import type { TOrbId } from "@/data/orb.type"

/**
 * Three.js と HTML（モーダル・一覧）をつなぐ CustomEvent の定義（計画書 §14-1）。
 * イベントはすべて window に dispatch する。イベント名の文字列を直接書かず、ここの定数とヘルパーを使うこと。
 */

/** オーブが選ばれた（3D 上のクリック・タップ、OrbList のボタン）。OrbModal が受け取って開く */
export const ORB_SELECT_EVENT = "forest:orb-select"

/**
 * モーダルが開いた・閉じた。Experience が受け取って移動を止める・再開する。
 * 停止の起点をモーダルの開閉に一本化し、どこから開いても同じように止まるようにする
 */
export const MODAL_CHANGE_EVENT = "forest:modal-change"

/** forest:orb-select の detail */
export interface IOrbSelectDetail {
  orbId: TOrbId
}

/** forest:modal-change の detail */
export interface IModalChangeDetail {
  /** モーダルが開いているか */
  isOpen: boolean
  /** 表示中のオーブの ID。閉じたときは null */
  orbId: TOrbId | null
}

declare global {
  interface WindowEventMap {
    [ORB_SELECT_EVENT]: CustomEvent<IOrbSelectDetail>
    [MODAL_CHANGE_EVENT]: CustomEvent<IModalChangeDetail>
  }
}

/**
 * forest:orb-select を window に dispatch する
 * @param orbId 選ばれたオーブの ID
 */
export const dispatchOrbSelect = (orbId: TOrbId): void => {
  window.dispatchEvent(new CustomEvent(ORB_SELECT_EVENT, { detail: { orbId } }))
}

/**
 * forest:modal-change を window に dispatch する
 * @param detail 開閉の状態と、表示中のオーブの ID（閉じたときは null）
 */
export const dispatchModalChange = (detail: IModalChangeDetail): void => {
  window.dispatchEvent(new CustomEvent(MODAL_CHANGE_EVENT, { detail }))
}
