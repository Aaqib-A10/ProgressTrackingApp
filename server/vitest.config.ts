import { defineConfig } from 'vitest/config'

// Default (unit) test run: fast, no database. Integration tests are excluded
// here and run via vitest.integration.config.ts (npm run test:integration).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
})
