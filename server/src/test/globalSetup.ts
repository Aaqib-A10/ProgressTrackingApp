import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { BASE_DATABASE_URL, TEST_DATABASE_URL, TEST_DB_NAME } from './testDbUrl'

/**
 * Runs once before the integration suite: ensures an isolated `pulsetrack_test`
 * database exists and is migrated to the current schema. Idempotent — safe to
 * re-run. The suite itself truncates + seeds per file.
 */
export async function setup(): Promise<void> {
  // Create the test DB via a connection to the base DB. CREATE DATABASE can't run
  // inside a transaction, so use $executeRawUnsafe (autocommit) and swallow "exists".
  const admin = new PrismaClient({ datasources: { db: { url: BASE_DATABASE_URL } } })
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`)
  } catch (e) {
    if (!/already exists/i.test((e as Error).message)) throw e
  } finally {
    await admin.$disconnect()
  }

  // Apply all migrations to the test DB.
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
    cwd: process.cwd(),
  })
}
