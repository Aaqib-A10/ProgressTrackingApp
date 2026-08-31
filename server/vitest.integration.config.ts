import { defineConfig } from 'vitest/config'
import { TEST_DATABASE_URL } from './src/test/testDbUrl'

// Integration tests: hit the Express app via supertest against an isolated
// pulsetrack_test database (created + migrated by globalSetup). DATABASE_URL is
// injected here so lib/prisma connects to the test DB, and NODE_ENV=test keeps
// rate-limiting disabled and JWT on the dev fallback secret.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
