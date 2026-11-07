import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Baseline (full suite, Nov 2026): ~89% across all metrics.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    projects: [
      // Fast tests with no database dependency
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          globals: true,
        },
      },

      // Tests against a real graph database:
      // Relate (embedded, default) or Neo4j / Memgraph via Bolt (env vars).
      // Files share one in-process engine, so they must not race each
      // other's schema installs (wipe() drops every constraint).
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles: ['./test/integration/setup.ts'],
          testTimeout: 30000,
          fileParallelism: false,
          globals: true,
        },
      },
    ],
  },
})
