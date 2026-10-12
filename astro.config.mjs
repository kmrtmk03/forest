import { defineConfig } from "astro/config"

/** Astro と Vite の開発サーバー設定。 */
export default defineConfig({
  vite: {
    server: {
      // 同一ネットワーク上の実機からも確認できるようにする。
      host: true,
    },
  },
})
