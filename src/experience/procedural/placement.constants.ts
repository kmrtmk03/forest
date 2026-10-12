import type { IPlacementRule } from "./placement.type"

/**
 * 配置物の配置ルール。計画書 §11-3 の帯（道の中心からの距離）に合わせる。
 *   0〜1.2m: 道（何も置かない）
 *   1.2〜3.5m: 低い物だけ（Phase 3 では小さめの岩）
 *   3.5〜12m: 道の縁の木・岩（12m に向けて密度を上げる）
 *   12m〜: 密な木（森の壁）
 */

/** 世界の seed。変えると別の森になる（デバッグ GUI からも切り替えられる） */
export const WORLD_SEED = 20261012

/**
 * 空き地（林の濃淡）を作るノイズのセルの大きさ（m）。COURSE_LENGTH を割り切る値にする。
 * 10m 程度の空き地と茂みが交互に現れる
 */
export const CLEARING_NOISE_CELL = 10

/** 空き地のノイズがこの値以下で最も間引かれ、上限の値以上で間引かれない */
export const CLEARING_NOISE_LOW = 0.3
export const CLEARING_NOISE_HIGH = 0.6

/** 空き地のノイズ用に seed をずらす値（配置の乱数とは別の模様にする） */
export const CLEARING_SEED_OFFSET = 7919

/**
 * 配置する最も遠い距離（m）。地面メッシュ（±48m）の内側に収め、根元の下に必ず地面があるようにする。
 * これより先は霧（FOG_FAR 45m）で見えない
 */
const MAX_PROP_DISTANCE = 42

/**
 * 木のルール。モデルの高さは最大約 6.5m、拡大率 1.3 倍で約 8.45m。
 * 起伏（最大 1.2m）を足しても約 9.9m 未満に収め、ループの折り返し地点で頭が突然現れないようにする。
 * 道の縁から密に生やし、空き地も控えめにして、樹冠が重なり合う鬱蒼とした森にする
 */
const TREE_RULE: IPlacementRule = {
  kind: "tree",
  cellSize: 2.5,
  jitterRatio: 0.4,
  minDistanceFromPath: 3.5,
  maxDistanceFromPath: MAX_PROP_DISTANCE,
  densityCurve: [
    [3.5, 0.5],
    [8, 0.7],
    [12, 0.9],
    [MAX_PROP_DISTANCE, 0.9],
  ],
  clearingStrength: 0.5,
  // 0: 針葉樹、1: 広葉樹、2: 細長い木
  variantWeights: [0.45, 0.35, 0.2],
  scaleRange: [0.8, 1.3],
  maxTiltDegrees: 3,
  tintRange: [0.8, 1.15],
  // 木同士の幹は 1.2m 以上離す。ジッターだけだと隣のセルの木と 0.5m まで近づき、1 本から幹が 2 本生えたように見える
  clearance: 0.6,
  // 地面は 2m 間隔の頂点で起伏を近似しているため、TS の groundHeight と最大約 0.07m 食い違う。
  // それに加え、斜面では幹の縁の片側が持ち上がるので、余裕を持って埋める
  rootSink: 0.25,
  seedOffset: 0,
}

/** 岩のルール。道の近くにも小さく散らし、遠くでは木の間にまばらに置く */
const ROCK_RULE: IPlacementRule = {
  kind: "rock",
  cellSize: 5,
  jitterRatio: 0.4,
  // 最大の岩（半径約 0.85m）が道（半幅 1.2m）にはみ出さない距離
  minDistanceFromPath: 2.2,
  maxDistanceFromPath: MAX_PROP_DISTANCE,
  densityCurve: [
    [2.2, 0.3],
    [12, 0.15],
    [MAX_PROP_DISTANCE, 0.1],
  ],
  clearingStrength: 0,
  // 0: 角ばった岩、1: 丸みのある岩
  variantWeights: [0.6, 0.4],
  scaleRange: [0.5, 1.4],
  maxTiltDegrees: 15,
  tintRange: [0.85, 1.1],
  // 木の根元から 1.5m、岩同士は 1.8m 離し、岩が幹を貫いて見えないようにする
  clearance: 0.9,
  rootSink: 0.15,
  seedOffset: 104729,
}

/** 配置する種類の一覧。この順に生成する */
export const PLACEMENT_RULES: readonly IPlacementRule[] = [TREE_RULE, ROCK_RULE]
