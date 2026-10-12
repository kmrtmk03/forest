import { DodecahedronGeometry, IcosahedronGeometry, MeshLambertMaterial } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import type { IPropModel } from "./propModel.type"

/**
 * 3D モデルが用意できるまでの仮の岩を、three.js のプリミティブ形状で作る。
 * 寸法はすべて m。原点は根元の中心で、大きさはモデル単体（拡大率 1）の値。
 * フラットシェーディングでローポリの見た目にする。
 * TODO: GLB を用意したら AssetManager から同じ IPropModel の形で返して差し替える
 */

/** 色（マテリアルの基本色。個体差はインスタンスの色で掛ける） */
const ANGULAR_ROCK_COLOR = "#7d7f78"
const ROUND_ROCK_COLOR = "#6b6a62"

/** 岩: 平たくつぶした多面体。中心を少し持ち上げ、下側を地面に埋める */
const ANGULAR_ROCK_RADIUS = 0.6
const ANGULAR_ROCK_SCALE = [1, 0.6, 0.8] as const
const ROUND_ROCK_RADIUS = 0.5
const ROUND_ROCK_SCALE = [1.1, 0.7, 1] as const
const ROCK_CENTER_Y = 0.15

/** 曲げ変換を適用したフラットシェーディングのマテリアルを作る */
const createRockMaterial = (
  color: string,
  curvatureUniforms: ICurvatureUniforms,
): MeshLambertMaterial =>
  applyCurvature(new MeshLambertMaterial({ color, flatShading: true }), curvatureUniforms, {
    // シェーダーの改変は曲げ変換だけなので、幹・枝のマテリアルと同じプログラムを共有できる
    cacheKey: "prop",
  })

/**
 * 仮の岩のモデル一覧を作る（角ばった岩・丸みのある岩の 2 種）。
 * 返したジオメトリ・マテリアルの破棄は、受け取った側（Forest）が行うこと
 * @param curvatureUniforms 曲げ変換の共有 uniform
 */
export const createPrimitiveRockModels = (curvatureUniforms: ICurvatureUniforms): IPropModel[] => [
  {
    kind: "rock",
    variant: 0,
    parts: [
      {
        geometry: new IcosahedronGeometry(ANGULAR_ROCK_RADIUS, 0)
          .scale(...ANGULAR_ROCK_SCALE)
          .translate(0, ROCK_CENTER_Y, 0),
        material: createRockMaterial(ANGULAR_ROCK_COLOR, curvatureUniforms),
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
        material: createRockMaterial(ROUND_ROCK_COLOR, curvatureUniforms),
      },
    ],
  },
]
