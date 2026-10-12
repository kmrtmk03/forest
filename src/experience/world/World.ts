import { Color, DirectionalLight, Fog, HemisphereLight, Scene } from "three"

import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import { CoursePoles } from "./CoursePoles"
import { Ground } from "./Ground"
import { FOG_COLOR, FOG_FAR, FOG_NEAR } from "./world.constants"

/**
 * 環境光の設定。上（空）と下（地面）で色を変え、森の中の柔らかい環境光にする。
 * TODO: Phase 7 で光・霧・空をまとめる Atmosphere へ移す
 */
const HEMISPHERE_SKY_COLOR = "#9fc7c0"
const HEMISPHERE_GROUND_COLOR = "#2b3a2a"
const HEMISPHERE_INTENSITY = 1.2

/** 斜め前方の低い位置からの暖色の光。カメラ相対で固定し、どこへ進んでも同じ光にする（ループに強い） */
const SUN_COLOR = "#ffe2b0"
const SUN_INTENSITY = 2
const SUN_POSITION = [-10, 8, -20] as const

/**
 * 3D 空間全体（地面・配置物・光・霧）の生成と毎フレームの更新を束ねる。
 * 各要素は互いを参照せず、World の update から上から順に更新する。
 */
export class World {
  readonly scene = new Scene()
  private readonly ground: Ground
  private readonly coursePoles: CoursePoles

  constructor(curvatureUniforms: ICurvatureUniforms) {
    // 背景色を霧の色と一致させ、霧に溶けた地面の端と空の境目を見えなくする
    this.scene.background = new Color(FOG_COLOR)
    this.scene.fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)

    // DirectionalLight の target は既定で原点を向くため、位置だけ設定すればよい
    const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY)
    sun.position.set(...SUN_POSITION)
    this.scene.add(
      new HemisphereLight(HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, HEMISPHERE_INTENSITY),
      sun,
    )

    this.ground = new Ground(curvatureUniforms)
    this.coursePoles = new CoursePoles(curvatureUniforms)
    this.scene.add(this.ground.mesh, this.coursePoles.mesh)
  }

  /**
   * カメラのコース位置に合わせて世界を更新する。毎フレーム呼ぶこと。
   * @param cameraX カメラのコース x
   * @param cameraS カメラのコース s（COURSE_LENGTH で折り返した値）
   */
  update(cameraX: number, cameraS: number): void {
    this.ground.update(cameraX, cameraS)
  }

  /** 生成したジオメトリ・マテリアルをすべて破棄する */
  dispose(): void {
    this.ground.dispose()
    this.coursePoles.dispose()
    this.scene.clear()
  }
}
