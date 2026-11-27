import { defineConfig } from 'vitest/config'

// Unit tests only; page flows are covered by Playwright in /e2e.
export default defineConfig({ test: { include: ['app/**/*.test.ts', 'app/**/*.test.tsx'] } })
