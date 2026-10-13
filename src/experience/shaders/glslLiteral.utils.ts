/**
 * TS の数値を GLSL の float リテラルにする。整数は小数点を付けないと int 扱いになるため ".0" を付ける。
 * それ以外は丸めずにそのまま出力し、TS 側と GLSL 側で同じ値を使う（material.defines やシェーダー文字列への埋め込みに使う）
 */
export const toGlslFloat = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : String(value)
