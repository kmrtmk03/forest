import {
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  MeshLambertMaterial,
  OctahedronGeometry,
} from "three"
import type { BufferGeometry } from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import type { IPropModel } from "./propModel.type"

/**
 * 3D モデルが用意できるまでの仮の配置物を、three.js のプリミティブ形状で作る。
 * 寸法はすべて m。原点は根元の中心で、高さはモデル単体（拡大率 1）の値。
 * フラットシェーディングでローポリの見た目にする。
 * TODO: GLB を用意したら AssetManager から同じ IPropModel の形で返して差し替える
 */

/** 円柱・円錐の周方向の分割数。少なめにしてローポリらしく角を見せる */
const TRUNK_RADIAL_SEGMENTS = 6
const CONE_RADIAL_SEGMENTS = 7

/** 色（マテリアルの基本色。個体差はインスタンスの色で掛ける） */
const TRUNK_COLOR = "#5a4030"
const FIR_FOLIAGE_COLOR = "#2f5a3a"
const BROADLEAF_FOLIAGE_COLOR = "#4a7a3a"
const POPLAR_FOLIAGE_COLOR = "#3d6b40"
const ANGULAR_ROCK_COLOR = "#7d7f78"
const ROUND_ROCK_COLOR = "#6b6a62"

/** 幹: 根元が少し太い円柱 */
interface ITrunkSize {
  /** 上端の半径（m） */
  topRadius: number
  /** 根元の半径（m） */
  bottomRadius: number
  /** 高さ（m）。根元を地面に埋める分（rootSink）も含める */
  height: number
}

/** 原点を根元に置いた幹のジオメトリを作る */
const createTrunkGeometry = ({ topRadius, bottomRadius, height }: ITrunkSize): BufferGeometry =>
  new CylinderGeometry(topRadius, bottomRadius, height, TRUNK_RADIAL_SEGMENTS).translate(
    0,
    height / 2,
    0,
  )

/**
 * 針葉樹の葉: 3 段に重ねた円錐（上ほど小さい）。全高 約 5.6m
 * [半径, 高さ, 円錐の下端の高さ]
 */
const FIR_TIERS = [
  [1.8, 2.6, 1.2],
  [1.4, 2.2, 2.4],
  [1.0, 1.8, 3.8],
] as const

/** 広葉樹の葉: 2 つの二十面体を重ねた丸い樹冠。全高 約 5.4m */
const BROADLEAF_CROWN_RADIUS = 1.7
const BROADLEAF_CROWN_CENTER_Y = 3.7
const BROADLEAF_SUB_CROWN_RADIUS = 1.1
const BROADLEAF_SUB_CROWN_OFFSET = [0.9, -0.4, 0.4] as const

/** 細長い木の葉: 縦に引き伸ばした八面体。全高 約 6.2m */
const POPLAR_CROWN_RADIUS = 0.9
const POPLAR_CROWN_STRETCH_Y = 2.9
const POPLAR_CROWN_CENTER_Y = 3.6

/** 岩: 平たくつぶした多面体。中心を少し持ち上げ、下側を地面に埋める */
const ANGULAR_ROCK_RADIUS = 0.6
const ANGULAR_ROCK_SCALE = [1, 0.6, 0.8] as const
const ROUND_ROCK_RADIUS = 0.5
const ROUND_ROCK_SCALE = [1.1, 0.7, 1] as const
const ROCK_CENTER_Y = 0.15

/** 針葉樹の葉のジオメトリ。円錐を重ねて 1 つにまとめる（InstancedMesh 1 つで描くため） */
const createFirFoliageGeometry = (): BufferGeometry => {
  const tiers = FIR_TIERS.map(([radius, height, baseY]) =>
    new ConeGeometry(radius, height, CONE_RADIAL_SEGMENTS).translate(0, baseY + height / 2, 0),
  )
  return mergeTiers(tiers)
}

/** 広葉樹の葉のジオメトリ。大小 2 つの二十面体をずらして重ね、いびつな丸みを出す */
const createBroadleafFoliageGeometry = (): BufferGeometry => {
  const main = new IcosahedronGeometry(BROADLEAF_CROWN_RADIUS, 0).translate(
    0,
    BROADLEAF_CROWN_CENTER_Y,
    0,
  )
  const [offsetX, offsetY, offsetZ] = BROADLEAF_SUB_CROWN_OFFSET
  const sub = new IcosahedronGeometry(BROADLEAF_SUB_CROWN_RADIUS, 0).translate(
    offsetX,
    BROADLEAF_CROWN_CENTER_Y + offsetY,
    offsetZ,
  )
  return mergeTiers([main, sub])
}

