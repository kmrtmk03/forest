import {
  Box3,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  MathUtils,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three"
import type { WebGLProgramParametersWithUniforms } from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { hash2, mulberry32, randomRange } from "@/experience/procedural/random.utils"
import { insertAfterShaderChunk } from "@/experience/shaders/shaderChunk.utils"

import {
  BARK_RADIAL_SEGMENTS_BY_ORDER,
  FRACTAL_TREE_SPECIES,
  MIN_BRANCH_RADIUS,
  SHAPES_PER_SPECIES,
  TREE_SHAPE_SEED,
} from "./fractalTree.constants"
import type { IFractalTreeSpecies } from "./fractalTree.type"
import { createLeafTexture } from "./leafTexture.utils"
import type { IPropModel } from "./propModel.type"

/** 上方向（幹の向き） */
const UP = new Vector3(0, 1, 0)

/** 葉の切り抜きのしきい値（画像のアルファがこれ未満の画素は描かない） */
const LEAF_ALPHA_TEST = 0.5

/** 葉の法線を「樹冠の中心から外向き」にするとき、上向きに寄せる量。上面が明るく、下面が暗い樹冠になる */
const LEAF_NORMAL_UP_BIAS = 0.6

/** 葉の板の大きさのばらつき（±割合） */
const LEAF_SIZE_VARIATION = 0.2

/** 枝の円柱を節の先へ少し延ばす量（半径に対する割合）。曲がり目の継ぎ目に隙間が見えないようにする */
const BRANCH_JOINT_OVERLAP = 1

/** 枝 1 本分（節と節の間）の円柱 */
interface IBranchSegment {
  start: Vector3
  end: Vector3
  startRadius: number
  endRadius: number
  /** 枝分かれの次数（0 = 幹） */
  order: number
}

/** 葉の板 1 枚 */
interface ILeafCard {
  center: Vector3
  rotation: Euler
  size: number
}

/** 生成した木の骨格（枝の円柱と葉の板の一覧） */
interface ITreeSkeleton {
  segments: IBranchSegment[]
  leaves: ILeafCard[]
}

/**
 * 木の骨格を再帰的に作る。1 本の軸を節で区切り、各節から細い軸を斜めに生やす。生えた軸も同じ規則で枝分かれする。
 * 乱数は呼び出し順で決まるため、同じ random からは必ず同じ木ができる
 */
class TreeSkeletonBuilder {
  readonly skeleton: ITreeSkeleton = { segments: [], leaves: [] }

  // 向きの計算に使い回す作業用オブジェクト
  private readonly axis = new Vector3()
  private readonly rotation = new Quaternion()

  constructor(
    private readonly species: IFractalTreeSpecies,
    private readonly random: () => number,
  ) {}

  /** 幹から木全体を作る */
  build(): ITreeSkeleton {
    const { trunkLength, trunkRadius } = this.species
    this.growAxis(0, new Vector3(), UP.clone(), trunkLength, trunkRadius)
    return this.skeleton
  }

  /**
   * 1 本の軸（幹・枝）を節ごとに伸ばし、各節で葉と子の枝を付ける
   * @param order 枝分かれの次数（0 = 幹）
   * @param start 軸の根元
   * @param direction 軸の向き（単位ベクトル）
   * @param length 軸の長さ
   * @param radius 軸の根元の半径
   */
  private growAxis(
    order: number,
    start: Vector3,
    direction: Vector3,
    length: number,
    radius: number,
  ): void {
    const { species } = this
    const segmentCount = order === 0 ? species.trunkSegments : species.branchSegments
    const segmentLength = length / segmentCount
    const point = start.clone()
    const heading = direction.clone()

    for (let index = 0; index < segmentCount; index++) {
      // 根元から先端へ向けて、半径を tipRadiusRatio まで細くする
      const progress = (index + 1) / segmentCount
      const startRadius = Math.max(
        MIN_BRANCH_RADIUS,
        radius * MathUtils.lerp(1, species.tipRadiusRatio, index / segmentCount),
      )
      const endRadius = Math.max(
        MIN_BRANCH_RADIUS,
        radius * MathUtils.lerp(1, species.tipRadiusRatio, progress),
      )
      const end = point.clone().addScaledVector(heading, segmentLength)
      this.skeleton.segments.push({ start: point.clone(), end, startRadius, endRadius, order })

      // 幹は firstBranchHeightRatio より上の節からだけ、枝と葉を付ける
      const canSprout = order > 0 || progress >= species.firstBranchHeightRatio
      if (canSprout && order >= species.leaves.minOrder) this.addLeaves(end)
      if (canSprout && order < species.maxOrder) {
        this.growBranches(order, end, heading, length, endRadius, progress)
      }

      // 次の節へ: 少し揺らし、gravity の分だけ上（負なら下）へ曲げる
      this.perturb(heading, species.wobble)
      heading.y += species.gravity
      heading.normalize()
      point.copy(end)
    }
  }

  /**
   * 節から子の枝を生やす
   * @param parentOrder 親の軸の次数
   * @param node 節の位置
   * @param parentDirection 親の軸の向き
   * @param parentLength 親の軸の長さ
   * @param nodeRadius 節での親の半径
   * @param heightRatio 親の軸の根元から節までの割合（0〜1）。上の節ほど枝を短くするのに使う
   */
  private growBranches(
    parentOrder: number,
    node: Vector3,
    parentDirection: Vector3,
    parentLength: number,
    nodeRadius: number,
    heightRatio: number,
  ): void {
    const { species, random } = this
    const [minCount, maxCount] = species.branchesPerNode
    const count = Math.floor(randomRange(random, minCount, maxCount + 1))
    // 節ごとに枝の向きの基準を回し、真上から見たときに枝が一列に並ばないようにする
    const baseAzimuth = random() * Math.PI * 2
    const lengthScale = 1 - species.topTaper * heightRatio

    for (let index = 0; index < count; index++) {
      const azimuth = baseAzimuth + (index / count) * Math.PI * 2 + randomRange(random, -0.3, 0.3)
      const angle = MathUtils.degToRad(randomRange(random, ...species.branchAngleDegrees))
      const direction = this.tiltAway(parentDirection, angle, azimuth)
      this.growAxis(
        parentOrder + 1,
        node,
        direction,
        parentLength * species.branchLengthRatio * lengthScale,
        nodeRadius * species.branchRadiusRatio,
      )
    }
  }

  /** 節のまわりに葉の板を散らす */
  private addLeaves(node: Vector3): void {
    const { leaves } = this.species
    const { random } = this
    for (let index = 0; index < leaves.cardsPerNode; index++) {
      const offset = new Vector3(
        randomRange(random, -1, 1),
        randomRange(random, -1, 1),
        randomRange(random, -1, 1),
      ).multiplyScalar(leaves.spread)
      this.skeleton.leaves.push({
        center: node.clone().add(offset),
        rotation: new Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2),
        size:
          leaves.cardSize * randomRange(random, 1 - LEAF_SIZE_VARIATION, 1 + LEAF_SIZE_VARIATION),
      })
    }
  }

  /**
   * 親の向きから angle だけ開いた向きを作る。開く方向は、親の軸のまわりの角度 azimuth で決める
   * @returns 新しい単位ベクトル
   */
  private tiltAway(parentDirection: Vector3, angle: number, azimuth: number): Vector3 {
    // 親の向きに垂直な軸を作り、親の向きのまわりに azimuth だけ回す
    this.axis.crossVectors(parentDirection, UP)
    if (this.axis.lengthSq() < 1e-6) this.axis.set(1, 0, 0)
    this.axis.normalize().applyQuaternion(this.rotation.setFromAxisAngle(parentDirection, azimuth))
    return parentDirection.clone().applyQuaternion(this.rotation.setFromAxisAngle(this.axis, angle))
  }

  /** 向きを最大 amount ラジアンだけランダムに揺らす（direction を書き換える） */
  private perturb(direction: Vector3, amount: number): void {
    if (amount === 0) return
    const angle = randomRange(this.random, 0, amount)
    const azimuth = this.random() * Math.PI * 2
    direction.copy(this.tiltAway(direction, angle, azimuth))
  }
}

