/**
 * 3D 世界の寸法・見た目に関わる定数。
 * 1 単位 = 1m として扱う。
 */

/** コース 1 周の長さ（m）。すべての配置はコース座標 s ∈ [0, COURSE_LENGTH) で定義する */
export const COURSE_LENGTH = 400

/**
 * 見た目の惑星半径（m）。コース長とは独立した値で、湾曲の強さだけを決める。
 * MEMO: Phase 1 で PLANET_RADIUS_CANDIDATES と見比べて最終値を決める
 */
export const PLANET_RADIUS = 150

/** デバッグ GUI で切り替えて見比べる惑星半径の候補（m）。63.7m は赤道 400m の実球体に相当 */
export const PLANET_RADIUS_CANDIDATES = [63.7, 150, 300] as const

/** 目の高さ（m） */
export const EYE_HEIGHT = 1.65

/** 道の半幅（m）。道幅は 2 倍の 2.4m */
export const PATH_HALF_WIDTH = 1.2

/** 霧と背景の色。空の地平線付近の色と一致させ、地面の端やオブジェクトの出現を霧に溶かす */
export const FOG_COLOR = "#6f8f88"

/** 霧が掛かり始める距離（m） */
export const FOG_NEAR = 20

/** 霧で完全に見えなくなる距離（m） */
export const FOG_FAR = 90
