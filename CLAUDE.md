# Forest プロジェクト設定

Astro と素の Three.js で作る「小さな惑星の森を、スクロールで無限に歩く」サイト。
グローバル設定（`~/.claude/CLAUDE.md`）を土台に、このプロジェクト固有の前提とルールをまとめる。両者が矛盾する場合は、このファイルを優先する。

## 最初に読むもの

セッションを始めたら、作業に入る前に次の順で読む。

1. `.plan/00-引き継ぎメモ.md`: 現在の進捗、決定事項、次にやること
2. `.plan/01-森の無限スクロールサイト実装計画.md`: 設計書。付録 B に、本文の後で変わった決定（惑星半径・コース長など）がある
3. `.memo/プロンプト/最初のプロンプト.md`: 元の要件（必要なときだけ）

Phase を進めたり方針を決めたりしたら、引き継ぎメモの状態欄と決定事項を更新する。計画書の本文と違う決定をした場合は、付録 B に追記する。

## 最重要原則

迷ったら、この 5 つに立ち返る。

1. 書く前に読む: 変更対象と周辺コードを理解してから実装する
2. 既存に合わせる: 自分の好みより、コードベースの既存パターンを優先する
3. スコープを守る: 依頼されたことだけを、依頼された範囲で行う。計画書の Phase を先取りしない
4. 終わる前に見直す: 依頼文と自分の差分を照合してから完了を宣言する
5. 正直に報告する: 検証結果・失敗・スキップした確認を、そのまま伝える

## 技術スタックと環境

| 項目                 | 内容                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| フレームワーク       | Astro 7（Vite 内蔵）。UI フレームワークの統合は入れていない                  |
| 3D                   | `three`（0.186 系）を直接使う。`@types/three` は devDependencies             |
| 言語                 | TypeScript strict（`astro/tsconfigs/strict`）。シェーダーは `.glsl` ファイル |
| パッケージマネージャ | **pnpm 11.5.2 専用**。npm / yarn は `scripts/ensure-pnpm.cjs` で失敗する     |
| Node                 | 24.16.0（`.node-version`）                                                   |
| スタイル             | Astro の scoped `<style>`。Tailwind は使っていない                           |

使わないもの（理由がない限り追加しない）:

- React / Vue / React Three Fiber などの UI フレームワーク
- Tailwind、状態管理ライブラリ（zustand 等）、GSAP、物理エンジン
- WebGPURenderer / TSL（曲げ変換が `onBeforeCompile` 前提のため。レンダラーは WebGLRenderer）
- 新しい依存の追加は、計画書に記載があるか、ユーザーの了承を得てから行う

## コマンド

| コマンド                            | 内容                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                          | 開発サーバー（`http://localhost:4321`）。Astro 7 はデーモンとして起動する。止めるときは `pnpm exec astro dev stop` |
| `pnpm check`                        | Astro・TypeScript の静的チェック                                                                                   |
| `pnpm build`                        | 本番ビルド。three のチャンクが 500kB を超える警告は既知（Phase 8 で対応予定）                                      |
| `pnpm format` / `pnpm format:check` | Prettier による整形と検査                                                                                          |

## 作業の進め方

コード編集を伴うタスクは、規模に関わらず次の順で進める。

1. **理解**: 変更対象に加え、呼び出し元・関連する定数・型・シェーダーを先に読む。three の API は記憶に頼らず `node_modules/@types/three` と `node_modules/three/src` で確認する
2. **方針**: 変更が波及する箇所を列挙する。特に、次のどちらかを変えるときは影響を必ず洗い出す
   - 曲げ変換（`curvature/`）: これを使う全マテリアルの見た目に影響する
   - `world.constants.ts` のコース長・惑星半径: 地面の大きさ、可視範囲、配置物の高さ、霧に影響する
3. **実装**: スコープを守り、エッジケース（後退して距離が負になる、ループ境界をまたぐ、`dt = 0`、サイズ 0、破棄後に非同期処理が戻ってくる）に防御を入れる
4. **自己レビュー**: 差分を通しで読み、デバッグコード・未使用 import・破棄漏れ（`dispose` / リスナー解除）がないか確認する
5. **検証**: 下記「検証」の手順を実行し、結果を報告する

