import {
  Color,
  DoubleSide,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three"
import type { IUniform, WebGLProgramParametersWithUniforms } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { groundHeight, pathX } from "@/experience/procedural/path.utils"
import { hash2, mulberry32, randomRange } from "@/experience/procedural/random.utils"
import {
  ADDITIVE_COLOR_BLENDING,
  ADDITIVE_FOG_FRAGMENT,
} from "@/experience/shaders/additiveBlending.utils"
import { insertAfterShaderChunk, replaceShaderChunk } from "@/experience/shaders/shaderChunk.utils"

import { assertDividesCourseLength } from "./course.utils"
import { COURSE_LENGTH } from "./world.constants"

/**
 * 光芒の間隔（m）。COURSE_LENGTH を割り切る値にする（コンストラクタで検証する）。
 * 12.5m なら 1 周に 8 本。常に前方に 2〜3 本が見え、同じ景色の繰り返しに見えない程度にまばらにする
 */
const LIGHT_SHAFT_SPACING = 12.5

/** 光芒の数 */
const LIGHT_SHAFT_COUNT = COURSE_LENGTH / LIGHT_SHAFT_SPACING

/** 等間隔の位置から前後にずらす最大量（m）。間隔が規則的に見えないようにする */
const LIGHT_SHAFT_S_JITTER = 3

/**
 * 道の中心からの横距離の範囲（m）。左右交互に置く。
 * 道の上と道の縁（木の手前）に落ちる光にし、歩きながら近くを通り抜けられるようにする
 */
const LIGHT_SHAFT_SIDE_RANGE = [0.5, 4.5] as const

/** 光芒の高さ（m）。樹冠の下端（約 2.6m）より上の葉の間から差し込むように、木の高さ（7〜13m）程度にする */
const LIGHT_SHAFT_HEIGHT_RANGE = [8, 11] as const

/** 光芒の幅（m） */
const LIGHT_SHAFT_WIDTH_RANGE = [1.2, 2.2] as const

/** 光芒の色と明るさ。斜め前からの暖色の光（Atmosphere の SUN_COLOR）に寄せ、うっすら見える程度にする */
const LIGHT_SHAFT_COLOR = "#ffe6b8"
const LIGHT_SHAFT_INTENSITY = 0.16

/** 光芒の配置の乱数の seed。森の配置（WORLD_SEED）とは独立させ、森の seed を変えても光芒は動かさない */
const LIGHT_SHAFT_SEED = 3

/** 板の縦の分割数。曲げ変換は頂点単位なので、高い板が惑星の曲面に沿って傾くよう縦を分ける */
const LIGHT_SHAFT_HEIGHT_SEGMENTS = 8

/** 1 本の光芒の配置（コース座標系） */
interface ILightShaftPlacement {
  /** 根元の横位置（m） */
  x: number
  /** 根元のコース位置（m、0 以上 COURSE_LENGTH 未満） */
  s: number
  /** 根元の高さ（m、地面の起伏に合わせる） */
  baseHeight: number
  width: number
  height: number
}

/**
 * 1 周分の光芒の配置を作る。seed が固定なので、毎回同じ場所に同じ光芒ができる
 */
const listLightShaftPlacements = (): ILightShaftPlacement[] =>
  Array.from({ length: LIGHT_SHAFT_COUNT }, (_, index) => {
    const random = mulberry32(hash2(index, 0, LIGHT_SHAFT_SEED))
    // 引く順番を変えると配置が変わる（値を増やすときは最後に足すこと）
    // ずらした後の位置を 1 周で折り返し、0 以上 COURSE_LENGTH 未満に収める
    const s = MathUtils.euclideanModulo(
      (index + 0.5) * LIGHT_SHAFT_SPACING +
        randomRange(random, -LIGHT_SHAFT_S_JITTER, LIGHT_SHAFT_S_JITTER),
      COURSE_LENGTH,
    )
    const side = index % 2 === 0 ? -1 : 1
    const x = pathX(s) + side * randomRange(random, ...LIGHT_SHAFT_SIDE_RANGE)
    return {
      x,
      s,
      baseHeight: groundHeight(x, s),
      width: randomRange(random, ...LIGHT_SHAFT_WIDTH_RANGE),
      height: randomRange(random, ...LIGHT_SHAFT_HEIGHT_RANGE),
    }
  })

/** 頂点シェーダー・フラグメントシェーダーの両方に差し込む varying */
const SHARED_PARS = /* glsl */ `
  // 板の上の位置（0〜1、v = 0 が根元）。光の形を描くのに使う
  varying vec2 vLightShaftUv;
  // 近くを通り抜けるときに光芒を消す倍率（0〜1。光芒ごとに一定）
  varying float vLightShaftNearFade;
  // 光芒ごとの揺らぎのずらし量
  varying float vLightShaftSeed;
`

/** 頂点シェーダーの共通部分へ差し込む定数 */
const VERTEX_PARS = /* glsl */ `
  ${SHARED_PARS}
  // 光芒の傾き（高さ 1m あたりの横のずれ m）。光は左上（Atmosphere の SUN_POSITION の x が負）から差すので、
  // 上ほど左へずらす。板をカメラへ向けても、傾きは常に画面の中で同じ向きになる
  const float LIGHT_SHAFT_LEAN = -0.18;
  // 根元からカメラまでの水平距離（m）がこの範囲で、光芒を消した状態から現す。
  // 道の近くの光芒を通り抜けるとき、板が視界いっぱいに広がらないようにする
  const float LIGHT_SHAFT_NEAR_FADE_START = 1.5;
  const float LIGHT_SHAFT_NEAR_FADE_END = 5.0;
`

/**
 * 板をカメラへ向ける処理（begin_vertex の後に差し込む）。
 * インスタンス行列は平行移動と拡大だけ（回転なし）にしてあり、ここで縦軸のまわりだけ回してカメラへ向ける。
 * 向きは光芒の根元（インスタンスの原点）から見たカメラの方向で決め、板全体を同じ向きにする。
 * カメラは曲げ変換のカメラ相対座標の原点の真上にいるため、原点の相対位置を反転すればカメラへの向きになる。
 * この後、applyCurvature の project_vertex がインスタンス行列を掛けてから球面へ曲げる
 */
const BILLBOARD_PATCH = /* glsl */ `
  vec4 lightShaftAnchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 lightShaftToCamera = -curvatureRelative(lightShaftAnchor.xyz, lightShaftAnchor.xyz).xz;
  float lightShaftDistance = length(lightShaftToCamera);
  // 根元の真上にカメラがあると向きが決まらないため、正面（+Z）向きのままにする
  vec2 lightShaftFacing = lightShaftDistance > 1e-4 ? lightShaftToCamera / lightShaftDistance : vec2(0.0, 1.0);

  // 傾きは m 単位で決め、インスタンスの拡大（幅・高さ）を掛ける前の単位に直してから足す
  float lightShaftWidth = length(instanceMatrix[0].xyz);
  float lightShaftHeight = length(instanceMatrix[1].xyz);
  transformed.x += transformed.y * LIGHT_SHAFT_LEAN * lightShaftHeight / lightShaftWidth;
  // 板（XY 平面、表が +Z）を縦軸のまわりに回し、表を lightShaftFacing（xz）へ向ける
  transformed = vec3(transformed.x * lightShaftFacing.y, transformed.y, -transformed.x * lightShaftFacing.x);

  vLightShaftUv = uv;
  vLightShaftNearFade = smoothstep(LIGHT_SHAFT_NEAR_FADE_START, LIGHT_SHAFT_NEAR_FADE_END, lightShaftDistance);
  vLightShaftSeed = instanceMatrix[3].z;
`

/** フラグメントシェーダーの共通部分へ差し込む宣言 */
const FRAGMENT_PARS = /* glsl */ `
  ${SHARED_PARS}
  // 経過時間（秒）。光の中の縞を揺らす
  uniform float uTime;
`

/**
 * 光の形を描く処理（color_fragment の後に差し込む）。diffuseColor（光芒の色 × 明るさ）に光の濃さを掛ける。
 * 横は中央が明るく両端で 0、縦は根元と上端で 0 にし、板の四角い輪郭が見えないようにする。
 * 中に細い明暗の縞をゆっくり揺らし、葉の隙間を抜ける光が揺らいで見えるようにする
 */
const SHAPE_PATCH = /* glsl */ `
  float lightShaftCenter = abs(vLightShaftUv.x * 2.0 - 1.0);
  float lightShaftAcross = 1.0 - lightShaftCenter * lightShaftCenter;
  lightShaftAcross *= lightShaftAcross;
  // 上の方（葉の間）から明るくなり、地面へ向かってゆっくり薄れる
  float lightShaftAlong = smoothstep(0.0, 0.55, vLightShaftUv.y) * (1.0 - smoothstep(0.82, 1.0, vLightShaftUv.y));
  float lightShaftShimmer = 0.7 + 0.3
    * sin(vLightShaftUv.x * 9.0 + uTime * 0.6 + vLightShaftSeed)
    * sin(vLightShaftUv.x * 4.0 - uTime * 0.37 + vLightShaftSeed * 1.3);
  diffuseColor.rgb *= lightShaftAcross * lightShaftAlong * lightShaftShimmer * vLightShaftNearFade;
`

/**
 * 木漏れ日の光の筋（光芒カード）。計画書 §15。
 * 縦長の板を道の近くにまばらに立て、縦軸のまわりだけカメラへ向けて（シェーダー内で）、加算合成でうっすら光らせる。
 * 体積レンダリングは使わない。
 *
 * 1 周分（8 本）を 1 つの InstancedMesh で描く。インスタンス行列にはコース座標をそのまま入れ、
 * 移動・折り返し・湾曲は applyCurvature が行う（折り返しは光芒の根元で決まる）。
 * 前方 45〜50m では霧で完全に消え、後方の折り返し位置（50m）はカメラの後ろなので、チャンクで詰め直す必要はない。
 * 霧は色を混ぜず明るさを落とす（ADDITIVE_FOG_FRAGMENT）。
 */
export class LightShafts {
  /** シーンへ追加すること */
  readonly mesh: InstancedMesh<PlaneGeometry, MeshBasicMaterial>
  private readonly timeUniform: IUniform<number>

  /**
   * @param curvatureUniforms 曲げ変換の共有 uniform
   * @param timeUniform 経過時間（秒）の共有 uniform（World が毎フレーム更新する）
   * @throws 光芒の間隔が COURSE_LENGTH を割り切らない場合（GPU のリソースを作る前に投げる）
   */
  constructor(curvatureUniforms: ICurvatureUniforms, timeUniform: IUniform<number>) {
    assertDividesCourseLength("LightShafts: LIGHT_SHAFT_SPACING", LIGHT_SHAFT_SPACING)
    this.timeUniform = timeUniform

    // 幅 1・高さ 1 の板。根元（下端の中央）を原点にし、幅と高さはインスタンス行列の拡大で決める
    const geometry = new PlaneGeometry(1, 1, 1, LIGHT_SHAFT_HEIGHT_SEGMENTS).translate(0, 0.5, 0)
    const material = applyCurvature(
      new MeshBasicMaterial({
        ...ADDITIVE_COLOR_BLENDING,
        color: new Color(LIGHT_SHAFT_COLOR).multiplyScalar(LIGHT_SHAFT_INTENSITY),
        // 向きはシェーダーで常にカメラへ向けるが、向きが決まらない瞬間に裏から見えても消えないようにする
        side: DoubleSide,
      }),
      curvatureUniforms,
      { patchShader: this.patchShader, cacheKey: "light-shaft" },
    )

    const placements = listLightShaftPlacements()
    this.mesh = new InstancedMesh(geometry, material, placements.length)
    // 頂点をシェーダーで曲げるため、three.js の視錐台カリングは正しく判定できない
    this.mesh.frustumCulled = false

    // 配置は変わらないため、インスタンス行列は生成時に一度だけ書き込む
    const matrix = new Matrix4()
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    placements.forEach(({ x, s, baseHeight, width, height }, index) => {
      // 平面ワールド座標は (x, 高さ, -s)。回転は入れない（BILLBOARD_PATCH が前提にしている）
      position.set(x, baseHeight, -s)
      // 横の拡大は x と z を同じにする（縦軸のまわりに回しても幅が変わらないように）
      scale.set(width, height, width)
      this.mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.dispose()
  }

  /** 曲げ変換の後に、板をカメラへ向ける処理（頂点）と光の形・霧（フラグメント）の処理を差し込む */
  private readonly patchShader = (shader: WebGLProgramParametersWithUniforms): void => {
    // 共有 uniform はオブジェクトごと渡し、World の更新がそのまま届くようにする
    shader.uniforms.uTime = this.timeUniform

    const vertexShader = insertAfterShaderChunk(shader.vertexShader, "common", VERTEX_PARS)
    shader.vertexShader = insertAfterShaderChunk(vertexShader, "begin_vertex", BILLBOARD_PATCH)

    let fragmentShader = insertAfterShaderChunk(shader.fragmentShader, "common", FRAGMENT_PARS)
    fragmentShader = insertAfterShaderChunk(fragmentShader, "color_fragment", SHAPE_PATCH)
    shader.fragmentShader = replaceShaderChunk(
      fragmentShader,
      "fog_fragment",
      ADDITIVE_FOG_FRAGMENT,
    )
  }
}
