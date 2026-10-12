import { Color, Euler, Group, InstancedMesh, MathUtils, Matrix4, Quaternion, Vector3 } from "three"
import type { Material } from "three"

import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { WORLD_SEED } from "@/experience/procedural/placement.constants"
import type {
  IPropPlacement,
  TPlacementChunks,
  TPropKind,
} from "@/experience/procedural/placement.type"
import {
  assertPlacementSettings,
  CHUNK_COUNT,
  generatePlacements,
  listVisibleChunks,
} from "@/experience/procedural/placement.utils"

import { createPrimitivePropModels } from "./primitivePropModels.utils"
import type { IPropModel } from "./propModel.type"
import { CHUNK_LENGTH, VISIBLE_CHUNKS_AHEAD, VISIBLE_CHUNKS_BEHIND } from "./world.constants"

/** モデルを (kind, variant) で引くためのキー（例: "tree:0"） */
type TModelKey = `${TPropKind}:${number}`

/**
 * 配置またはモデルから、両者を対応づけるキーを作る。
 * 配置（IPropPlacement）とモデル（IPropModel）は kind と variant が同じなら同じキーになる
 */
const toModelKey = ({ kind, variant }: { kind: TPropKind; variant: number }): TModelKey =>
  `${kind}:${variant}`

/** 傾きの回転順。先に向き（Y）を決め、その向きの横軸（X）まわりに倒す */
const TILT_EULER_ORDER = "YXZ"

/**
 * InstancedMesh へ書き込む 1 個体分のデータ。
 * 配置は seed を変えない限り変わらないため、行列は生成時に一度だけ作り、詰め直しでは書き写すだけにする
 */
interface IPropInstance {
  key: TModelKey
  /** インスタンス行列（コース座標への平行移動・向き・傾き・拡大率） */
  matrix: Matrix4
  /** 色の明るさの倍率（IPropPlacement.tint） */
  tint: number
}

/** チャンク番号ごとの個体の配列（TPlacementChunks と同じ並び） */
type TInstanceChunks = IPropInstance[][]

/**
 * 木・岩などの配置物を描く。
 *
 * 1 周分の配置は起動時（と seed の変更時）に一度だけ生成し、チャンク（CHUNK_LENGTH = 5m）ごとに保持する。
 * カメラが別のチャンクへ入ったときだけ、前後の可視チャンクの配置を InstancedMesh へ詰め直す（計画書 §10-3）。
 * インスタンス行列にはコース座標をそのまま入れ、移動・折り返し・湾曲はシェーダー（applyCurvature）が行う。
 *
 * モデルの部品（幹・葉など）ごとに InstancedMesh を 1 つ作るため、Draw Call は「部品の数」になる。
 */
export class Forest {
  /** 配置物の InstancedMesh をまとめたグループ。シーンへ追加すること */
  readonly group = new Group()
  private readonly models: readonly IPropModel[]
  /** モデルごとの InstancedMesh（部品の数だけ）。seed を変えると作り直す */
  private readonly meshesByModel = new Map<TModelKey, InstancedMesh[]>()
  private instanceChunks: TInstanceChunks = []
  private currentSeed = WORLD_SEED
  /** いま詰めてあるチャンク。null のときは次の update で必ず詰め直す */
  private currentChunk: number | null = null

  // 詰め直しで使い回す作業用オブジェクト（毎回 new しない）
  private readonly color = new Color()
  private readonly fillCounts = new Map<TModelKey, number>()

