// 空のグラデーションを描くフラグメントシェーダー。
// 地平線付近は霧の色と完全に一致させ、霧に溶けた地面の端・配置物と空の境目を見えなくする。
//
// 色は線形色空間で受け取り、colorspace_fragment で出力の色空間へ変換する。
// three.js の霧は出力の色空間へ変換した後に混ぜるため、同じ Color から作った霧の色と同じ画素値になる。
// トーンマッピングは霧に掛からないので、このマテリアルも toneMapped: false にしておく。

uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyZenithColor;
// 霧の色のまま保つ上限の仰角（ラジアン）。これより下は地平線の色
uniform float uSkyHorizonElevation;
// 天頂の色になる仰角（ラジアン）
uniform float uSkyZenithElevation;

varying vec3 vSkyDirection;

void main() {
  float elevation = asin(clamp(normalize(vSkyDirection).y, -1.0, 1.0));
  float blend = smoothstep(uSkyHorizonElevation, uSkyZenithElevation, elevation);
  gl_FragColor = vec4(mix(uSkyHorizonColor, uSkyZenithColor, blend), 1.0);

  #include <colorspace_fragment>
}
