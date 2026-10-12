import type { BufferGeometry, Material } from "three"

import type { TPropKind } from "@/experience/procedural/placement.type"

/** 配置物のモデルを構成する部品（幹・葉など）。部品ごとに 1 つの InstancedMesh で描く */
export interface IPropModelPart {
  /** 根元の中心を原点、Y-up、1 単位 = 1m のジオメトリ */
  geometry: BufferGeometry
  /** applyCurvature を適用済みのマテリアル */
  material: Material
}

/**
 * 配置物のモデル。配置データの (kind, variant) と対応づけて描く。
 * 今は仮のプリミティブ形状（primitivePropModels.utils.ts）で作る。
 * TODO: AssetManager で GLB を読み込めるようになったら、同じ形で返して差し替える（計画書 付録 A）
 */
export interface IPropModel {
  kind: TPropKind
  /** 同じ kind 内のモデル番号。placement.constants.ts の variantWeights の添字と対応する */
  variant: number
  parts: readonly IPropModelPart[]
}
