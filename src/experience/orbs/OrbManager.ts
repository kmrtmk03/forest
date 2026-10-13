import {
  Color,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three"
import type { Camera, Intersection, Object3D, ShaderMaterial } from "three"

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
import {
  createOrbFlameGeometry,
  createOrbFlameMaterial,
  createOrbFlameSharedUniforms,
} from "./orbFlame.utils"
import type { IOrbFlameSharedUniforms } from "./orbFlame.utils"

// ---- 見た目 ----

/** データに色の指定がないときの炎の色（参考画像の青白い炎に近い水色） */
const ORB_DEFAULT_COLOR = "#8fd8ff"

/** 板の向きを決めるときに、カメラがほぼ真上・真下にいて向きが定まらないとみなす長さの 2 乗 */
const BILLBOARD_MIN_LENGTH_SQ = 1e-8

// ---- 動き ----

/** 上下の浮遊の振幅（m）と周期（秒）。計画書 §12 */
const ORB_BOB_AMPLITUDE = 0.12
const ORB_BOB_PERIOD = 3

/**
 * オーブごとの個体差の種をずらす量（黄金角）。浮遊の位相（ラジアン）と炎のノイズのずらし量の両方に使い、
 * 隣り合うオーブが同じタイミングで上下したり、同じように揺らいだりしないようにする。
 * 位置ではなく並び順で決めるため、1 周の境界でも途切れない
 */
const ORB_VARIATION_STEP = Math.PI * (3 - Math.sqrt(5))

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

/**
 * クリック判定用の球の半径（m）。中心は火の玉の中心。
 * 見た目より大きくして押しやすくする（計画書 §13）。炎を 1.5 倍にしたのに合わせて 0.5m から 1.5 倍にした
 */
const ORB_HIT_RADIUS = 0.75

/** クリックとして受け付ける最も遠い距離（m、カメラからの直線距離）。霧が濃く見えにくいオーブは選ばせない */
const PICK_MAX_DISTANCE = 40

/** 押してから離すまでの移動量（px）と時間（ms）がこれ未満のときだけクリックとみなす（スワイプ移動を除くため） */
const CLICK_MAX_MOVE_PX = 6
const CLICK_MAX_DURATION_MS = 400

/** ホバー中のオーブの拡大率と明るさの倍率 */
const ORB_HOVER_SCALE = 1.15
const ORB_HOVER_INTENSITY = 1.4

/** 判定用の球の分割数（横・縦）。描画しないので粗くてよい */
const HIT_WIDTH_SEGMENTS = 12
const HIT_HEIGHT_SEGMENTS = 8

/** 1 個のオーブの描画用のデータ */
interface IOrb {
  id: TOrbId
  slot: IOrbSlot
  /** 炎の板と判定用の球をまとめたグループ。位置・向き・大きさはこれに設定する */
  group: Group
  /** 炎のマテリアル（オーブごとに色と乱数の種が違う） */
  flameMaterial: ShaderMaterial
  /** クリック判定用の球（描画しない） */
  hit: Mesh
  /** 個体差の種。浮遊の位相（ラジアン）と、炎のノイズのずらし量に使う */
  variation: number
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
  /** クリック・ホバーの判定と、炎の板をカメラへ向けるのに使うカメラ */
  camera: Camera
  /** 曲げ変換の共有 uniform。カメラのコース位置と惑星半径を読む（World が毎フレーム更新する） */
  curvatureUniforms: ICurvatureUniforms
  /** オーブの描画用データ。並び順がコース上の並び順になる */
  markers: readonly TOrbMarker[]
}

/**
 * コース上のオーブの配置・浮遊・クリック判定を行う（計画書 §12・§13）。
 * 見た目は板ポリに描く魂の炎（orbFlame.utils.ts）。
 * TODO: Phase 7 で光の粒と Bloom を足す
 *
 * オーブは数が少ないため InstancedMesh にせず、1 個ずつ Mesh を作る。
 * 位置はシェーダーで曲げず、TS 版の曲げ変換（curvaturePosition）で毎フレーム CPU で求める。
 * そのため通常の Raycaster でクリック・ホバーを判定できる。
 *
 * 毎フレーム、World の update（曲げ変換の uniform の更新）の後、描画の前に update(dt) を呼ぶこと。
 * 呼ばないとオーブが動かず、ホバーの判定も更新されない。
 * クリックされたオーブは forest:orb-select（orb.events.ts）で知らせる。
 * setEnabled(false) の間はクリック・ホバーを受け付けない（モーダル表示中に使う）。
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
  private readonly flameGeometry: PlaneGeometry
  private readonly flameUniforms: IOrbFlameSharedUniforms = createOrbFlameSharedUniforms()
  private readonly hitGeometry: SphereGeometry
  private readonly hitMaterial: MeshBasicMaterial

  /** 経過時間（秒）。浮遊の動きに使う。位置に依存させないため、ループの境界でも途切れない */
  private elapsedSeconds = 0
  private hoveredOrb: IOrb | null = null
  /** マウスが要素の上にあるか。ないときはホバーの判定をしない */
  private isPointerInside = false
  /** マウスの最後の位置（clientX, clientY）。ホバーの判定にだけ使う */
  private readonly hoverPointer = new Vector2()
  /** 押している最中のポインタ。押していないときは null */
  private press: IPointerPress | null = null
  /** クリック・ホバーを受け付けるか（setEnabled を参照） */
  private isEnabled = true

  // 毎フレームの処理で使い回す作業用オブジェクト（毎回 new しない）
  private readonly relative = new Vector3()
  private readonly billboardUp = new Vector3()
  private readonly billboardNormal = new Vector3()
  private readonly billboardRight = new Vector3()
  private readonly billboardBasis = new Matrix4()
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
    // 先に間隔を検証する（割り切れないと ORB_COUNT が整数にならず、件数のエラーが紛らわしくなるため）
    const slots = listOrbSlots()
    if (markers.length !== ORB_COUNT) {
      throw new Error(
        `OrbManager: オーブのデータが ${markers.length} 件ですが、1 周に置くオーブは ${ORB_COUNT} 個です`,
      )
    }

    this.host = host
    this.camera = camera
    this.curvatureUniforms = curvatureUniforms
    this.raycaster.far = PICK_MAX_DISTANCE

    // 形は全オーブで共有し、色を変えるマテリアルだけを 1 個ずつ作る
    this.flameGeometry = createOrbFlameGeometry()
    this.hitGeometry = new SphereGeometry(ORB_HIT_RADIUS, HIT_WIDTH_SEGMENTS, HIT_HEIGHT_SEGMENTS)
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

    // 炎の揺らぎの時間。霧の距離は three.js がマテリアルの fog: true で入れる
    this.flameUniforms.uTime.value = this.elapsedSeconds

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
        Math.sin((Math.PI * 2 * this.elapsedSeconds) / ORB_BOB_PERIOD + orb.variation) *
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
      this.faceCamera(orb.group, planetRadius)
      orb.group.scale.setScalar(shrink * (orb === this.hoveredOrb ? ORB_HOVER_SCALE : 1))
      // 同じフレームのうちにクリック・ホバーを判定できるよう、行列をすぐ更新する（描画時の更新を待たない）
      orb.group.updateMatrixWorld()
      this.visibleHits.push(orb.hit)
    })

    // オーブもカメラも動くため、マウスが止まっていても毎フレーム判定し直す（10 個の球なので軽い）
    this.setHoveredOrb(
      this.isEnabled && this.isPointerInside
        ? this.pickOrb(this.hoverPointer.x, this.hoverPointer.y)
        : null,
    )
  }

  /**
   * クリック・ホバーの受け付けを切り替える。止めるときはホバーの強調とカーソルをすぐ戻し、
   * 押している最中の操作も捨てる（モーダルの背面でオーブが光ったまま残らないようにするため）
   * @param isEnabled true で受け付ける、false で無視する
   */
  setEnabled(isEnabled: boolean): void {
    this.isEnabled = isEnabled
    if (isEnabled) return

    this.press = null
    this.setHoveredOrb(null)
  }

  /** ジオメトリ・マテリアルを破棄し、カーソルを元に戻す。リスナーは Experience の abort() で外れる */
  dispose(): void {
    this.flameGeometry.dispose()
    this.hitGeometry.dispose()
    this.hitMaterial.dispose()
    this.orbs.forEach(({ flameMaterial }) => flameMaterial.dispose())
    this.group.clear()
    this.host.style.cursor = ""
  }

  /** 1 個のオーブ（炎の板・判定用の球）を作り、グループへ追加する */
  private createOrb(slot: IOrbSlot, marker: TOrbMarker): IOrb {
    const variation = slot.index * ORB_VARIATION_STEP
    const flameMaterial = createOrbFlameMaterial(
      this.flameUniforms,
      new Color(marker.color ?? ORB_DEFAULT_COLOR),
      variation,
    )

    const flame = new Mesh(this.flameGeometry, flameMaterial)
    const hit = new Mesh(this.hitGeometry, this.hitMaterial)
    const group = new Group()
    group.add(flame, hit)
    // 最初は表示したままにしておく。compileAsync は表示中の物だけをコンパイルするため、
    // 非表示にすると、オーブが初めて描画範囲に入ったときにシェーダーのコンパイルでカクつく。
    // 描画は最初の update の後なので、この時点の位置（原点）で描かれることはない
    this.group.add(group)

    const orb: IOrb = {
      id: marker.id,
      slot,
      group,
      flameMaterial,
      hit,
      variation,
    }
    this.orbByHit.set(hit, orb)
    return orb
  }

  /**
   * 炎の板をカメラへ向ける。板の縦軸はその場所での惑星の真上（球の中心から外向き）に固定し、
   * その軸のまわりだけ回す。炎が惑星の曲面に対してまっすぐ立ち、どの向きから見ても炎の形に見える
   * @param group 位置を設定済みのオーブのグループ
   * @param planetRadius 見た目の惑星半径（m）。球の中心は (0, -planetRadius, 0)
   */
  private faceCamera(group: Group, planetRadius: number): void {
    const up = this.billboardUp.copy(group.position)
    up.y += planetRadius
    up.normalize()

    // カメラへの向きを、縦軸に垂直な面へ落としたものを板の表（+Z）にする
    const normal = this.billboardNormal.subVectors(this.camera.position, group.position)
    normal.addScaledVector(up, -normal.dot(up))
    // カメラが真上・真下にいると向きが決まらないため、前のフレームの向きのままにする
    if (normal.lengthSq() < BILLBOARD_MIN_LENGTH_SQ) return
    normal.normalize()

    const right = this.billboardRight.crossVectors(up, normal)
    group.quaternion.setFromRotationMatrix(this.billboardBasis.makeBasis(right, up, normal))
  }

  /**
   * 画面上の位置にあるオーブを探す。いま描画しているオーブだけを対象にし、最も手前のものを返す
   * @param clientX ポインタの位置（clientX）
   * @param clientY ポインタの位置（clientY）
   */
  private pickOrb(clientX: number, clientY: number): IOrb | null {
    // 描画範囲にオーブがない区間では、要素の位置の取得も光線の計算もしない
    if (this.visibleHits.length === 0) return null

    const rect = this.host.getBoundingClientRect()
    // 要素が表示されていない（サイズ 0）ときは判定しない
    if (rect.width === 0 || rect.height === 0) return null

    // 要素内の位置を正規化デバイス座標（-1〜1、上が +）に直す
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    this.intersections.length = 0
    this.raycaster.intersectObjects(this.visibleHits, false, this.intersections)

    const nearest = this.intersections[0]
    return nearest ? (this.orbByHit.get(nearest.object) ?? null) : null
  }

  /** ホバー中のオーブを切り替え、明るさとカーソルを反映する。大きさは次の update で反映される */
  private setHoveredOrb(orb: IOrb | null): void {
    if (orb === this.hoveredOrb) return

    if (this.hoveredOrb) this.hoveredOrb.flameMaterial.uniforms.uIntensity.value = 1
    if (orb) orb.flameMaterial.uniforms.uIntensity.value = ORB_HOVER_INTENSITY
    this.hoveredOrb = orb
    this.host.style.cursor = orb ? "pointer" : ""
  }

  /** 押した位置と時刻を覚える。主ボタン（タッチ・ペンの接触を含む）以外は無視する */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.isEnabled || !event.isPrimary || event.button !== 0) return
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

    // ホバー用のマウスの位置（hoverPointer）は書き換えない。タッチのタップでホバーの位置がずれないようにする
    const orb = this.pickOrb(event.clientX, event.clientY)
    if (orb) dispatchOrbSelect(orb.id)
  }

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.press?.pointerId === event.pointerId) this.press = null
  }

  /** マウスの位置を覚える。判定は update でフレームごとに 1 回だけ行う。タッチ・ペンにはホバーがないので無視する */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    this.hoverPointer.set(event.clientX, event.clientY)
    this.isPointerInside = true
  }

  private readonly handlePointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return
    this.isPointerInside = false
  }
}
