import { Color, Mesh, MeshLambertMaterial, PlaneGeometry } from "three"
import type { WebGLProgramParametersWithUniforms } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import {
  GROUND_FLAT_HALF_WIDTH,
  GROUND_HILL_HEIGHT,
  GROUND_HILL_RAMP_END,
  GROUND_HILL_WAVES,
  PATH_MEANDER_WAVES,
} from "@/experience/procedural/path.constants"
import groundFragmentShader from "@/experience/shaders/ground.frag.glsl?raw"
import groundShader from "@/experience/shaders/ground.glsl?raw"

import { COURSE_LENGTH, PATH_HALF_WIDTH } from "./world.constants"

/** 地面の頂点間隔（m）。曲げ変換と起伏は頂点単位なので、粗すぎると球面や丘がカクつく */
const GROUND_VERTEX_SPACING = 2

/**
 * 地面メッシュの一辺（m）。地平線より十分大きくし、地平線の向こうにある物の根元を地面で隠す。
 * 端の頂点が折り返し位置（カメラから ±COURSE_LENGTH / 2）に達すると反対側へ飛んで地面が裂ける。
 * メッシュは頂点間隔単位でカメラに追従させる（最大で間隔の半分ずれる）ため、
 * 頂点 2 間隔分だけ内側に収める（COURSE_LENGTH = 100 のとき 96m = ±48m、ずれを含めても ±49m）
 */
const GROUND_SIZE = COURSE_LENGTH - GROUND_VERTEX_SPACING * 2

/** 地面メッシュの分割数 */
const GROUND_SEGMENTS = GROUND_SIZE / GROUND_VERTEX_SPACING

/** 法線を求めるために高さを差分で取るときの間隔（m）。起伏の波長（12m 以上）より十分小さくする */
const GROUND_NORMAL_SAMPLE_OFFSET = 0.5

/** 地面の色（草地・苔・道の土）。明るさは光と霧を掛けた後の見た目で調整した */
const GRASS_DARK_COLOR = "#2c4527"
const GRASS_LIGHT_COLOR = "#4d6b37"
const MOSS_COLOR = "#6f8a3c"
const DIRT_DARK_COLOR = "#5e4b35"
const DIRT_LIGHT_COLOR = "#8a7452"

/** GLSL の float リテラルにする（整数でも小数点を付けないと int 扱いになる） */
const toGlslFloat = (value: number): string => value.toFixed(4)

/**
 * ground.glsl へ渡す定数。TS の定数から作り、TS 版（path.utils.ts）と GLSL 版で同じ値を使う。
 * material.defines は頂点・フラグメントの両方に #define として付き、プログラムキャッシュのキーにも含まれる
 */
const GROUND_DEFINES = {
  GROUND_COURSE_LENGTH: toGlslFloat(COURSE_LENGTH),
  GROUND_PATH_HALF_WIDTH: toGlslFloat(PATH_HALF_WIDTH),
  GROUND_FLAT_HALF_WIDTH: toGlslFloat(GROUND_FLAT_HALF_WIDTH),
  GROUND_HILL_RAMP_END: toGlslFloat(GROUND_HILL_RAMP_END),
  GROUND_HILL_HEIGHT: toGlslFloat(GROUND_HILL_HEIGHT),
  GROUND_NORMAL_SAMPLE_OFFSET: toGlslFloat(GROUND_NORMAL_SAMPLE_OFFSET),
  // GLSL の配列は長さ 0 にできないため、定数側で 1 件以上を保つこと
  GROUND_PATH_MEANDER_WAVE_COUNT: PATH_MEANDER_WAVES.length,
  GROUND_PATH_MEANDER_WAVES: PATH_MEANDER_WAVES.map(
    ({ cycles, amplitude, phase }) =>
      `vec3(${[cycles, amplitude, phase].map(toGlslFloat).join(", ")})`,
  ).join(", "),
  GROUND_HILL_WAVE_COUNT: GROUND_HILL_WAVES.length,
  GROUND_HILL_WAVES: GROUND_HILL_WAVES.map(
    ({ cycles, xFrequency, phase, weight }) =>
      `vec4(${[cycles, xFrequency, phase, weight].map(toGlslFloat).join(", ")})`,
  ).join(", "),
}

/**
 * 法線を起伏に合わせる処理（beginnormal_vertex の後に差し込む）。
 * 法線のチャンクは begin_vertex より前に実行されるため、位置は position から求める。
 * メッシュは回転していないので、平面ワールド座標の法線をそのまま objectNormal に使える。
 * この後、applyCurvature の処理が球面写像に合わせて法線を回転する
 */
const NORMAL_PATCH = /* glsl */ `
  vec4 groundNormalFlatPosition = modelMatrix * vec4(position, 1.0);
  objectNormal = groundNormal(groundNormalFlatPosition.x, -groundNormalFlatPosition.z);
`

