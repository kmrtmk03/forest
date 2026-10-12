import type { WebGLRenderer } from "three"

/** 1 フレームの経過時間の上限（秒）。タブ復帰やデバッガ停止明けに大きく進みすぎるのを防ぐ */
const MAX_DELTA_SECONDS = 0.1

/**
 * アニメーションループの管理。renderer.setAnimationLoop に一本化し、requestAnimationFrame を直接使わない。
 *
 * - onTick には経過時間（秒、MAX_DELTA_SECONDS でクランプ済み）を渡す
 * - タブが非表示の間はループを止め、表示に戻ったら再開する
 * - stop() を呼ぶまでループは止まらない。破棄時は必ず stop() を呼ぶこと
 */
export class Ticker {
  private isRunning = false
  /** 前フレームの時刻（ms）。null の間は次のフレームの dt を 0 として扱う */
  private lastTime: number | null = null

  /**
   * @param renderer ループを駆動するレンダラー
   * @param signal visibilitychange のリスナー解除用
   * @param onTick 毎フレーム呼ばれる処理
   */
  constructor(
    private readonly renderer: WebGLRenderer,
    signal: AbortSignal,
    private readonly onTick: (deltaSeconds: number) => void,
  ) {
    document.addEventListener("visibilitychange", this.handleVisibilityChange, { signal })
  }

  start(): void {
    this.isRunning = true
    this.resume()
  }

  stop(): void {
    this.isRunning = false
    this.pause()
  }

  /** start() 済みで、かつタブが表示されているときだけループを回す */
  private resume(): void {
    if (!this.isRunning || document.hidden) return

    // 停止していた時間を dt に含めないよう、時刻をリセットしてから再開する
    this.lastTime = null
    this.renderer.setAnimationLoop(this.handleFrame)
  }

  private pause(): void {
    this.renderer.setAnimationLoop(null)
  }

  private readonly handleFrame = (time: number): void => {
    const deltaSeconds =
      this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, MAX_DELTA_SECONDS)
    this.lastTime = time
    this.onTick(deltaSeconds)
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.pause()
      return
    }
    this.resume()
  }
}
