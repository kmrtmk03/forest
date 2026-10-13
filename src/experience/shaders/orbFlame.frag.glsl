// オーブ（魂の炎）のフラグメントシェーダー。orbFlame.utils.ts が hash.glsl の後に連結して使う。
// 下が丸い火の玉で、上へ細く伸びる炎の舌が揺らぐ形を、ノイズで描く。加算合成で重ねて光らせる。
//
// 形はすべて「火の玉の半径 = 1」の単位で決める（uBallRadius で m に直す）。
// 板の大きさは orbFlame.utils.ts の ORB_FLAME_PLANE_* で決めており、ここで描く形（横 ±2、縦 -1.6〜+5 程度）が
// 板の内側に収まるようにしてある。形を大きくするときは、板の大きさも合わせて変えること。

// 経過時間（秒）。全オーブで共有する
uniform float uTime;
// 火の玉の半径（m）
uniform float uBallRadius;
// 霧が掛かり始める距離と、完全に見えなくなる距離（m）。
// three.js 標準の霧の uniform と同じ名前にしてあり、マテリアルの fog: true で描画のたびにシーンの霧の値が入る
uniform float fogNear;
uniform float fogFar;
// 炎の色（線形色空間）。縁ほどこの色が濃く、中心は白くなる
uniform vec3 uColor;
// オーブごとの乱数の種。揺らぎ方をオーブごとに変える
uniform float uSeed;
// 明るさの倍率（ホバー中は 1 より大きい）
uniform float uIntensity;

varying vec2 vLocal;
varying vec2 vUv;
varying float vFogDistance;

// 炎の先端の高さ（火の玉の中心から、半径の何倍か）
const float ORB_FLAME_TIP = 4.2;
// 炎が上へ流れる速さ（半径 / 秒）
const float ORB_FLAME_RISE_SPEED = 1.6;
// 横の揺れの強さ（根元・先端）
const float ORB_FLAME_SWAY_BASE = 0.3;
const float ORB_FLAME_SWAY_TIP = 0.55;
// 輪郭のぼかし幅（内側・外側）。ぼかしすぎると焚き火のような光の塊になるため、輪郭は保つ。
// 柔らかい光のにじみは Phase 7 の Bloom で足す
const float ORB_FLAME_EDGE_INNER = 0.3;
const float ORB_FLAME_EDGE_OUTER = 0.1;
// 縁をノイズで崩す強さ。大きいほど輪郭がモヤモヤと欠ける
const float ORB_FLAME_EDGE_BREAKUP = 0.45;
// 炎の本体の明るさ。加算合成なので、上げすぎると後ろが透けずに白く飛ぶ
const float ORB_FLAME_BODY_BRIGHTNESS = 0.85;
// 縁から内側へ、濃い色 → 指定の色に変わる深さ（輪郭からの距離、半径の何倍か）
const float ORB_FLAME_COLOR_DEPTH = 0.35;
// 火の玉の中で白くなり始める深さと、真っ白になる深さ（輪郭からの距離）
const float ORB_FLAME_WHITE_START = 0.3;
const float ORB_FLAME_WHITE_END = 0.85;
// 火の玉を包む淡い光の強さと広がり
const float ORB_FLAME_HALO_STRENGTH = 0.1;
const float ORB_FLAME_HALO_FALLOFF = 2.5;
// 淡い光を消し始める距離と、完全に 0 にする距離（火の玉の中心から、半径の何倍か）。
// 板の横幅（±2.2）より内側で必ず 0 にする。指数関数の裾は 0 にならず、わずかな値でも
// 画面の色（sRGB）へ変換すると持ち上がって見え、板の四角い輪郭が浮き出るため
const float ORB_FLAME_HALO_FADE_START = 1.2;
const float ORB_FLAME_HALO_FADE_END = 2.0;
// 板の端で消す幅（UV）。光の広がりが板の端で切れて四角く見えないようにする
const float ORB_FLAME_UV_EDGE = 0.12;

// value noise（0〜1）
float orbFlameNoise(vec2 coord) {
  vec2 cell = floor(coord);
  vec2 local = fract(coord);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(forestHash12(cell), forestHash12(cell + vec2(1.0, 0.0)), blend.x),
    mix(forestHash12(cell + vec2(0.0, 1.0)), forestHash12(cell + vec2(1.0, 1.0)), blend.x),
    blend.y
  );
}

