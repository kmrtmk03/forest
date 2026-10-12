import { MathUtils } from "three"

import { COURSE_LENGTH } from "@/experience/world/world.constants"

import { hash2ToUnit } from "./random.utils"

/** セルの角の値を滑らかにつなぐ補間（3t² − 2t³。GLSL の smoothstep と同じ形） */
const smoothBlend = (t: number): number => t * t * (3 - 2 * t)

/**
 * コース方向に 1 周で途切れない value noise（0 以上 1 未満）。
 * コース方向のセル番号を 1 周のセル数で折り返すため、s と s + COURSE_LENGTH で同じ値になる。
 * 林の濃淡や空き地など、配置の密度を場所ごとに変えるのに使う
 * @param x 横方向の座標（m）
 * @param s コース座標（m）。折り返していない値でもよい
 * @param cellSize セルの大きさ（m）。COURSE_LENGTH を割り切る値にすること（割り切れないと境界で値が飛ぶ）
 * @param seed 世界の seed（用途ごとにずらすと、別の模様になる）
 */
export const periodicValueNoise = (
  x: number,
  s: number,
  cellSize: number,
  seed: number,
): number => {
  const cellCountS = COURSE_LENGTH / cellSize
  const scaledX = x / cellSize
  const scaledS = s / cellSize
  const cellX = Math.floor(scaledX)
  const cellS = Math.floor(scaledS)
  const s0 = MathUtils.euclideanModulo(cellS, cellCountS)
  const s1 = MathUtils.euclideanModulo(cellS + 1, cellCountS)

  const corner00 = hash2ToUnit(cellX, s0, seed)
  const corner10 = hash2ToUnit(cellX + 1, s0, seed)
  const corner01 = hash2ToUnit(cellX, s1, seed)
  const corner11 = hash2ToUnit(cellX + 1, s1, seed)

  const blendX = smoothBlend(scaledX - cellX)
  const blendS = smoothBlend(scaledS - cellS)
  return MathUtils.lerp(
    MathUtils.lerp(corner00, corner10, blendX),
    MathUtils.lerp(corner01, corner11, blendX),
    blendS,
  )
}
