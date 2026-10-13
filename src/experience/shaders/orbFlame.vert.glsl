// オーブ（魂の炎）の板の頂点シェーダー。
// 板は OrbManager が CPU で曲面上の位置へ置き、カメラの方へ向けている（シェーダーでは曲げない）。

// 板の上の位置（m）。原点が火の玉の中心
varying vec2 vLocal;
// 板の UV（0〜1）。端で炎を消すのに使う
varying vec2 vUv;
// カメラからの直線距離（m）。霧の濃さに使う（曲げ変換を使うマテリアルと同じく、ビューの奥行きではなく直線距離）
varying float vFogDistance;

void main() {
  vLocal = position.xy;
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDistance = length(mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
