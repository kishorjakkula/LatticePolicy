import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Run against the shared package's source so tests never depend on a stale build.
    alias: { '@lattice-policy/rules': fileURLToPath(new URL('../packages/rules/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 20, functions: 20, statements: 20, branches: 15,
        'src/lib/customer-crypto.ts': { lines: 25, functions: 50, statements: 20, branches: 30 },
        'src/config.ts': { lines: 90, functions: 90, statements: 90, branches: 85 },
      },
      exclude: ['dist/**', 'migrations/**', 'scripts/**', '**/*.d.ts']
    }
  }
})
