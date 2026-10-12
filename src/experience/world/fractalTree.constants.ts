import type { IFractalTreeSpecies } from "./fractalTree.type"

/**
 * フラクタルの木の形を決める定数。
 * ポリゴン数は 1 本あたり 約 600〜800 を目安にする（同時に数百本描くため。計画書 §17-3 の目標 PC 50 万）
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
 * 木の種類。全高はどれも 6.5m 以下にする。拡大率 1.3 倍で約 8.45m、起伏（最大 1.2m）を足しても約 9.65m で、
 * ループの折り返し地点で頭が突然現れない上限（約 9.9m）に収まる
 */
export const FRACTAL_TREE_SPECIES: readonly IFractalTreeSpecies[] = [
  {
    // 針葉樹: まっすぐな幹から、ほぼ水平の枝を輪のように出す。上ほど枝が短く、円錐形になる
    name: "fir",
    height: 6.4,
    trunkLength: 6.4,
    trunkRadius: 0.24,
    trunkSegments: 8,
    firstBranchHeightRatio: 0.2,
    maxOrder: 1,
    branchesPerNode: [4, 5],
    branchAngleDegrees: [70, 85],
    branchLengthRatio: 0.42,
    branchSegments: 2,
    branchRadiusRatio: 0.35,
    tipRadiusRatio: 0.25,
    topTaper: 0.85,
    gravity: -0.12,
    wobble: 0.05,
    barkColor: "#4a3528",
    leaves: {
      minOrder: 1,
      cardsPerNode: 3,
      cardSize: 1.8,
      spread: 0.4,
      texture: "needle",
      color: "#2f5a3a",
    },
  },
  {
    // 広葉樹: 短い幹の上で大きく枝分かれし、枝先に葉の塊を付けて丸い樹冠にする
    name: "broadleaf",
    height: 6.2,
    trunkLength: 2.4,
    trunkRadius: 0.26,
    trunkSegments: 2,
    firstBranchHeightRatio: 0.5,
    maxOrder: 2,
    branchesPerNode: [2, 3],
    branchAngleDegrees: [30, 50],
    branchLengthRatio: 0.9,
    branchSegments: 2,
    branchRadiusRatio: 0.6,
    tipRadiusRatio: 0.55,
    topTaper: 0,
    gravity: 0.08,
    wobble: 0.2,
    barkColor: "#5a4030",
    leaves: {
      minOrder: 2,
      cardsPerNode: 4,
      cardSize: 1.9,
      spread: 0.6,
      texture: "broadleaf",
      color: "#4a7a3a",
    },
  },
  {
    // 細長い木: 幹に沿って短い枝を上向きに出し、縦長の樹冠にする
    name: "poplar",
    height: 6.5,
    trunkLength: 6.5,
    trunkRadius: 0.18,
    trunkSegments: 6,
    firstBranchHeightRatio: 0.2,
    maxOrder: 1,
    branchesPerNode: [2, 3],
    branchAngleDegrees: [20, 35],
    branchLengthRatio: 0.3,
    branchSegments: 2,
    branchRadiusRatio: 0.4,
    tipRadiusRatio: 0.3,
    topTaper: 0.5,
    gravity: 0.1,
    wobble: 0.08,
    barkColor: "#55452f",
    leaves: {
      minOrder: 0,
      cardsPerNode: 3,
      cardSize: 1.5,
      spread: 0.45,
      texture: "broadleaf",
      color: "#3d6b40",
    },
  },
]
