/** 描画領域のサイズ情報 */
export interface IViewportSize {
  /** CSS ピクセル単位の幅 */
  width: number
  /** CSS ピクセル単位の高さ */
  height: number
  /** レンダラーに設定するピクセル比（上限で丸めた値） */
  pixelRatio: number
}

/**
 * ピクセル比の上限。高 DPI 画面での GPU 負荷を抑える。
 * TODO: Phase 8 の品質 tier（モバイルは 1.5）と動的品質調整に置き換える
 */
const MAX_PIXEL_RATIO = 2

/**
 * 描画先コンテナのサイズとピクセル比を監視し、変化したらコールバックへ通知する。
 *
 * window の resize ではなく ResizeObserver を使い、モバイルのアドレスバーの伸縮にも追従する。
 * 生成時に 1 回だけ通知するため、呼び出し側は初期サイズを別途設定しなくてよい。
 * dispose() を呼ぶまで監視を続ける（DPR の監視は AbortSignal で解除される）。
 */
export class Viewport {
  private readonly resizeObserver: ResizeObserver
  private currentSize: IViewportSize

  /**
   * @param container サイズを監視する要素（canvas を全面に敷いているコンテナ）
   * @param signal DPR 監視のリスナー解除用
   * @param onResize サイズかピクセル比が変わるたびに呼ばれる
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly signal: AbortSignal,
    private readonly onResize: (size: IViewportSize) => void,
  ) {
    this.currentSize = this.measure()
    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(container)
    this.watchPixelRatio()
    this.onResize(this.currentSize)
  }

  get size(): IViewportSize {
    return this.currentSize
  }

  dispose(): void {
    this.resizeObserver.disconnect()
  }

  private measure(): IViewportSize {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    }
  }

  private readonly handleResize = (): void => {
    const nextSize = this.measure()
    const isSame =
      nextSize.width === this.currentSize.width &&
      nextSize.height === this.currentSize.height &&
      nextSize.pixelRatio === this.currentSize.pixelRatio
    if (isSame) return

    this.currentSize = nextSize
    this.onResize(nextSize)
  }

  /**
   * ウィンドウを別の DPI の画面へ移動したときなど、devicePixelRatio の変化を検知する。
   * resolution のメディアクエリは「現在の値から変わった」ことしか分からないため、変化のたびに張り直す。
   */
  private watchPixelRatio(): void {
    if (this.signal.aborted) return

    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    query.addEventListener(
      "change",
      () => {
        this.handleResize()
        this.watchPixelRatio()
      },
      { once: true, signal: this.signal },
    )
  }
}
