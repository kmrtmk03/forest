import { AddEquation, CustomBlending, OneFactor, ZeroFactor } from "three"

/**
 * 光を足して描くマテリアル（光芒・浮遊粒子）の合成の設定。マテリアルの生成時にスプレッドで渡す。
 * 標準の AdditiveBlending はアルファも足してしまうため使わず、色だけを足してアルファは描画先のまま残す。
 * 葉（alphaToCoverage）は縁でアルファが 1 未満になっており、そこへアルファを足すと、
 * 光が 0 の部分でも板の範囲だけ葉の縁の見え方が変わり、板の四角い輪郭が浮き出るため。
 * MEMO: orbs/orbFlame.utils.ts の炎のマテリアルと同じ設定
 *
 * 色は One を掛けて足すため、シェーダーは「光の強さを掛け終えた色」を出力すること（アルファは使わない）。
 * 板に描く光は、板の端より内側で必ず 0 にすること
 */
export const ADDITIVE_COLOR_BLENDING = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
  transparent: true,
  // 光は後ろの物を隠さない。手前の幹などには隠れるよう、深度の判定は行う
  depthWrite: false,
  depthTest: true,
} as const

/**
 * 標準の fog_fragment の代わりに使う GLSL。
 * 加算合成で霧の色を混ぜると、霧の中で光が霧の色に光ってしまうため、色は混ぜずに明るさだけを落とす。
 * vFogDepth は applyCurvature がカメラからの直線距離にしてある
 */
export const ADDITIVE_FOG_FRAGMENT = /* glsl */ `
  #ifdef USE_FOG
    gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
`