/**
 * 頂点を起伏の高さだけ持ち上げる処理（begin_vertex の後に差し込む）。
 * 平面ワールド座標のまま高さを足し、その後の project_vertex（applyCurvature）で球面へ曲げる
 */
const POSITION_PATCH = /* glsl */ `
  vec4 groundFlatPosition = modelMatrix * vec4(transformed, 1.0);
  transformed.y += groundHeight(groundFlatPosition.x, -groundFlatPosition.z);
`

/** 地面の模様を色に反映する処理（color_fragment の後に差し込む）。vCourseCoord は applyCurvature が渡す */
const COLOR_PATCH = /* glsl */ `
  diffuseColor.rgb *= groundSurfaceColor(vCourseCoord);
`

/** 差し込み先の標準チャンク */
const COMMON_CHUNK = "#include <common>"
const BEGIN_NORMAL_CHUNK = "#include <beginnormal_vertex>"
const BEGIN_VERTEX_CHUNK = "#include <begin_vertex>"
const COLOR_CHUNK = "#include <color_fragment>"

/**
 * 惑星の表面となる地面。カメラに追従する 1 枚の平面を、曲げ変換で球冠に見せる。
 *
 * メッシュ自体はカメラの真下に付いて回るだけなので、ループの影響を受けない。
 * 起伏と模様はコース座標で計算するため、カメラが動くと地形と模様だけが流れて「進んでいる」ように見える。
 * 道は専用のメッシュを作らず、フラグメントシェーダー内で道のマスクを計算して土の色を塗る。
 */
export class Ground {
  readonly mesh: Mesh<PlaneGeometry, MeshLambertMaterial>

  constructor(curvatureUniforms: ICurvatureUniforms) {
    const geometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS)
    // PlaneGeometry は XY 平面なので、XZ 平面（地面）へ寝かせる
    geometry.rotateX(-Math.PI / 2)

    const material = new MeshLambertMaterial()
    material.defines = { ...GROUND_DEFINES }
    applyCurvature(material, curvatureUniforms, {
      patchShader: this.patchShader,
      cacheKey: "ground",
    })

    this.mesh = new Mesh(geometry, material)
    // 頂点をシェーダーで曲げるため、three.js の視錐台カリングは正しく判定できない
    this.mesh.frustumCulled = false
  }

  /**
   * カメラの真下へ地面を移動する。毎フレーム呼ぶこと。
   * 頂点間隔の単位でだけ動かし、頂点が常にコース座標の同じ格子点に乗るようにする。
   * 連続的に動かすと、頂点が起伏の上を滑って丘の形が揺らいで見える。
   * COURSE_LENGTH は頂点間隔で割り切れるため、ループ境界をまたいでも格子はずれない
   * @param cameraX カメラのコース x
   * @param cameraS カメラのコース s（COURSE_LENGTH で折り返した値）
   */
  update(cameraX: number, cameraS: number): void {
    const snappedX = Math.round(cameraX / GROUND_VERTEX_SPACING) * GROUND_VERTEX_SPACING
    const snappedS = Math.round(cameraS / GROUND_VERTEX_SPACING) * GROUND_VERTEX_SPACING
    // 平面ワールド座標では z = -s
    this.mesh.position.set(snappedX, 0, -snappedS)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }

  /** 曲げ変換の後に、起伏（頂点）と模様（フラグメント）の処理を差し込む */
  private readonly patchShader = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uGrassDarkColor = { value: new Color(GRASS_DARK_COLOR) }
    shader.uniforms.uGrassLightColor = { value: new Color(GRASS_LIGHT_COLOR) }
    shader.uniforms.uMossColor = { value: new Color(MOSS_COLOR) }
    shader.uniforms.uDirtDarkColor = { value: new Color(DIRT_DARK_COLOR) }
    shader.uniforms.uDirtLightColor = { value: new Color(DIRT_LIGHT_COLOR) }

    shader.vertexShader = shader.vertexShader
      .replace(COMMON_CHUNK, `${COMMON_CHUNK}\n${groundShader}`)
      .replace(BEGIN_NORMAL_CHUNK, `${BEGIN_NORMAL_CHUNK}\n${NORMAL_PATCH}`)
      .replace(BEGIN_VERTEX_CHUNK, `${BEGIN_VERTEX_CHUNK}\n${POSITION_PATCH}`)

    shader.fragmentShader = shader.fragmentShader
      .replace(COMMON_CHUNK, `${COMMON_CHUNK}\n${groundShader}\n${groundFragmentShader}`)
      .replace(COLOR_CHUNK, `${COLOR_CHUNK}\n${COLOR_PATCH}`)
  }
}
