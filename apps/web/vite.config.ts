import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // The repo-root .env configures every app; load it so `pnpm dev` just works.
  const env = loadEnv(mode, '../..', '')
  for (const [k, v] of Object.entries(env)) if (k.startsWith('BUILDWITH_')) process.env[k] ??= v
  const api = process.env.BUILDWITH_API_ORIGIN ?? 'http://localhost:8080'

  return {
    plugins: [tailwindcss(), reactRouter()],
    build: {
      // Fonts stay real files: the CSP allows font-src 'self' only (no data:), and files cache better.
      assetsInlineLimit: (file: string) =>
        file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined,
    },
    server: {
      port: Number(env.PORT || 5173),
      strictPort: true,
      // The browser reaches the API (event stream, OAuth, uploads) and media
      // through this proxy in development; Caddy does it in production.
      proxy: {
        '/v1': { target: api, changeOrigin: false },
        '/media': { target: api, changeOrigin: false },
      },
    },
  }
})
