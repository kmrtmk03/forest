// 地面の模様（草地・道の土）を描くフラグメントシェーダー用の関数。
// Ground.ts がフラグメントシェーダーの common チャンクの後（ground.glsl の後）へ差し込み、
// color_fragment チャンクの後で groundSurfaceColor() の結果を diffuseColor に掛ける。
//
// 模様はすべてコース座標 (x, s)（applyCurvature が渡す vCourseCoord）で描く。
// カメラが進むと地面と同じ速度で模様が流れるため、滑って見えない。
// ノイズのセルの大きさは GROUND_COURSE_LENGTH（100m）を割り切る値にし、s 方向のセル番号を 1 周で折り返して
// ループ境界で模様がつながるようにする。

uniform vec3 uGrassDarkColor;
uniform vec3 uGrassLightColor;
uniform vec3 uMossColor;
uniform vec3 uDirtDarkColor;
uniform vec3 uDirtLightColor;

// ノイズのセルの大きさ（m）は GROUND_MOSS_CELL などの #define で Ground.ts から受け取る（COURSE_LENGTH を割り切ることを検証済み）

// 2 つのノイズを混ぜるときの重み（大きいセル側。小さいセル側は 1 - この値）
// 草地・土の色の濃淡: 茂み・小石の濃淡を主にし、ざらつきを少し重ねる
const float GROUND_DETAIL_PRIMARY_WEIGHT = 0.6;
// 道の縁のずらし: 大きなうねりを主にし、細かい欠けを少し重ねる
const float GROUND_EDGE_LARGE_WEIGHT = 0.6;

// 道の縁: 草地へ切り替わり始める距離と終わる距離（道の半幅からの差、m）
const float GROUND_PATH_EDGE_INNER = 0.08;
const float GROUND_PATH_EDGE_OUTER = 0.12;
// 道の縁をノイズで前後にずらす最大量（m）
const float GROUND_PATH_EDGE_JITTER = 0.25;

// 苔が混ざり始める・最も濃くなるノイズ値と、混ぜる強さ
const float GROUND_MOSS_START = 0.55;
const float GROUND_MOSS_END = 0.85;
const float GROUND_MOSS_STRENGTH = 0.6;

// 道の縁の草を踏まれて暗くする強さ
const float GROUND_TRAMPLED_DARKEN = 0.25;

// セル座標から 0〜1 の擬似乱数を作る（Dave Hoskins の hash12。sin を使わない）
// sin を使うハッシュは、セル番号が数百になると引数が 10 万を超えて float の精度が落ち、
// GPU ごとに模様が崩れたり縞が出たりするため使わない
float groundHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// s 方向のセル番号を 1 周のセル数で折り返す。
// GPU の除算は誤差を含むため、セルの中央（+0.5）で mod を取ってから floor して整数に揃える
float groundWrapCell(float cell, float cellCount) {
  return floor(mod(cell + 0.5, cellCount));
}

// 1 周で途切れない value noise（0〜1）。cellSize（m）は GROUND_COURSE_LENGTH を割り切る値にすること
float groundValueNoise(vec2 coord, float cellSize) {
  vec2 scaled = coord / cellSize;
  vec2 cell = floor(scaled);
  vec2 local = fract(scaled);
  float cellCount = GROUND_COURSE_LENGTH / cellSize;
  float s0 = groundWrapCell(cell.y, cellCount);
  float s1 = groundWrapCell(cell.y + 1.0, cellCount);

  float corner00 = groundHash(vec2(cell.x, s0));
  float corner10 = groundHash(vec2(cell.x + 1.0, s0));
  float corner01 = groundHash(vec2(cell.x, s1));
  float corner11 = groundHash(vec2(cell.x + 1.0, s1));

  vec2 blend = local * local * (3.0 - 2.0 * local);
  return mix(mix(corner00, corner10, blend.x), mix(corner01, corner11, blend.x), blend.y);
}

// 画面上でセルが 1 画素程度まで小さくなる遠景では、ノイズを平均値（0.5）へ寄せてちらつきを防ぐ
// pixelSize: 1 画素あたりのコース座標の変化量（m）
float groundFilteredNoise(vec2 coord, float cellSize, float pixelSize) {
  float fade = smoothstep(cellSize * 0.25, cellSize, pixelSize);
  return mix(groundValueNoise(coord, cellSize), 0.5, fade);
}

// 道らしさ（0 = 草地、1 = 道の土）。縁をノイズでずらし、自然なギザギザの境界にする
float groundPathMask(vec2 courseCoord, float pixelSize) {
  float distanceFromPath = abs(courseCoord.x - groundPathX(courseCoord.y));
  float edgeNoise = mix(
    groundFilteredNoise(courseCoord, GROUND_EDGE_SMALL_CELL, pixelSize),
    groundValueNoise(courseCoord, GROUND_EDGE_LARGE_CELL),
    GROUND_EDGE_LARGE_WEIGHT
  );
  float jitteredDistance = distanceFromPath + (edgeNoise - 0.5) * 2.0 * GROUND_PATH_EDGE_JITTER;
  return 1.0 - smoothstep(
    GROUND_PATH_HALF_WIDTH - GROUND_PATH_EDGE_INNER,
    GROUND_PATH_HALF_WIDTH + GROUND_PATH_EDGE_OUTER,
    jitteredDistance
  );
}

// コース座標での地面の色（線形色空間）
vec3 groundSurfaceColor(vec2 courseCoord) {
  float pixelSize = length(fwidth(courseCoord));
  float grain = groundFilteredNoise(courseCoord, GROUND_GRAIN_CELL, pixelSize);

  // 草地: 茂みの濃淡 + ざらつき、ところどころに明るい苔のまだら
  float tuft = groundFilteredNoise(courseCoord, GROUND_TUFT_CELL, pixelSize);
  vec3 grass = mix(uGrassDarkColor, uGrassLightColor, mix(grain, tuft, GROUND_DETAIL_PRIMARY_WEIGHT));
  float moss = smoothstep(GROUND_MOSS_START, GROUND_MOSS_END, groundValueNoise(courseCoord, GROUND_MOSS_CELL));
  grass = mix(grass, uMossColor, moss * GROUND_MOSS_STRENGTH);

  // 道の土: 小石の凹凸 + ざらつき
  float pebble = groundFilteredNoise(courseCoord, GROUND_PEBBLE_CELL, pixelSize);
  vec3 dirt = mix(uDirtDarkColor, uDirtLightColor, mix(grain, pebble, GROUND_DETAIL_PRIMARY_WEIGHT));

  // 道の縁に近い草は踏まれて暗くなる（0.5 付近で最も強く掛かる）
  float pathMask = groundPathMask(courseCoord, pixelSize);
  float trampled = pathMask * (1.0 - pathMask) * 4.0;
  grass *= 1.0 - trampled * GROUND_TRAMPLED_DARKEN;

  return mix(grass, dirt, pathMask);
}
