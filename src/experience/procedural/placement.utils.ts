import { MathUtils } from "three"

import { assertDividesCourseLength, wrapSignedCourse } from "@/experience/world/course.utils"
import { CHUNK_LENGTH, COURSE_LENGTH } from "@/experience/world/world.constants"

import { periodicValueNoise } from "./noise.utils"
import { groundHeight, pathX } from "./path.utils"
import {
  CLEARING_NOISE_CELL,
  CLEARING_NOISE_HIGH,
  CLEARING_NOISE_LOW,
  CLEARING_SEED_OFFSET,
  PLACEMENT_RULES,
} from "./placement.constants"
import type {
  IPlacementRule,
  IPropPlacement,
  TDensityPoint,
  TPlacementChunks,
  TPropKind,
} from "./placement.type"
import { hash2, mulberry32, pickWeightedIndex, randomRange } from "./random.utils"

/** 1 周のチャンク数（COURSE_LENGTH = 100、CHUNK_LENGTH = 5 なら 20） */
export const CHUNK_COUNT = COURSE_LENGTH / CHUNK_LENGTH

/** 種類ごとの clearance（近い物を探すときに、相手の種類から引く） */
const CLEARANCE_BY_KIND = new Map<TPropKind, number>(
  PLACEMENT_RULES.map(({ kind, clearance }) => [kind, clearance]),
)

/**
 * 配置の設定が 1 周の長さと矛盾していないか検証する。配置を生成する前（起動時）に一度だけ呼ぶこと。
 * 割り切れないチャンク長だと、チャンクの配列の長さが切り捨てられて範囲外へ書き込んでしまい、
 * 割り切れないセル幅だと、0m 付近でセルが重なったり抜けたりする
 * @throws 設定が矛盾している場合
 */
export const assertPlacementSettings = (): void => {
  assertDividesCourseLength("placement: CHUNK_LENGTH", CHUNK_LENGTH)
  assertDividesCourseLength("placement: CLEARING_NOISE_CELL", CLEARING_NOISE_CELL)
  PLACEMENT_RULES.forEach(({ kind, cellSize, clearance }) => {
    assertDividesCourseLength(`placement: ${kind} の cellSize`, cellSize)
    // 近い物は前後のチャンクだけから探すため、2 つの物の clearance の合計がチャンク長を超えてはいけない
    if (clearance * 2 > CHUNK_LENGTH) {
      throw new Error(
        `placement: ${kind} の clearance（${clearance}m）が CHUNK_LENGTH の半分を超えています`,
      )
    }
  })
}

/**
 * 道からの距離に応じた基本密度を、対応点の間の直線補間で求める。
 * 最初の点より近い・最後の点より遠い場合は、端の点の密度を使う
 */
const sampleDensityCurve = (curve: readonly TDensityPoint[], distance: number): number => {
  const [firstDistance, firstDensity] = curve[0]
  if (distance <= firstDistance) return firstDensity

  for (let index = 1; index < curve.length; index++) {
    const [toDistance, toDensity] = curve[index]
    if (distance > toDistance) continue
    const [fromDistance, fromDensity] = curve[index - 1]
    const t = (distance - fromDistance) / (toDistance - fromDistance)
    return MathUtils.lerp(fromDensity, toDensity, t)
  }
  return curve[curve.length - 1][1]
}

/**
 * 空き地による間引きの倍率（0〜1）。ノイズが低い場所ほど小さくなり、林の濃淡と空き地ができる
 * @param strength IPlacementRule.clearingStrength
 */
const sampleClearingFactor = (x: number, s: number, strength: number, seed: number): number => {
  if (strength === 0) return 1
  const noise = periodicValueNoise(x, s, CLEARING_NOISE_CELL, seed + CLEARING_SEED_OFFSET)
  const openness = MathUtils.smoothstep(noise, CLEARING_NOISE_LOW, CLEARING_NOISE_HIGH)
  return MathUtils.lerp(1 - strength, 1, openness)
}

/**
 * 1 つのセルに置く配置物を決める。置かない場合は null を返す。
 * 乱数はセル番号と seed だけから作るため、同じ seed なら必ず同じ結果になる。
 * MEMO: 乱数を引く順番を変えると森全体が変わる。引く値を増やすときは最後に足すこと
 * @param cellX 横方向のセル番号（負数あり）
 * @param cellS コース方向のセル番号（0 以上、1 周のセル数未満）
 */
