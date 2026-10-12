/**
 * 道の蛇行と地面の起伏を決める定数。
 * TS 版（path.utils.ts）と GLSL 版（shaders/ground.glsl）の両方がこの値を使う。
 * GLSL へは Ground.ts が material.defines として渡すため、ここを変えれば両方に反映される。
 *
 * 周期関数の cycles は「1 周（COURSE_LENGTH）の間に何回振動するか」で、必ず整数にする。
 * 整数でないと s = 0 と s = COURSE_LENGTH で値が一致せず、ループ境界に段差ができる。
 */

import { PATH_HALF_WIDTH } from "@/experience/world/world.constants"

/** 道の蛇行の 1 成分（pathX は各成分の正弦波の和） */
export interface IPathMeanderWave {
  /** 1 周あたりの振動回数（整数） */
  cycles: number
  /** 振幅（m） */
  amplitude: number
  /** 位相（ラジアン） */
  phase: number
}

/** 地面の起伏の 1 成分（コース方向と横方向の両方に傾いた正弦波） */
export interface IGroundHillWave {
  /** 1 周あたりのコース方向の振動回数（整数） */
  cycles: number
  /** 横方向（x）の角周波数（ラジアン / m）。x は折り返さないため整数でなくてよい */
  xFrequency: number
  /** 位相（ラジアン） */
  phase: number
  /** 重み。全成分の合計を 1 にし、和が -1〜1 に収まるようにする */
  weight: number
}

/**
 * 道の蛇行。Phase 2 では振幅 0（直線）にしておく。
 * TODO: Phase 7 で振幅 1〜1.5m を試し、カメラの x 追従と合わせて調整する
 */
export const PATH_MEANDER_WAVES: readonly IPathMeanderWave[] = [
  { cycles: 2, amplitude: 0, phase: 0 },
  { cycles: 5, amplitude: 0, phase: 1.3 },
]

/**
 * 道の中心からこの距離（m）までは起伏を付けず平坦に保つ。
 * 道の縁がギザギザにはみ出す分（最大約 0.3m）と、歩く足元の余裕を含める
 */
export const GROUND_FLAT_HALF_WIDTH = PATH_HALF_WIDTH + 0.6

/** 道の中心からこの距離（m）で起伏が最大の高さに達する。平坦部からここまでを滑らかにつなぐ */
export const GROUND_HILL_RAMP_END = 12

/**
 * 起伏の最大の高さ（m）。道が浅い谷になり、両側の森が少し盛り上がって見える。
 * 道が浅い谷になる程度に控えめにする（配置物の根元の高さにも足される）
 */
export const GROUND_HILL_HEIGHT = 1.2

/**
 * 起伏の成分。コース方向は 2〜7 回 / 周（波長 14〜50m）、横方向は波長 12〜33m 程度の低周波にする。
 * 頂点間隔（2m）より十分長い波長にし、地面メッシュで形がカクつかないようにする
 */
export const GROUND_HILL_WAVES: readonly IGroundHillWave[] = [
  { cycles: 3, xFrequency: 0.31, phase: 0, weight: 0.5 },
  { cycles: 7, xFrequency: -0.19, phase: 1.7, weight: 0.3 },
  { cycles: 2, xFrequency: 0.53, phase: 4.1, weight: 0.2 },
]
