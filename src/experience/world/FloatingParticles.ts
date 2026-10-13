import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three"
import type { IUniform, WebGLProgramParametersWithUniforms } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { mulberry32, randomRange } from "@/experience/procedural/random.utils"
import {
  ADDITIVE_COLOR_BLENDING,
  ADDITIVE_FOG_FRAGMENT,
} from "@/experience/shaders/additiveBlending.utils"
import { insertAfterShaderChunk, replaceShaderChunk } from "@/experience/shaders/shaderChunk.utils"

import { assertDividesCourseLength } from "./course.utils"

/** 粒子の数。箱（25m × 24m × 約 5m）の中に、歩きながら常に数十個が見える程度にまばらに置く */
const PARTICLE_COUNT = 450

/**
 * 粒子を閉じ込める箱のコース方向の長さ（m）と、そのうちカメラより後方の長さ（m）。
 * 前方 20m・後方 5m の範囲を、歩いた分だけ後ろへ流し、後ろの端から出た粒子を前の端へ戻す。
 * 長さは COURSE_LENGTH を割り切る値にする（コンストラクタで検証する）。カメラのコース位置は 1 周ごとに
 * COURSE_LENGTH だけ戻るため、割り切れないとループ境界で粒子の位置が飛ぶ
 */
const PARTICLE_BOX_LENGTH = 25
const PARTICLE_BOX_BEHIND = 5

/** 箱の横幅の半分（m）。16:9 の画面で、前方 12m 付近の画面の端まで届く幅 */
const PARTICLE_BOX_HALF_WIDTH = 12

/** 粒子の高さ（m）の範囲。低いところほど多くなるよう偏らせる（PARTICLE_HEIGHT_BIAS） */
const PARTICLE_HEIGHT_RANGE = [0.4, 5.5] as const
const PARTICLE_HEIGHT_BIAS = 1.6

/** 粒子の板の一辺（m）の範囲。光は中心から縁へ向けて 0 になるので、見える光の粒はこれより小さい */
const PARTICLE_SIZE_RANGE = [0.025, 0.05] as const

/**
 * 粒子の色と明るさ（線形色空間）。木漏れ日に照らされた埃・胞子のような淡い黄緑。
 * 中心を周りの森よりずっと明るくし、Bloom（PostProcessing）で粒がにじんで光るようにする。
 * 光は中心から縁へ向けて下がるため、強くにじむのは中心の小さな範囲だけ
 */
const PARTICLE_COLOR = "#f2f0c4"
const PARTICLE_INTENSITY = 1.2

/** 粒子の配置の乱数の seed（森の seed とは独立） */
const PARTICLE_SEED = 11

/** 1 個の粒子の板の頂点数と三角形の頂点の並び（四角形 = 三角形 2 枚） */
const VERTICES_PER_PARTICLE = 4
const QUAD_INDICES = [0, 1, 2, 2, 1, 3] as const
/** 板の四隅（uv）。シェーダーで (-1〜1) に直し、ビュー空間で広げる */
const QUAD_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const

/** 頂点シェーダー・フラグメントシェーダーの両方に差し込む varying */
const SHARED_PARS = /* glsl */ `
  // 板の四隅（-1〜1）。フラグメント側で丸い光にする
  varying vec2 vParticleCorner;
  // 箱の端・カメラの目の前で消す倍率と、明滅をまとめた明るさの倍率（0〜1）
  varying float vParticleBrightness;
`

/**
 * 頂点シェーダーの共通部分へ差し込む宣言と定数。
 * 箱の大きさは TS の定数から作る（toGlslFloat を使わず、必ず小数点を付けて float リテラルにする）
 */
const VERTEX_PARS = /* glsl */ `
  ${SHARED_PARS}
  uniform float uTime;
  // (乱数の種 0〜1, 板の一辺 m)
  attribute vec2 aParticle;
  const float PARTICLE_BOX_LENGTH = ${PARTICLE_BOX_LENGTH.toFixed(3)};
  const float PARTICLE_BOX_BEHIND = ${PARTICLE_BOX_BEHIND.toFixed(3)};
  const float PARTICLE_BOX_HALF_WIDTH = ${PARTICLE_BOX_HALF_WIDTH.toFixed(3)};
  // 箱の前の端・横の端で消す幅（m）。端で粒子が反対側へ移るのを見せない
  const float PARTICLE_FAR_FADE = 5.0;
  const float PARTICLE_SIDE_FADE = 3.0;
  // 目からこの範囲（m）で消す。目の前を横切る粒子が大きくぼやけて見えないようにする
  // （一辺 0.05m の板でも 1m の距離では画面の高さの 5% ほどになり、ぼやけた円に見える）
  const float PARTICLE_NEAR_FADE_START = 0.8;
  const float PARTICLE_NEAR_FADE_END = 2.5;
  // ふわふわと漂う振幅（m、横・縦・前後）と角速度（rad/秒）
  const vec3 PARTICLE_DRIFT = vec3(0.35, 0.2, 0.35);
  const vec3 PARTICLE_DRIFT_SPEED = vec3(0.23, 0.17, 0.29);
  // 明滅の強さと角速度（rad/秒）の範囲
  const float PARTICLE_TWINKLE = 0.45;
  const vec2 PARTICLE_TWINKLE_SPEED = vec2(0.6, 1.8);
`

