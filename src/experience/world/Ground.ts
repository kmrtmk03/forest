import { Color, Mesh, MeshLambertMaterial, PlaneGeometry } from "three"
import type { WebGLProgramParametersWithUniforms } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"

import { COURSE_LENGTH, PATH_HALF_WIDTH } from "./world.constants"

/** 地面の頂点間隔（m）。曲げ変換は頂点単位なので、粗すぎると球面がカクつく */
const GROUND_VERTEX_SPACING = 2

/**
 * 地面メッシュの一辺（m）。地平線より十分大きくし、地平線の向こうにある物の根元を地面で隠す。
 * 端の頂点が折り返し位置（カメラから ±COURSE_LENGTH / 2）に達すると反対側へ飛んで地面が裂けるため、
 * 頂点 1 間隔分だけ内側に収める（COURSE_LENGTH = 100 のとき 96m = ±48m）
 */
const GROUND_SIZE = COURSE_LENGTH - GROUND_VERTEX_SPACING * 2

/** 地面メッシュの分割数 */
const GROUND_SEGMENTS = GROUND_SIZE / GROUND_VERTEX_SPACING

/**
 * 仮の地面の模様。グリッド間隔は COURSE_LENGTH（100m）を割り切る値にし、ループ境界で模様がずれないようにする。
 * TODO: Phase 2 で道・草地の模様（ground.vert / ground.frag）に置き換える
 */
const MINOR_GRID_SPACING = 2
const MAJOR_GRID_SPACING = 10
const MINOR_GRID_HALF_WIDTH = 0.03
const MAJOR_GRID_HALF_WIDTH = 0.08
const GRASS_COLOR = "#3f5a3a"
const PATH_COLOR = "#7a6a4f"
const MINOR_GRID_COLOR = "#5f7d55"
const MAJOR_GRID_COLOR = "#a8c49a"

/** 道の縁をぼかす幅（m） */
const PATH_EDGE_SOFTNESS = 0.05

/** フラグメントシェーダーへ追加する関数（color_pars_fragment の後に差し込む） */
const GRID_FUNCTIONS = /* glsl */ `
  uniform vec3 uGrassColor;
  uniform vec3 uPathColor;
  uniform vec3 uMinorGridColor;
  uniform vec3 uMajorGridColor;

  // coord から spacing 間隔の格子線までの距離で線を描く。fwidth で画面上の太さを補い、遠くでもちらつかないようにする
  float groundGridLine(vec2 coord, float spacing, float halfWidth) {
    vec2 distanceToLine = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
    vec2 pixelWidth = fwidth(coord);
    vec2 line = 1.0 - smoothstep(vec2(halfWidth), vec2(halfWidth) + pixelWidth, distanceToLine);
    return max(line.x, line.y);
  }
`

/** 地面の色を決める処理（color_fragment の後に差し込む）。vCourseCoord は applyCurvature が渡すコース座標 */
const GRID_COLOR = /* glsl */ `
  float groundPathMask = 1.0 - smoothstep(
    ${(PATH_HALF_WIDTH - PATH_EDGE_SOFTNESS).toFixed(3)},
    ${(PATH_HALF_WIDTH + PATH_EDGE_SOFTNESS).toFixed(3)},
    abs(vCourseCoord.x)
  );
  vec3 groundColor = mix(uGrassColor, uPathColor, groundPathMask);
  groundColor = mix(
    groundColor,
    uMinorGridColor,
    groundGridLine(vCourseCoord, ${MINOR_GRID_SPACING.toFixed(1)}, ${MINOR_GRID_HALF_WIDTH.toFixed(3)})
  );
  groundColor = mix(
    groundColor,
    uMajorGridColor,
    groundGridLine(vCourseCoord, ${MAJOR_GRID_SPACING.toFixed(1)}, ${MAJOR_GRID_HALF_WIDTH.toFixed(3)})
  );
  diffuseColor.rgb *= groundColor;
`

const COLOR_PARS_CHUNK = "#include <color_pars_fragment>"
const COLOR_CHUNK = "#include <color_fragment>"

/**
 * 惑星の表面となる地面。カメラに追従する 1 枚の平面を、曲げ変換で球冠に見せる。
 *
 * メッシュ自体はカメラの真下に付いて回るだけなので、ループの影響を受けない。
 * 模様はコース座標で描くため、カメラが動くと模様だけが流れて「進んでいる」ように見える。
 */
export class Ground {
  readonly mesh: Mesh<PlaneGeometry, MeshLambertMaterial>

  constructor(curvatureUniforms: ICurvatureUniforms) {
    const geometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS)
    // PlaneGeometry は XY 平面なので、XZ 平面（地面）へ寝かせる
    geometry.rotateX(-Math.PI / 2)

    const material = applyCurvature(new MeshLambertMaterial(), curvatureUniforms, {
      patchShader: this.patchShader,
      cacheKey: "ground-grid",
    })

    this.mesh = new Mesh(geometry, material)
    // 頂点をシェーダーで曲げるため、three.js の視錐台カリングは正しく判定できない
    this.mesh.frustumCulled = false
  }

  /**
   * カメラの真下へ地面を移動する。毎フレーム呼ぶこと。
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

  /** 曲げ変換の後に、地面の模様を描くフラグメント処理を差し込む */
  private readonly patchShader = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uGrassColor = { value: new Color(GRASS_COLOR) }
    shader.uniforms.uPathColor = { value: new Color(PATH_COLOR) }
    shader.uniforms.uMinorGridColor = { value: new Color(MINOR_GRID_COLOR) }
    shader.uniforms.uMajorGridColor = { value: new Color(MAJOR_GRID_COLOR) }

    shader.fragmentShader = shader.fragmentShader
      .replace(COLOR_PARS_CHUNK, `${COLOR_PARS_CHUNK}\n${GRID_FUNCTIONS}`)
      .replace(COLOR_CHUNK, `${COLOR_CHUNK}\n${GRID_COLOR}`)
  }
}
