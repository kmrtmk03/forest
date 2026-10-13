import type { ImageMetadata } from "astro"

/**
 * オーブのコンテンツの型。Astro（モーダル・一覧）と Three.js（オーブの描画）の両方から参照する。
 */

/** オーブ ID。データの追加時に表記揺れを防ぐため、"orb-" で始まる文字列に限る */
export type TOrbId = `orb-${string}`

/** オーブに紐づくモーダルのコンテンツ */
export interface IOrbContent {
  id: TOrbId
  /** 3D 上・一覧に出す短いラベル（例: "Orb 01"） */
  label: string
  title: string
  /** 段落ごとの本文 */
  body: string[]
  /** モーダルに出す画像。src/assets 配下を import して渡す（astro:assets で最適化する） */
  image?: {
    src: ImageMetadata
    alt: string
  }
  /** オーブの色（CSS の色文字列。未指定なら既定の色） */
  color?: string
}

/**
 * Three.js 側（オーブの描画）へ渡す最小限の情報。
 * 本文や画像はモーダル用に Astro がビルド時に HTML 化するため、クライアントのバンドルには含めない
 */
export type TOrbMarker = Pick<IOrbContent, "id" | "label" | "color">
