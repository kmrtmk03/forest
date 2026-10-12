import { WebGLRenderer } from "three"

import { CameraController } from "./controls/CameraController"
import { ScrollController } from "./controls/ScrollController"
import { Ticker } from "./core/Ticker"
import { Viewport } from "./core/Viewport"
import type { IViewportSize } from "./core/Viewport"
import { createCurvatureUniforms } from "./curvature/applyCurvature"
import type { ICurvatureUniforms } from "./curvature/applyCurvature"
import { positiveModulo } from "./curvature/curvature.utils"
import { Debug } from "./debug/Debug"
import { World } from "./world/World"
import { COURSE_LENGTH, PLANET_RADIUS } from "./world/world.constants"

/** 初期化の状態。ホスト要素の data-state に反映し、CSS でフェードインに使う */
type TExperienceState = "loading" | "ready"

/**
 * Three.js アプリ全体の生成・アニメーションループ・破棄を管理する。
 *
 * 使い方: new Experience(host) → start() → （ページ離脱時）destroy()
 * destroy() を呼ばないと、ループ・リスナー・GPU リソースが残り続ける。
 *
 * 毎フレームの更新は次の一方向の流れで行い、クラス同士は互いを直接参照しない。
 *   Ticker → ScrollController.update → 曲げ変換の uniform 更新 → World.update → 描画
 */
export class Experience {
  /** すべてのイベントリスナーをこの signal で登録し、destroy() で一括解除する */
  private readonly abortController = new AbortController()
  private readonly renderer: WebGLRenderer
  private readonly curvatureUniforms: ICurvatureUniforms
  private readonly cameraController: CameraController
  private readonly world: World
  private readonly scrollController: ScrollController
  private readonly viewport: Viewport
  private readonly ticker: Ticker
  private debug: Debug | null = null
  private isDestroyed = false

  /**
   * @param host canvas を内包するコンテナ要素（<forest-experience>）。入力の受け付けとサイズ監視に使う
   * @throws canvas が見つからない場合や、WebGL コンテキストを作れない場合
   */
  constructor(private readonly host: HTMLElement) {
    const canvas = host.querySelector("canvas")
    if (!canvas) throw new Error("Experience: canvas 要素が見つかりません")

    const { signal } = this.abortController
    this.setState("loading")

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    })
    this.curvatureUniforms = createCurvatureUniforms(PLANET_RADIUS, COURSE_LENGTH)
    this.cameraController = new CameraController()
    this.world = new World(this.curvatureUniforms)
    this.scrollController = new ScrollController(host, signal)
    // Viewport は生成時に 1 回 handleResize を呼ぶため、renderer と camera の生成後に作る
    this.viewport = new Viewport(host, signal, this.handleResize)
    this.ticker = new Ticker(this.renderer, signal, this.handleTick)
  }

  /**
   * シェーダーのコンパイルを済ませてからループを開始する。
   * 先にコンパイルしておくことで、歩き始めのカクつきを防ぐ。
   */
  async start(): Promise<void> {
    await this.renderer.compileAsync(this.world.scene, this.cameraController.camera)
    // コンパイル待ちの間にページを離れた場合は、何も始めない
    if (this.isDestroyed) return

    if (Debug.isRequested()) {
      const debug = await Debug.create({ curvatureUniforms: this.curvatureUniforms })
      if (this.isDestroyed) {
        debug.dispose()
        return
      }
      this.debug = debug
    }

    this.ticker.start()
    this.setState("ready")
  }

  /** ループ・リスナー・GPU リソースをすべて解放する。複数回呼んでも安全 */
  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true

    this.ticker.stop()
    this.abortController.abort()
    this.viewport.dispose()
    this.debug?.dispose()
    this.debug = null
    this.world.dispose()
    this.renderer.dispose()
  }

  private setState(state: TExperienceState): void {
    this.host.dataset.state = state
  }

  /** 描画サイズを canvas の表示サイズに合わせる */
  private readonly handleResize = ({ width, height, pixelRatio }: IViewportSize): void => {
    // 非表示などで高さが 0 の間は、投影行列を壊さないよう更新を見送る
    if (width === 0 || height === 0) return

    this.renderer.setPixelRatio(pixelRatio)
    // 第 3 引数 false: canvas の CSS サイズはスタイルシート側（100%）に任せる
    this.renderer.setSize(width, height, false)
    this.cameraController.resize(width / height)
  }

  /** 毎フレームの更新と描画 */
  private readonly handleTick = (deltaSeconds: number): void => {
    this.scrollController.update(deltaSeconds)

    // 進行距離はリセットせず増やし続け、シェーダーに渡すときだけ 1 周の長さで折り返す
    const distance = this.scrollController.distance
    const cameraS = positiveModulo(distance, COURSE_LENGTH)
    // MEMO: 道の蛇行（Phase 7）を入れるまでは、カメラは常に道の中央（x = 0）を歩く
    const cameraX = 0
    this.curvatureUniforms.uCurvatureCamera.value.set(cameraX, cameraS)
    this.world.update(cameraX, cameraS)

    this.renderer.render(this.world.scene, this.cameraController.camera)

    this.debug?.update({ distance, courseS: cameraS, velocity: this.scrollController.velocity })
  }
}
