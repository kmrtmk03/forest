// 擬似球面（カーブドワールド）の共通 uniform と関数。
// applyCurvature.ts が頂点シェーダーの #include <common> の直後へ差し込む（フラグメント側は vCourseCoord の宣言だけ）。
//
// 平面ワールド座標の約束:
//   x = 道の中心からの横距離、y = 地面からの高さ、z = -s（s はコース座標。前方が -Z）
// カメラは常に球の頂上（描画座標の原点の真上）にいて、世界の方をカメラ相対で球面へ曲げる。

// (カメラのコース x, カメラのコース s mod courseLength)
uniform vec2 uCurvatureCamera;
// 見た目の惑星半径（m）
uniform float uPlanetRadius;
// コース 1 周の長さ（m）
uniform float uCourseLength;

// コース座標 (x, s)。s は折り返さずカメラ付近で連続な値（cameraS ± courseLength/2）
varying vec2 vCourseCoord;

// -courseLength/2 〜 courseLength/2 に折り返し、円環上で最も近い向きの相対距離を求める
float curvatureWrapSigned(float value) {
  float halfLength = uCourseLength * 0.5;
  // GLSL の mod は常に 0 以上を返すので、負数の補正は不要
  return mod(value + halfLength, uCourseLength) - halfLength;
}

// 平面ワールド座標 → カメラ相対の平面座標 (dx, h, dz)。dz は前方が負
vec3 curvatureRelative(vec3 flatWorld) {
  float s = -flatWorld.z;
  float forward = curvatureWrapSigned(s - uCurvatureCamera.y);
  return vec3(flatWorld.x - uCurvatureCamera.x, flatWorld.y, -forward);
}

// カメラ相対の平面座標を球面へ写像する（θ = 弧長 / 半径 の正確な球面写像）
vec3 curvaturePosition(vec3 relative) {
  float arcLength = length(relative.xz);
  // カメラ真下では方向が定まらないため、曲げずにそのまま返す
  if (arcLength < 1e-4) return relative;

  float theta = arcLength / uPlanetRadius;
  vec2 direction = relative.xz / arcLength;
  float distanceFromCenter = uPlanetRadius + relative.y;
  float horizontal = distanceFromCenter * sin(theta);
  return vec3(
    direction.x * horizontal,
    distanceFromCenter * cos(theta) - uPlanetRadius,
    direction.y * horizontal
  );
}

// 法線を球面写像と同じだけ回転させる（ライティングを曲面に合わせるため）
// 回転軸は「上方向 × 水平方向」で、上方向が水平方向へ θ だけ倒れる回転になる
vec3 curvatureNormal(vec3 relative, vec3 normal) {
  float arcLength = length(relative.xz);
  if (arcLength < 1e-4) return normal;

  float theta = arcLength / uPlanetRadius;
  vec2 direction = relative.xz / arcLength;
  vec3 axis = vec3(direction.y, 0.0, -direction.x);
  float cosTheta = cos(theta);
  // ロドリゲスの回転公式
  return normal * cosTheta
    + cross(axis, normal) * sin(theta)
    + axis * dot(axis, normal) * (1.0 - cosTheta);
}
