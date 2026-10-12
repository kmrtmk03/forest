import type { Fog, IUniform } from "three"
import type GUI from "three/addons/libs/lil-gui.module.min.js"
import type Stats from "three/addons/libs/stats.module.js"

import { CAMERA_FAR } from "@/experience/controls/controls.constants"
import { PLANET_RADIUS_CANDIDATES } from "@/experience/world/world.constants"

/** 惑星半径スライダーの範囲（m） */
const PLANET_RADIUS_MIN = 40
const PLANET_RADIUS_MAX = 400

/**
 * 霧の距離スライダーの範囲（m）。上限はカメラの far にする。
 * far より先に霧の終端を置くと、霧に溶けきる前に物が far で切れて見えるため
 */
const FOG_DISTANCE_MIN = 0
const FOG_DISTANCE_MAX = CAMERA_FAR
const FOG_DISTANCE_STEP = 0.5

/** seed をランダムに選ぶときの上限（32bit 符号なし整数の範囲） */
const SEED_RANGE = 2 ** 32

/** seed を切り替えて森を作り直せる対象（World の Forest） */
interface IDebugSeedTarget {
  readonly seed: number
  setSeed(seed: number): void
}

/** デバッグ GUI から調整する対象 */
interface IDebugTargets {
  /** 惑星半径の uniform（曲げ変換の共有 uniform をそのまま渡す） */
  radiusUniform: IUniform<number>
  /** シーンの霧（Atmosphere の fog をそのまま渡す） */
  fog: Fog
  /** 配置物の森（seed の切り替えに使う） */
  forest: IDebugSeedTarget
}

/** デバッグ表示で読み取る現在値 */
interface IDebugReadouts {
  /** 累計の進行距離（m） */
  distance: number
  /** コース上の位置（m、0〜COURSE_LENGTH） */
  courseS: number
  /** 速度（m/s） */
  velocity: number
  /** 直前のフレームの Draw Call 数 */
  drawCalls: number
  /** 直前のフレームで描いた三角形の数 */
  triangles: number
}

/**
 * URL に ?debug を付けたときだけ使うデバッグ GUI（lil-gui）と FPS 表示（stats）。
 * 通常の閲覧時にライブラリを読み込まないよう、Debug.create で動的 import する。
 */
export class Debug {
  private readonly readouts: IDebugReadouts = {
    distance: 0,
    courseS: 0,
    velocity: 0,
    drawCalls: 0,
    triangles: 0,
  }

  private constructor(
    private readonly gui: GUI,
    private readonly stats: Stats,
    { radiusUniform, fog, forest }: IDebugTargets,
  ) {
    document.body.append(stats.dom)

    // 惑星半径: 候補値の切り替えと、細かい調整用のスライダー
    const planet = gui.addFolder("Planet")
    planet.add(radiusUniform, "value", [...PLANET_RADIUS_CANDIDATES]).name("radius preset")
    planet
      .add(radiusUniform, "value", PLANET_RADIUS_MIN, PLANET_RADIUS_MAX, 0.1)
      .name("radius (m)")
      .listen()

    // 霧の距離: 地平線・折り返し位置（50m）との兼ね合いを見ながら調整する
    const atmosphere = gui.addFolder("Atmosphere")
    atmosphere
      .add(fog, "near", FOG_DISTANCE_MIN, FOG_DISTANCE_MAX, FOG_DISTANCE_STEP)
      .name("fog near (m)")
    atmosphere
      .add(fog, "far", FOG_DISTANCE_MIN, FOG_DISTANCE_MAX, FOG_DISTANCE_STEP)
      .name("fog far (m)")

    // 森の seed: 入力を確定したとき（または random を押したとき）だけ森を作り直す。
    // 入力中に毎回作り直すと、配置の生成と InstancedMesh の作り直しが連続して重くなるため
    const forestFolder = gui.addFolder("Forest")
    const forestParams = {
      seed: forest.seed,
      random: () => {
        forestParams.seed = Math.floor(Math.random() * SEED_RANGE)
        seedController.updateDisplay()
        forest.setSeed(forestParams.seed)
      },
    }
    const seedController = forestFolder
      .add(forestParams, "seed")
      .step(1)
      .onFinishChange((seed: number) => forest.setSeed(seed))
    forestFolder.add(forestParams, "random").name("random seed")

    const status = gui.addFolder("Status")
    status.add(this.readouts, "distance").decimals(2).listen().disable()
    status.add(this.readouts, "courseS").decimals(2).listen().disable()
    status.add(this.readouts, "velocity").decimals(2).listen().disable()
    status.add(this.readouts, "drawCalls").listen().disable()
    status.add(this.readouts, "triangles").listen().disable()
  }

  /** ?debug が付いているかどうか */
  static isRequested(): boolean {
    return new URLSearchParams(window.location.search).has("debug")
  }

  /**
   * lil-gui と stats を動的 import してデバッグ表示を作る
   * @param targets GUI から調整する対象（値を直接書き換えるため、コピーではなく実物を渡す）
   */
  static async create(targets: IDebugTargets): Promise<Debug> {
    const [{ default: GUIClass }, { default: StatsClass }] = await Promise.all([
      import("three/addons/libs/lil-gui.module.min.js"),
      import("three/addons/libs/stats.module.js"),
    ])
    return new Debug(new GUIClass({ title: "Forest debug" }), new StatsClass(), targets)
  }

  /** 毎フレームの表示更新。Experience のループの最後に呼ぶ */
  update(readouts: IDebugReadouts): void {
    Object.assign(this.readouts, readouts)
    this.stats.update()
  }

  dispose(): void {
    this.gui.destroy()
    this.stats.dom.remove()
  }
}