/** 細長い木の葉のジオメトリ */
const createPoplarFoliageGeometry = (): BufferGeometry =>
  new OctahedronGeometry(POPLAR_CROWN_RADIUS, 0)
    .scale(1, POPLAR_CROWN_STRETCH_Y, 1)
    .translate(0, POPLAR_CROWN_CENTER_Y, 0)

/**
 * 複数のジオメトリを 1 つにまとめ、元のジオメトリを破棄する。
 * 種類の違うプリミティブ（index の有無が違う）が混ざると mergeGeometries が失敗するため、
 * 同じ種類のジオメトリだけを渡すこと
 * @throws まとめられなかった場合
 */
const mergeTiers = (geometries: BufferGeometry[]): BufferGeometry => {
  const merged = mergeGeometries(geometries)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error("primitivePropModels: ジオメトリをまとめられませんでした")
  return merged
}

/** 曲げ変換を適用したフラットシェーディングのマテリアルを作る */
const createPropMaterial = (
  color: string,
  curvatureUniforms: ICurvatureUniforms,
): MeshLambertMaterial =>
  applyCurvature(new MeshLambertMaterial({ color, flatShading: true }), curvatureUniforms, {
    // シェーダーの改変は曲げ変換だけなので、配置物のマテリアルはすべて同じプログラムを共有できる
    cacheKey: "prop",
  })

/**
 * 仮の配置物のモデル一覧を作る。
 * 木 3 種（針葉樹・広葉樹・細長い木）× 幹と葉、岩 2 種。幹のマテリアルは木の 3 種で共有する。
 * 返したジオメトリ・マテリアルの破棄は、受け取った側（Forest）が行うこと
 * @param curvatureUniforms 曲げ変換の共有 uniform
 */
export const createPrimitivePropModels = (curvatureUniforms: ICurvatureUniforms): IPropModel[] => {
  const trunkMaterial = createPropMaterial(TRUNK_COLOR, curvatureUniforms)

  return [
    {
      kind: "tree",
      variant: 0,
      parts: [
        {
          geometry: createTrunkGeometry({ topRadius: 0.18, bottomRadius: 0.26, height: 1.6 }),
          material: trunkMaterial,
        },
        {
          geometry: createFirFoliageGeometry(),
          material: createPropMaterial(FIR_FOLIAGE_COLOR, curvatureUniforms),
        },
      ],
    },
    {
      kind: "tree",
      variant: 1,
      parts: [
        {
          geometry: createTrunkGeometry({ topRadius: 0.16, bottomRadius: 0.24, height: 2.6 }),
          material: trunkMaterial,
        },
        {
          geometry: createBroadleafFoliageGeometry(),
          material: createPropMaterial(BROADLEAF_FOLIAGE_COLOR, curvatureUniforms),
        },
      ],
    },
    {
      kind: "tree",
      variant: 2,
      parts: [
        {
          geometry: createTrunkGeometry({ topRadius: 0.12, bottomRadius: 0.18, height: 1.4 }),
          material: trunkMaterial,
        },
        {
          geometry: createPoplarFoliageGeometry(),
          material: createPropMaterial(POPLAR_FOLIAGE_COLOR, curvatureUniforms),
        },
      ],
    },
    {
      kind: "rock",
      variant: 0,
      parts: [
        {
          geometry: new IcosahedronGeometry(ANGULAR_ROCK_RADIUS, 0)
            .scale(...ANGULAR_ROCK_SCALE)
            .translate(0, ROCK_CENTER_Y, 0),
          material: createPropMaterial(ANGULAR_ROCK_COLOR, curvatureUniforms),
        },
      ],
    },
    {
      kind: "rock",
      variant: 1,
      parts: [
        {
          geometry: new DodecahedronGeometry(ROUND_ROCK_RADIUS, 0)
            .scale(...ROUND_ROCK_SCALE)
            .translate(0, ROCK_CENTER_Y, 0),
          material: createPropMaterial(ROUND_ROCK_COLOR, curvatureUniforms),
        },
      ],
    },
  ]
}
