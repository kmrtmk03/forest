import { Color, DirectionalLight, Fog, HemisphereLight, MathUtils, Scene } from "three"

import { createCurvatureUniforms } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import { CoursePoles } from "./CoursePoles"
import { Ground } from "./Ground"
import { COURSE_LENGTH, FOG_COLOR, FOG_FAR, FOG_NEAR, PLANET_RADIUS } from "./world.constants"

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
 * 曲げ変換の共有 uniform もここで持ち、進行距離からカメラのコース位置を求めて全マテリアルへ反映する。
 * 各要素は互いを参照せず、World の update から上から順に更新する。
 */
export class World {
  readonly scene = new Scene()
  /** 曲げ変換で全マテリアルが共有する uniform。デバッグ GUI からも惑星半径を調整する */
  readonly curvatureUniforms: ICurvatureUniforms = createCurvatureUniforms(
    PLANET_RADIUS,
    COURSE_LENGTH,
  )
  private readonly ground: Ground
  private readonly coursePoles: CoursePoles
  /** カメラのコース s（COURSE_LENGTH で折り返した値） */
  private cameraS = 0

  constructor() {
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

    this.ground = new Ground(this.curvatureUniforms)
    this.coursePoles = new CoursePoles(this.curvatureUniforms)
    this.scene.add(this.ground.mesh, this.coursePoles.mesh)
  }

  /** カメラのコース s（m、0 以上 COURSE_LENGTH 未満） */
  get courseS(): number {
    return this.cameraS
  }

  /**
   * 進行距離に合わせて世界を更新する。毎フレーム、描画の前に呼ぶこと。
   * @param distance 累計の進行距離（m）。リセットせず増減し続ける値をそのまま渡す
   */
  update(distance: number): void {
    // 進行距離はリセットせず増やし続け、シェーダーに渡すときだけ 1 周の長さで折り返す
    this.cameraS = MathUtils.euclideanModulo(distance, COURSE_LENGTH)
    // MEMO: 道の蛇行（Phase 7）を入れるまでは、カメラは常に道の中央（x = 0）を歩く
    const cameraX = 0

    this.curvatureUniforms.uCurvatureCamera.value.set(cameraX, this.cameraS)
    this.ground.update(cameraX, this.cameraS)
  }

  /** 生成したジオメトリ・マテリアルをすべて破棄する */
  dispose(): void {
    this.ground.dispose()
    this.coursePoles.dispose()
    this.scene.clear()
  }
}
