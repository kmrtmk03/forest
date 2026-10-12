import { MathUtils } from "three"

import { COURSE_LENGTH } from "./world.constants"

/**
 * 長さ（m）が COURSE_LENGTH を割り切るか検証する。
 * チャンク長・セル幅・ノイズのセル幅などは、割り切れないと 1 周の境界でセル番号の折り返しがずれ、
 * 継ぎ目（模様の段差、配置の重なりや抜け）ができる。起動時に一度だけ呼ぶこと
 * @param label エラーメッセージに出す名前（例: "Ground: GROUND_MOSS_CELL"）
 * @param length 検証する長さ（m）
 * @throws 割り切れない場合
 */
export const assertDividesCourseLength = (label: string, length: number): void => {
  if (Number.isInteger(COURSE_LENGTH / length)) return
  throw new Error(`${label}（${length}m）が COURSE_LENGTH（${COURSE_LENGTH}m）を割り切りません`)
}

/**
 * コース方向の差を -COURSE_LENGTH / 2 〜 COURSE_LENGTH / 2 に折り返し、1 周の上で最も近い向きの差を求める。
 * MEMO: curvature.glsl の curvatureWrapSigned と同じ式
 * @param value コース方向の差（m）。例: 物の s − カメラの s
 */
export const wrapSignedCourse = (value: number): number => {
  const halfLength = COURSE_LENGTH / 2
  return MathUtils.euclideanModulo(value + halfLength, COURSE_LENGTH) - halfLength
}