## ディレクトリ構成

```
src/
├── pages/index.astro            # 全画面レイアウト（ページ自体はスクロールしない）
├── components/                  # Astro コンポーネント（ForestExperience = カスタム要素 <forest-experience>）
└── experience/                  # Three.js のコード（Astro 非依存）
    ├── Experience.ts            # 生成・ループ・破棄の起点
    ├── core/                    # Viewport（サイズ監視）・Ticker（ループ）など
    ├── controls/                # ScrollController・CameraController・controls.constants.ts
    ├── curvature/               # 擬似球面の曲げ変換（GLSL と TS）
    ├── world/                   # World・Ground・配置物・world.constants.ts
    └── debug/                   # ?debug 時だけ動的 import するデバッグ GUI
```

- 計画書 §19 の構成に従ってファイルを増やす。予定のディレクトリ（`procedural/` `orbs/` `assets/` `shaders/` など）は、その Phase で必要になってから作る
- import は `@/*`（`src/*`）エイリアスを使う。同じディレクトリ内の参照は相対パスでよい
- 3D 用のアセットは `public/models/`・`public/textures/`、モーダル用の画像は `src/assets/` に置く

## 3D 実装のルール

設計の要点。破ると見た目やループが壊れるため、変更前に必ず確認する。

### 座標と曲げ変換

- 平面ワールド座標は **`x` = 道の中心からの横距離、`y` = 地面からの高さ、`z = -s`**（s はコース座標。前方が -Z）で統一する
- カメラは原点の真上（目の高さ）に固定する。世界の方をシェーダーで球面へ曲げて動かす
- 曲げ変換を使うマテリアルは、必ず `applyCurvature(material, curvatureUniforms, options)` を通す
  - そのメッシュは `frustumCulled = false` にする
  - 独自のシェーダー改変は `options.patchShader` で行い、`options.cacheKey` を固有の値にする
- オーブの位置計算などで TS 版の曲げ変換を追加するときは、`curvature.glsl` と **同じ式** にする。片方だけ変えない

### ループ（円環座標）

- 現在の値: `COURSE_LENGTH = 100`、`PLANET_RADIUS = 63.7`
- 進行距離はリセットせず増やし続ける。折り返すのは描画時だけ（TS は `MathUtils.euclideanModulo`、GLSL は `curvatureWrapSigned`）
- カメラから ±`COURSE_LENGTH / 2`（±50m）の位置で、物が 1 周の反対側に切り替わる。そのため次を守る
  - 地面・配置物の可視範囲は、前方・後方とも 50m 未満に収める
  - 配置物の高さは約 9.9m 未満にする（頭が見え始める距離 `14.5 + √(127.4·H)` m が 50m を超えないように）
  - 周期関数の周波数、テクスチャのタイル幅、グリッド間隔、チャンク長は、すべて `COURSE_LENGTH` を割り切る値にする
- 光・霧・空はコース位置に依存させず、カメラ相対で一定にする

### ライフサイクルとパフォーマンス

- イベントリスナーは Experience の `AbortController` の `signal` を渡して登録する。個別の `removeEventListener` は書かない
- ループは `Ticker`（`renderer.setAnimationLoop`）に一本化する。`requestAnimationFrame` を直接使わない
- 生成したジオメトリ・マテリアル・テクスチャは、各クラスの `dispose()` で破棄し、Experience の `destroy()` から辿れるようにする
- 毎フレームの処理で `new Vector3()` などを作らない。作業用のオブジェクトはフィールドに持って再利用する
- リアルタイムの影は使わない。木など同じ形の物は InstancedMesh で描く（計画書 §10・§15）

### Astro との連携

- Three.js の初期化はカスタム要素の `connectedCallback` で行い、`disconnectedCallback` で `destroy()` する
- Three.js と HTML（モーダル等）は `forest:` 接頭辞の CustomEvent でつなぐ。イベント名と detail の型は一箇所で定義する
- デバッグ用の機能は `?debug` を付けたときだけ動的 import し、通常のバンドルに含めない