/** 枝の円柱をまとめて 1 つのジオメトリにする（InstancedMesh 1 つで描くため） */
const buildBarkGeometry = (segments: readonly IBranchSegment[]): BufferGeometry => {
  const direction = new Vector3()
  const quaternion = new Quaternion()
  const pieces = segments.map(({ start, end, startRadius, endRadius, order }) => {
    direction.subVectors(end, start)
    const length = direction.length()
    direction.normalize()
    const radialSegments =
      BARK_RADIAL_SEGMENTS_BY_ORDER[Math.min(order, BARK_RADIAL_SEGMENTS_BY_ORDER.length - 1)]
    // 蓋のない円柱（openEnded）にして三角形を節約する。継ぎ目は次の円柱と重ねて隠す
    const overlap = endRadius * BRANCH_JOINT_OVERLAP
    const geometry = new CylinderGeometry(
      endRadius,
      startRadius,
      length + overlap,
      radialSegments,
      1,
      true,
    )
    // 円柱の根元を原点に合わせてから、軸の向きへ回して根元の位置へ移す
    geometry.translate(0, (length + overlap) / 2, 0)
    geometry.applyQuaternion(quaternion.setFromUnitVectors(UP, direction))
    geometry.translate(start.x, start.y, start.z)
    return geometry
  })
  return mergeAndDispose(pieces)
}

/**
 * 葉の板をまとめて 1 つのジオメトリにする。
 * 法線は板の向きではなく「樹冠の中心から外向き（少し上寄り）」にする。
 * 板の向きのままだと、ばらばらの向きの板が明暗のまだらになるため、樹冠を 1 つの塊として陰影を付ける
 */
