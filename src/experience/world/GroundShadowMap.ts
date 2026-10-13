import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
} from "three"

import type { TPlacementChunks, TPropKind } from "@/experience/procedural/placement.type"

import { assertDividesCourseLength } from "./course.utils"
import { COURSE_LENGTH } from "./world.constants"

/**
 * 影のテクスチャの 1 画素の大きさ（m）。COURSE_LENGTH を割り切る値にする（コンストラクタで検証する）。
 * 影はぼかした円なので、小さい岩（半径 約 0.5m）の影がつぶれない程度の細かさでよい
 */
const SHADOW_TEXEL_SIZE = 0.25

/**
 * 影を描く横方向の範囲（m、道の中心から片側）。
 * 配置物は道の中心から 36m まで（placement.constants.ts）に置かれるため、そこに影の半径（最大 約 2.2m）と、
 * 道の蛇行の振幅（Phase 7 で 1〜1.5m を試す予定）の余裕を足して切りのよい値にした。
 * これより外の地面には影を描かない（霧でほとんど見えない）
 */
export const GROUND_SHADOW_HALF_WIDTH = 40

/** テクスチャの幅（横方向）と高さ（コース方向）の画素数 */
const SHADOW_MAP_WIDTH = (GROUND_SHADOW_HALF_WIDTH * 2) / SHADOW_TEXEL_SIZE
const SHADOW_MAP_HEIGHT = COURSE_LENGTH / SHADOW_TEXEL_SIZE

/** 1 画素の値の最大（UnsignedByte） */
const BYTE_MAX = 255

/** 種類ごとのブロブ影の形 */
interface IBlobShadowShape {
  /** 拡大率 1 のときの影の半径（m）。配置の拡大率（IPropPlacement.scale）を掛ける */
  radius: number
  /** 根元（中心）での暗さ（0〜1）。重なった影は掛け合わせて暗くなる */
  strength: number
}

/**
 * 種類ごとのブロブ影。光は真上ではなく斜め前から来るが、影はぼかして根元を地面になじませるのが目的なので、
 * 中心を根元に置いた円にする（光の向きに伸ばすと、カメラに対する向きで不自然に見える）。
 *   木: 幹（拡大後の半径 約 0.3〜0.4m）の周りを、根が張る程度の広さで暗くする
 *   岩: 岩（半径 約 0.6m × 拡大率）より一回り大きく暗くし、地面から浮いて見えないようにする
 */
const BLOB_SHADOW_SHAPES: Record<TPropKind, IBlobShadowShape> = {
  tree: { radius: 1.8, strength: 0.55 },
  rock: { radius: 1.1, strength: 0.5 },
}

/**
 * 配置物の根元のブロブ影（計画書 §15「影の代替 ①」）を、1 周分のテクスチャに描いて持つ。
 * 地面のシェーダー（ground.frag.glsl）がコース座標 (x, s) でこのテクスチャを読み、地面の色を暗くする。
 *
 * 計画書では「板ポリを InstancedMesh で並べて乗算合成」としていたが、地面の起伏に沿わせにくく（斜面で板が浮く・埋まる）、
 * 地面との Z ファイティングも起きるため、地面の模様の一部として描く方式にした。Draw Call も増えない。
 *
 * テクスチャの横（u）は道の中心から ±GROUND_SHADOW_HALF_WIDTH、縦（v）はコース 1 周（0〜COURSE_LENGTH）に対応する。
 * 縦は RepeatWrapping にして、1 周の境界をまたいでも影がつながるようにする。
 * draw は配置を作り直したとき（起動時と seed の変更時）だけ呼ぶこと。破棄は dispose で行う
 */
export class GroundShadowMap {
  /** 影の暗さ（0 = 影なし、1 = 真っ黒）。Ground のマテリアルが uniform として参照する */
  readonly texture: DataTexture
  private readonly data = new Uint8Array(SHADOW_MAP_WIDTH * SHADOW_MAP_HEIGHT)
  /** 影を重ねるときの作業用。画素ごとの「光の残り（1 = 影なし）」を掛け合わせる */
  private readonly light = new Float32Array(SHADOW_MAP_WIDTH * SHADOW_MAP_HEIGHT)