// 4 オクターブの fbm（0〜1 付近）。炎のゆらぎに使う
float orbFlameFbm(vec2 coord) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * orbFlameNoise(coord);
    coord = coord * 2.03 + vec2(17.1, 9.7);
    amplitude *= 0.5;
  }
  return value;
}

// 炎の輪郭からの距離（半径 = 1 の単位、内側が正）。下半分は円、上半分は先端へ向けて細くなるしずく形。
// 円の下と先端の上では負になり続けるようにし、板の上下の端まで光が伸びないようにする
float orbFlameInside(vec2 q) {
  if (q.y < 0.0) return 1.0 - length(q);
  float halfWidth = pow(max(1.0 - q.y / ORB_FLAME_TIP, 0.0), 1.4);
  return min(halfWidth - abs(q.x), ORB_FLAME_TIP - q.y);
}

void main() {
  vec2 p = vLocal / uBallRadius;
  float time = uTime + uSeed;
  // 0（火の玉の中心）〜 1（先端）
  float height01 = clamp(p.y / ORB_FLAME_TIP, 0.0, 1.0);

  // 上へ流れるノイズで、炎を横に揺らす。先端ほど大きく揺れる
  vec2 flow = vec2(p.x * 1.2, p.y * 0.8 - time * ORB_FLAME_RISE_SPEED);
  float swayNoise = orbFlameFbm(flow * 1.3 + uSeed);
  float sway = (swayNoise - 0.5) * mix(ORB_FLAME_SWAY_BASE, ORB_FLAME_SWAY_TIP, height01) * 2.0;
  vec2 q = vec2(p.x + sway * (0.3 + height01), p.y);

  // 炎の輪郭（内側が正）。縁をノイズで前後させてモヤモヤと崩し、ぼかして縁ほど薄くする
  float edgeNoise = orbFlameFbm(vec2(q.x * 3.0, q.y * 2.0 - time * ORB_FLAME_RISE_SPEED * 1.2) + uSeed * 1.9);
  float inside = orbFlameInside(q) + (edgeNoise - 0.5) * ORB_FLAME_EDGE_BREAKUP;
  float body = smoothstep(-ORB_FLAME_EDGE_OUTER, ORB_FLAME_EDGE_INNER, inside);

  // 上ほどノイズで削り、先端が何本かの舌に分かれて揺らぐようにする
  float tongueNoise = orbFlameFbm(vec2(q.x * 2.2, q.y * 1.1 - time * ORB_FLAME_RISE_SPEED * 1.4) - uSeed);
  float carve = height01 * 0.75;
  body *= smoothstep(carve - 0.15, carve + 0.2, tongueNoise);

  // 色は輪郭からの深さで段階的に変える（参考画像: 縁は濃い青、内側は水色、火の玉の中は白）。
  // 縁は指定の色を 2 乗して彩度を上げた濃い色にする
  vec3 deepColor = uColor * uColor;
  vec3 color = mix(deepColor, uColor, smoothstep(0.0, ORB_FLAME_COLOR_DEPTH, inside));
  // 白くするのは火の玉の部分だけ（炎の舌は色のまま）。中心を少し揺らして芯が生きているように見せる
  float ballInside = 1.0 - length(vec2(p.x + sway * 0.2, p.y));
  color = mix(color, vec3(1.0), smoothstep(ORB_FLAME_WHITE_START, ORB_FLAME_WHITE_END, ballInside));
  color *= body * ORB_FLAME_BODY_BRIGHTNESS;

  // 火の玉を包む淡い光
  float distanceFromCenter = length(p);
  float halo = exp(-max(distanceFromCenter - 1.0, 0.0) * ORB_FLAME_HALO_FALLOFF) * ORB_FLAME_HALO_STRENGTH;
  halo *= 1.0 - smoothstep(ORB_FLAME_HALO_FADE_START, ORB_FLAME_HALO_FADE_END, distanceFromCenter);
  color += deepColor * halo;

  // ちらつき（芯が少し明滅する）
  color *= 0.92 + 0.08 * sin(time * 9.0 + swayNoise * 6.0);
  color *= uIntensity;

  // 板の端で消す
  vec2 uvEdge = min(vUv, 1.0 - vUv);
  color *= smoothstep(0.0, ORB_FLAME_UV_EDGE, min(uvEdge.x, uvEdge.y));

  // 霧: 加算合成なので霧の色を混ぜず、明るさを落として霧の中へ溶かす
  color *= 1.0 - smoothstep(fogNear, fogFar, vFogDistance);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
