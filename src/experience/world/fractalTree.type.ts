/**
 * フラクタルの木（再帰的に枝分かれする枝 + 板ポリの葉）の型。
 */

/** 葉の付け方 */
export interface IFractalLeafParams {
  /** この次数以上の枝の節に葉を付ける（0 = 幹、1 = 幹から出た枝、2 = その枝から出た枝） */
  minOrder: number
  /** 1 つの節に付ける葉の板の枚数 */
  cardsPerNode: number
  /** 葉の板の一辺（m）。個体ごとに ±20% ばらつかせる */
  cardSize: number
  /** 節から葉の板の中心をずらす最大距離（m）。大きいほど葉の塊がふんわり広がる */
  spread: number
  /** 葉の色（画像の白い部分にこの色が掛かる） */
  color: string
}

/**
 * 木の種類ごとの形のパラメータ。
 * 1 本の軸（幹・枝）を節で区切り、各節から細い軸を斜めに生やす。生えた軸も同じ規則で枝分かれする（自己相似 = フラクタル）
 */
export interface IFractalTreeSpecies {
  /** 種類の名前（デバッグ・コメント用。モデル番号は FRACTAL_TREE_SPECIES の並び順で決まる） */
  name: string
  /** 生成後に全体を拡大縮小して、この高さ（m）にそろえる（拡大率 1 のときの全高） */
  height: number
  /**
   * 葉の下端の高さの下限（m、height にそろえた後・拡大率 1 のとき）。これより下へ垂れる葉の板は付けない。
   * 道に寄せた木の葉が、道の上を歩くカメラ（目の高さ 1.65m）にかからないようにする
   */
  canopyMinHeight: number
  /** 幹の長さ（m）。height にそろえる前の値なので、枝との比率だけが意味を持つ */
  trunkLength: number
  /** 幹の根元の半径（m、height にそろえる前の値） */
  trunkRadius: number
  /** 幹を何個の節に区切るか */
  trunkSegments: number
  /** 幹のこの高さの割合（0〜1）より上の節からだけ枝を出す */
  firstBranchHeightRatio: number
  /** 枝分かれの最大の次数（1 なら幹から出た枝で止まる） */
  maxOrder: number
  /** 1 つの節から出す枝の本数 [最小, 最大] */
  branchesPerNode: readonly [number, number]
  /** 親の軸から枝が開く角度（度） [最小, 最大] */
  branchAngleDegrees: readonly [number, number]
  /** 枝の長さ ÷ 親の軸の長さ */
  branchLengthRatio: number
  /** 枝を何個の節に区切るか */
  branchSegments: number
  /** 枝の根元の半径 ÷ 親の節の半径 */
  branchRadiusRatio: number
  /** 軸の先端の半径 ÷ 根元の半径 */
  tipRadiusRatio: number
  /** 上の方の節から出る枝ほど短くする強さ（0 = 一定、1 = てっぺんで長さ 0）。針葉樹の円錐形を作る */
  topTaper: number
  /** 節ごとに枝先を上へ曲げる量（負なら垂れ下がる） */
  gravity: number
  /** 節ごとに向きをランダムに揺らす量（ラジアン） */
  wobble: number
  /** 幹・枝の色 */
  barkColor: string
  /** 葉の付け方 */
  leaves: IFractalLeafParams
}
