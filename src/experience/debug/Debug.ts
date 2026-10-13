import type { Fog, IUniform } from "three"
import type GUI from "three/addons/libs/lil-gui.module.min.js"
import type Stats from "three/addons/libs/stats.module.js"

import { CAMERA_FAR, MAX_SPEED } from "@/experience/controls/controls.constants"
import { MODAL_CHANGE_EVENT, ORB_SELECT_EVENT } from "@/experience/orbs/orb.events"
import { COURSE_LENGTH, PLANET_RADIUS_CANDIDATES } from "@/experience/world/world.constants"

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

/**
 * ループ検証で最初にジャンプする先のコース s（m）。
 * 1 周の境界（0m）の 5m 手前から歩き始め、境界をまたぐ前後を見比べるため
 */
const LOOP_JUMP_DEFAULT_S = COURSE_LENGTH - 5

/** ジャンプ先のコース s の入力の刻み（m）。境界の直前・直後（99.95m など）を指定できる細かさにする */
const LOOP_JUMP_STEP = 0.01

/**
 * ジャンプ先のコース s の上限（m）。
 * COURSE_LENGTH ちょうどを許すと次の周の 0m になり、周回数が 1 増えてしまうため、1 刻み分だけ手前にする
 */
const LOOP_JUMP_MAX_S = COURSE_LENGTH - LOOP_JUMP_STEP

/** 少しだけ周回を進める・戻すときの周回数。10 周以上で挙動が変わらないことを確かめる（計画書 §23 Phase 4） */
const LOOP_FEW_LAPS = 10

/**
 * 一気に周回を進めるときの周回数（1 万周 = 100km）。
 * 進行距離が大きくなっても、折り返し後の位置（courseS）と見た目が変わらないこと（数値誤差の蓄積がないこと）を確かめる
 */
const LOOP_MANY_LAPS = 10_000

/** 自動歩行の速度の刻み（m/s） */
const AUTO_WALK_SPEED_STEP = 0.1

/** seed を切り替えて森を作り直せる対象（World の Forest） */
interface IDebugSeedTarget {
  readonly seed: number
  setSeed(seed: number): void
}

/** ループ検証で進行距離を直接動かす対象（Experience の ScrollController） */
interface IDebugScrollTarget {
  /** 累計の進行距離（m） */
  readonly distance: number
  /** 慣性を付けずに指定の進行距離へ移動する */
  teleport(distance: number): void
  /** 一定の速度（m/s）で進み続ける。0 で止める */
  setAutoWalkSpeed(speed: number): void
}

/** デバッグ GUI から調整する対象 */
interface IDebugTargets {
  /** 惑星半径の uniform（曲げ変換の共有 uniform をそのまま渡す） */
  radiusUniform: IUniform<number>
  /** シーンの霧（Atmosphere の fog をそのまま渡す） */
  fog: Fog
  /** 配置物の森（seed の切り替えに使う） */
  forest: IDebugSeedTarget
  /** 進行距離（ループ検証のジャンプ・自動歩行に使う） */
  scroll: IDebugScrollTarget
}

/** デバッグ表示で読み取る現在値（Experience が毎フレーム渡す） */
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

/** Status フォルダに表示する値。渡された現在値に、Debug の中で求める値を足したもの */
interface IDebugStatus extends IDebugReadouts {
  /** 周回数（0m を前進でまたぐと 1 増え、後退でまたぐと 1 減る。負にもなる） */
  lap: number
}

/**
 * 進行距離から周回数を求める
 * @param distance 累計の進行距離（m）
 */
const toLap = (distance: number): number => Math.floor(distance / COURSE_LENGTH)

/**
 * URL に ?debug を付けたときだけ使うデバッグ GUI（lil-gui）と FPS 表示（stats）。
 * 通常の閲覧時にライブラリを読み込まないよう、Debug.create で動的 import する。
 */
export class Debug {
  private readonly status: IDebugStatus = {
    distance: 0,
    courseS: 0,
    lap: 0,
    velocity: 0,
    drawCalls: 0,
    triangles: 0,
  }

  private readonly scroll: IDebugScrollTarget
  /** Debug が window に登録したリスナーを dispose() で外す */
  private readonly abortController = new AbortController()

  private constructor(
    private readonly gui: GUI,
    private readonly stats: Stats,
    { radiusUniform, fog, forest, scroll }: IDebugTargets,
  ) {
    this.scroll = scroll
    document.body.append(stats.dom)

    // オーブの選択とモーダルの開閉のイベントが発火したことを、コンソールで確かめる
    window.addEventListener(
      ORB_SELECT_EVENT,
      (event) => console.info(`[debug] ${ORB_SELECT_EVENT}:`, event.detail.orbId),
      { signal: this.abortController.signal },
    )
    window.addEventListener(
      MODAL_CHANGE_EVENT,
      ({ detail }) => console.info(`[debug] ${MODAL_CHANGE_EVENT}:`, detail.isOpen, detail.orbId),
      { signal: this.abortController.signal },
    )

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

    // ループ検証: 1 周の境界（0m）の手前へのジャンプ、周回の早送り、一定速度の自動歩行
    const loop = gui.addFolder("Loop")
    const loopParams = {
      jumpS: LOOP_JUMP_DEFAULT_S,
      // 周回数はいまのまま、コース s だけを指定の位置へ動かす
      jump: () => scroll.teleport(toLap(scroll.distance) * COURSE_LENGTH + loopParams.jumpS),
      forwardFewLaps: () => this.shiftLaps(LOOP_FEW_LAPS),
      backwardFewLaps: () => this.shiftLaps(-LOOP_FEW_LAPS),
      forwardManyLaps: () => this.shiftLaps(LOOP_MANY_LAPS),
      // 自動歩行: 慣性を通さず一定の速度で進める（境界をまたぐ前後を同じ速さで見比べるため）
      autoWalkSpeed: 0,
    }
    loop.add(loopParams, "jumpS", 0, LOOP_JUMP_MAX_S, LOOP_JUMP_STEP).name("jump s (m)")
    loop.add(loopParams, "jump").name("jump to s")
    loop.add(loopParams, "forwardFewLaps").name(`+${LOOP_FEW_LAPS} laps`)
    loop.add(loopParams, "backwardFewLaps").name(`-${LOOP_FEW_LAPS} laps`)
    loop.add(loopParams, "forwardManyLaps").name(`+${LOOP_MANY_LAPS} laps`)
    loop
      .add(loopParams, "autoWalkSpeed", -MAX_SPEED, MAX_SPEED, AUTO_WALK_SPEED_STEP)
      .name("auto walk (m/s)")
      .onChange((speed: number) => scroll.setAutoWalkSpeed(speed))

    const statusFolder = gui.addFolder("Status")
    statusFolder.add(this.status, "distance").decimals(2).listen().disable()
    statusFolder.add(this.status, "courseS").decimals(2).listen().disable()
    statusFolder.add(this.status, "lap").listen().disable()
    statusFolder.add(this.status, "velocity").decimals(2).listen().disable()
    statusFolder.add(this.status, "drawCalls").listen().disable()
    statusFolder.add(this.status, "triangles").listen().disable()
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
    Object.assign(this.status, readouts)
    this.status.lap = toLap(readouts.distance)
    this.stats.update()
  }

  dispose(): void {
    this.abortController.abort()
    this.gui.destroy()
    this.stats.dom.remove()
  }

  /** コース s はいまのまま、周回数だけを進める（負なら戻す） */
  private shiftLaps(laps: number): void {
    this.scroll.teleport(this.scroll.distance + laps * COURSE_LENGTH)
  }
}
