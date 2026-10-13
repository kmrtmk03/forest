import {
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three"
import type { Camera, Intersection, Object3D } from "three"

import type { TOrbId, TOrbMarker } from "@/data/orb.type"
import type { ICurvatureUniforms } from "@/experience/curvature/applyCurvature"
import { curvaturePosition } from "@/experience/curvature/curvature.utils"
import type { IOrbSlot } from "@/experience/procedural/orbSlot.type"
import { listOrbSlots, ORB_COUNT } from "@/experience/procedural/orbSlot.utils"
import { wrapSignedCourse } from "@/experience/world/course.utils"
import {
  CHUNK_LENGTH,
  VISIBLE_CHUNKS_AHEAD,
  VISIBLE_CHUNKS_BEHIND,
} from "@/experience/world/world.constants"

import { dispatchOrbSelect } from "./orb.events"

// ---- 見た目 ----

/** オーブ本体の半径（m） */
const ORB_RADIUS = 0.25

/** 球の分割数（横・縦）。半径 0.25m なら、近くで見ても角が目立たない程度 */
const ORB_WIDTH_SEGMENTS = 24
const ORB_HEIGHT_SEGMENTS = 16

/**
 * 本体を包む半透明の殻の半径（m）と不透明度。光っているように見せる仮の表現。
 * TODO: Phase 7 で Bloom と HDR の発光・光の粒に置き換える
 */
const ORB_HALO_RADIUS = 0.42
const ORB_HALO_OPACITY = 0.25

/** データに色の指定がないときの色 */
const ORB_DEFAULT_COLOR = "#fff2c4"

// ---- 動き ----

/** 上下の浮遊の振幅（m）と周期（秒）。計画書 §12 */
const ORB_BOB_AMPLITUDE = 0.12
const ORB_BOB_PERIOD = 3

/**
 * オーブごとに浮遊の位相をずらす量（ラジアン、黄金角）。
 * 隣り合うオーブが同じタイミングで上下しないようにする。位置ではなく並び順で決めるため、1 周の境界でも途切れない
 */
const ORB_PHASE_STEP = Math.PI * (3 - Math.sqrt(5))

/**
 * 描画する範囲（m、カメラからのコース方向の距離）。配置物のチャンクと同じ範囲（前方 45m・後方 10m）にそろえる。
 * 前方 45m は地平線（約 14.5m）よりずっと先で、オーブ（高さ 約 1.2m）は地面に隠れて見えない。
 * どちらも 1 周の半分（50m）未満にし、反対側へ折り返す位置で描かないようにする
 */
const ORB_VISIBLE_AHEAD = CHUNK_LENGTH * VISIBLE_CHUNKS_AHEAD
const ORB_VISIBLE_BEHIND = CHUNK_LENGTH * VISIBLE_CHUNKS_BEHIND

/**
 * カメラ（目）に近づいたときに縮め始める距離と、大きさが 0 になる距離（m、直線距離）。
 * オーブは道の脇（0.8m）を目より低く浮かぶため、すれ違うときの最接近は 約 0.9m。
 * そこで小さくしておき、画面の端で大きな球が視界を覆ったり、カメラが球の中に入ったりしないようにする
 */
const ORB_SHRINK_START_DISTANCE = 1.5
const ORB_SHRINK_END_DISTANCE = 0.6

// ---- クリック・ホバー ----

/** クリック判定用の球の半径（m）。見た目より大きくして、小さなオーブも押しやすくする（計画書 §13） */
const ORB_HIT_RADIUS = 0.5

/** クリックとして受け付ける最も遠い距離（m、カメラからの直線距離）。霧が濃く見えにくいオーブは選ばせない */
const PICK_MAX_DISTANCE = 40

/** 押してから離すまでの移動量（px）と時間（ms）がこれ未満のときだけクリックとみなす（スワイプ移動を除くため） */
const CLICK_MAX_MOVE_PX = 6
const CLICK_MAX_DURATION_MS = 400

/** ホバー中のオーブの拡大率と、白に寄せる割合（0〜1） */
const ORB_HOVER_SCALE = 1.15
const ORB_HOVER_WHITEN = 0.35

/** ホバー時に白へ寄せるための色 */
const WHITE = new Color("#ffffff")

/** 1 個のオーブの描画用のデータ */
interface IOrb {
  id: TOrbId
  slot: IOrbSlot
  /** 本体・殻・判定用の球をまとめたグループ。位置と大きさはこれに設定する */
  group: Group
  coreMaterial: MeshBasicMaterial
  haloMaterial: MeshBasicMaterial
  /** クリック判定用の球（描画しない） */
  hit: Mesh
  /** データで指定された色（ホバーを外したときに戻す） */
  baseColor: Color
  /** 浮遊の位相（ラジアン） */
  phase: number
}

/** 押した瞬間のポインタの情報（クリックかスワイプかの判定に使う） */
interface IPointerPress {
  pointerId: number
  clientX: number
  clientY: number
  timeStamp: number
}

/** OrbManager の生成に必要なもの */
interface IOrbManagerOptions {
  /** ポインタ操作を受け付け、カーソルを変える要素（canvas を含むコンテナ） */
  host: HTMLElement
  /** リスナー解除用。abort() で全リスナーが外れる */
  signal: AbortSignal
  /** クリック・ホバーの判定に使うカメラ */
  camera: Camera
  /** 曲げ変換の共有 uniform。カメラのコース位置と惑星半径を読む（World が毎フレーム更新する） */
  curvatureUniforms: ICurvatureUniforms
  /** オーブの描画用データ。並び順がコース上の並び順になる */
  markers: readonly TOrbMarker[]
}

/**
 * コース上のオーブの配置・浮遊・クリック判定を行う（計画書 §12・§13）。
 *
 * オーブは数が少ないため InstancedMesh にせず、1 個ずつ Mesh を作る。
 * 位置はシェーダーで曲げず、TS 版の曲げ変換（curvaturePosition）で毎フレーム CPU で求める。
 * そのため通常の Raycaster でクリック・ホバーを判定できる。
 *
 * 毎フレーム、World の update（曲げ変換の uniform の更新）の後、描画の前に update(dt) を呼ぶこと。
 * 呼ばないとオーブが動かず、ホバーの判定も更新されない。
 * クリックされたオーブは forest:orb-select（orb.events.ts）で知らせる。
 */
export class OrbManager {
  /** オーブをまとめたグループ。シーンへ追加すること */
  readonly group = new Group()
  private readonly host: HTMLElement
  private readonly camera: Camera
  private readonly curvatureUniforms: ICurvatureUniforms
  private readonly orbs: IOrb[]
  /** 判定用の球からオーブを引く */
  private readonly orbByHit = new Map<Object3D, IOrb>()
  private readonly coreGeometry: SphereGeometry
  private readonly haloGeometry: SphereGeometry
  private readonly hitGeometry: SphereGeometry
  private readonly hitMaterial: MeshBasicMaterial

  /** 経過時間（秒）。浮遊の動きに使う。位置に依存させないため、ループの境界でも途切れない */
  private elapsedSeconds = 0
  private hoveredOrb: IOrb | null = null
  /** マウスが要素の上にあるか。ないときはホバーの判定をしない */
  private isPointerInside = false
  /** 押している最中のポインタ。押していないときは null */
  private press: IPointerPress | null = null

  // 毎フレームの処理で使い回す作業用オブジェクト（毎回 new しない）
  private readonly relative = new Vector3()
  private readonly pointerClient = new Vector2()
  private readonly pointerNdc = new Vector2()
  private readonly raycaster = new Raycaster()
  /** いま描画しているオーブの判定用の球（クリック・ホバーの判定対象） */
  private readonly visibleHits: Object3D[] = []
  private readonly intersections: Intersection[] = []

  /**
   * @throws オーブのデータの件数が 1 周のオーブの数（ORB_COUNT）と合わない場合、
   *   ORB_SPACING が COURSE_LENGTH を割り切らない場合。どちらも GPU のリソースを作る前に投げる
   */
  constructor({ host, signal, camera, curvatureUniforms, markers }: IOrbManagerOptions) {
    if (markers.length !== ORB_COUNT) {
      throw new Error(
        `OrbManager: オーブのデータが ${markers.length} 件ですが、1 周に置くオーブは ${ORB_COUNT} 個です`,
      )
    }
    const slots = listOrbSlots()

    this.host = host
    this.camera = camera
    this.curvatureUniforms = curvatureUniforms
    this.raycaster.far = PICK_MAX_DISTANCE

    // 形は全オーブで共有し、色を変えるマテリアルだけを 1 個ずつ作る
    this.coreGeometry = new SphereGeometry(ORB_RADIUS, ORB_WIDTH_SEGMENTS, ORB_HEIGHT_SEGMENTS)
    this.haloGeometry = new SphereGeometry(ORB_HALO_RADIUS, ORB_WIDTH_SEGMENTS, ORB_HEIGHT_SEGMENTS)
    this.hitGeometry = new SphereGeometry(ORB_HIT_RADIUS, ORB_WIDTH_SEGMENTS, ORB_HEIGHT_SEGMENTS)
    // visible: false のマテリアルは描画されないが、Raycaster の判定には使える
    this.hitMaterial = new MeshBasicMaterial({ visible: false })

    this.orbs = slots.map((slot) => this.createOrb(slot, markers[slot.index]))

    host.addEventListener("pointerdown", this.handlePointerDown, { signal })
    host.addEventListener("pointerup", this.handlePointerUp, { signal })
    host.addEventListener("pointercancel", this.handlePointerCancel, { signal })
    host.addEventListener("pointermove", this.handlePointerMove, { signal })
    host.addEventListener("pointerleave", this.handlePointerLeave, { signal })
  }

  /**
   * オーブの位置・大きさとホバーの状態を更新する。毎フレーム、World の update の後、描画の前に呼ぶこと
   * @param deltaSeconds 前フレームからの経過時間（秒）。Ticker 側でクランプ済みの値を渡す
   */
  update(deltaSeconds: number): void {
    this.elapsedSeconds += deltaSeconds
    const { x: cameraX, y: cameraS } = this.curvatureUniforms.uCurvatureCamera.value
    const planetRadius = this.curvatureUniforms.uPlanetRadius.value

    this.visibleHits.length = 0
    this.orbs.forEach((orb) => {
      // 1 周の上で最も近い向きの前方距離。描画範囲の外のオーブは描かず、判定の対象からも外す
      const forward = wrapSignedCourse(orb.slot.s - cameraS)
      if (forward <= -ORB_VISIBLE_BEHIND || forward >= ORB_VISIBLE_AHEAD) {
        orb.group.visible = false
        return
      }

      // カメラ相対の平面座標（curvature.glsl の curvatureRelative と同じ形。前方が -Z）を球面へ写像する
      const bob =
        Math.sin((Math.PI * 2 * this.elapsedSeconds) / ORB_BOB_PERIOD + orb.phase) *
        ORB_BOB_AMPLITUDE
      this.relative.set(orb.slot.x - cameraX, orb.slot.height + bob, -forward)
      curvaturePosition(this.relative, planetRadius, orb.group.position)

      // 目に近づいたら縮め、すれ違う瞬間に視界を覆わないようにする
      const distance = orb.group.position.distanceTo(this.camera.position)
      const shrink = MathUtils.smoothstep(
        distance,
        ORB_SHRINK_END_DISTANCE,
        ORB_SHRINK_START_DISTANCE,
      )
      if (shrink === 0) {
        orb.group.visible = false
        return
      }

      orb.group.visible = true
      orb.group.scale.setScalar(shrink * (orb === this.hoveredOrb ? ORB_HOVER_SCALE : 1))
      // 同じフレームのうちにクリック・ホバーを判定できるよう、行列をすぐ更新する（描画時の更新を待たない）
      orb.group.updateMatrixWorld()
      this.visibleHits.push(orb.hit)
    })

    // オーブもカメラも動くため、マウスが止まっていても毎フレーム判定し直す（10 個の球なので軽い）
    this.setHoveredOrb(this.isPointerInside ? this.pickOrb(this.pointerClient) : null)
  }

  /** ジオメトリ・マテリアルを破棄し、カーソルを元に戻す。リスナーは Experience の abort() で外れる */
  dispose(): void {
    this.coreGeometry.dispose()
    this.haloGeometry.dispose()
    this.hitGeometry.dispose()
    this.hitMaterial.dispose()
    this.orbs.forEach(({ coreMaterial, haloMaterial }) => {
      coreMaterial.dispose()
      haloMaterial.dispose()
    })
    this.group.clear()
    this.host.style.cursor = ""
  }

  /** 1 個のオーブ（本体・殻・判定用の球）を作り、グループへ追加する */
  private createOrb(slot: IOrbSlot, marker: TOrbMarker): IOrb {
    const baseColor = new Color(marker.color ?? ORB_DEFAULT_COLOR)
    // 光の影響を受けない MeshBasicMaterial で、暗い森の中でも明るく見せる。霧は通常どおり掛かる
    const coreMaterial = new MeshBasicMaterial({ color: baseColor })
    const haloMaterial = new MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: ORB_HALO_OPACITY,
      // 殻が本体や後ろの物を深度で隠さないようにする
      depthWrite: false,
    })

    const core = new Mesh(this.coreGeometry, coreMaterial)
    const halo = new Mesh(this.haloGeometry, haloMaterial)
    const hit = new Mesh(this.hitGeometry, this.hitMaterial)
    const group = new Group()
    group.add(core, halo, hit)
    // 最初は表示したままにしておく。compileAsync は表示中の物だけをコンパイルするため、
    // 非表示にすると、オーブが初めて描画範囲に入ったときにシェーダーのコンパイルでカクつく。
    // 描画は最初の update の後なので、この時点の位置（原点）で描かれることはない
    this.group.add(group)

    const orb: IOrb = {
      id: marker.id,
      slot,
      group,
      coreMaterial,
      haloMaterial,
      hit,
      baseColor,
      phase: slot.index * ORB_PHASE_STEP,
    }
    this.orbByHit.set(hit, orb)
    return orb
  }

  /**
   * 画面上の位置にあるオーブを探す。いま描画しているオーブだけを対象にし、最も手前のものを返す
   * @param client ポインタの位置（clientX, clientY）
   */
  private pickOrb(client: Vector2): IOrb | null {
    const rect = this.host.getBoundingClientRect()
    // 要素が表示されていない（サイズ 0）ときは判定しない
    if (rect.width === 0 || rect.height === 0) return null

    // 要素内の位置を正規化デバイス座標（-1〜1、上が +）に直す
    this.pointerNdc.set(
      ((client.x - rect.left) / rect.width) * 2 - 1,
      -((client.y - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    this.intersections.length = 0
    this.raycaster.intersectObjects(this.visibleHits, false, this.intersections)

    const nearest = this.intersections[0]
    return nearest ? (this.orbByHit.get(nearest.object) ?? null) : null
  }

  /** ホバー中のオーブを切り替え、色とカーソルを反映する。大きさは次の update で反映される */
  private setHoveredOrb(orb: IOrb | null): void {
    if (orb === this.hoveredOrb) return

    this.hoveredOrb?.coreMaterial.color.copy(this.hoveredOrb.baseColor)
    orb?.coreMaterial.color.copy(orb.baseColor).lerp(WHITE, ORB_HOVER_WHITEN)
    this.hoveredOrb = orb
    this.host.style.cursor = orb ? "pointer" : ""
  }

  /** 押した位置と時刻を覚える。主ボタン（タッチ・ペンの接触を含む）以外は無視する */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return
    this.press = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    }
  }

  /** ほとんど動かさずにすぐ離したときだけクリックとみなし、その位置のオーブを選ぶ */
  private readonly handlePointerUp = (event: PointerEvent): void => {
    const { press } = this
    if (!press || press.pointerId !== event.pointerId) return
    this.press = null

    const movedPx = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY)
    const durationMs = event.timeStamp - press.timeStamp
    // スワイプ（タッチでの移動）や長押しはクリックにしない
    if (movedPx >= CLICK_MAX_MOVE_PX || durationMs >= CLICK_MAX_DURATION_MS) return

    this.pointerClient.set(event.clientX, event.clientY)
    const orb = this.pickOrb(this.pointerClient)
    if (orb) dispatchOrbSelect(orb.id)
  }

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.press?.pointerId === event.pointerId) this.press = null
  }

  /** マウスの位置を覚える。判定は update でフレームごとに 1 回だけ行う。タッチ・ペンにはホバーがないので無視する */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    this.pointerClient.set(event.clientX, event.clientY)
    this.isPointerInside = true
  }

  private readonly handlePointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    this.isPointerInside = false
  }
}
