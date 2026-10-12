# Forest

Astro（Vite 内蔵）を使ったフロントエンド開発環境です。

## 必要環境

- Node.js 24.16.0
- pnpm 11.5.2

## 使い方

```bash
corepack enable
pnpm install
pnpm dev
```

`.node-version`、`package.json`、`.npmrc` で使用バージョンを固定しています。依存関係の操作は pnpm 専用です。`npm install` や `yarn install` は実行時に失敗します。

開発サーバー起動後、表示された URL（通常は `http://localhost:4321`）をブラウザで開きます。

## コマンド

| コマンド            | 内容                                  |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | Vite ベースの開発サーバーを起動       |
| `pnpm build`        | 本番用の静的ファイルを `dist/` に生成 |
| `pnpm preview`      | ビルド済みサイトをローカルで確認      |
| `pnpm check`        | Astro・TypeScript の静的チェック      |
| `pnpm format`       | Prettier でコードを整形               |
| `pnpm format:check` | Prettier の整形差分を検査             |
