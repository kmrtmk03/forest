import { LinearSRGBColorSpace, NoToneMapping, Vector2, WebGLRenderTarget } from "three"
import type { Camera, Scene, WebGLRenderer } from "three"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

/**
 * Bloom の強さ・広がり・しきい値（デバッグ GUI で変えられる）。
 * しきい値はトーンマッピングと sRGB 変換が済んだ画面の色（0〜1）の輝度。低くして画面全体を薄くにじませ、
 * 明るい物（木漏れ日・浮遊粒子・オーブの炎・霧の明るい所）ほど強くにじむ柔らかい見た目にする。
 * 2026-10-13 にユーザーが今の描き方（画面の色で計算）のデバッグ GUI で選んだ値。
 * しきい値 0.01 でほぼ全画素がにじみ、強さを小さく・広がりを大きくして、画面全体を薄い光で包む
 */
const BLOOM_STRENGTH = 0.04
const BLOOM_RADIUS = 0.91
const BLOOM_THRESHOLD = 0.01

/**
 * Bloom を計算する解像度の倍率（CSS px に対する倍率）。
 * Bloom はぼかした光なので細かさは要らず、高 DPR の画面でも pixelRatio を掛けない。
 * UnrealBloomPass はこの大きさのさらに半分から計算を始める（1280×720 の画面なら 640×360）。
 * Retina（pixelRatio 2）の画面では、ぼかしの計算量が 1/4 になる
 */
const BLOOM_PIXEL_RATIO = 1

/**
 * 後処理（計画書 §16 の Bloom）。シーンは canvas に直接描き、その画面をテクスチャへ写してから Bloom を重ねる。
 *   1. renderer.render でシーンを canvas に描く（canvas の MSAA・トーンマッピング・sRGB 変換はいつもどおり）
 *   2. canvas の画面を sceneCopy へ写す（copyFramebufferToTexture。MSAA の解決もここで行われる）
 *   3. UnrealBloomPass で sceneCopy から光をにじませ、canvas へ書き戻して重ねる
 *
 * 計画書 §16 の「EffectComposer で HDR のレンダーターゲットに MSAA を掛けて描く」方式は、Apple の GPU（ANGLE / Metal）で
 * 描画先の MSAA が非常に重く（MacBook 相当の画面で 1 フレームの GPU 時間が 43ms、canvas の MSAA なら 2.5ms）、
 * フレームレートが落ちたため使わない。代わりに Bloom は画面の色（sRGB、0〜1）で計算する（付録 B-15）。
 *
 * 使い方: renderer.setSize の後に setSize を呼び、毎フレーム renderer.render の代わりに render を呼ぶ。
 * setSize を呼ばないと sceneCopy の大きさが canvas と合わず、Bloom がずれる。破棄は dispose で行う
 * TODO: Phase 8 の品質 tier でモバイルは Bloom を切る（計画書 §16）
 */
export class PostProcessing {
  /** Bloom のパス。デバッグ GUI から strength / radius / threshold を調整する */
  readonly bloomPass: UnrealBloomPass
  /** canvas の画面を写すレンダーターゲット（canvas の描画バッファと同じ大きさ、MSAA なし・深度なし） */
  private readonly sceneCopy = new WebGLRenderTarget(1, 1, { depthBuffer: false })
  /** setSize で canvas の描画バッファの大きさを読むための作業用 */
  private readonly drawingBufferSize = new Vector2()

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    this.bloomPass = new UnrealBloomPass(
      new Vector2(1, 1),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    // 最後に canvas へ書き戻す（sceneCopy の画面を描き直し、その上に光を足す）
    this.bloomPass.renderToScreen = true
  }

  /**
   * 描画サイズを合わせる。renderer.setSize / setPixelRatio の後に呼ぶこと（canvas の描画バッファの大きさを読むため）
   * @param width canvas の表示幅（CSS px）
   * @param height canvas の表示高さ（CSS px）
   */
  setSize(width: number, height: number): void {
    const { x: bufferWidth, y: bufferHeight } = this.renderer.getDrawingBufferSize(
      this.drawingBufferSize,
    )
    this.sceneCopy.setSize(bufferWidth, bufferHeight)
    // setSize で作り直された GPU のテクスチャを確保する。copyFramebufferToTexture は確保済みのテクスチャへしか写せない
    this.renderer.initRenderTarget(this.sceneCopy)
    this.bloomPass.setSize(width * BLOOM_PIXEL_RATIO, height * BLOOM_PIXEL_RATIO)
  }

  /**
   * シーンを描いて Bloom を重ねる。毎フレーム、renderer.render の代わりに呼ぶこと
   * @param deltaSeconds 前フレームからの経過時間（秒）
   */
  render(deltaSeconds: number): void {
    const { renderer } = this
    renderer.setRenderTarget(null)
    renderer.render(this.scene, this.camera)
    // 直前に描いた canvas（既定のフレームバッファ）から写す
    renderer.copyFramebufferToTexture(this.sceneCopy.texture)

    // sceneCopy にはトーンマッピングと sRGB 変換が済んだ色が入っている。
    // Bloom のマテリアルが canvas へ描くときに、もう一度変換して明るくならないよう、その間だけ変換を切る。
    // （マテリアルのシェーダーはこの設定で 1 回だけコンパイルされ、シーンのマテリアルには影響しない）
    // Bloom の途中で例外が起きても、次のフレームのシーンが変換なしで描かれないよう、finally で必ず戻す
    const { outputColorSpace, toneMapping } = renderer
    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.toneMapping = NoToneMapping
    try {
      // writeBuffer は使われない（renderToScreen のため）。readBuffer の内容を canvas へ描き直し、光を足す
      this.bloomPass.render(renderer, this.sceneCopy, this.sceneCopy, deltaSeconds, false)
    } finally {
      renderer.outputColorSpace = outputColorSpace
      renderer.toneMapping = toneMapping
    }
  }

  /** レンダーターゲットと Bloom のマテリアルを破棄する */
  dispose(): void {
    this.sceneCopy.dispose()
    this.bloomPass.dispose()
  }
}
