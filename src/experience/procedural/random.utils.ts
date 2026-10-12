/**
 * seed 付きの決定的な乱数。同じ seed からは必ず同じ列が出るため、リロードしても同じ場所に同じ物が置かれる。
 * Three.js に依存しない純関数だけを置く。
 */

/** 32bit 整数の掛け算に使う定数（xxHash 系の素数） */
const HASH_PRIME_A = 0x27d4eb2d
const HASH_PRIME_B = 0x165667b1
const HASH_PRIME_C = 0x85ebca77
const HASH_PRIME_D = 0xc2b2ae3d

/** 32bit 符号なし整数を 0 以上 1 未満の小数へ変換する除数（2^32） */
const UINT32_RANGE = 2 ** 32

/**
 * 2 つの整数（セル番号など）と seed から、32bit 符号なし整数のハッシュを作る。
 * 隣り合うセル番号でも結果が大きく変わるよう、掛け算とビットシフトで十分に混ぜる
 * @param a 1 つ目の整数（例: 横方向のセル番号。負数でもよい）
 * @param b 2 つ目の整数（例: コース方向のセル番号。円環にするなら呼び出し側で折り返してから渡す）
 * @param seed 世界の seed
 */
export const hash2 = (a: number, b: number, seed: number): number => {
  let hash = Math.imul(seed | 0, HASH_PRIME_A)
  hash = Math.imul(hash ^ (a | 0), HASH_PRIME_B)
  hash = Math.imul(hash ^ (b | 0), HASH_PRIME_C)
  hash ^= hash >>> 15
  hash = Math.imul(hash, HASH_PRIME_D)
  hash ^= hash >>> 13
  return hash >>> 0
}

/** hash2 の結果を 0 以上 1 未満の小数にする */
export const hash2ToUnit = (a: number, b: number, seed: number): number =>
  hash2(a, b, seed) / UINT32_RANGE

/**
 * mulberry32: 32bit の状態を持つ軽量な疑似乱数生成器。
 * 返す関数を呼ぶたびに、0 以上 1 未満の小数を順に返す（呼んだ回数だけ状態が進む）
 * @param seed 初期状態（hash2 で作ったセルごとの seed を渡す）
 */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE
  }
}

/**
 * min 以上 max 未満の一様乱数
 * @param random mulberry32 が返した関数
 */
export const randomRange = (random: () => number, min: number, max: number): number =>
  min + (max - min) * random()

/**
 * 重みに比例した確率で添字を選ぶ
 * @param random mulberry32 が返した関数
 * @param weights 各候補の重み（0 以上。合計が 0 より大きいこと）
 * @returns 選ばれた候補の添字
 */
export const pickWeightedIndex = (random: () => number, weights: readonly number[]): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let threshold = random() * total
  for (let index = 0; index < weights.length; index++) {
    threshold -= weights[index]
    if (threshold < 0) return index
  }
  // 浮動小数の誤差で最後まで残った場合は、最後の候補にする
  return weights.length - 1
}
