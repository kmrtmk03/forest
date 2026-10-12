import type { IFractalTreeSpecies } from "./fractalTree.type"

/**
 * フラクタルの木の形を決める定数。
 * ポリゴン数は 1 本あたり 約 700〜800 を目安にする（同時に約 400 本描くため。計画書 §17-3 の目標 PC 50 万）
 */

/** 木の形の乱数の seed。森の配置（WORLD_SEED）とは独立させ、seed を変えても木の形は変えない */
export const TREE_SHAPE_SEED = 7

/** 種類ごとに作る形の数。同じ種類でも枝ぶりの違う木を混ぜ、同じ形の繰り返しを目立たなくする */
export const SHAPES_PER_SPECIES = 2

/** 幹・枝の円柱の周方向の分割数（次数ごと。細い枝ほど少なくしてポリゴンを節約する） */
export const BARK_RADIAL_SEGMENTS_BY_ORDER = [5, 3, 3] as const

/** 細くなりすぎた枝の半径の下限（m）。これより細いと遠くで線が途切れて見える */
export const MIN_BRANCH_RADIUS = 0.02

/**
 * 木の種類。軽くするため 1 種類（広葉樹）だけにし、形の違いは SHAPES_PER_SPECIES と、
 * 配置ごとの回転・拡大率・縦の伸び・傾き・色の明るさ（placement.constants.ts）で出す。
 *
 * 高さについて: 新しいチャンクの木は 45m 先から描かれ、そこで地平線より上に頭を出す木（高さ 7.3m 以上）は
 * 目からの直線距離が 47.5m 以上になるため、霧（FOG_FAR 45m）で完全に見えない。高い木ほど遠くなるので、
 * 高さによって突然現れることはない（FOG_FAR を 45m より大きくするときは再確認すること）
 */
export const FRACTAL_TREE_SPECIES: readonly IFractalTreeSpecies[] = [
  {
    // 広葉樹: 太い幹を高くまっすぐ伸ばし、上の方で大きく枝分かれして広い樹冠を作る。
    // 枝と葉は頭上（拡大率が最小でも 3m 以上）から始め、道に近い木の枝が道の上へ張り出してもカメラに当たらないようにする
    name: "canopy",
    height: 9.5,
    // 拡大率が最小（0.85 × 縦 0.9 = 0.765 倍）でも葉の下端が 約 2.6m になり、目の高さ（1.65m）より 1m ほど上に残る
    canopyMinHeight: 3.4,
    trunkLength: 6,
    trunkRadius: 0.34,
    trunkSegments: 5,
    // 幹の上側 2 節（高さの 8 割と 10 割）からだけ枝を出し、枝の付け根を頭上高くに置く
    firstBranchHeightRatio: 0.8,
    maxOrder: 2,
    branchesPerNode: [2, 3],
    branchAngleDegrees: [35, 60],
    branchLengthRatio: 0.75,
    branchSegments: 2,
    branchRadiusRatio: 0.55,
    tipRadiusRatio: 0.5,
    topTaper: 0,
    gravity: 0.06,
    wobble: 0.2,
    barkColor: "#5a4030",
    leaves: {
      minOrder: 2,
      cardsPerNode: 5,
      cardSize: 2.6,
      spread: 0.9,
      color: "#4a7a3a",
    },
  },
]
