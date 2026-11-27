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