  /**
   * @param curvatureUniforms 曲げ変換の共有 uniform（配置物のマテリアルへ渡す）
   * @throws 配置の設定が 1 周の長さと矛盾する場合、可視チャンクの数が 1 周のチャンク数を超える場合、
   *   配置に対応するモデルがない場合。例外を投げるときは、作ったモデルを破棄してから投げる
   */
  constructor(curvatureUniforms: ICurvatureUniforms) {
    assertPlacementSettings()
    // 可視範囲が 1 周を超えると、同じチャンクを 2 回詰めて同じ物を二重に描いてしまう
    if (VISIBLE_CHUNKS_BEHIND + 1 + VISIBLE_CHUNKS_AHEAD > CHUNK_COUNT) {
      throw new Error("Forest: 可視チャンクの数が 1 周のチャンク数を超えています")
    }

    this.models = createPrimitivePropModels(curvatureUniforms)
    try {
      this.rebuild(WORLD_SEED)
    } catch (error) {
      // 呼び出し側は生成に失敗したインスタンスを受け取れず dispose できないため、ここで破棄する
      this.disposeModels()
      throw error
    }
  }

  /** いまの森の seed */
  get seed(): number {
    return this.currentSeed
  }

  /**
   * seed を変えて森を作り直す（デバッグ GUI 用）。配置の生成と InstancedMesh の作り直しを伴うため、毎フレーム呼ばないこと
   * @param seed 新しい seed（整数）
   * @throws 配置に対応するモデルがない場合。そのときは元の森を残したままにする
   */
  setSeed(seed: number): void {
    this.rebuild(seed)
  }

  /**
   * カメラの位置に合わせて、描画する配置物を更新する。毎フレーム呼ぶこと。
   * チャンクが変わったときだけ詰め直すため、ほとんどのフレームでは何もしない
   * @param cameraS カメラのコース s（COURSE_LENGTH で折り返した値）
   */
  update(cameraS: number): void {
    const cameraChunk = MathUtils.euclideanModulo(Math.floor(cameraS / CHUNK_LENGTH), CHUNK_COUNT)
    if (cameraChunk === this.currentChunk) return
    this.fill(cameraChunk)
  }

  /** InstancedMesh・ジオメトリ・マテリアルをすべて破棄する */
  dispose(): void {
    this.disposeMeshes()
    this.disposeModels()
  }

  /**
   * 指定の seed で配置を生成し直し、InstancedMesh を必要な容量で作り直してから、いまのチャンクで詰める。
   * 例外を投げうる処理（個体の作成・容量の計算）を先に済ませ、成功してから古い InstancedMesh と入れ替える。
   * 生成直後に詰めることで、最初のシェーダーのコンパイル（compileAsync）の時点でインスタンスの色を持たせ、
   * 歩き始めてからの再コンパイルを防ぐ
   * @throws 配置に対応するモデルがない場合
   */
  private rebuild(seed: number): void {
    const instanceChunks = this.createInstances(generatePlacements(seed))
    const capacities = Forest.measureCapacities(instanceChunks)

    // ここから先は例外を投げない
    this.disposeMeshes()
    this.instanceChunks = instanceChunks
    this.currentSeed = seed
    this.models.forEach((model) => {
      const capacity = capacities.get(toModelKey(model)) ?? 0
      // 一度も可視範囲に入らないモデルは作らない
      if (capacity === 0) return

      const meshes = model.parts.map(({ geometry, material }) => {
        const mesh = new InstancedMesh(geometry, material, capacity)
        // 頂点をシェーダーで曲げるため、three.js の視錐台カリングは正しく判定できない。
        // 代わりに可視チャンクだけを詰めることで、距離によるカリングを行う
        mesh.frustumCulled = false
        return mesh
      })
      this.meshesByModel.set(toModelKey(model), meshes)
      this.group.add(...meshes)
    })

    this.fill(this.currentChunk ?? 0)
  }

