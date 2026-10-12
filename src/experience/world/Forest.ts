import { Color, Euler, Group, InstancedMesh, MathUtils, Matrix4, Quaternion, Vector3 } from "three"
import type { Material } from "three"

import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { WORLD_SEED } from "@/experience/procedural/placement.constants"
import type { IPropPlacement, TPlacementChunks } from "@/experience/procedural/placement.type"
import {
  CHUNK_COUNT,
  generatePlacements,
  listVisibleChunks,
} from "@/experience/procedural/placement.utils"

import { createPrimitivePropModels } from "./primitivePropModels.utils"
import type { IPropModel } from "./propModel.type"
import { CHUNK_LENGTH, VISIBLE_CHUNKS_AHEAD, VISIBLE_CHUNKS_BEHIND } from "./world.constants"

/** モデルを (kind, variant) で引くためのキー */
type TModelKey = `${IPropPlacement["kind"]}:${number}`

const toModelKey = ({ kind, variant }: Pick<IPropPlacement, "kind" | "variant">): TModelKey =>
  `${kind}:${variant}`

/** 傾きの回転順。先に向き（Y）を決め、その向きの横軸（X）まわりに倒す */
const TILT_EULER_ORDER = "YXZ"

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
  private chunks: TPlacementChunks = []
  private currentSeed: number
  /** いま詰めてあるチャンク。null のときは次の update で必ず詰め直す */
  private currentChunk: number | null = null

  // 詰め直しで使い回す作業用オブジェクト（毎回 new しない）
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Euler(0, 0, 0, TILT_EULER_ORDER)
  private readonly quaternion = new Quaternion()
  private readonly scale = new Vector3()
  private readonly color = new Color()
  private readonly fillCounts = new Map<TModelKey, number>()

  /**
   * @param curvatureUniforms 曲げ変換の共有 uniform（配置物のマテリアルへ渡す）
   * @throws 可視チャンクの数が 1 周のチャンク数を超える設定の場合、配置に対応するモデルがない場合
   */
  constructor(curvatureUniforms: ICurvatureUniforms) {
    // 可視範囲が 1 周を超えると、同じチャンクを 2 回詰めて同じ物を二重に描いてしまう
    if (VISIBLE_CHUNKS_BEHIND + 1 + VISIBLE_CHUNKS_AHEAD > CHUNK_COUNT) {
      throw new Error("Forest: 可視チャンクの数が 1 周のチャンク数を超えています")
    }

    this.models = createPrimitivePropModels(curvatureUniforms)
    this.currentSeed = WORLD_SEED
    this.rebuild()
  }

  /** いまの森の seed */
  get seed(): number {
    return this.currentSeed
  }

  /**
   * seed を変えて森を作り直す（デバッグ GUI 用）。配置の生成と InstancedMesh の作り直しを伴うため、毎フレーム呼ばないこと
   * @param seed 新しい seed（整数）
   */
  setSeed(seed: number): void {
    this.currentSeed = seed
    this.rebuild()
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

  /**
   * いまの seed で配置を生成し直し、InstancedMesh を必要な容量で作り直してから、いまのチャンクで詰める。
   * 生成直後に詰めることで、最初のシェーダーのコンパイル（compileAsync）の時点でインスタンスの色を持たせ、
   * 歩き始めてからの再コンパイルを防ぐ
   */
  private rebuild(): void {
    this.chunks = generatePlacements(this.currentSeed)
    this.disposeMeshes()

    const capacities = this.measureCapacities()
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
   * モデルごとに、可視範囲へ同時に入る最大の個数を数える。
   * InstancedMesh のバッファをこの容量で確保し、詰め直しのたびに再確保しないようにする
   * @throws 配置に対応するモデルがない場合（配置ルールの variantWeights とモデルの数が合っていない）
   */
  private measureCapacities(): Map<TModelKey, number> {
    const modelKeys = new Set(this.models.map(toModelKey))
    const capacities = new Map<TModelKey, number>()

    for (let cameraChunk = 0; cameraChunk < CHUNK_COUNT; cameraChunk++) {
      const counts = new Map<TModelKey, number>()
      listVisibleChunks(cameraChunk, VISIBLE_CHUNKS_BEHIND, VISIBLE_CHUNKS_AHEAD).forEach((chunk) =>
        this.chunks[chunk].forEach((placement) => {
          const key = toModelKey(placement)
          if (!modelKeys.has(key)) {
            throw new Error(`Forest: 配置 ${key} に対応するモデルがありません`)
          }
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }),
      )
      counts.forEach((count, key) => capacities.set(key, Math.max(capacities.get(key) ?? 0, count)))
    }
    return capacities
  }

  /**
   * カメラのいるチャンクの前後にある配置を、InstancedMesh へ詰め直す
   * @param cameraChunk カメラのいるチャンク番号（0〜CHUNK_COUNT - 1）
   */
  private fill(cameraChunk: number): void {
    this.currentChunk = cameraChunk
    this.fillCounts.clear()

    listVisibleChunks(cameraChunk, VISIBLE_CHUNKS_BEHIND, VISIBLE_CHUNKS_AHEAD).forEach((chunk) =>
      this.chunks[chunk].forEach((placement) => this.writeInstance(placement)),
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
  private writeInstance(placement: IPropPlacement): void {
    const key = toModelKey(placement)
    const meshes = this.meshesByModel.get(key)
    if (!meshes) return

    const index = this.fillCounts.get(key) ?? 0
    this.fillCounts.set(key, index + 1)

    // 平面ワールド座標は (x, 高さ, -s)。s はコース座標のまま入れ、折り返しはシェーダーに任せる
    this.position.set(placement.x, placement.height, -placement.s)
    this.rotation.set(placement.tilt, placement.rotationY, 0)
    this.quaternion.setFromEuler(this.rotation)
    this.scale.setScalar(placement.scale)
    this.matrix.compose(this.position, this.quaternion, this.scale)
    // 色はマテリアルの色に掛かるため、白 × 明るさの倍率にする
    this.color.setScalar(placement.tint)

    meshes.forEach((mesh) => {
      mesh.setMatrixAt(index, this.matrix)
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
}
