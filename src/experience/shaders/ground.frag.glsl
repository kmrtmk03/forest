// 地面の模様（草地・道の土）と光の模様（根元の影・木漏れ日）を描くフラグメントシェーダー用の関数。
// Ground.ts がフラグメントシェーダーの common チャンクの後（hash.glsl・ground.glsl の後）へ差し込み、
// color_fragment チャンクの後で groundSurfaceColor() と groundBlobShadow() の結果を diffuseColor に掛け、
// emissivemap_fragment チャンクの後で groundSunfleck() の光を totalEmissiveRadiance に足す。
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
// 配置物の根元の影（GroundShadowMap.ts）。r が暗さ（0〜1）。横は道の中心から ±GROUND_SHADOW_HALF_WIDTH、縦はコース 1 周
uniform sampler2D uGroundShadowMap;
// 木漏れ日の色（線形色空間）。地面の色に足す明るさの色味
uniform vec3 uDappleColor;
// 経過時間（秒）。木漏れ日を揺らすのに使う。World が毎フレーム更新する
uniform float uTime;

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

// 木漏れ日: 葉が風で揺れて、光の斑点がその場で少しずれる量（m）と、揺れの角速度（rad/秒、横・コース方向）。
// 模様そのものは地面に固定し（コース座標）、歩くと地面と一緒に流れる。時間で流し続けると地面が滑って見えるため、往復させる
const float GROUND_DAPPLE_SWAY = 0.15;
const vec2 GROUND_DAPPLE_SWAY_SPEED = vec2(0.45, 0.31);
// 区域（大きいノイズ）は斑点（小さいノイズ）と逆向きに、この倍率で揺らす（斑点の並びがゆっくり崩れて見える）
const float GROUND_DAPPLE_AREA_SWAY_RATIO = -0.5;
// 日の当たる区域: 大きいノイズがこの範囲で 0 → 1 になる。葉の茂り方で、斑点の多い所と少ない所を作る
const float GROUND_DAPPLE_AREA_START = 0.4;
const float GROUND_DAPPLE_AREA_END = 0.65;
// 斑点: GROUND_DAPPLE_SPOT_CELL ごとに、この確率で丸い光を 1 つ置く。
// 大きな光ほど面積を取るため、多すぎると区域全体が明るく塗りつぶされる
const float GROUND_DAPPLE_SPOT_DENSITY = 0.45;
// 斑点の半径の範囲（m）。円は隣のセルへはみ出してよいが、周りの 1 セルまでしか調べないため、
// 最大でもセルの大きさ（GROUND_DAPPLE_SPOT_CELL）以下にすること。
// 光は中心から縁へ向けてなだらかに薄れるため、見た目の明るい部分はこの半径の半分ほどになる
const float GROUND_DAPPLE_SPOT_RADIUS_MIN = 0.15;
const float GROUND_DAPPLE_SPOT_RADIUS_MAX = 0.95;
// 半径の偏り。乱数（0〜1）をこの値で累乗してから範囲に当てはめ、小さな光を多く、大きな光をときどきにする
const float GROUND_DAPPLE_SPOT_RADIUS_BIAS = 2.5;
// 斑点の中心の明るさ（線形色空間の輝度）。周りの地面よりずっと明るくし、Bloom（PostProcessing）で芯が強くにじむようにする。
// 縁はなだらかに 0 へ下がる。1.0 を超えるとトーンマッピングのない今は白く飛ぶため、1.0 未満にする
const float GROUND_DAPPLE_BRIGHTNESS = 0.6;
// 斑点の色に地面の色味をどれだけ混ぜるか（0 = 光の色のまま、1 = 地面の色味）。草の上は黄緑、土の上は橙がかった光になる
const float GROUND_DAPPLE_SURFACE_TINT = 0.5;

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

  float corner00 = forestHash12(vec2(cell.x, s0));
  float corner10 = forestHash12(vec2(cell.x + 1.0, s0));
  float corner01 = forestHash12(vec2(cell.x, s1));
  float corner11 = forestHash12(vec2(cell.x + 1.0, s1));

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

// コース座標での配置物の根元の影の暗さ（0 = 影なし、1 = 真っ黒）
float groundBlobShadow(vec2 courseCoord) {
  vec2 uv = vec2(
    (courseCoord.x + GROUND_SHADOW_HALF_WIDTH) / (2.0 * GROUND_SHADOW_HALF_WIDTH),
    // 縦はテクスチャの RepeatWrapping で 1 周ごとに繰り返すため、折り返していない s をそのまま使ってよい
    courseCoord.y / GROUND_COURSE_LENGTH
  );
  return texture2D(uGroundShadowMap, uv).r;
}

