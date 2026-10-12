import type { IUniform } from "three"
import type GUI from "three/addons/libs/lil-gui.module.min.js"
import type Stats from "three/addons/libs/stats.module.js"

import { PLANET_RADIUS_CANDIDATES } from "@/experience/world/world.constants"

/** 惑星半径スライダーの範囲（m） */
const PLANET_RADIUS_MIN = 40
const PLANET_RADIUS_MAX = 400

/** デバッグ表示で読み取る現在値 */
interface IDebugReadouts {
  /** 累計の進行距離（m） */
  distance: number
  /** コース上の位置（m、0〜COURSE_LENGTH） */
  courseS: number
  /** 速度（m/s） */
  velocity: number
}

/**
 * URL に ?debug を付けたときだけ使うデバッグ GUI（lil-gui）と FPS 表示（stats）。
 * 通常の閲覧時にライブラリを読み込まないよう、Debug.create で動的 import する。
 */
export class Debug {
  private readonly readouts: IDebugReadouts = { distance: 0, courseS: 0, velocity: 0 }

  private constructor(
    private readonly gui: GUI,
    private readonly stats: Stats,
    radiusUniform: IUniform<number>,
  ) {
    document.body.append(stats.dom)

    // 惑星半径: 候補値の切り替えと、細かい調整用のスライダー
    const planet = gui.addFolder("Planet")
    planet.add(radiusUniform, "value", [...PLANET_RADIUS_CANDIDATES]).name("radius preset")
    planet
      .add(radiusUniform, "value", PLANET_RADIUS_MIN, PLANET_RADIUS_MAX, 0.1)
      .name("radius (m)")
      .listen()

    const status = gui.addFolder("Status")
    status.add(this.readouts, "distance").decimals(2).listen().disable()
    status.add(this.readouts, "courseS").decimals(2).listen().disable()
    status.add(this.readouts, "velocity").decimals(2).listen().disable()
  }

  /** ?debug が付いているかどうか */
  static isRequested(): boolean {
    return new URLSearchParams(window.location.search).has("debug")
  }

  /**
   * lil-gui と stats を動的 import してデバッグ表示を作る
   * @param radiusUniform GUI から調整する惑星半径の uniform（曲げ変換の共有 uniform をそのまま渡す）
   */
  static async create(radiusUniform: IUniform<number>): Promise<Debug> {
    const [{ default: GUIClass }, { default: StatsClass }] = await Promise.all([
      import("three/addons/libs/lil-gui.module.min.js"),
      import("three/addons/libs/stats.module.js"),
    ])
    return new Debug(new GUIClass({ title: "Forest debug" }), new StatsClass(), radiusUniform)
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
