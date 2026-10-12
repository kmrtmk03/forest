import { MathUtils } from "three"

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
} from "./placement.type"
import { hash2, mulberry32, pickWeightedIndex, randomRange } from "./random.utils"

/** 1 周のチャンク数（COURSE_LENGTH = 100、CHUNK_LENGTH = 5 なら 20） */
export const CHUNK_COUNT = COURSE_LENGTH / CHUNK_LENGTH

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

  return {
    kind: rule.kind,
    variant,
    x,
    s,
    height: groundHeight(x, s) - rule.rootSink,
    rotationY,
    scale,
    tilt,
    tint,
  }
}

/**
 * 1 周分のすべての配置物を生成し、チャンクごとに分けて返す（計画書 §11-3 のジッター付きグリッド + 密度関数）。
 * 起動時と seed の変更時に 1 回だけ呼ぶ。毎フレーム呼ばないこと
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
