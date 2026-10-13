// シェーダー共通の擬似乱数。使うシェーダーの前に連結して差し込む（Ground.ts・orbFlame.utils.ts）。
// three.js の標準チャンクと名前が衝突しないよう、関数には forest の接頭辞を付ける。

// セル座標から 0〜1 の擬似乱数を作る（Dave Hoskins の hash12。sin を使わない）
// sin を使うハッシュは、セル番号が数百になると引数が 10 万を超えて float の精度が落ち、
// GPU ごとに模様が崩れたり縞が出たりするため使わない
float forestHash12(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
