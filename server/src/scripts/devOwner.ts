// LOCAL ONLY (erp): a test owner for trying the owner console on your PC.
//   username: testuser   password: test123   (email testuser@local.test, no phone code)
// It refuses to run against anything but a database on this computer, and the live server
// refuses to sign in any owner whose email ends in @local.test, so it can never be used live.
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { isLocalDatabase } from './demoCompanies'

export const TEST_OWNER = { username: 'testuser', email: 'testuser@local.test', name: 'Test User', password: 'test123' }

async function main() {
  if (!isLocalDatabase(process.env.DATABASE_URL)) {
    console.log('The test owner is only for a database on your own computer. Nothing was changed.')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  try {
    const passwordHash = await hashPassword(TEST_OWNER.password)
    await prisma.platformOwner.upsert({
      where: { email: TEST_OWNER.email },
      update: { username: TEST_OWNER.username, passwordHash, totpSecret: null, failedLogins: 0, lockedUntil: null },
      create: { name: TEST_OWNER.name, email: TEST_OWNER.email, username: TEST_OWNER.username, passwordHash },
    })
    console.log('Test owner ready. Sign in at http://localhost:5173/owner with username testuser and password test123.')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
