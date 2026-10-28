// LOCAL ONLY (erp): test accounts for trying Metriq on your PC. Every password is test123.
//   testuser          the owner console (http://localhost:5173/owner)
//   testcompanyadmin  the Super Admin of "Test Company" (setup wizard, company settings, billing)
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
export const TEST_COMPANY_ADMIN = { username: 'testcompanyadmin', email: 'testcompanyadmin@local.test', name: 'Test Company Admin' }
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

    // On this computer only: open sign-ups, so the Start a free trial page can be tried.
    await prisma.featureFlag.upsert({ where: { key: 'new-companies' }, update: { enabled: true }, create: { key: 'new-companies', enabled: true, updatedBy: 'test accounts' } })

    // Both start as a fresh free trial (14 days, setup wizard not done yet), so sign-up, the
    // wizard and billing (test payments) can be tried. Running this again starts them over.
    const trial = { status: 'TRIAL' as const, trialEndsAt: new Date(Date.now() + 14 * 86400_000), setupDoneAt: null }
    await prisma.company.upsert({
      where: { id: TEST_COMPANY.id },
      update: { ...trial, plan: 'business' },
      create: { ...TEST_COMPANY, kind: 'TEAM', plan: 'business', helpEnabled: true, timeZone: 'Asia/Karachi', ...trial },
    })
    await prisma.company.upsert({
      where: { id: SOLO_WORKSPACE.id },
      update: { ...trial, plan: 'personal' },
      create: { ...SOLO_WORKSPACE, kind: 'PERSONAL', plan: 'personal', helpEnabled: true, timeZone: 'Asia/Karachi', ...trial },
    })
    await prisma.subscription.deleteMany({ where: { companyId: { in: [TEST_COMPANY.id, SOLO_WORKSPACE.id] } } })

    const person = (u: { username: string; email: string; name: string }, companyId: string, role: 'MEMBER' | 'SUPER_ADMIN' = 'MEMBER') =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { username: u.username, passwordHash, companyId, role, isActive: true, status: 'ACTIVE', sessionsValidFrom: null, emailCheckPending: false },
        create: { ...u, passwordHash, companyId, role, status: 'ACTIVE', isActive: true, emailVerifiedAt: new Date() },
      })
    await person(TEST_COMPANY_ADMIN, TEST_COMPANY.id, 'SUPER_ADMIN')
    await person(TEST_COMPANY_USER, TEST_COMPANY.id)
    // On their own, the solo person runs their workspace.
    await person(SOLO_USER, SOLO_WORKSPACE.id, 'SUPER_ADMIN')

    console.log('Test accounts ready (password test123 for all):')
    console.log('  testuser          owner console          http://localhost:5173/owner')
    console.log('  testcompanyadmin  Test Company (admin)   http://localhost:5173/login')
    console.log('  testcompanyuser   Test Company           http://localhost:5173/login')
    console.log('  solouser          on their own           http://localhost:5173/login')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