/**
 * 粒子をカメラの周りの箱へ折り返す処理（begin_vertex の後に差し込む）。
 * position には粒子の元の位置 (x, 高さ, -s) が入っている（板の 4 頂点とも同じ値）。
 * メッシュはカメラの真下に付いて回る（update）ため、ここで求めるのはカメラからの相対位置。
 * 折り返しはカメラのコース位置（uCurvatureCamera、curvature.glsl）で行い、歩いた分だけ粒子が後ろへ流れる
 */
const POSITION_PATCH = /* glsl */ `
  float particleSeed = aParticle.x;
  float particleForward = mod(
    -position.z - uCurvatureCamera.y + PARTICLE_BOX_BEHIND,
    PARTICLE_BOX_LENGTH
  ) - PARTICLE_BOX_BEHIND;
  float particleSide = mod(
    position.x - uCurvatureCamera.x + PARTICLE_BOX_HALF_WIDTH,
    PARTICLE_BOX_HALF_WIDTH * 2.0
  ) - PARTICLE_BOX_HALF_WIDTH;

  // 時間で往復させて漂わせる。粒子ごとに位相をずらす
  vec3 particleDrift = sin(uTime * PARTICLE_DRIFT_SPEED + particleSeed * vec3(6.28, 12.9, 4.1)) * PARTICLE_DRIFT;
  transformed = vec3(particleSide, position.y, -particleForward) + particleDrift;

  float particleFarFade = 1.0 - smoothstep(
    PARTICLE_BOX_LENGTH - PARTICLE_BOX_BEHIND - PARTICLE_FAR_FADE,
    PARTICLE_BOX_LENGTH - PARTICLE_BOX_BEHIND,
    particleForward
  );
  float particleSideFade = 1.0 - smoothstep(
    PARTICLE_BOX_HALF_WIDTH - PARTICLE_SIDE_FADE,
    PARTICLE_BOX_HALF_WIDTH,
    abs(particleSide)
  );
  float particleTwinkleSpeed = mix(PARTICLE_TWINKLE_SPEED.x, PARTICLE_TWINKLE_SPEED.y, particleSeed);
  float particleTwinkle = 1.0 - PARTICLE_TWINKLE * (0.5 + 0.5 * sin(uTime * particleTwinkleSpeed + particleSeed * 40.0));
  vParticleBrightness = particleFarFade * particleSideFade * particleTwinkle;
  vParticleCorner = uv * 2.0 - 1.0;
`

/**
 * 板をカメラへ向けて広げる処理（logdepthbuf_vertex の直前に差し込む）。
 * applyCurvature の project_vertex で粒子の中心を球面へ曲げてビュー空間へ移した後、ビュー空間で四隅へ広げる。
 * 常に画面に平行な板になり、大きさは m 単位なので遠い粒子ほど小さく見える。
 * この後の fog_vertex は広げた後の mvPosition から距離を求める
 */
const BILLBOARD_PATCH = /* glsl */ `
  vParticleBrightness *= smoothstep(PARTICLE_NEAR_FADE_START, PARTICLE_NEAR_FADE_END, length(mvPosition.xyz));
  mvPosition.xy += vParticleCorner * (aParticle.y * 0.5);
  gl_Position = projectionMatrix * mvPosition;
`

/** フラグメントシェーダーの共通部分へ差し込む宣言 */
const FRAGMENT_PARS = SHARED_PARS

/**
 * 丸い光にする処理（color_fragment の後に差し込む）。中心が明るく、板の縁（半径 1）より内側で 0 になる
 */
const GLOW_PATCH = /* glsl */ `
  float particleGlow = 1.0 - smoothstep(0.0, 1.0, length(vParticleCorner));
  diffuseColor.rgb *= particleGlow * particleGlow * vParticleBrightness;
`

/**
 * 森の中を漂う光る埃・胞子（計画書 §15「浮遊する粒子」）。
 *
 * 粒子はカメラの周りの箱（前方 20m・後方 5m・左右 12m）に閉じ込め、カメラのコース位置で折り返して循環させる。
 * 歩いた分だけ後ろへ流れるので、粒子が地面や木と一緒に動いて見える（画面に貼り付いた汚れに見えない）。
 * 箱の長さが COURSE_LENGTH を割り切るため、1 周の境界をまたいでも粒子の位置は変わらない。
 *
 * Points は曲げ変換の法線のチャンクを持たず applyCurvature を通せないため、粒子ごとに 4 頂点の板を 1 つのメッシュにまとめ、
 * MeshBasicMaterial に applyCurvature を通して描く（Draw Call は 1）。板は頂点シェーダーでカメラへ向ける。
 * 加算合成でうっすら光らせ、霧は色を混ぜず明るさを落とす（ADDITIVE_FOG_FRAGMENT）。
 *
 * メッシュはカメラの真下に付いて回るため、毎フレーム update を呼ぶこと。呼ばないと粒子の位置がずれる
 */
