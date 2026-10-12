/**
 * スクロール入力とカメラの調整値。
 * 距離は m、時間は秒、角度は度で表す。
 */

// ---- wheel 入力の正規化 ----

/** deltaMode = 1（行単位）を px に換算するときの 1 行の高さ */
export const LINE_HEIGHT_PX = 16

/** 1 回の wheel イベントで受け付ける最大量（px）。高速ホイールや一部ブラウザの巨大な delta を抑える */
export const MAX_EVENT_DELTA_PX = 120

/** wheel 1px あたりの移動量（m）。マウス 1 ノッチ（約 100px）で約 1.5m 進む */
export const WHEEL_METERS_PER_PX = 0.015

// ---- タッチ・キーボード入力 ----

/** タッチの縦ドラッグ 1px あたりの移動量（m） */
export const TOUCH_METERS_PER_PX = 0.03

/** 指を離した瞬間の速度に掛けて追加の移動量にする時間（秒）。フリックの慣性になる */
export const FLICK_TIME = 0.3

/** キーボード 1 回分の移動量（m） */
export const KEY_STEP_METERS = 2

// ---- 追従（慣性）----

/** 目標位置が現在位置より先行できる最大距離（m）。連続入力で目標だけが遠くへ行きすぎるのを防ぐ */
export const MAX_LEAD_METERS = 12

/** 目標位置への追従の強さ。大きいほどキビキビ止まる */
export const DAMPING = 4

/** prefers-reduced-motion 時の追従の強さ。慣性を短くする */
export const REDUCED_MOTION_DAMPING = 10

/** 最大移動速度（m/s） */
export const MAX_SPEED = 8

// ---- カメラ ----

/** 標準の垂直 FOV（度）。16:9 で水平 約 87° */
export const CAMERA_FOV = 55

/** 縦長画面でも確保する水平 FOV の下限（度） */
export const MIN_HORIZONTAL_FOV = 60

/** 縦長画面で垂直 FOV を広げるときの上限（度）。これ以上は広角の歪みが目立つ */
export const MAX_VERTICAL_FOV = 75

/** カメラの描画範囲（m）。far は霧の終端より少し先まで */
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 150

/** 視線を前方から下へ傾ける角度（度）。地平線が画面中央のやや下に来るようにする */
export const CAMERA_PITCH_DOWN = 4
