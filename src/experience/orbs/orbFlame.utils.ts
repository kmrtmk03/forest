import {
  AddEquation,
  Color,
  CustomBlending,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  ZeroFactor,
} from "three"
import type { IUniform } from "three"

import orbFlameFragmentShader from "@/experience/shaders/orbFlame.frag.glsl?raw"
import orbFlameVertexShader from "@/experience/shaders/orbFlame.vert.glsl?raw"
import hashShader from "@/experience/shaders/hash.glsl?raw"

/** 炎のフラグメントシェーダー。共通の擬似乱数（forestHash12）を前に連結する */
const ORB_FLAME_FRAGMENT_SHADER = `${hashShader}\n${orbFlameFragmentShader}`

/**
 * 火の玉（炎の下の丸い部分）の半径（m）。炎の形はこの半径を 1 とした単位で描く（orbFlame.frag.glsl）。
 * 炎の全高は 約 0.24 × (1 + 4.2) = 1.25m、火の玉の直径は 0.48m。
 * 浮遊の中心（地面から 1.2m）が火の玉の中心なので、炎の先端は地面から 約 2.2m（目の高さ 1.65m より上）になる。
 * 2026-10-13 にユーザーの要望で 0.16m から 1.5 倍にした
 */
export const ORB_FLAME_BALL_RADIUS = 0.24

/**
 * 板の範囲（火の玉の半径の何倍か）。原点が火の玉の中心。
 * シェーダーが描く形（先端 4.2・横の揺れ・周りの淡い光）が収まり、端で光が切れないよう余白を取る
 */
const ORB_FLAME_PLANE_HALF_WIDTH = 2.2
const ORB_FLAME_PLANE_BOTTOM = -2
const ORB_FLAME_PLANE_TOP = 5.4

/** 全オーブの炎のマテリアルで共有する uniform。値を書き換えると全オーブに反映される */
export interface IOrbFlameSharedUniforms {
  /** 経過時間（秒）。OrbManager が毎フレーム更新する */
  uTime: IUniform<number>
  /** 火の玉の半径（m） */
  uBallRadius: IUniform<number>
}

/** 共有 uniform を作る */
export const createOrbFlameSharedUniforms = (): IOrbFlameSharedUniforms => ({
  uTime: { value: 0 },
  uBallRadius: { value: ORB_FLAME_BALL_RADIUS },
})

/**
 * 炎を描く板を作る。原点が火の玉の中心になるよう、板を上へずらしてある。
 * 全オーブで共有してよい（破棄は呼び出し側が 1 回だけ行う）
 */
export const createOrbFlameGeometry = (): PlaneGeometry => {
  const width = ORB_FLAME_PLANE_HALF_WIDTH * 2 * ORB_FLAME_BALL_RADIUS
  const height = (ORB_FLAME_PLANE_TOP - ORB_FLAME_PLANE_BOTTOM) * ORB_FLAME_BALL_RADIUS
  const geometry = new PlaneGeometry(width, height)
  // PlaneGeometry は中心が原点なので、下端が ORB_FLAME_PLANE_BOTTOM に来るよう持ち上げる
  geometry.translate(0, ORB_FLAME_PLANE_BOTTOM * ORB_FLAME_BALL_RADIUS + height / 2, 0)
  return geometry
}

/**
 * 1 個のオーブの炎のマテリアルを作る。色・乱数の種・明るさはオーブごと、それ以外は共有 uniform を参照する
 * @param sharedUniforms createOrbFlameSharedUniforms の結果（コピーせず同じオブジェクトを参照させる）
 * @param color 炎の色
 * @param seed 揺らぎ方を変える乱数の種
 */
export const createOrbFlameMaterial = (
  sharedUniforms: IOrbFlameSharedUniforms,
  color: Color,
  seed: number,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      // 霧の uniform（fogNear / fogFar など）。fog: true にすると、three.js が描画のたびにシーンの霧の値を入れる。
      // 値はマテリアルごとに書き込まれるため、共有せずマテリアルごとに複製する
      ...UniformsUtils.clone(UniformsLib.fog),
      // 共有 uniform は IUniform のオブジェクトごと渡し、値の更新が全オーブに届くようにする
      ...sharedUniforms,
      uColor: { value: color },
      uSeed: { value: seed },
      uIntensity: { value: 1 },
    },
    vertexShader: orbFlameVertexShader,
    fragmentShader: ORB_FLAME_FRAGMENT_SHADER,
    // 霧の色は混ぜず、距離だけを使って明るさを落とす（orbFlame.frag.glsl）
    fog: true,
    // 加算合成で光らせる。重なった部分ほど明るくなり、後ろの物を隠さない。
    // 標準の AdditiveBlending はアルファも足してしまうため使わず、色だけを足してアルファは描画先のまま残す。
    // 葉（alphaToCoverage）は縁でアルファが 1 未満になっており、そこへアルファを足すと、
    // 炎が 0 の部分でも板の範囲だけ葉の縁の見え方が変わり、板の四角い輪郭が浮き出るため
    blending: CustomBlending,
    blendEquation: AddEquation,
    // シェーダーはアルファ 1 を出すので、色は SrcAlpha ではなく One を掛けても同じ
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    transparent: true,
    depthWrite: false,
    // 木の幹などの手前の物には隠れるよう、深度の判定は行う
    depthTest: true,
  })
