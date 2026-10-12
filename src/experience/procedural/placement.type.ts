/**
 * 配置物（木・岩など）の配置データの型。Three.js に依存しない。
 */

/**
 * 配置物の種類。
 * MEMO: 計画書 §21 の log（倒木）・bush（低木）・grass（草）は、使い始める Phase で追加する
 */
export type TPropKind = "tree" | "rock"

/** 1 個体の配置情報（コース座標系） */
export interface IPropPlacement {
  kind: TPropKind
  /** 同じ kind 内のモデル番号（0 始まり） */
  variant: number
  /** 道の中心（直線時）からの横距離（m）。右が + */
  x: number
  /** コース上の距離（m、0 以上 COURSE_LENGTH 未満） */
  s: number
  /** 根元を置く高さ（m）。地面の起伏に合わせ、少し埋めた値 */
  height: number
  /** 鉛直軸まわりの回転（ラジアン） */
  rotationY: number
  /** 拡大率（1 = モデルそのままの大きさ） */
  scale: number
  /** 傾き（ラジアン）。rotationY で決まる向きへ倒す */
  tilt: number
  /** 色の明るさの倍率（1 = マテリアルの色のまま）。同じモデルの個体差を出す */
  tint: number
}

/** チャンク番号（floor(s / CHUNK_LENGTH)）ごとの配置の配列 */
export type TPlacementChunks = IPropPlacement[][]

/** 道からの距離と密度の対応点。点の間は直線で補間する */
export type TDensityPoint = readonly [distanceFromPath: number, density: number]

/** 1 種類の配置物を、どこにどれくらい置くかのルール */
export interface IPlacementRule {
  kind: TPropKind
  /** 配置セルの一辺（m）。1 セルに最大 1 個置く。COURSE_LENGTH を割り切る値にする */
  cellSize: number
  /** セル中心からずらす最大量（セルの一辺に対する割合、片側） */
  jitterRatio: number
  /** 道の中心からこの距離（m）より近くには置かない */
  minDistanceFromPath: number
  /** 道の中心からこの距離（m）より遠くには置かない */
  maxDistanceFromPath: number
  /** 道からの距離ごとの基本密度（0〜1 の確率）。距離の昇順に並べる */
  densityCurve: readonly TDensityPoint[]
  /** 空き地のノイズでどれだけ間引くか（0 = 間引かない、1 = 空き地では 0 になる） */
  clearingStrength: number
  /** モデル番号ごとの出やすさ。長さがモデルの数になる */
  variantWeights: readonly number[]
  /** 拡大率の範囲 [最小, 最大] */
  scaleRange: readonly [number, number]
  /** 傾きの最大値（度） */
  maxTiltDegrees: number
  /** 色の明るさの倍率の範囲 [最小, 最大] */
  tintRange: readonly [number, number]
  /** 根元を地面に埋める深さ（m）。起伏の上で浮かないようにする */
  rootSink: number
  /** 種類ごとに乱数をずらすための値。同じセルでも木と岩で別の乱数列にする */
  seedOffset: number
}
