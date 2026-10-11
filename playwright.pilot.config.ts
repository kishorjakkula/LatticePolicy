import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  globalSetup: undefined,
  testIgnore: [],
  testMatch: '**/pilot-*.spec.ts',
  workers: 1,
  outputDir: '.pilot/test-results',
  timeout: 120000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.pilot/playwright-report' }], ['json', { outputFile: '.pilot/evidence/playwright.json' }]],
})
