import type { IOrbContent } from "./orb.type"

/**
 * オーブのコンテンツ（仮データ）。並び順がそのままコース上の並び順になる（0 番目が s = 5m）。
 * 件数は 1 周の長さ ÷ オーブの間隔（COURSE_LENGTH 100m ÷ ORB_SPACING 10m = 10 件）と一致させること。
 * 一致しないと起動時に OrbManager が例外を投げる
 * TODO: Phase 6 でモーダルの本文・画像を本番の内容に差し替える
 */
export const ORB_CONTENTS = [
  {
    id: "orb-01",
    label: "Orb 01",
    title: "仮のタイトル 01",
    body: ["ここにオーブ 01 の本文が入ります。"],
    color: "#ffd27a",
  },
  {
    id: "orb-02",
    label: "Orb 02",
    title: "仮のタイトル 02",
    body: ["ここにオーブ 02 の本文が入ります。"],
    color: "#9fe7ff",
  },
  {
    id: "orb-03",
    label: "Orb 03",
    title: "仮のタイトル 03",
    body: ["ここにオーブ 03 の本文が入ります。"],
    color: "#ffb3c7",
  },
  {
    id: "orb-04",
    label: "Orb 04",
    title: "仮のタイトル 04",
    body: ["ここにオーブ 04 の本文が入ります。"],
    color: "#c6ff9e",
  },
  {
    id: "orb-05",
    label: "Orb 05",
    title: "仮のタイトル 05",
    body: ["ここにオーブ 05 の本文が入ります。"],
    color: "#d7b8ff",
  },
  {
    id: "orb-06",
    label: "Orb 06",
    title: "仮のタイトル 06",
    body: ["ここにオーブ 06 の本文が入ります。"],
    color: "#ffd27a",
  },
  {
    id: "orb-07",
    label: "Orb 07",
    title: "仮のタイトル 07",
    body: ["ここにオーブ 07 の本文が入ります。"],
    color: "#9fe7ff",
  },
  {
    id: "orb-08",
    label: "Orb 08",
    title: "仮のタイトル 08",
    body: ["ここにオーブ 08 の本文が入ります。"],
    color: "#ffb3c7",
  },
  {
    id: "orb-09",
    label: "Orb 09",
    title: "仮のタイトル 09",
    body: ["ここにオーブ 09 の本文が入ります。"],
    color: "#c6ff9e",
  },
  {
    id: "orb-10",
    label: "Orb 10",
    title: "仮のタイトル 10",
    body: ["ここにオーブ 10 の本文が入ります。"],
    color: "#d7b8ff",
  },
] as const satisfies readonly IOrbContent[]
