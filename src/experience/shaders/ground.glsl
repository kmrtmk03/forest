// 地面（惑星の表面）の起伏と道の中心線を求める共通関数。
// Ground.ts が頂点・フラグメントの両シェーダーの common チャンクの直後へ差し込む。
//
// GROUND_ で始まる定数は Ground.ts が material.defines で渡す（値は procedural/path.constants.ts）。
// MEMO: groundPathX・groundHeight は procedural/path.utils.ts の pathX・groundHeight と同じ式。片方だけ変えないこと
//
// 引数の s は折り返していないコース座標でよい。どの成分も 1 周で整数回振動するため、s と s + 1 周で同じ値になる。

#define GROUND_TAU 6.283185307179586

// 道の蛇行の成分 (1 周あたりの振動回数, 振幅 m, 位相)
const vec3 groundPathMeanderWaves[GROUND_PATH_MEANDER_WAVE_COUNT] = vec3[](GROUND_PATH_MEANDER_WAVES);
// 起伏の成分 (1 周あたりの振動回数, 横方向の角周波数 rad/m, 位相, 重み)
const vec4 groundHillWaves[GROUND_HILL_WAVE_COUNT] = vec4[](GROUND_HILL_WAVES);

// コース位置 s での道の中心の x（m）
float groundPathX(float s) {
  float phase = GROUND_TAU * s / GROUND_COURSE_LENGTH;
  float x = 0.0;
  for (int i = 0; i < GROUND_PATH_MEANDER_WAVE_COUNT; i++) {
    vec3 wave = groundPathMeanderWaves[i];
    x += wave.y * sin(wave.x * phase + wave.z);
  }
  return x;
}

// 道の中心 pathCenter（= groundPathX(s)）が分かっているときの地面の高さ（m）
// 同じ s で何度も高さを求める groundNormal から、groundPathX の計算を省くために使う
float groundHeightFromPath(float x, float s, float pathCenter) {
  float distanceFromPath = abs(x - pathCenter);
  float ramp = smoothstep(GROUND_FLAT_HALF_WIDTH, GROUND_HILL_RAMP_END, distanceFromPath);

  float phase = GROUND_TAU * s / GROUND_COURSE_LENGTH;
  float noise = 0.0;
  for (int i = 0; i < GROUND_HILL_WAVE_COUNT; i++) {
    vec4 wave = groundHillWaves[i];
    noise += wave.w * sin(wave.x * phase + wave.y * x + wave.z);
  }
  return GROUND_HILL_HEIGHT * ramp * (0.5 + 0.5 * noise);
}

// コース座標 (x, s) での地面の高さ（m）。道の上は平坦で、道から離れるほど起伏が大きくなる
float groundHeight(float x, float s) {
  return groundHeightFromPath(x, s, groundPathX(s));
}

// 起伏に合わせた法線（平面ワールド座標）。高さの勾配を中心差分で求める
// 平面ワールド座標では z = -s なので、∂h/∂z = -∂h/∂s になる
vec3 groundNormal(float x, float s) {
  float offset = GROUND_NORMAL_SAMPLE_OFFSET;
  // x 方向の差分は同じ s なので、道の中心は 1 回だけ求めて使い回す
  float pathCenter = groundPathX(s);
  float slopeX = (groundHeightFromPath(x + offset, s, pathCenter)
    - groundHeightFromPath(x - offset, s, pathCenter)) / (2.0 * offset);
  float slopeS = (groundHeight(x, s + offset) - groundHeight(x, s - offset)) / (2.0 * offset);
  return normalize(vec3(-slopeX, 1.0, slopeS));
}
