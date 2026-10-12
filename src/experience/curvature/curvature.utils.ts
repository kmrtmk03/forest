/**
 * 円環座標（0〜courseLength で一周するコース座標）の計算ヘルパー。
 * GLSL 側（curvature.glsl）の curvatureWrapSigned と同じ式で実装し、両者の結果を一致させる。
 */

/**
 * 0 以上 length 未満に折り返す剰余。
 * JS の % は負数に対して負の値を返すため、後退してコース位置が負になっても正しく折り返せるようにする。
 */
export const positiveModulo = (value: number, length: number): number =>
  ((value % length) + length) % length

/**
 * -length/2 以上 length/2 未満に折り返す。
 * 「オブジェクトのコース位置 - カメラのコース位置」に使い、円環上で最も近い向きの相対距離を求める。
 * 例: length = 400 のとき wrapSigned(-396, 400) = 4（4m 先）
 */
export const wrapSigned = (value: number, length: number): number =>
  positiveModulo(value + length / 2, length) - length / 2
