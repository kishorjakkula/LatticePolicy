import { defineConfig } from '@playwright/test'

// UI contract tests only: synthetic responses, no login/seeding against a live carrier.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'llm-release-workflow.spec.ts',
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5189',
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
})