const placeInCell = (
  rule: IPlacementRule,
  cellX: number,
  cellS: number,
  seed: number,
): IPropPlacement | null => {
  const random = mulberry32(hash2(cellX, cellS, seed + rule.seedOffset))

  // セルの中心からランダムにずらす。s は 1 周で折り返して [0, COURSE_LENGTH) に収める
  const jitter = rule.cellSize * rule.jitterRatio
  const x = (cellX + 0.5) * rule.cellSize + randomRange(random, -jitter, jitter)
  const s = MathUtils.euclideanModulo(
    (cellS + 0.5) * rule.cellSize + randomRange(random, -jitter, jitter),
    COURSE_LENGTH,
  )

  // 除外: 道に近すぎる・遠すぎる場所には置かない（ずらした後の位置で判定する）
  const distanceFromPath = Math.abs(x - pathX(s))
  if (distanceFromPath < rule.minDistanceFromPath) return null
  if (distanceFromPath > rule.maxDistanceFromPath) return null
  // TODO: Phase 5 でオーブの周囲（s ± 3m、道から 3m 以内）を除外する

  // 密度: 帯ごとの基本密度 × 空き地の間引きを確率として使う
  const density =
    sampleDensityCurve(rule.densityCurve, distanceFromPath) *
    sampleClearingFactor(x, s, rule.clearingStrength, seed)
  if (random() >= density) return null

  // 個体差
  const variant = pickWeightedIndex(random, rule.variantWeights)
  const rotationY = random() * Math.PI * 2
  const scale = randomRange(random, ...rule.scaleRange)
  const tilt = MathUtils.degToRad(randomRange(random, -rule.maxTiltDegrees, rule.maxTiltDegrees))
  const tint = randomRange(random, ...rule.tintRange)
  const heightScale = randomRange(random, ...rule.heightScaleRange)

  return {
    kind: rule.kind,
    variant,
    x,
    s,
    height: groundHeight(x, s) - rule.rootSink,
    rotationY,
    scale,
    heightScale,
    tilt,
    tint,
  }
}

/**
 * すでに置いた物のどれかに近すぎるか判定する。
 * 自分のチャンクと前後のチャンクだけを調べる（clearance の合計はチャンク長以下に検証済み）。
 * 1 周の境界をまたぐ距離は、折り返した差で測る
 * @param chunks これまでに置いた配置
 * @param candidate 置こうとしている物
 * @param clearance 置こうとしている物の clearance（m）
 */
const isTooCloseToPlaced = (
  chunks: TPlacementChunks,
  candidate: IPropPlacement,
  clearance: number,
): boolean => {
  const chunk = Math.floor(candidate.s / CHUNK_LENGTH)
  for (let offset = -1; offset <= 1; offset++) {
    const neighbors = chunks[MathUtils.euclideanModulo(chunk + offset, CHUNK_COUNT)]
    const isTooClose = neighbors.some((other) => {
      const minDistance = clearance + (CLEARANCE_BY_KIND.get(other.kind) ?? 0)
      const deltaX = other.x - candidate.x
      const deltaS = wrapSignedCourse(other.s - candidate.s)
      return deltaX * deltaX + deltaS * deltaS < minDistance * minDistance
    })
    if (isTooClose) return true
  }
  return false
}

/**
 * 1 周分のすべての配置物を生成し、チャンクごとに分けて返す（計画書 §11-3 のジッター付きグリッド + 密度関数）。
 * PLACEMENT_RULES の順（木 → 岩）に置き、後から置く物ほど先に置いた物を避ける。
 * 起動時と seed の変更時に 1 回だけ呼ぶ。毎フレーム呼ばないこと。事前に assertPlacementSettings で設定を検証すること
 * @param seed 世界の seed
 * @returns 添字がチャンク番号（0〜CHUNK_COUNT - 1）の配列
 */
export const generatePlacements = (seed: number): TPlacementChunks => {
  const chunks: TPlacementChunks = Array.from({ length: CHUNK_COUNT }, () => [])

  PLACEMENT_RULES.forEach((rule) => {
    const cellCountS = COURSE_LENGTH / rule.cellSize
    // 横方向は道の両側に、最大距離を覆うだけのセルを並べる（蛇行の振幅ぶんは除外判定で吸収する）
    const cellReachX = Math.ceil(rule.maxDistanceFromPath / rule.cellSize)

    for (let cellS = 0; cellS < cellCountS; cellS++) {
      for (let cellX = -cellReachX; cellX < cellReachX; cellX++) {
        const placement = placeInCell(rule, cellX, cellS, seed)
        if (!placement) continue
        if (isTooCloseToPlaced(chunks, placement, rule.clearance)) continue
        // s は [0, COURSE_LENGTH) に折り返し済みなので、チャンク番号は範囲内に収まる
        chunks[Math.floor(placement.s / CHUNK_LENGTH)].push(placement)
      }
    }
  })

  return chunks
}

/**
 * カメラのいるチャンクを基準に、描画するチャンク番号を前方・後方の順に列挙する。
 * 1 周の境界をまたぐときは折り返す（例: 20 チャンクでカメラが 19 番なら、後方 18 → 19 → 0 → 1 …）
 * @param cameraChunk カメラのいるチャンク番号（0〜CHUNK_COUNT - 1）
 * @param behind カメラより後方に含めるチャンク数
 * @param ahead カメラより前方に含めるチャンク数
 */
export const listVisibleChunks = (cameraChunk: number, behind: number, ahead: number): number[] =>
  Array.from({ length: behind + 1 + ahead }, (_, index) =>
    MathUtils.euclideanModulo(cameraChunk - behind + index, CHUNK_COUNT),
  )
