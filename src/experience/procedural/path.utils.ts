import { MathUtils } from "three"

import { COURSE_LENGTH } from "@/experience/world/world.constants"

import {
  GROUND_FLAT_HALF_WIDTH,
  GROUND_HILL_HEIGHT,
  GROUND_HILL_RAMP_END,
  GROUND_HILL_WAVES,
  PATH_MEANDER_WAVES,
} from "./path.constants"

/** 1 周を 2π に対応させるための係数 */
const TAU = Math.PI * 2

/**
 * コース位置 s での道の中心の x（m）。
 * 1 周で整数回振動する正弦波の和なので、s と s + COURSE_LENGTH で必ず同じ値になる。
 * MEMO: shaders/ground.glsl の groundPathX と同じ式。片方だけ変えないこと
 * @param s コース座標（m）。折り返していない値をそのまま渡してよい
 */
export const pathX = (s: number): number => {
  const phase = (TAU * s) / COURSE_LENGTH
  return PATH_MEANDER_WAVES.reduce(
    (sum, wave) => sum + wave.amplitude * Math.sin(wave.cycles * phase + wave.phase),
    0,
  )
}

/**
 * コース座標 (x, s) での地面の高さ（m、0 以上 GROUND_HILL_HEIGHT 以下）。
 * 道の上は平坦（0）に保ち、道から離れるほど低周波の起伏が大きくなる。
 * Phase 3 以降の配置物は、根元の高さをこの関数で求めて地面に合わせる。
 * MEMO: shaders/ground.glsl の groundHeight と同じ式。片方だけ変えないこと
 * @param x 道の中心線（直線時）からの横距離（m）
 * @param s コース座標（m）。折り返していない値をそのまま渡してよい
 */
export const groundHeight = (x: number, s: number): number => {
  const distanceFromPath = Math.abs(x - pathX(s))
  const ramp = MathUtils.smoothstep(distanceFromPath, GROUND_FLAT_HALF_WIDTH, GROUND_HILL_RAMP_END)
  // 道の上では ramp = 0 なので、起伏の計算を省く
  if (ramp === 0) return 0

  const phase = (TAU * s) / COURSE_LENGTH
  // 各成分の重みの合計は 1 なので、noise は -1〜1 に収まる
  const noise = GROUND_HILL_WAVES.reduce(
    (sum, wave) =>
      sum + wave.weight * Math.sin(wave.cycles * phase + wave.xFrequency * x + wave.phase),
    0,
  )
  return GROUND_HILL_HEIGHT * ramp * (0.5 + 0.5 * noise)
}
