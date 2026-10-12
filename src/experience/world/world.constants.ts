/**
 * 3D 世界の寸法・見た目に関わる定数。
 * 1 単位 = 1m として扱う。
 */

/**
 * コース 1 周の長さ（m）。すべての配置はコース座標 s ∈ [0, COURSE_LENGTH) で定義する。
 * 描画はカメラから ±COURSE_LENGTH / 2（±50m）で折り返すため、地面や配置物の可視範囲はこれより内側に収めること
 */
export const COURSE_LENGTH = 100

/**
 * 見た目の惑星半径（m）。コース長とは独立した値で、湾曲の強さだけを決める。
 * Phase 1 で候補を見比べ、デフォルメの効いた小惑星らしさを優先して 63.7m に決めた。
 * この半径では地平線が約 14.5m 先、高さ 8m の木が見え始めるのは約 46m 先になる
 */
export const PLANET_RADIUS = 63.7

/** デバッグ GUI で切り替えて見比べる惑星半径の候補（m） */
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
