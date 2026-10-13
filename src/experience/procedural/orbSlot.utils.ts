import { assertDividesCourseLength, wrapSignedCourse } from "@/experience/world/course.utils"
import { COURSE_LENGTH } from "@/experience/world/world.constants"

import { ORB_CLEARANCE, ORB_HEIGHT, ORB_SIDE_OFFSET, ORB_SPACING } from "./orbSlot.constants"
import type { IOrbSlot } from "./orbSlot.type"
import { groundHeight, pathX } from "./path.utils"

/** 1 周に置くオーブの数（COURSE_LENGTH 100m ÷ ORB_SPACING 10m = 10） */
export const ORB_COUNT = COURSE_LENGTH / ORB_SPACING

/**
 * 1 周分のオーブの位置を、コース上の並び順で返す（計画書 §12: s_i = (i + 0.5) × 間隔）。
 * 間隔の半分ずらすことで、0m（1 周の境界）の真上にオーブが来ないようにする。
 * 起動時（オーブの生成時・配置の生成時）に呼ぶ。毎フレーム呼ばないこと
 * @throws ORB_SPACING が COURSE_LENGTH を割り切らない場合（0m 付近でオーブの間隔が詰まる・空くため）
 */
export const listOrbSlots = (): IOrbSlot[] => {
  assertDividesCourseLength("orb: ORB_SPACING", ORB_SPACING)

  return Array.from({ length: ORB_COUNT }, (_, index): IOrbSlot => {
    const s = (index + 0.5) * ORB_SPACING
    // 偶数番目は左（-）、奇数番目は右（+）
    const side = index % 2 === 0 ? -1 : 1
    const x = pathX(s) + side * ORB_SIDE_OFFSET
    return { index, s, x, height: groundHeight(x, s) + ORB_HEIGHT }
  })
}

/**
 * コース座標 (x, s) がどれかのオーブに近すぎるか判定する（配置物をオーブの周りに置かないために使う）。
 * 1 周の境界をまたぐ距離は、折り返した差で測る
 * @param slots listOrbSlots の結果
 * @param clearance 置こうとしている物の clearance（m）。ORB_CLEARANCE に足して判定する
 */
export const isNearOrbSlot = (
  slots: readonly IOrbSlot[],
  x: number,
  s: number,
  clearance: number,
): boolean => {
  const minDistance = ORB_CLEARANCE + clearance
  return slots.some((slot) => {
    const deltaX = slot.x - x
    const deltaS = wrapSignedCourse(slot.s - s)
    return deltaX * deltaX + deltaS * deltaS < minDistance * minDistance
  })
}
