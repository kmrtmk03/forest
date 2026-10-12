import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshLambertMaterial } from "three"

import { applyCurvature } from "@/experience/curvature/applyCurvature"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { groundHeight } from "@/experience/procedural/path.utils"

import { COURSE_LENGTH, PATH_HALF_WIDTH } from "./world.constants"

/** ポールを立てる間隔（m）。COURSE_LENGTH を割り切る値にする */
const POLE_INTERVAL = 10

/** ポールの寸法（m） */
const POLE_HEIGHT = 3
const POLE_RADIUS = 0.08
const POLE_RADIAL_SEGMENTS = 8

/** 道の縁からポールまでの距離（m） */
const POLE_OFFSET_FROM_PATH = 0.6

/** 0m 地点のポールの色（ループの境界を目視で確認するため目立たせる） */
const ORIGIN_POLE_COLOR = "#d64545"
const POLE_COLOR = "#e8e2d0"

/**
 * 動作確認用のポール。コース座標で 10m ごとに道の両側へ立てる（0m だけ赤）。
 * 地平線からのせり上がり・ループ境界のつながりを確認するための仮の目印。
 * TODO: Phase 3 で木・岩の配置（Forest）が入ったら削除する
 */
export class CoursePoles {
  readonly mesh: InstancedMesh<CylinderGeometry, MeshLambertMaterial>

  constructor(curvatureUniforms: ICurvatureUniforms) {
    const geometry = new CylinderGeometry(
      POLE_RADIUS,
      POLE_RADIUS,
      POLE_HEIGHT,
      POLE_RADIAL_SEGMENTS,
    )
    // 原点を根元にして、y = 地面からの高さで扱えるようにする
    geometry.translate(0, POLE_HEIGHT / 2, 0)

    const material = applyCurvature(new MeshLambertMaterial(), curvatureUniforms, {
      cacheKey: "course-poles",
    })

    const polesPerSide = COURSE_LENGTH / POLE_INTERVAL
    const sides = [-1, 1]
    this.mesh = new InstancedMesh(geometry, material, polesPerSide * sides.length)
    // 頂点をシェーダーで曲げるため、three.js の視錐台カリングは正しく判定できない
    this.mesh.frustumCulled = false

    const matrix = new Matrix4()
    const originColor = new Color(ORIGIN_POLE_COLOR)
    const poleColor = new Color(POLE_COLOR)
    const poleX = PATH_HALF_WIDTH + POLE_OFFSET_FROM_PATH

    // インスタンス行列の平行移動にコース座標を入れる（平面ワールド座標では z = -s）
    // 根元の高さは地面の起伏（GLSL 版と同じ式の TS 版）に合わせる
    for (let index = 0; index < polesPerSide; index++) {
      const s = index * POLE_INTERVAL
      sides.forEach((side, sideIndex) => {
        const instanceIndex = index * sides.length + sideIndex
        const x = side * poleX
        matrix.makeTranslation(x, groundHeight(x, s), -s)
        this.mesh.setMatrixAt(instanceIndex, matrix)
        this.mesh.setColorAt(instanceIndex, s === 0 ? originColor : poleColor)
      })
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.dispose()
  }
}