const buildLeafGeometry = (leaves: readonly ILeafCard[]): BufferGeometry => {
  const crownCenter = leaves
    .reduce((sum, { center }) => sum.add(center), new Vector3())
    .divideScalar(Math.max(1, leaves.length))
  const normal = new Vector3()

  const pieces = leaves.map(({ center, rotation, size }) => {
    const geometry = new PlaneGeometry(size, size)
    geometry.rotateX(rotation.x).rotateY(rotation.y).rotateZ(rotation.z)
    geometry.translate(center.x, center.y, center.z)

    normal.subVectors(center, crownCenter).normalize()
    normal.y += LEAF_NORMAL_UP_BIAS
    normal.normalize()
    const vertexCount = geometry.getAttribute("position").count
    const normals = Array.from({ length: vertexCount }, () => [normal.x, normal.y, normal.z]).flat()
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3))
    return geometry
  })
  return mergeAndDispose(pieces)
}

/**
 * 複数のジオメトリを 1 つにまとめ、元のジオメトリを破棄する
 * @throws まとめられなかった場合
 */
const mergeAndDispose = (geometries: BufferGeometry[]): BufferGeometry => {
  const merged = mergeGeometries(geometries)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error("fractalTreeModels: ジオメトリをまとめられませんでした")
  return merged
}

/**
 * 幹・枝と葉のジオメトリを、全高が species.height になるよう同じ倍率で拡大縮小する。
 * 根元（原点）は動かさない
 */
const fitToHeight = (height: number, ...geometries: BufferGeometry[]): void => {
  const bounds = new Box3()
  geometries.forEach((geometry) => {
    geometry.computeBoundingBox()
    if (geometry.boundingBox) bounds.union(geometry.boundingBox)
  })
  const scale = height / bounds.max.y
  geometries.forEach((geometry) => geometry.scale(scale, scale, scale))
}

/**
 * 葉のシェーダー改変: 両面描画でも法線を裏返さない。
 * three.js は両面描画（DoubleSide）の裏面で法線を反転するが、葉の法線は樹冠の外向きにそろえてあるため、
 * 反転すると裏から見た葉だけが暗くなる。normal_fragment_begin の後で、反転前の法線に戻す
 */
const patchLeafShader = (shader: WebGLProgramParametersWithUniforms): void => {
  shader.fragmentShader = insertAfterShaderChunk(
    shader.fragmentShader,
    "normal_fragment_begin",
    "normal = normalize( vNormal );",
  )
}

/**
 * フラクタルの木のモデル一覧を作る。種類ごとに SHAPES_PER_SPECIES 個の形を作り、
 * モデル番号は「種類の添字 × SHAPES_PER_SPECIES + 形の添字」にする（placement.constants.ts の木の variantWeights と対応）。
 * 部品は幹・枝（フラットシェーディング）と、板ポリの葉（切り抜き）の 2 つ。
 * 返したジオメトリ・マテリアル・テクスチャの破棄は、受け取った側（Forest）が行うこと
 * @param curvatureUniforms 曲げ変換の共有 uniform
 */
export const createFractalTreeModels = (curvatureUniforms: ICurvatureUniforms): IPropModel[] =>
  FRACTAL_TREE_SPECIES.flatMap((species, speciesIndex) => {
    // 同じ種類の形どうしで、マテリアル（と葉の画像）を共有する
    const barkMaterial = applyCurvature(
      new MeshLambertMaterial({ color: species.barkColor, flatShading: true }),
      curvatureUniforms,
      { cacheKey: "prop" },
    )
    const leafMaterial = applyCurvature(
      new MeshLambertMaterial({
        color: species.leaves.color,
        map: createLeafTexture(species.leaves.texture),
        alphaTest: LEAF_ALPHA_TEST,
        // MSAA で葉の縁を滑らかにし、遠くで葉が細かくちらつくのを抑える
        alphaToCoverage: true,
        side: DoubleSide,
      }),
      curvatureUniforms,
      { cacheKey: "leaf", patchShader: patchLeafShader },
    )

    return Array.from({ length: SHAPES_PER_SPECIES }, (_, shapeIndex): IPropModel => {
      const random = mulberry32(hash2(speciesIndex, shapeIndex, TREE_SHAPE_SEED))
      const skeleton = new TreeSkeletonBuilder(species, random).build()
      const barkGeometry = buildBarkGeometry(skeleton.segments)
      const leafGeometry = buildLeafGeometry(skeleton.leaves)
      fitToHeight(species.height, barkGeometry, leafGeometry)

      return {
        kind: "tree",
        variant: speciesIndex * SHAPES_PER_SPECIES + shapeIndex,
        parts: [
          { geometry: barkGeometry, material: barkMaterial },
          { geometry: leafGeometry, material: leafMaterial },
        ],
      }
    })
  })
