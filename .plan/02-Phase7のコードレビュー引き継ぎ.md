# 02. Phase 7 のコードレビュー・リファクタリング 引き継ぎ

作成: 2026-10-13

Phase 7 の前半（森の空気感 + Bloom）のコードレビューとリファクタリングを、別のセッションで行うための資料。
このセッションでは、まずこのファイルを読み、続けて `00-引き継ぎメモ.md` の「Phase 7 の進め方」「Phase 7-2 で作ったもの」「Bloom」の節と、
`01-森の無限スクロールサイト実装計画.md` の付録 B-14〜16 を読む。

## 1. 対象

| 項目 | 内容 |
| --- | --- |
| PR | [kmrtmk03/forest#2](https://github.com/kmrtmk03/forest/pull/2)（`feat/phase-7-bloom` → `develop`、未マージ） |
| ブランチ | `feat/phase-7-bloom`（`develop` → `feat/phase-7-forest-atmosphere` → `feat/phase-7-bloom` の順に積み重ね。`feat/phase-7-forest-atmosphere` は push していない） |
| 差分の確認 | `git diff origin/develop...feat/phase-7-bloom`（18 ファイル、+1177 / -40） |
| コミット | `1636e3b` feat 森の空気感 / `d73a14b` docs / `d29883b` feat Bloom / `62826e1` feat 霧 / `60b249a` fix オーブを選べる距離 / `c8498ea` docs |

### 進め方の前提（ユーザーの指示がなければ、次の形を提案する）

- レビュー結果をユーザーに示し、直す項目を決めてもらってからリファクタリングする
- リファクタリング用のブランチを `feat/phase-7-bloom` から切る（例: `refactor/phase-7-review`）。PR #2 のブランチへ直接積むか、別の PR にするかはユーザーに確認する
- **見た目と挙動を変えない**。値の調整（明るさ・量など）はユーザーが決めたものなので変えない（下の「ユーザーが決めた値」を参照）
- コミットは性質ごとに分ける（`refactor` / `fix` / `docs`）。`.plan/` の更新は別コミット
- コミット・push は依頼されたときだけ。GitHub の操作は `mcp__github__*` を使う（`gh` は使わない）

## 2. 変更したファイルと役割

### 新規

| ファイル | 役割 |
| --- | --- |
| `src/experience/core/PostProcessing.ts` | Bloom。シーンを canvas に直接描き（canvas の MSAA）、`copyFramebufferToTexture` で `sceneCopy` へ写し、UnrealBloomPass（`renderToScreen = true`）で canvas へ描き直して光を足す。Bloom の間だけ `outputColorSpace` を Linear・`toneMapping` を NoToneMapping にする |
| `src/experience/world/GroundShadowMap.ts` | 配置物の根元のブロブ影。1 周分の R8 テクスチャ（横 ±40m × コース 100m、0.25m/画素 = 320×400）に CPU で円い影を描く。Forest が配置を作り直すたびに `draw` |
| `src/experience/world/LightShafts.ts` | 光芒カード。1 周 8 本を 1 つの InstancedMesh で描き、頂点シェーダーで縦軸のまわりだけカメラへ向ける |
| `src/experience/world/FloatingParticles.ts` | 浮遊粒子 450 個。粒ごとの 4 頂点の板を 1 メッシュにまとめ、カメラの周りの箱（25m、COURSE_LENGTH を割り切る）で折り返す。メッシュはカメラに付いて回る |
| `src/experience/shaders/additiveBlending.utils.ts` | 光を足すマテリアルの共通設定 `ADDITIVE_COLOR_BLENDING`（色だけ足し、アルファは描画先のまま）と `ADDITIVE_FOG_FRAGMENT`（霧の色を混ぜず明るさだけ落とす） |

### 変更

| ファイル | 変更点 |
| --- | --- |
| `src/experience/shaders/ground.frag.glsl` | 根元の影（`groundBlobShadow`）、木漏れ日（`groundDappleSpotInCell` / `groundDappleSpot`（3×3 セル）/ `groundDapple` / `groundSunfleck`） |
| `src/experience/world/Ground.ts` | 影のテクスチャ・時間の uniform を受け取る。`COLOR_PATCH`（模様 × 影）と `SUNFLECK_PATCH`（emissivemap_fragment の後で木漏れ日を足す）。ノイズのセルに木漏れ日の 2 つを追加 |
| `src/experience/world/World.ts` | 時間の共有 uniform（`timeUniform`）、上の 4 クラスの生成・更新・破棄。`update(distance, deltaSeconds)` |
| `src/experience/world/Forest.ts` | `GroundShadowMap` を受け取り、`rebuild` の最後で `draw` |
| `src/experience/Experience.ts` | 描画を `postProcessing.render` に。`renderer.info.autoReset = false` + フレームの始めに `info.reset()` |
| `src/experience/debug/Debug.ts` | Bloom フォルダ（strength / radius / threshold） |
| `src/experience/orbs/OrbManager.ts` | `PICK_MAX_DISTANCE` を `FOG_FAR` に |
| `src/experience/world/world.constants.ts` | `FOG_NEAR` 1.5m・`FOG_FAR` 34m |
| `src/experience/world/Atmosphere.ts` / `fractalTree.constants.ts` / `procedural/placement.constants.ts` | コメントのみ |

## 3. 変えてはいけない設計判断（理由つき）

リファクタリングで元に戻さないこと。詳しくは計画書の付録 B-14〜16。

1. **Bloom は EffectComposer + レンダーターゲットの MSAA にしない**。Apple の GPU（ANGLE / Metal）でレンダーターゲットの MSAA が非常に重い。MacBook 相当（1512×982・DPR 2）の 1 フレームの GPU 時間は、後処理なし 2.5ms / MSAA なし 7.7ms / MSAA 2 で 22.8ms / MSAA 4 で 43.3ms だった。MSAA を外すと葉（alphaToCoverage）の縁が荒れる
2. **Bloom は画面の色（sRGB・0〜1）で計算している**。そのため数値の意味は計画書 §16（HDR のしきい値 1.0）と違う。`outputColorSpace` / `toneMapping` の一時的な切り替えは、写した色が二重に変換されないために必要
3. **根元の影は板ポリではなくテクスチャ**（起伏に沿う・Z ファイティングなし・Draw Call 0）
4. **木漏れ日は自ら光る成分（`totalEmissiveRadiance`）として足す**。地面の色を明るくするだけでは Bloom でにじむ明るさに届かない。色は光の色と地面の色味（明るさを 1 にそろえた色）を半々に混ぜる
5. **木漏れ日はノイズのしきい値ではなく円**（ノイズでは角ばった迷彩柄になった）。縁は `(1 - t²)²` でなだらかに 0 にする（ユーザーの指摘でくっきりした縁をやめた）
6. **浮遊粒子は Points ではなく板をまとめたメッシュ**（Points には `applyCurvature` が差し込む法線のチャンクがない）
7. **光芒・粒子・木漏れ日の時間の揺らぎは往復（sin）にする**。時間で流し続けると地面が滑って見える
8. 加算合成は標準の `AdditiveBlending` を使わない（CLAUDE.md の「座標と曲げ変換」の節）

### ユーザーが決めた値（変えない）

| 値 | 場所 |
| --- | --- |
| Bloom 強さ 0.04・広がり 0.91・しきい値 0.01 | `core/PostProcessing.ts` |
| FOG_NEAR 1.5m・FOG_FAR 34m | `world/world.constants.ts` |
| 粒子の大きさ 0.025〜0.05m | `world/FloatingParticles.ts` の `PARTICLE_SIZE_RANGE` |
| 木漏れ日の半径 0.15〜0.95m・縁のなだらかな減衰 | `shaders/ground.frag.glsl` |

## 4. レビューで見てほしい点（実装した側で気になっている箇所）

優先度は目安。直すかどうかはレビューの結果とユーザーの判断で決める。

### 重複・一貫性

- **(中) 加算合成の設定の重複**: `orbs/orbFlame.utils.ts` の炎のマテリアルが、`ADDITIVE_COLOR_BLENDING` と同じ設定を自前で書いている（スコープ外として触らなかった）。共通設定へ寄せられる。炎は霧を自前のシェーダーで掛けているので `ADDITIVE_FOG_FRAGMENT` は関係ない
- **(中) 経過時間が 2 系統ある**: `World.timeUniform`（木漏れ日・光芒・粒子）と `OrbManager` の `elapsedSeconds` → `flameUniforms.uTime`（炎）が別々に dt を積算している。値は同じになるはずだが、1 つにまとめられるか検討する
- **(中) `LightShafts` と `FloatingParticles` の作りが似ている**: どちらも `MeshBasicMaterial` + `ADDITIVE_COLOR_BLENDING` + `applyCurvature` + `patchShader`（共通部分の宣言の差し込み、`fog_fragment` の置き換え、`uTime` の共有）。共通化するかは、過度な抽象化にならないかと合わせて判断する（CLAUDE.md の「将来を先回りした共通化はしない」）
- **(低) GLSL へ TS の定数を渡す方法がばらばら**: `Ground.ts` は `toGlslFloat` + `material.defines`、`FloatingParticles.ts` は `toFixed(3)` でシェーダー文字列に埋め込み、`LightShafts.ts` は GLSL の const に直書き。`toGlslFloat` は `Ground.ts` の中に閉じている
- **(低) 色・向きの値が別ファイルに重複**: `Ground.ts` の `DAPPLE_COLOR` と `LightShafts.ts` の `LIGHT_SHAFT_COLOR` は Atmosphere の `SUN_COLOR` に「寄せた」値。光芒の傾き（`LIGHT_SHAFT_LEAN = -0.18`）は `SUN_POSITION` の x が負であることにコメントで依存している

### 正しさ・堅牢さ

- **(中) `GroundShadowMap` の大きさの検証**: `SHADOW_TEXEL_SIZE` が COURSE_LENGTH を割り切ることは検証しているが、横幅（`GROUND_SHADOW_HALF_WIDTH * 2 / SHADOW_TEXEL_SIZE`）が整数になることは検証していない（今は 320 で問題ない）
- **(中) `PostProcessing.render` の UnrealBloomPass の呼び方**: `render(renderer, sceneCopy, sceneCopy, dt, false)` と writeBuffer にも `sceneCopy` を渡している（renderToScreen では使われない）。three.js の内部の流れ（入力を画面へ描き直す → 光を足す）に依存しているので、three の更新で壊れないか、型や意図が読み取れるかを見る
- **(低) `renderer.info.autoReset = false`**: Experience の `handleTick` で毎フレーム `info.reset()` している。`?debug` の表示以外で `info` を読む箇所が増えたときに気をつける
- **(低) `PICK_MAX_DISTANCE = FOG_FAR`**: デバッグ GUI で霧の距離を変えても追従しない（コメントに明記済み）
- **(低) `uTime` は float で増え続ける**: sin の往復なので数時間は問題ない見込み。長時間表示での精度は未確認
- **(低) `World` のコンストラクタの try/catch**: 生成する物が増え、途中で失敗したときの破棄の順番が長くなった。読みやすさを見る

### パフォーマンス

- **(中) 木漏れ日の 3×3 セル探索**: 地面の全画素で 9 セル × ハッシュ 4 回。測った範囲（M4 Pro）では問題なかったが、低性能の GPU では効く可能性がある。地面の `fwidth` も `groundSurfaceColor` と `groundSunfleck` で 2 回計算している
- **(低) Bloom の残りの負荷**: 2560×1440・DPR 2 で 50fps（後処理なしは 60fps）。「画面を写す」と「canvas を開き直して描き直す」の組み合わせが原因。Bloom の解像度を半分にしても変わらなかった。削るには 1 フレーム遅れの Bloom（UnrealBloomPass の描画処理を写して作り直す）が要り、three の更新で壊れやすくなるため見送った

### 未対応（リファクタリングの対象外。Phase 7 の残りや Phase 8 で扱う）

- 揺らぎを `prefers-reduced-motion` で止める（7-4）
- トーンマッピング後の Bloom の見直し（7-3）
- モバイルで Bloom を切る品質 tier（Phase 8）

## 5. 検証の手順

CLAUDE.md の「検証」の節に従う。加えて、リファクタリングの前後で見た目と速さが変わっていないことを確かめる。

1. `pnpm check`（0 件）・`pnpm build`（three の 500kB 警告は既知）・`pnpm format:check`
2. `pnpm dev`（今は `http://localhost:4322` で起動していることがある。`pnpm exec astro dev status` で確認）
3. ヘッドレス Chrome + CDP（検証用のスクリプトはスクラッチパッドに置き、リポジトリに入れない）
   - GPU で確かめるときは `--use-angle=swiftshader` を付けずに起動する（SwiftShader は 4〜5fps しか出ない）
   - 見た目の比較: リファクタリングの前に、1280×720・DPR 1 で開始直後の画面を撮っておき、後で同じ条件で撮って比べる。木漏れ日の揺れ・炎・粒子は時間で動くので、画素が完全に一致することは期待できない。平均の差（0〜255）が小さいこと（目安 5 未満）と、目視で比べる。Python に画像ライブラリがないため、比較はブラウザの canvas（`getImageData`）で行うと楽
   - ループ境界: `?debug` の「jump to s」（95m）からホイールで 0m をまたいで戻り、木漏れ日・影・光芒が同じ場所に戻ること
   - 速さ: `requestAnimationFrame` の回数で fps を測る。60fps に張り付くと差が見えないため、`Emulation.setDeviceMetricsOverride` で 2560×1440・deviceScaleFactor 2 にして比べる（今は約 50fps）
   - GPU 時間: `EXT_disjoint_timer_query_webgl2` が使える。`Page.addScriptToEvaluateOnNewDocument` で `getContext` と `requestAnimationFrame` を包み、rAF のコールバックの前後を `TIME_ELAPSED_EXT` で測る。ただし「画面を写す + Bloom」の組み合わせでは待ち合わせの時間を含んで過大に出たので、fps の測定と合わせて判断する
   - コンソールのエラーは favicon.ico の 404 だけであること
4. オーブのクリックで `forest:orb-select` が出てモーダルが開くこと、デバッグ GUI で seed を変えると根元の影が描き直されること

### 開発サーバーの注意

`three/addons` の import を足したり外したりした直後は、Vite が依存を作り直し、`?debug` の lil-gui の読み込みが 504（Outdated Optimize Dep）で失敗して「3D 表示を開始できませんでした」になることがある。開発サーバーの再起動（`pnpm exec astro dev stop` → `pnpm dev`）とブラウザのキャッシュの破棄で直る。コードの不具合ではない。

## 6. 終わったら

- `00-引き継ぎメモ.md` の状態欄・「次にやること」と、リファクタリングの内容を更新する
- 設計を変えた場合は計画書の付録 B に追記する
- このファイル（02）は、レビューが終わったら「完了」と書き足すか、ユーザーに確認して削除する