  /** @throws 画素の大きさが COURSE_LENGTH を割り切らない場合 */
  constructor() {
    assertDividesCourseLength("GroundShadowMap: SHADOW_TEXEL_SIZE", SHADOW_TEXEL_SIZE)

    this.texture = new DataTexture(
      this.data,
      SHADOW_MAP_WIDTH,
      SHADOW_MAP_HEIGHT,
      RedFormat,
      UnsignedByteType,
    )
    // 横は範囲の外へ伸ばさない（端の画素は影を描かないので 0 のまま）。縦は 1 周で繰り返す
    this.texture.wrapS = ClampToEdgeWrapping
    this.texture.wrapT = RepeatWrapping
    // 影はぼかした円なので、線形補間で画素の境目を目立たなくする。ミップマップは作らない（データの更新を軽くするため）
    this.texture.magFilter = LinearFilter
    this.texture.minFilter = LinearFilter
    this.texture.generateMipmaps = false
  }

  /**
   * 配置物の根元の影を描き直す。配置を作り直したとき（起動時と seed の変更時）に呼ぶこと。毎フレーム呼ばないこと
   * @param placementChunks 1 周分の配置（generatePlacements の結果）
   */
  draw(placementChunks: TPlacementChunks): void {
    this.light.fill(1)
    placementChunks.forEach((placements) =>
      placements.forEach(({ kind, x, s, scale }) => {
        const { radius, strength } = BLOB_SHADOW_SHAPES[kind]
        this.drawBlob(x, s, radius * scale, strength)
      }),
    )

    for (let index = 0; index < this.data.length; index++) {
      this.data[index] = Math.round((1 - this.light[index]) * BYTE_MAX)
    }
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }

  /**
   * 1 個の円い影を重ねる。縁へ向かって (1 - d²)² で滑らかに 0 にする（d は中心からの距離 / 半径）。
   * 縦（コース方向）は 1 周で折り返して描き、0m 付近の影が反対側の端へつながるようにする
   * @param x 中心の横位置（m）
   * @param s 中心のコース位置（m、0 以上 COURSE_LENGTH 未満）
   * @param radius 半径（m）
   * @param strength 中心での暗さ（0〜1）
   */
  private drawBlob(x: number, s: number, radius: number, strength: number): void {
    if (radius <= 0 || strength <= 0) return

    // 画素 (column, row) の中心は (column + 0.5, row + 0.5) × SHADOW_TEXEL_SIZE（横は -GROUND_SHADOW_HALF_WIDTH から）
    const centerColumn = (x + GROUND_SHADOW_HALF_WIDTH) / SHADOW_TEXEL_SIZE - 0.5
    const centerRow = s / SHADOW_TEXEL_SIZE - 0.5
    const radiusInTexels = radius / SHADOW_TEXEL_SIZE

    // 横は範囲の外を描かない
    const firstColumn = Math.max(0, Math.ceil(centerColumn - radiusInTexels))
    const lastColumn = Math.min(SHADOW_MAP_WIDTH - 1, Math.floor(centerColumn + radiusInTexels))
    const firstRow = Math.ceil(centerRow - radiusInTexels)
    const lastRow = Math.floor(centerRow + radiusInTexels)

    for (let row = firstRow; row <= lastRow; row++) {
      const deltaRow = (row - centerRow) / radiusInTexels
      // 1 周で折り返す（負の行は末尾へ、範囲を超えた行は先頭へ）
      const wrappedRow = ((row % SHADOW_MAP_HEIGHT) + SHADOW_MAP_HEIGHT) % SHADOW_MAP_HEIGHT
      const rowOffset = wrappedRow * SHADOW_MAP_WIDTH

      for (let column = firstColumn; column <= lastColumn; column++) {
        const deltaColumn = (column - centerColumn) / radiusInTexels
        const distanceSq = deltaRow * deltaRow + deltaColumn * deltaColumn
        if (distanceSq >= 1) continue

        const falloff = (1 - distanceSq) * (1 - distanceSq)
        // 重なった影は「光の残り」を掛け合わせ、暗さが 1 を超えないようにする
        this.light[rowOffset + column] *= 1 - strength * falloff
      }
    }
  }
}
