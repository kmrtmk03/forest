import { MathUtils, Scene } from "three"
import type { IUniform } from "three"

import { createCurvatureUniforms } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import { Atmosphere } from "./Atmosphere"
import { FloatingParticles } from "./FloatingParticles"
import { Forest } from "./Forest"
import { Ground } from "./Ground"
import { GroundShadowMap } from "./GroundShadowMap"
import { LightShafts } from "./LightShafts"
import { COURSE_LENGTH, PLANET_RADIUS } from "./world.constants"

/**
 * 3D 空間全体（光・霧・空・地面・配置物・森の空気感の演出）の生成と毎フレームの更新を束ねる。
 * 曲げ変換の共有 uniform もここで持ち、進行距離からカメラのコース位置を求めて全マテリアルへ反映する。
 * 経過時間の共有 uniform も持ち、木漏れ日・光芒・浮遊粒子の揺らぎに使う。
 * 各要素は互いを参照せず、World の update から上から順に更新する。
 * 例外は配置物の根元の影で、Forest が配置を作るたびに GroundShadowMap へ描き、Ground がそのテクスチャを読む。
 */
export class World {
  readonly scene = new Scene()
  /** 曲げ変換で全マテリアルが共有する uniform。デバッグ GUI からも惑星半径を調整する */
  readonly curvatureUniforms: ICurvatureUniforms = createCurvatureUniforms(
    PLANET_RADIUS,
    COURSE_LENGTH,
  )
  /** 光・霧・空。デバッグ GUI からも霧の距離を調整する */
  readonly atmosphere = new Atmosphere()
  /** 木・岩などの配置物。デバッグ GUI からも seed を切り替える */
  readonly forest: Forest
  private readonly ground: Ground
  /** 配置物の根元の影。Forest が描き、Ground が読む */
  private readonly groundShadowMap: GroundShadowMap
  private readonly lightShafts: LightShafts
  private readonly floatingParticles: FloatingParticles
  /**
   * 経過時間（秒）。木漏れ日・光芒・浮遊粒子のマテリアルが共有する。
   * 位置に依存させないため、ループの境界でも揺らぎは途切れない
   */
  private readonly timeUniform: IUniform<number> = { value: 0 }
  /** カメラのコース s（COURSE_LENGTH で折り返した値） */
  private cameraS = 0

  /**
   * @throws 地面・配置物・演出の設定が不正な場合（各クラスのコンストラクタを参照）。
   *   例外を投げるときは、それまでに作った物を破棄してから投げる
   */
  constructor() {
    // 背景は空の球が描くため scene.background は使わない。空の地平線付近は霧と同じ色にしてある
    this.scene.fog = this.atmosphere.fog
    this.scene.add(this.atmosphere.group)

    // 各クラスは失敗したとき自分の作った分を破棄する（または作る前に投げる）ので、
    // ここではそれより前に作った物だけを破棄する
    let groundShadowMap: GroundShadowMap | null = null
    let ground: Ground | null = null
    let forest: Forest | null = null
    let lightShafts: LightShafts | null = null
    try {
      groundShadowMap = new GroundShadowMap()
      this.groundShadowMap = groundShadowMap
      ground = new Ground(this.curvatureUniforms, this.timeUniform, groundShadowMap.texture)
      this.ground = ground
      // Forest は生成時に配置を作り、根元の影を groundShadowMap へ描く
      forest = new Forest(this.curvatureUniforms, groundShadowMap)
      this.forest = forest
      lightShafts = new LightShafts(this.curvatureUniforms, this.timeUniform)
      this.lightShafts = lightShafts
      this.floatingParticles = new FloatingParticles(this.curvatureUniforms, this.timeUniform)
    } catch (error) {
      lightShafts?.dispose()
      forest?.dispose()
      ground?.dispose()
      groundShadowMap?.dispose()
      this.atmosphere.dispose()
      throw error
    }
    this.scene.add(
      this.ground.mesh,
      this.forest.group,
      this.lightShafts.mesh,
      this.floatingParticles.mesh,
    )
  }

  /** カメラのコース s（m、0 以上 COURSE_LENGTH 未満） */
  get courseS(): number {
    return this.cameraS
  }

  /**
   * 進行距離と経過時間に合わせて世界を更新する。毎フレーム、描画の前に呼ぶこと。
   * @param distance 累計の進行距離（m）。リセットせず増減し続ける値をそのまま渡す
   * @param deltaSeconds 前フレームからの経過時間（秒）。Ticker 側でクランプ済みの値を渡す
   */
  update(distance: number, deltaSeconds: number): void {
    this.timeUniform.value += deltaSeconds

    // 進行距離はリセットせず増やし続け、シェーダーに渡すときだけ 1 周の長さで折り返す
    this.cameraS = MathUtils.euclideanModulo(distance, COURSE_LENGTH)
    // MEMO: 道の蛇行（Phase 7）を入れるまでは、カメラは常に道の中央（x = 0）を歩く
    const cameraX = 0

    this.curvatureUniforms.uCurvatureCamera.value.set(cameraX, this.cameraS)
    this.ground.update(cameraX, this.cameraS)
    this.forest.update(this.cameraS)
    this.floatingParticles.update(cameraX, this.cameraS)
  }

  /** 生成したジオメトリ・マテリアルをすべて破棄する */
  dispose(): void {
    this.atmosphere.dispose()
    this.ground.dispose()
    this.forest.dispose()
    this.groundShadowMap.dispose()
    this.lightShafts.dispose()
    this.floatingParticles.dispose()
    this.scene.clear()
  }
}
