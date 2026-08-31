import 'dotenv/config'

/**
 * Resolves the integration-test database URL from the local dev DATABASE_URL by
 * swapping the database name to `pulsetrack_test`. Self-loads .env so it works
 * regardless of import order in the vitest config / globalSetup.
 *
 * SAFETY: refuses to run against anything that isn't a local Postgres, so an
 * integration run can never touch a staging/production database.
 */
const base = process.env.DATABASE_URL
if (!base) {
  throw new Error('DATABASE_URL is required for integration tests (set it in server/.env)')
}
if (!/@(localhost|127\.0\.0\.1)([:/])/.test(base)) {
  throw new Error(`Refusing to run integration tests against a non-local database: ${base.replace(/:\/\/[^@]*@/, '://***@')}`)
}

export const BASE_DATABASE_URL = base
// Replace the path segment (db name), preserving any ?query string.
export const TEST_DATABASE_URL = base.replace(/\/([^/?]+)(\?|$)/, '/pulsetrack_test$2')
export const TEST_DB_NAME = 'pulsetrack_test'
