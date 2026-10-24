import { defineConfig, devices } from '@playwright/test'

// Isolated synthetic UI contracts; never starts or writes a demo/pilot API.
export default defineConfig({
  testDir: './e2e', testMatch: 'businessowners.spec.ts', timeout: 60_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5195', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace=frontend -- --host 127.0.0.1 --port 5195 --strictPort',
    url: 'http://127.0.0.1:5195', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: 'http://127.0.0.1:5195', VITE_USE_MOCK: '0' }
  }
})
