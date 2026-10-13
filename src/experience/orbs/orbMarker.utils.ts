import type { TOrbId, TOrbMarker } from "@/data/orb.type"

/** オーブ ID の接頭辞（TOrbId のテンプレートリテラル型と同じ） */
const ORB_ID_PREFIX = "orb-"

/** オーブ ID の形（"orb-" で始まる文字列）か判定する */
const isOrbId = (value: unknown): value is TOrbId =>
  typeof value === "string" && value.startsWith(ORB_ID_PREFIX)

/**
 * オーブの描画用データ（TOrbMarker）の形か判定する。
 * data 属性の JSON はビルド時に Astro が書き出すが、HTML を経由するため型の保証がない。
 * 形が崩れたまま描画に進むと原因が分かりにくいため、受け取った時点で検証する
 */
const isOrbMarker = (value: unknown): value is TOrbMarker => {
  if (typeof value !== "object" || value === null) return false
  if (!("id" in value) || !isOrbId(value.id)) return false
  if (!("label" in value) || typeof value.label !== "string") return false
  // color は省略できる（JSON.stringify は undefined のキーを書き出さない）
  return !("color" in value) || typeof value.color === "string"
}

/**
 * <forest-experience data-orbs="..."> の JSON を、オーブの描画用データの配列に変換する
 * @param json data-orbs 属性の値
 * @throws 属性がない場合、JSON として読めない場合、形が TOrbMarker[] でない場合
 */
export const parseOrbMarkers = (json: string | undefined): TOrbMarker[] => {
  if (json === undefined) throw new Error("parseOrbMarkers: data-orbs 属性がありません")

  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed) || !parsed.every(isOrbMarker)) {
    throw new Error("parseOrbMarkers: data-orbs の形が正しくありません")
  }
  return parsed
}