export class FloatingParticles {
  /** シーンへ追加すること */
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>
  private readonly timeUniform: IUniform<number>

  /**
   * @param curvatureUniforms 曲げ変換の共有 uniform
   * @param timeUniform 経過時間（秒）の共有 uniform（World が毎フレーム更新する）
   * @throws 箱の長さが COURSE_LENGTH を割り切らない場合（GPU のリソースを作る前に投げる）
   */
  constructor(curvatureUniforms: ICurvatureUniforms, timeUniform: IUniform<number>) {
    assertDividesCourseLength("FloatingParticles: PARTICLE_BOX_LENGTH", PARTICLE_BOX_LENGTH)
    this.timeUniform = timeUniform

    const material = applyCurvature(
      new MeshBasicMaterial({
        ...ADDITIVE_COLOR_BLENDING,
        color: new Color(PARTICLE_COLOR).multiplyScalar(PARTICLE_INTENSITY),
      }),
      curvatureUniforms,
      { patchShader: this.patchShader, cacheKey: "floating-particle" },
    )

    this.mesh = new Mesh(FloatingParticles.createGeometry(), material)
    // 頂点をシェーダーで動かすため、three.js の視錐台カリングは正しく判定できない
    this.mesh.frustumCulled = false
  }

  /**
   * カメラの真下へメッシュを移動する。毎フレーム呼ぶこと。
   * 曲げ変換はメッシュの原点で折り返しを決めるため、原点をカメラに合わせ、粒子の位置はカメラからの相対位置で決める
   * @param cameraX カメラのコース x
   * @param cameraS カメラのコース s（COURSE_LENGTH で折り返した値）
   */
  update(cameraX: number, cameraS: number): void {
    // 平面ワールド座標では z = -s
    this.mesh.position.set(cameraX, 0, -cameraS)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }

  /**
   * 粒子の板をまとめたジオメトリを作る。板の 4 頂点には同じ位置（粒子の元の位置）と乱数を入れ、
   * 四隅の区別は uv で行う。seed が固定なので、毎回同じ粒子ができる
   */
  private static createGeometry(): BufferGeometry {
    const random = mulberry32(PARTICLE_SEED)
    const positions: number[] = []
    const uvs: number[] = []
    const particles: number[] = []
    const indices: number[] = []

    for (let index = 0; index < PARTICLE_COUNT; index++) {
      // 引く順番を変えると粒子の配置が変わる（値を増やすときは最後に足すこと）
      const x = randomRange(random, -PARTICLE_BOX_HALF_WIDTH, PARTICLE_BOX_HALF_WIDTH)
      const s = randomRange(random, 0, PARTICLE_BOX_LENGTH)
      const [minHeight, maxHeight] = PARTICLE_HEIGHT_RANGE
      const height = minHeight + (maxHeight - minHeight) * random() ** PARTICLE_HEIGHT_BIAS
      const seed = random()
      const size = randomRange(random, ...PARTICLE_SIZE_RANGE)

      const firstVertex = index * VERTICES_PER_PARTICLE
      QUAD_CORNERS.forEach(([u, v]) => {
        // 平面ワールド座標は (x, 高さ, -s)
        positions.push(x, height, -s)
        uvs.push(u, v)
        particles.push(seed, size)
      })
      QUAD_INDICES.forEach((offset) => indices.push(firstVertex + offset))
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    geometry.setAttribute("aParticle", new Float32BufferAttribute(particles, 2))
    geometry.setIndex(indices)
    return geometry
  }

  /** 曲げ変換の後に、粒子の位置と板の向き（頂点）、丸い光と霧（フラグメント）の処理を差し込む */
  private readonly patchShader = (shader: WebGLProgramParametersWithUniforms): void => {
    // 共有 uniform はオブジェクトごと渡し、World の更新がそのまま届くようにする
    shader.uniforms.uTime = this.timeUniform

    let vertexShader = insertAfterShaderChunk(shader.vertexShader, "common", VERTEX_PARS)
    vertexShader = insertAfterShaderChunk(vertexShader, "begin_vertex", POSITION_PATCH)
    // 直前に差し込むため、チャンクを自分の処理 + チャンク自身で置き換える
    shader.vertexShader = replaceShaderChunk(
      vertexShader,
      "logdepthbuf_vertex",
      `${BILLBOARD_PATCH}\n#include <logdepthbuf_vertex>`,
    )

    let fragmentShader = insertAfterShaderChunk(shader.fragmentShader, "common", FRAGMENT_PARS)
    fragmentShader = insertAfterShaderChunk(fragmentShader, "color_fragment", GLOW_PATCH)
    shader.fragmentShader = replaceShaderChunk(
      fragmentShader,
      "fog_fragment",
      ADDITIVE_FOG_FRAGMENT,
    )
  }
}
