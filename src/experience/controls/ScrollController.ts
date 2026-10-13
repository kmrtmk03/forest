import { MathUtils } from "three"

import {
  DAMPING,
  FLICK_TIME,
  KEY_STEP_METERS,
  LINE_HEIGHT_PX,
  MAX_EVENT_DELTA_PX,
  MAX_LEAD_METERS,
  MAX_SPEED,
  REDUCED_MOTION_DAMPING,
  TOUCH_METERS_PER_PX,
  WHEEL_METERS_PER_PX,
} from "./controls.constants"

/** 前進に割り当てるキー */
const FORWARD_KEYS = new Set(["ArrowUp", "KeyW", "PageDown", "Space"])

/** 後退に割り当てるキー */
const BACKWARD_KEYS = new Set(["ArrowDown", "KeyS", "PageUp"])

/** キー操作を横取りしない要素（フォーム部品やリンクを操作中のキー入力は奪わない） */
const INTERACTIVE_SELECTOR = "input, textarea, select, button, a[href], [contenteditable]"

/** 指を止めてからこの時間（ms）が経っていたら、フリックの慣性を付けない */
const FLICK_IDLE_MS = 100

/** タッチ速度の平滑化係数（0〜1）。直近の速度をどれだけ重視するか */
const TOUCH_VELOCITY_SMOOTHING = 0.8

/**
 * wheel / タッチ / キーボードの入力を「コース上の進行距離」に変換し、慣性付きで追従させる。
 *
 * - targetDistance: 入力で増減する目標位置
 * - currentDistance: 実際のカメラ位置。リセットせず無限に増減する（1 周分の折り返しは描画側で行う）
 *
 * 毎フレーム update(dt) を呼ぶこと。呼ばないと currentDistance が目標へ追従しない。
 * setEnabled(false) の間は入力を受け付けない（モーダル表示中の停止に使う）。
 * リスナーは渡された AbortSignal で登録するため、Experience の abort() で一括解除される。
 */
export class ScrollController {
  private targetDistance = 0
  private currentDistance = 0
  private currentVelocity = 0
  private damping = DAMPING
  /** 自動歩行の速度（m/s）。0 のときは入力だけで動く（setAutoWalkSpeed を参照） */
  private autoWalkSpeed = 0
  /** 入力を受け付けるか。false の間は wheel・タッチ・キーボードを無視する（setEnabled を参照） */
  private isEnabled = true

  /** 追跡中のタッチの pointerId。タッチしていない間は null */
  private touchPointerId: number | null = null
  private lastTouchY = 0
  private lastTouchTime = 0
  /** タッチの縦方向の速度（px/ms）。前進方向が正 */
  private touchVelocity = 0

  /**
   * @param target wheel・タッチを受け付ける要素（canvas を含むコンテナ）
   * @param signal リスナー解除用。abort() で全リスナーが外れる
   */
  constructor(target: HTMLElement, signal: AbortSignal) {
    // preventDefault するため passive: false で登録する（トラックパッドのバウンス・戻るジェスチャを抑止）
    target.addEventListener("wheel", this.handleWheel, { passive: false, signal })
    target.addEventListener("pointerdown", this.handlePointerDown, { signal })
    target.addEventListener("pointermove", this.handlePointerMove, { signal })
    target.addEventListener("pointerup", this.handlePointerUp, { signal })
    target.addEventListener("pointercancel", this.handlePointerCancel, { signal })
    window.addEventListener("keydown", this.handleKeyDown, { signal })

    // 動きを減らす設定の利用者には、慣性を短くする
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.applyReducedMotion(reducedMotionQuery.matches)
    reducedMotionQuery.addEventListener(
      "change",
      (event) => this.applyReducedMotion(event.matches),
      { signal },
    )
  }

  /** 現在の進行距離（m）。後退すると負にもなる */
  get distance(): number {
    return this.currentDistance
  }

  /** 現在の速度（m/s）。前進が正 */
  get velocity(): number {
    return this.currentVelocity
  }

  /**
   * 目標位置へ指数減衰で追従させる。dt に関係なく同じ時間で同じだけ近づくため、フレームレートに依存しない。
   * @param dt 前フレームからの経過時間（秒）。Ticker 側でクランプ済みの値を渡す
   */
  update(dt: number): void {
    // dt = 0 のフレーム（タブ復帰直後など）は速度が求まらないため、位置だけ維持する
    if (dt <= 0) return

    // 自動歩行の分は、目標位置と現在位置を同じだけ進める。
    // 両者の差（入力による先行量）は変わらないため、自動歩行中も入力がそのまま上乗せされる
    const autoWalkStep = this.autoWalkSpeed * dt
    this.targetDistance += autoWalkStep

    const alpha = 1 - Math.exp(-this.damping * dt)
    const maxStep = MAX_SPEED * dt
    const inputStep = MathUtils.clamp(
      (this.targetDistance - this.currentDistance) * alpha,
      -maxStep,
      maxStep,
    )

    const step = autoWalkStep + inputStep
    this.currentDistance += step
    this.currentVelocity = step / dt
  }

