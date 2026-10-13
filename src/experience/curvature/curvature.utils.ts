import type { Vector3 } from "three"

/**
 * 弧長がこれより小さいときは、カメラの真下として曲げずに返す（m）。
 * MEMO: curvature.glsl の curvaturePosition と同じ値
 */
const MIN_ARC_LENGTH = 1e-4

/**
 * カメラ相対の平面座標を球面へ写像する（θ = 弧長 / 半径 の正確な球面写像）。
 * シェーダーで曲げない物（オーブ）の位置を CPU で求めるときに使い、
 * シェーダーで曲げた地面・木と同じ場所に描く。
 * MEMO: curvature.glsl の curvaturePosition と同じ式。片方だけ変えないこと
 * @param relative カメラ相対の平面座標 (dx, 高さ, dz)。dz は前方が負（curvature.glsl の curvatureRelative の結果と同じ形）
 * @param planetRadius 見た目の惑星半径（m）
 * @param target 結果を書き込むベクトル（毎フレーム new しないよう、呼び出し側で使い回す）
 * @returns target
 */
export const curvaturePosition = (
  relative: Vector3,
  planetRadius: number,
  target: Vector3,
): Vector3 => {
  const arcLength = Math.hypot(relative.x, relative.z)
  // カメラ真下では方向が定まらないため、曲げずにそのまま返す
  if (arcLength < MIN_ARC_LENGTH) return target.copy(relative)

  const theta = arcLength / planetRadius
  const directionX = relative.x / arcLength
  const directionZ = relative.z / arcLength
  const distanceFromCenter = planetRadius + relative.y
  const horizontal = distanceFromCenter * Math.sin(theta)
  return target.set(
    directionX * horizontal,
    distanceFromCenter * Math.cos(theta) - planetRadius,
    directionZ * horizontal,
  )
}
