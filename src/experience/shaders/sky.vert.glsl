// 空のグラデーションを描く球（Atmosphere.ts の ShaderMaterial）の頂点シェーダー。
// 球は常にカメラを中心に置き、どこへ進んでも空が同じに見えるようにする（コース位置に依存させない）。
// 曲げ変換は使わない。position・cameraPosition・viewMatrix・projectionMatrix は ShaderMaterial が自動で宣言する。

// 球の中心（カメラ）から見た方向。フラグメント側で仰角を求める
varying vec3 vSkyDirection;

void main() {
  vSkyDirection = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
}
