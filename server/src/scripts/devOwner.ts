// LOCAL ONLY (erp): test accounts for trying Metriq on your PC. Every password is test123.
//   testuser          the owner console (http://localhost:5173/owner)
//   testcompanyuser   a person in "Test Company" (normal sign in, http://localhost:5173/login)
//   solouser          one person on their own: a personal workspace, not in any company
// It refuses to run against anything but a database on this computer, and the live server
// refuses to sign in any account whose email ends in @local.test, so none of these work live.
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { isLocalDatabase } from './demoCompanies'

export const TEST_PASSWORD = 'test123'
export const TEST_OWNER = { username: 'testuser', email: 'testuser@local.test', name: 'Test User' }
export const TEST_COMPANY = { id: 'test-company', name: 'Test Company', slug: 'test-company' }
export const TEST_COMPANY_USER = { username: 'testcompanyuser', email: 'testcompanyuser@local.test', name: 'Test Company User' }
export const SOLO_WORKSPACE = { id: 'solo-solouser', name: 'Solo User', slug: 'solo-solouser' }
export const SOLO_USER = { username: 'solouser', email: 'solouser@local.test', name: 'Solo User' }

async function main() {
  if (!isLocalDatabase(process.env.DATABASE_URL)) {
    console.log('Test accounts are only for a database on your own computer. Nothing was changed.')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  try {
    const passwordHash = await hashPassword(TEST_PASSWORD)

    await prisma.platformOwner.upsert({
      where: { email: TEST_OWNER.email },
      update: { username: TEST_OWNER.username, passwordHash, totpSecret: null, failedLogins: 0, lockedUntil: null },
      create: { ...TEST_OWNER, passwordHash },
    })

    await prisma.company.upsert({
      where: { id: TEST_COMPANY.id },
      update: { status: 'ACTIVE' },
      create: { ...TEST_COMPANY, kind: 'TEAM', status: 'ACTIVE', plan: 'business', helpEnabled: true, timeZone: 'Asia/Karachi' },
    })
    await prisma.company.upsert({
      where: { id: SOLO_WORKSPACE.id },
      update: { status: 'ACTIVE' },
      create: { ...SOLO_WORKSPACE, kind: 'PERSONAL', status: 'ACTIVE', plan: 'personal', helpEnabled: true, timeZone: 'Asia/Karachi' },
    })

    const person = (u: { username: string; email: string; name: string }, companyId: string) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { username: u.username, passwordHash, companyId, isActive: true, status: 'ACTIVE', sessionsValidFrom: null },
        create: { ...u, passwordHash, companyId, role: 'MEMBER', status: 'ACTIVE', isActive: true },
      })
    await person(TEST_COMPANY_USER, TEST_COMPANY.id)
    await person(SOLO_USER, SOLO_WORKSPACE.id)

    console.log('Test accounts ready (password test123 for all):')
    console.log('  testuser         owner console   http://localhost:5173/owner')
    console.log('  testcompanyuser  Test Company    http://localhost:5173/login')
    console.log('  solouser         on their own    http://localhost:5173/login')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
