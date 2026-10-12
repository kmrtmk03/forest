import { Vector2 } from "three"
import type { IUniform, Material, WebGLProgramParametersWithUniforms } from "three"

import curvatureShader from "./curvature.glsl?raw"

/** 擬似球面の曲げ変換で全マテリアルが共有する uniform */
export interface ICurvatureUniforms {
  /** (カメラのコース x, カメラのコース s mod COURSE_LENGTH)。World が毎フレーム更新する */
  uCurvatureCamera: IUniform<Vector2>
  /** 見た目の惑星半径（m） */
  uPlanetRadius: IUniform<number>
  /** コース 1 周の長さ（m） */
  uCourseLength: IUniform<number>
}

/** applyCurvature の追加オプション */
interface IApplyCurvatureOptions {
  /** 曲げ変換を差し込んだ後に、マテリアル固有のシェーダー改変を行う（地面の模様など） */
  patchShader?: (shader: WebGLProgramParametersWithUniforms) => void
  /** プログラムキャッシュを区別するためのキー。patchShader の内容ごとに固有の値にする */
  cacheKey: string
}

/**
 * 曲げ変換用の共有 uniform を作る。
 * 同じオブジェクトを全マテリアルへ渡すことで、毎フレーム 1 回の更新が全体に反映される。
 */
export const createCurvatureUniforms = (
  planetRadius: number,
  courseLength: number,
): ICurvatureUniforms => ({
  uCurvatureCamera: { value: new Vector2() },
  uPlanetRadius: { value: planetRadius },
  uCourseLength: { value: courseLength },
})

/**
 * 頂点の平面ワールド座標を求める GLSL。
 * three.js 標準の project_vertex と同じ順序（バッチ → インスタンス → モデル行列）で変換する。
 */
const buildFlatWorldPosition = (variableName: string, source: string): string => /* glsl */ `
  vec4 ${variableName} = vec4(${source}, 1.0);
  #ifdef USE_BATCHING
    ${variableName} = batchingMatrix * ${variableName};
  #endif
  #ifdef USE_INSTANCING
    ${variableName} = instanceMatrix * ${variableName};
  #endif
  ${variableName} = modelMatrix * ${variableName};
`

/**
 * 標準の project_vertex を置き換える GLSL。
 * 平面ワールド座標 → カメラ相対（円環の折り返し）→ 球面写像 → ビュー・投影の順に変換する。
 * 変数名 mvPosition は後続の標準チャンク（fog_vertex・lights 用の vViewPosition）が参照するため維持する。
 */
const PROJECT_VERTEX = /* glsl */ `
  ${buildFlatWorldPosition("curvatureFlatPosition", "transformed")}
  vec3 curvatureRelativePosition = curvatureRelative(curvatureFlatPosition.xyz);
  vCourseCoord = vec2(
    curvatureFlatPosition.x,
    uCurvatureCamera.y - curvatureRelativePosition.z
  );
  vec4 mvPosition = viewMatrix * vec4(curvaturePosition(curvatureRelativePosition), 1.0);
  gl_Position = projectionMatrix * mvPosition;
`

/**
 * 標準の defaultnormal_vertex の後に追加する GLSL。
 * ビュー空間の法線をワールド空間へ戻し、球面写像と同じ角度だけ回転してからビュー空間へ戻す。
 * 法線のチャンクは begin_vertex より前に実行されるため、位置はモーフ等を含まない position から求める。
 */
const NORMAL_VERTEX = /* glsl */ `
  ${buildFlatWorldPosition("curvatureNormalFlatPosition", "position")}
  vec3 curvatureWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
  curvatureWorldNormal = curvatureNormal(
    curvatureRelative(curvatureNormalFlatPosition.xyz),
    curvatureWorldNormal
  );
  transformedNormal = normalize((viewMatrix * vec4(curvatureWorldNormal, 0.0)).xyz);
`

/** フラグメントシェーダーへ差し込む宣言。curvature.glsl の varying と同じ名前・型にする */
const FRAGMENT_PARS = /* glsl */ `varying vec2 vCourseCoord;`

/** 差し込み先の標準チャンク */
const COMMON_CHUNK = "#include <common>"
const DEFAULT_NORMAL_CHUNK = "#include <defaultnormal_vertex>"
const PROJECT_VERTEX_CHUNK = "#include <project_vertex>"

/**
 * マテリアルに擬似球面の曲げ変換を差し込む。
 * 頂点がシェーダー内で大きく動くため、このマテリアルを使うメッシュは frustumCulled = false にすること。
 *
 * MEMO: worldpos_vertex（環境マップ・影で使用）は曲げていない。影や環境マップを使う場合は別途対応が必要
 */
export const applyCurvature = <TMaterial extends Material>(
  material: TMaterial,
  uniforms: ICurvatureUniforms,
  options: IApplyCurvatureOptions,
): TMaterial => {
  material.onBeforeCompile = (shader) => {
    // uniform は同じオブジェクトを共有させる（値をコピーしない）
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(COMMON_CHUNK, `${COMMON_CHUNK}\n${curvatureShader}`)
      .replace(DEFAULT_NORMAL_CHUNK, `${DEFAULT_NORMAL_CHUNK}\n${NORMAL_VERTEX}`)
      .replace(PROJECT_VERTEX_CHUNK, PROJECT_VERTEX)

    // フラグメント側ではコース座標（地面の模様など）だけを参照できるようにする
    shader.fragmentShader = shader.fragmentShader.replace(
      COMMON_CHUNK,
      `${COMMON_CHUNK}\n${FRAGMENT_PARS}`,
    )

    options.patchShader?.(shader)
  }

  // onBeforeCompile の内容が違うマテリアル同士でプログラムを共有しないようにする
  material.customProgramCacheKey = () => `curvature:${options.cacheKey}`

  return material
}
