import type { TOrbId } from "@/data/orb.type"

/**
 * Three.js と HTML（モーダル・一覧）をつなぐ CustomEvent の定義（計画書 §14-1）。
 * イベントはすべて window に dispatch する。イベント名の文字列を直接書かず、ここの定数とヘルパーを使うこと。
 * MEMO: モーダルの開閉を伝える forest:modal-change は、使い始める Phase 6 で追加する
 */

/** オーブが選ばれた（3D 上のクリック・タップ、Phase 6 の一覧のボタン） */
export const ORB_SELECT_EVENT = "forest:orb-select"

/** forest:orb-select の detail */
export interface IOrbSelectDetail {
  orbId: TOrbId
}

declare global {
  interface WindowEventMap {
    [ORB_SELECT_EVENT]: CustomEvent<IOrbSelectDetail>
  }
}

/**
 * forest:orb-select を window に dispatch する
 * @param orbId 選ばれたオーブの ID
 */
export const dispatchOrbSelect = (orbId: TOrbId): void => {
  window.dispatchEvent(new CustomEvent(ORB_SELECT_EVENT, { detail: { orbId } }))
}
