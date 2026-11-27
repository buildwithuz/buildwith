import { defineConfig, devices } from '@playwright/test'

// Runs against a stack that is already up (pnpm dev locally; the e2e CI job starts one).
// E2E_BASE_URL picks the web origin; E2E_CHROME uses an installed Chrome instead of
// Playwright's bundled Chromium (handy on systems where the bundled one can't run).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@smoke/ },
  ],
})
