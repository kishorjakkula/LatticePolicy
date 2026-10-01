import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 20, functions: 20, statements: 20, branches: 15,
        'src/features/auth/LoginPage.tsx': { lines: 30, functions: 40, statements: 30, branches: 20 },
      },
      exclude: ['src/test/**', 'src/api/mock/**', '**/*.d.ts']
    }
  }
})
