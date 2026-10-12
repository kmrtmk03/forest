import { CanvasTexture, SRGBColorSpace } from "three"

import { mulberry32, randomRange } from "@/experience/procedural/random.utils"

/**
 * 板ポリの葉に貼る画像を、Canvas 2D で描いて作る（画像ファイルを用意しなくて済むようにするため）。
 * 背景は透明で、葉は白〜灰色で描く。マテリアルの色が掛かって緑になり、灰色の濃淡が陰影になる。
 * TODO: 画像を用意したら public/textures/ に置き、TextureLoader で読み込んで差し替える
 */

/** 画像の一辺（px）。2 の累乗にしてミップマップを作れるようにする */
const LEAF_TEXTURE_SIZE = 128

/** 葉の画像の乱数の seed（毎回同じ画像にする） */
const LEAF_TEXTURE_SEED = 11

/** 広葉樹の葉: 1 枚の板に描く葉の枚数と、1 枚の大きさ（画像の一辺に対する割合） */
const BROADLEAF_COUNT = 34
const BROADLEAF_LENGTH_RATIO = [0.16, 0.24] as const
const BROADLEAF_WIDTH_RATIO = 0.45

/** 葉を描く範囲（中心からの半径。画像の一辺に対する割合）。端まで描くと板の四角い縁が見える */
const LEAF_AREA_RADIUS_RATIO = 0.4

/** 葉の明るさの範囲（0〜255 の灰色）。マテリアルの色に掛かるので、白に近いほど明るい緑になる */
const LEAF_SHADE_RANGE = [150, 255] as const

/** 葉脈の線の色（暗い灰色） */
const VEIN_COLOR = "rgb(90, 90, 90)"

/** 0〜255 の明るさを CSS の灰色にする */
const toGray = (value: number): string => {
  const shade = Math.round(value)
  return `rgb(${shade}, ${shade}, ${shade})`
}

/** 広葉樹の葉: 楕円の葉を、中心から放射状にばらまく */
const drawBroadleaves = (context: CanvasRenderingContext2D, random: () => number): void => {
  const center = LEAF_TEXTURE_SIZE / 2
  for (let index = 0; index < BROADLEAF_COUNT; index++) {
    const angle = random() * Math.PI * 2
    const distance = Math.sqrt(random()) * LEAF_TEXTURE_SIZE * LEAF_AREA_RADIUS_RATIO
    const length = LEAF_TEXTURE_SIZE * randomRange(random, ...BROADLEAF_LENGTH_RATIO)

    context.save()
    context.translate(center + Math.cos(angle) * distance, center + Math.sin(angle) * distance)
    context.rotate(random() * Math.PI * 2)
    context.fillStyle = toGray(randomRange(random, ...LEAF_SHADE_RANGE))
    context.beginPath()
    context.ellipse(0, 0, length / 2, (length / 2) * BROADLEAF_WIDTH_RATIO, 0, 0, Math.PI * 2)
    context.fill()
    // 葉の中心に一本だけ葉脈を引き、のっぺりしないようにする
    context.strokeStyle = VEIN_COLOR
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(-length / 2, 0)
    context.lineTo(length / 2, 0)
    context.stroke()
    context.restore()
  }
}

/**
 * 広葉樹の葉の画像を作る。破棄（dispose）は、このテクスチャを map に持つマテリアルを破棄する側が行うこと
 * MEMO: 針葉樹の葉（小枝に針を並べる画像）は木を 1 種類にしたときに削除した。戻すときは b7b8a45 を参照
 * @throws Canvas 2D のコンテキストを作れない場合
 */
export const createLeafTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas")
  canvas.width = LEAF_TEXTURE_SIZE
  canvas.height = LEAF_TEXTURE_SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("leafTexture: Canvas 2D のコンテキストを作れませんでした")

  drawBroadleaves(context, mulberry32(LEAF_TEXTURE_SEED))

  const texture = new CanvasTexture(canvas)
  // 灰色の濃淡は色として扱う（マテリアルの色と掛け合わせる前に線形へ変換させる）
  texture.colorSpace = SRGBColorSpace
  return texture
}
