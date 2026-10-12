/**
 * 依存関係の管理ツールを pnpm に統一する。
 * npm / yarn 経由で install すると lockfile の形式が混在するため、処理を中断する。
 */
const packageManagerUserAgent = process.env.npm_config_user_agent ?? ""

if (!packageManagerUserAgent.startsWith("pnpm/")) {
  console.error("このプロジェクトでは pnpm を使用してください: pnpm install")
  process.exit(1)
}
