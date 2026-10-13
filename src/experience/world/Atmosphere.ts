import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from "three"

import skyFragmentShader from "@/experience/shaders/sky.frag.glsl?raw"
import skyVertexShader from "@/experience/shaders/sky.vert.glsl?raw"

import { FOG_COLOR, FOG_FAR, FOG_NEAR } from "./world.constants"

/** 環境光。上（空）と下（地面）で色を変え、森の中の柔らかい環境光にする */
const HEMISPHERE_SKY_COLOR = "#9fc7c0"
const HEMISPHERE_GROUND_COLOR = "#2b3a2a"
const HEMISPHERE_INTENSITY = 1.2

/** 斜め前方の低い位置からの暖色の光。カメラ相対で固定し、どこへ進んでも同じ光にする（ループに強い） */
const SUN_COLOR = "#ffe2b0"
const SUN_INTENSITY = 2
const SUN_POSITION = [-10, 8, -20] as const

/** 天頂付近の空の色。地平線側は霧の色（FOG_COLOR）にする */
const SKY_ZENITH_COLOR = "#2f5a63"

/**
 * 霧の色のまま保つ上限の仰角（度）。
 * 惑星の地平線は視線より約 13° 下（半径 63.7m）にあり、その少し上までを霧の色にして、
 * 地平線の向こうからせり上がる物の頭が空と同じ色に溶けるようにする
 */
const SKY_HORIZON_ELEVATION = 3

/** 天頂の色になる仰角（度） */
const SKY_ZENITH_ELEVATION = 50

/**
 * 空の球の半径（m）。深度テストをせず最初に描くため、カメラの near〜far の間であれば値は見た目に影響しない
 */
const SKY_RADIUS = 20
const SKY_WIDTH_SEGMENTS = 32
const SKY_HEIGHT_SEGMENTS = 16

/** 空を他の物より先に描くための描画順（小さいほど先） */
const SKY_RENDER_ORDER = -1

/**
 * 光・霧・空をまとめる。どれもコース位置に依存させず、カメラ相対で一定にする（ループに強い）。
 * World が group をシーンへ追加し、fog を scene.fog に設定する。
 * 森の空気感の演出のうち、コース上の位置に結びつくもの（木漏れ日・光芒・浮遊粒子）は曲げ変換を使うため、
 * Ground・LightShafts・FloatingParticles に置き、World が束ねる。
 * TODO: Phase 7 で色調整（トーンマッピング、光・霧・空の色）を行う
 */
export class Atmosphere {
  /** 光と空のメッシュ。シーンへ追加すること */
  readonly group = new Group()
  /** 線形の霧。scene.fog に設定すること。デバッグ GUI からも距離を調整する */
  readonly fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)
  private readonly sky: Mesh<SphereGeometry, ShaderMaterial>

  constructor() {
    // DirectionalLight の target は既定で原点を向くため、位置だけ設定すればよい
    const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY)
    sun.position.set(...SUN_POSITION)
    const hemisphere = new HemisphereLight(
      HEMISPHERE_SKY_COLOR,
      HEMISPHERE_GROUND_COLOR,
      HEMISPHERE_INTENSITY,
    )

    this.sky = new Mesh(
      new SphereGeometry(SKY_RADIUS, SKY_WIDTH_SEGMENTS, SKY_HEIGHT_SEGMENTS),
      new ShaderMaterial({
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        uniforms: {
          // 霧と同じ Color から作り、地平線付近の画素値を霧と一致させる
          uSkyHorizonColor: { value: this.fog.color },
          uSkyZenithColor: { value: new Color(SKY_ZENITH_COLOR) },
          uSkyHorizonElevation: { value: MathUtils.degToRad(SKY_HORIZON_ELEVATION) },
          uSkyZenithElevation: { value: MathUtils.degToRad(SKY_ZENITH_ELEVATION) },
        },
        // 球の内側から見る
        side: BackSide,
        // 最初に描いて背景にする。深度を書かないので、後から描く地面などが必ず手前に来る
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    )
    this.sky.renderOrder = SKY_RENDER_ORDER
    // 頂点シェーダーでカメラ位置へ移動するため、three.js の視錐台カリングは正しく判定できない
    this.sky.frustumCulled = false

    this.group.add(hemisphere, sun, this.sky)
  }

  dispose(): void {
    this.sky.geometry.dispose()
    this.sky.material.dispose()
  }
}