## 命名規則

- クラス: `PascalCase`（ファイル名も `PascalCase.ts`、1 ファイル 1 クラス）
- Astro コンポーネント: `PascalCase.astro`
- 定数: `UPPER_SNAKE_CASE`。単位が分かる名前にする（例: `MAX_LEAD_METERS`、`FLICK_TIME`）
- イベントハンドラ: `handleXxx`（クラスでは `private readonly handleXxx = (...) => {}` のアロー関数にして `this` を固定する）
- boolean: `isXxx`
- interface: `IXxx`、type エイリアス・ジェネリック型パラメータ: `TXxx`
- ファイル接尾辞: `*.constants.ts` / `*.utils.ts` / `*.type.ts` / `*.data.ts` / `*.events.ts`
- GLSL: uniform は `uXxx`、varying は `vXxx`。標準チャンクへ差し込む関数・変数には `curvature` などの接頭辞を付けて three.js 側の名前と衝突させない

## コーディング規約

- フォーマットは Prettier 設定が正: セミコロンなし、ダブルクォート、末尾カンマ、`printWidth: 100`
- import 順: `three` などの外部ライブラリ → `@/` エイリアス → 相対パス。型だけの import は `import type` で分ける
- TypeScript: `any` を使わない。`as` は最後の手段にし、`@ts-ignore` を使わない。`enum` ではなく Union 型を使う
- マジックナンバーは定数化する。複数ファイルで使う値は `*.constants.ts` へ、1 ファイル内だけの値はそのファイルの先頭に置く
- 早期 return と浅いネストを優先する。エラーは握りつぶさない

### コメント方針

コードベースに合わせ、コメントは日本語で多めに書く。

- クラス・関数・interface には JSDoc（`/** */`）で役割を書く
- 「毎フレーム呼ぶこと」「呼ばないと追従しない」のような呼び出し契約と、破棄の責任を明記する
- 数値には単位（m / 秒 / 度 / px）と、その値にした理由を書く
- シェーダーの改変には、差し込み先のチャンクと、元の処理との違いを書く
- 暫定対応や後の Phase で置き換える予定のものは `TODO:` / `MEMO:` に Phase 番号を添えて残す（例: `TODO: Phase 7 で Atmosphere へ移す`）

## 検証

各 Phase の終わりと、コード変更の完了時に次を実行し、結果を報告する。

1. `pnpm check`（エラー・警告 0 件）
2. `pnpm build`
3. `pnpm format:check`
4. ブラウザでの動作確認: `pnpm dev` で起動し、`http://localhost:4321/?debug` で確認する
   - Claude in Chrome に接続できない場合は、ヘッドレス Chrome（`--use-angle=swiftshader --enable-unsafe-swiftshader`）を `--remote-debugging-port` 付きで起動し、CDP から wheel・キー入力を送ってスクリーンショットを撮る。検証用のスクリプトはスクラッチパッドに置き、リポジトリには入れない
   - ループ境界（0m をまたぐ前進・後退）、ページが縦スクロールしないこと、コンソールにエラーがないことを確認する
   - 実機のトラックパッド・タッチ、高リフレッシュレートのモニタで確認できなかった場合は、その旨を報告する

## ブランチ・コミット

- `develop` / `main` に直接コミットしない。Phase ごとに作業ブランチ（例: `feat/phase-2-ground-path`）を切る
- Phase のブランチを develop へマージするのは、ユーザーの指示があったときだけ
- コミットは性質ごとに分ける（`feat` / `fix` / `docs` / `style` / `refactor`）。メッセージは日本語で `<prefix>: <要約>`
- 依存の追加（`package.json` / `pnpm-lock.yaml` / 設定ファイル）、実装（`src/`）、計画書・引き継ぎメモ（`.plan/`）は、別々のコミットにする
- コミットと push は、ユーザーに依頼されたときだけ行う。2026-10-12 時点でリモートは未設定

## 報告

作業完了時は「変更内容の要約 / 検証結果 / 残課題」を報告する。計画書と違う判断をしたときは、その理由も添える。