  /**
   * 配置データから、InstancedMesh へ書き込む個体のデータ（行列）を作る
   * @throws 配置に対応するモデルがない場合（配置ルールの variantWeights とモデルの数が合っていない）
   */
  private createInstances(placementChunks: TPlacementChunks): TInstanceChunks {
    const modelKeys = new Set(this.models.map(toModelKey))
    // 行列の合成に使う作業用オブジェクト（生成時にしか使わないので、ここで作る）
    const position = new Vector3()
    const rotation = new Euler(0, 0, 0, TILT_EULER_ORDER)
    const quaternion = new Quaternion()
    const scale = new Vector3()

    return placementChunks.map((placements) =>
      placements.map((placement: IPropPlacement): IPropInstance => {
        const key = toModelKey(placement)
        if (!modelKeys.has(key)) {
          throw new Error(`Forest: 配置 ${key} に対応するモデルがありません`)
        }
        // 平面ワールド座標は (x, 高さ, -s)。s はコース座標のまま入れ、折り返しはシェーダーに任せる
        position.set(placement.x, placement.height, -placement.s)
        rotation.set(placement.tilt, placement.rotationY, 0)
        quaternion.setFromEuler(rotation)
        scale.setScalar(placement.scale)
        return {
          key,
          matrix: new Matrix4().compose(position, quaternion, scale),
          tint: placement.tint,
        }
      }),
    )
  }

  /**
   * モデルごとに、可視範囲へ同時に入る最大の個数を数える。
   * InstancedMesh のバッファをこの容量で確保し、詰め直しのたびに再確保しないようにする
   */
  private static measureCapacities(instanceChunks: TInstanceChunks): Map<TModelKey, number> {
    const capacities = new Map<TModelKey, number>()

    for (let cameraChunk = 0; cameraChunk < CHUNK_COUNT; cameraChunk++) {
      const counts = new Map<TModelKey, number>()
      listVisibleChunks(cameraChunk, VISIBLE_CHUNKS_BEHIND, VISIBLE_CHUNKS_AHEAD).forEach((chunk) =>
        instanceChunks[chunk].forEach(({ key }) => counts.set(key, (counts.get(key) ?? 0) + 1)),
      )
      counts.forEach((count, key) => capacities.set(key, Math.max(capacities.get(key) ?? 0, count)))
    }
    return capacities
  }

  /**
   * カメラのいるチャンクの前後にある個体を、InstancedMesh へ詰め直す
   * @param cameraChunk カメラのいるチャンク番号（0〜CHUNK_COUNT - 1）
   */
  private fill(cameraChunk: number): void {
    this.currentChunk = cameraChunk
    this.fillCounts.clear()

    listVisibleChunks(cameraChunk, VISIBLE_CHUNKS_BEHIND, VISIBLE_CHUNKS_AHEAD).forEach((chunk) =>
      this.instanceChunks[chunk].forEach((instance) => this.writeInstance(instance)),
    )

    // 詰めた数だけを描画し、行列と色の更新を GPU へ送る
    this.meshesByModel.forEach((meshes, key) => {
      const count = this.fillCounts.get(key) ?? 0
      meshes.forEach((mesh) => {
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      })
    })
  }

  /** 1 個体の行列と色を、そのモデルの全部品の InstancedMesh の末尾へ書き込む */
  private writeInstance({ key, matrix, tint }: IPropInstance): void {
    const meshes = this.meshesByModel.get(key)
    if (!meshes) return

    const index = this.fillCounts.get(key) ?? 0
    this.fillCounts.set(key, index + 1)
    // 色はマテリアルの色に掛かるため、白 × 明るさの倍率にする
    this.color.setScalar(tint)

    meshes.forEach((mesh) => {
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, this.color)
    })
  }

  /** いまの InstancedMesh をシーンから外して破棄する（ジオメトリ・マテリアルはモデルが持つので残す） */
  private disposeMeshes(): void {
    this.meshesByModel.forEach((meshes) =>
      meshes.forEach((mesh) => {
        this.group.remove(mesh)
        mesh.dispose()
      }),
    )
    this.meshesByModel.clear()
  }

  /** モデルのジオメトリ・マテリアルを破棄する */
  private disposeModels(): void {
    // 幹のマテリアルのように複数の部品で共有している物があるため、重複を除いてから破棄する
    const materials = new Set<Material>()
    this.models.forEach(({ parts }) =>
      parts.forEach(({ geometry, material }) => {
        geometry.dispose()
        materials.add(material)
      }),
    )
    materials.forEach((material) => material.dispose())
  }
}