  /**
   * 慣性を付けずに、指定の進行距離へ瞬時に移動する（デバッグ GUI のループ検証用）。
   * 目標位置も同じ値にそろえ、移動後にカメラが元の位置へ戻ろうとしないようにする
   * @param distance 移動先の累計の進行距離（m）。有限の値であること
   * @throws distance が有限の数でない場合（NaN が入ると以後の位置計算がすべて NaN になるため）
   */
  teleport(distance: number): void {
    if (!Number.isFinite(distance)) {
      throw new Error(`ScrollController: 移動先の距離が不正です（${distance}）`)
    }
    this.targetDistance = distance
    this.currentDistance = distance
    this.currentVelocity = 0
  }

  /**
   * 慣性を通さず、一定の速度で進み続けるようにする（デバッグ GUI のループ検証用）。
   * 入力による移動はこの速度に上乗せされる。update(dt) の中で進めるため、Ticker が止まっている間は進まない
   * @param speed 速度（m/s）。前進が正、0 で止める
   * @throws speed が有限の数でない場合（NaN が入ると以後の位置計算がすべて NaN になるため）
   */
  setAutoWalkSpeed(speed: number): void {
    if (!Number.isFinite(speed)) {
      throw new Error(`ScrollController: 自動歩行の速度が不正です（${speed}）`)
    }
    this.autoWalkSpeed = speed
  }

  /**
   * 入力の受け付けを切り替える。止めるときは慣性の残りも捨て、その場で止まるようにする
   * （モーダルを開いた後もカメラが進み続けて背景がずれないようにするため）。
   * 自動歩行（デバッグ用）は入力ではないため止めない
   * @param isEnabled true で受け付ける、false で無視する
   */
  setEnabled(isEnabled: boolean): void {
    if (isEnabled === this.isEnabled) return
    this.isEnabled = isEnabled
    if (isEnabled) return

    this.targetDistance = this.currentDistance
    this.endTouch()
  }

  /** 目標位置を動かす。現在位置からの先行量を MAX_LEAD_METERS までに制限する */
  private moveTarget(meters: number): void {
    this.targetDistance = MathUtils.clamp(
      this.targetDistance + meters,
      this.currentDistance - MAX_LEAD_METERS,
      this.currentDistance + MAX_LEAD_METERS,
    )
  }

  private applyReducedMotion(isReduced: boolean): void {
    this.damping = isReduced ? REDUCED_MOTION_DAMPING : DAMPING
  }

  /** wheel の delta を deltaMode（px / 行 / ページ単位）ごとに px 相当へ揃える */
  private toDeltaPx(event: WheelEvent): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * LINE_HEIGHT_PX
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight
    return event.deltaY
  }

  /** 追跡中のタッチを終える */
  private endTouch(): void {
    this.touchPointerId = null
    this.touchVelocity = 0
  }

  /** wheel の delta を px 相当へ揃え、1 イベントあたりの上限で抑えてから距離に変換する */
  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault()
    if (!this.isEnabled) return

    const clampedDeltaPx = MathUtils.clamp(
      this.toDeltaPx(event),
      -MAX_EVENT_DELTA_PX,
      MAX_EVENT_DELTA_PX,
    )

    this.moveTarget(clampedDeltaPx * WHEEL_METERS_PER_PX)
  }

  /** タッチの開始。マウス・ペンはドラッグ移動の対象外（クリック操作に使うため） */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.isEnabled || event.pointerType !== "touch" || this.touchPointerId !== null) return

    this.touchPointerId = event.pointerId
    this.lastTouchY = event.clientY
    this.lastTouchTime = event.timeStamp
    this.touchVelocity = 0
  }

  /** 指を上へ動かすと前進する（通常のページで下へスクロールするのと同じ向き） */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.touchPointerId) return

    const deltaPx = this.lastTouchY - event.clientY
    const elapsedMs = event.timeStamp - this.lastTouchTime
    if (elapsedMs > 0) {
      this.touchVelocity = MathUtils.lerp(
        this.touchVelocity,
        deltaPx / elapsedMs,
        TOUCH_VELOCITY_SMOOTHING,
      )
    }

    this.lastTouchY = event.clientY
    this.lastTouchTime = event.timeStamp
    this.moveTarget(deltaPx * TOUCH_METERS_PER_PX)
  }

  /** 指を離した瞬間の速度から、フリックの慣性分を目標位置へ足す */
  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.touchPointerId) return

    const isFlick = event.timeStamp - this.lastTouchTime < FLICK_IDLE_MS
    if (isFlick) {
      // touchVelocity は px/ms なので、px/s に直してから FLICK_TIME 秒分の距離にする
      const flickPx = this.touchVelocity * 1000 * FLICK_TIME
      this.moveTarget(flickPx * TOUCH_METERS_PER_PX)
    }

    this.endTouch()
  }

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.touchPointerId) return
    this.endTouch()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // 止めている間は preventDefault もしない（モーダル内のスクロールなど、本来のキー操作を妨げないため）
    if (!this.isEnabled) return
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    // フォーム部品やリンクにフォーカスがあるときは、Space などの本来の操作を優先する
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return

    const direction = FORWARD_KEYS.has(event.code) ? 1 : BACKWARD_KEYS.has(event.code) ? -1 : 0
    if (direction === 0) return

    event.preventDefault()
    this.moveTarget(direction * KEY_STEP_METERS)
  }
}
