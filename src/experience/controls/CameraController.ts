import { MathUtils, PerspectiveCamera } from "three"

import { EYE_HEIGHT } from "@/experience/world/world.constants"

import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_PITCH_DOWN,
  MAX_VERTICAL_FOV,
  MIN_HORIZONTAL_FOV,
} from "./controls.constants"

/**
 * 一人称カメラの生成と、画面サイズに応じた FOV の調整を行う。
 *
 * 擬似球面の設計では、カメラは常に球の頂上（原点の真上、目の高さ）に固定し、世界の方を曲げて動かす。
 * そのため位置・上方向（+Y）は一定で、進行による姿勢の計算は不要。
 * TODO: Phase 7 で歩行の揺れ・マウス視差・道の蛇行への追従を update(dt, velocity) として追加する
 */
export class CameraController {
  readonly camera: PerspectiveCamera

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
    this.camera.position.set(0, EYE_HEIGHT, 0)
    // 前方（-Z）から少し見下ろし、地平線を画面中央のやや下に置く
    this.camera.rotation.x = -MathUtils.degToRad(CAMERA_PITCH_DOWN)
  }

  /**
   * 画面のアスペクト比に合わせて投影を更新する。
   * 縦長画面では水平 FOV が MIN_HORIZONTAL_FOV を下回らないよう垂直 FOV を広げる（上限 MAX_VERTICAL_FOV）。
   */
  resize(aspect: number): void {
    // 高さ 0 の瞬間など、不正なアスペクト比では投影を壊さないよう更新を見送る
    if (!Number.isFinite(aspect) || aspect <= 0) return

    const minHorizontalHalf = MathUtils.degToRad(MIN_HORIZONTAL_FOV / 2)
    const requiredVerticalFov = MathUtils.radToDeg(
      2 * Math.atan(Math.tan(minHorizontalHalf) / aspect),
    )

    this.camera.aspect = aspect
    this.camera.fov = MathUtils.clamp(requiredVerticalFov, CAMERA_FOV, MAX_VERTICAL_FOV)
    this.camera.updateProjectionMatrix()
  }
}