// 1 つのセルに置く丸い光の、点 local（そのセルの左下を原点、セルの大きさを 1 とした単位）での明るさ（0〜1）。
// 光を置かないセルでは 0 を返す
float groundDappleSpotInCell(vec2 cell, vec2 local) {
  if (forestHash12(cell) > GROUND_DAPPLE_SPOT_DENSITY) return 0.0;

  // 半径と中心はセルの大きさを 1 とした単位で求める。中心はセルの中のどこでもよい
  float radius = mix(
    GROUND_DAPPLE_SPOT_RADIUS_MIN,
    GROUND_DAPPLE_SPOT_RADIUS_MAX,
    pow(forestHash12(cell + vec2(17.3, 5.1)), GROUND_DAPPLE_SPOT_RADIUS_BIAS)
  ) / GROUND_DAPPLE_SPOT_CELL;
  vec2 center = vec2(forestHash12(cell + vec2(41.7, 23.9)), forestHash12(cell + vec2(7.3, 61.1)));
  // 中心から縁まで (1 - t²)² でなだらかに 0 にする（t = 中心からの距離 / 半径）。
  // 縁をくっきり切ると地面に貼ったシールのように見えるため、輪郭を作らず地面へ溶け込ませる
  float t = min(length(local - center) / radius, 1.0);
  float falloff = 1.0 - t * t;
  return falloff * falloff;
}

// 木漏れ日の丸い光（0〜1）。セルごとに、乱数で決めた位置・半径の円を 1 つ置く（置かないセルもある）。
// 葉の隙間を通った光は、隙間の形によらず太陽の形（円）になるため、ノイズの形ではなく円で描く。
// 大きな円は隣のセルへはみ出すため、周りの 3×3 セルの円を調べ、重なった所は明るい方を取る
float groundDappleSpot(vec2 courseCoord) {
  vec2 scaled = courseCoord / GROUND_DAPPLE_SPOT_CELL;
  vec2 baseCell = floor(scaled);
  vec2 local = fract(scaled);
  float cellCount = GROUND_COURSE_LENGTH / GROUND_DAPPLE_SPOT_CELL;

  float brightness = 0.0;
  for (int offsetS = -1; offsetS <= 1; offsetS++) {
    for (int offsetX = -1; offsetX <= 1; offsetX++) {
      vec2 offset = vec2(float(offsetX), float(offsetS));
      vec2 cell = baseCell + offset;
      // セル番号は 1 周で折り返し、ループ境界でも同じ円が同じ場所に来るようにする
      cell.y = groundWrapCell(cell.y, cellCount);
      brightness = max(brightness, groundDappleSpotInCell(cell, local - offset));
    }
  }
  return brightness;
}

// 木漏れ日の斑点の強さ（0〜1）。丸い光（groundDappleSpot）を、大きいノイズで日の当たる区域に絞る。
// 2 つを互いに逆向きに揺らし、葉が風で揺れて光の斑点がちらつくように見せる
float groundDapple(vec2 courseCoord, float pixelSize) {
  vec2 sway = vec2(
    sin(uTime * GROUND_DAPPLE_SWAY_SPEED.x),
    sin(uTime * GROUND_DAPPLE_SWAY_SPEED.y + 1.7)
  ) * GROUND_DAPPLE_SWAY;
  // 画面上で円が数画素まで小さくなる遠景では、ちらつかないよう斑点を消す
  float spot = groundDappleSpot(courseCoord + sway)
    * (1.0 - smoothstep(GROUND_DAPPLE_SPOT_CELL * 0.25, GROUND_DAPPLE_SPOT_CELL, pixelSize));
  float area = smoothstep(
    GROUND_DAPPLE_AREA_START,
    GROUND_DAPPLE_AREA_END,
    groundValueNoise(courseCoord + sway * GROUND_DAPPLE_AREA_SWAY_RATIO, GROUND_DAPPLE_AREA_CELL)
  );
  return spot * area;
}

// 木漏れ日の光（線形色空間の明るさ）。地面の光の計算（Lambert）の結果に、自ら光る成分として足す。
// 木漏れ日は周りの日陰より何倍も強い日差しなので、地面の色を明るくするだけでは Bloom のしきい値に届かない。
// 地面の色（反射率）を掛けると暗い草地の上では光らないため、地面の色は色味（明るさを 1 にそろえた色）としてだけ混ぜる
// surfaceColor: 地面の色（diffuseColor.rgb。根元の影を掛けた後の値）
// lit: 根元の影の外か（1 - groundBlobShadow）。影の中には木漏れ日を落とさない（根元が明るく抜けると影が浮いて見える）
vec3 groundSunfleck(vec2 courseCoord, vec3 surfaceColor, float lit) {
  float pixelSize = length(fwidth(courseCoord));
  float dapple = groundDapple(courseCoord, pixelSize) * lit;
  vec3 surfaceTint = surfaceColor / max(dot(surfaceColor, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  vec3 tint = mix(vec3(1.0), surfaceTint, GROUND_DAPPLE_SURFACE_TINT);
  return uDappleColor * tint * (dapple * GROUND_DAPPLE_BRIGHTNESS);
}
