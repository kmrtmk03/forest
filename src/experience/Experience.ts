import { WebGLRenderer } from "three"

import type { TOrbMarker } from "@/data/orb.type"

import { CameraController } from "./controls/CameraController"
import { ScrollController } from "./controls/ScrollController"
import { Ticker } from "./core/Ticker"
import { Viewport } from "./core/Viewport"
import type { IViewportSize } from "./core/Viewport"
import { Debug } from "./debug/Debug"
import { OrbManager } from "./orbs/OrbManager"
import { World } from "./world/World"

/** 初期化の状態。ホスト要素の data-state に反映し、CSS でフェードインに使う */
type TExperienceState = "loading" | "ready"

/**
 * Three.js アプリ全体の生成・アニメーションループ・破棄を管理する。
 *
 * 使い方: new Experience(host) → start() → （ページ離脱時）destroy()
 * destroy() を呼ばないと、ループ・リスナー・GPU リソースが残り続ける。
 *
 * 毎フレームの更新は次の一方向の流れで行い、クラス同士は互いを直接参照しない。
 *   Ticker → ScrollController.update → World.update（曲げ変換の uniform 更新を含む）
 *   → OrbManager.update（更新済みの uniform からオーブの位置を求める）→ 描画
 */
export class Experience {
  /** すべてのイベントリスナーをこの signal で登録し、destroy() で一括解除する */
  private readonly abortController = new AbortController()
  private readonly renderer: WebGLRenderer
  private readonly cameraController: CameraController
  private readonly world: World
  private readonly orbManager: OrbManager
  private readonly scrollController: ScrollController
  private readonly viewport: Viewport
  private readonly ticker: Ticker
  private debug: Debug | null = null
  private isDestroyed = false

  /**
   * @param host canvas を内包するコンテナ要素（<forest-experience>）。入力の受け付けとサイズ監視に使う
   * @param orbMarkers オーブの描画用データ（Astro が data-orbs 属性で渡す）。並び順がコース上の並び順になる
   * @throws canvas が見つからない場合、WebGL コンテキストを作れない場合、
   *   オーブのデータの件数が 1 周のオーブの数と合わない場合
   */
  constructor(
    private readonly host: HTMLElement,
    orbMarkers: readonly TOrbMarker[],
  ) {
    const canvas = host.querySelector("canvas")
    if (!canvas) throw new Error("Experience: canvas 要素が見つかりません")

    const { signal } = this.abortController
    this.setState("loading")

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    })
    // 生成に失敗したとき、それより前に作った World・OrbManager を破棄するために覚えておく
    let world: World | null = null
    let orbManager: OrbManager | null = null
    try {
      this.cameraController = new CameraController()
      world = new World()
      this.world = world
      orbManager = new OrbManager({
        host,
        signal,
        camera: this.cameraController.camera,
        fog: world.atmosphere.fog,
        curvatureUniforms: world.curvatureUniforms,
        markers: orbMarkers,
      })
      this.orbManager = orbManager
      world.scene.add(orbManager.group)
      this.scrollController = new ScrollController(host, signal)
      // Viewport は生成時に 1 回 handleResize を呼ぶため、renderer と camera の生成後に作る
      this.viewport = new Viewport(host, signal, this.handleResize)
      this.ticker = new Ticker(this.renderer, signal, this.handleTick)
    } catch (error) {
      // 生成に失敗すると呼び出し側は destroy() を呼べないため、ここまでに作ったリスナー・World・レンダラーを解放する。
      // World・OrbManager は自分の中で失敗したときに、作った分を破棄してから（または作る前に）例外を投げる
      this.abortController.abort()
      orbManager?.dispose()
      world?.dispose()
      this.renderer.dispose()
      throw error
    }
  }

  /**
   * シェーダーのコンパイルを済ませてからループを開始する。
   * 先にコンパイルしておくことで、歩き始めのカクつきを防ぐ。
   */
  async start(): Promise<void> {
    await this.renderer.compileAsync(this.world.scene, this.cameraController.camera)
    const debug = Debug.isRequested()
      ? await Debug.create({
          radiusUniform: this.world.curvatureUniforms.uPlanetRadius,
          fog: this.world.atmosphere.fog,
          forest: this.world.forest,
          scroll: this.scrollController,
        })
      : null
    // 待っている間にページを離れた場合は、何も始めない
    if (this.isDestroyed) {
      debug?.dispose()
      return
    }

    this.debug = debug
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
    this.orbManager.dispose()
    this.world.dispose()
    this.renderer.dispose()
  }

  private setState(state: TExperienceState): void {
    this.host.dataset.state = state
  }

  /** 描画サイズを canvas の表示サイズに合わせる。Viewport はサイズが 0 のときは通知しない */
  private readonly handleResize = ({ width, height, pixelRatio }: IViewportSize): void => {
    this.renderer.setPixelRatio(pixelRatio)
    // 第 3 引数 false: canvas の CSS サイズはスタイルシート側（100%）に任せる
    this.renderer.setSize(width, height, false)
    this.cameraController.resize(width / height)
  }

  /** 毎フレームの更新と描画 */
  private readonly handleTick = (deltaSeconds: number): void => {
    this.scrollController.update(deltaSeconds)
    const { distance, velocity } = this.scrollController
    this.world.update(distance)
    this.orbManager.update(deltaSeconds)

    this.renderer.render(this.world.scene, this.cameraController.camera)

    // renderer.info は render のたびに数え直されるため、描画の直後に読む
    const { calls: drawCalls, triangles } = this.renderer.info.render
    this.debug?.update({ distance, courseS: this.world.courseS, velocity, drawCalls, triangles })
  }
}
