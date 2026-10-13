/**
 * オーブを置く位置（スロット）の型。Three.js に依存しない。
 * オーブのコンテンツとは独立しており、木の配置（オーブの周りを空ける）にも使う
 */

/** 1 個のオーブを置く位置（コース座標系） */
export interface IOrbSlot {
  /** コース上の並び順（0 始まり）。ORB_CONTENTS の添字と対応する */
  index: number
  /** コース上の距離（m、0 以上 COURSE_LENGTH 未満） */
  s: number
  /** 道の中心（直線時）からの横距離（m）。右が + */
  x: number
  /** 浮遊の中心の高さ（m）。地面の高さ + ORB_HEIGHT */
  height: number
}
