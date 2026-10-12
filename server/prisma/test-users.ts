import { PrismaClient, type DepartmentType, type Role } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'
import { companyToday, dbDateFromString } from '../src/lib/time'

/**
 * LOCAL TESTING ONLY: one team lead and one member for every department (plus Marketing
 * people per discipline and a QA user), all with the password Password123!, and a little
 * activity for today so every dashboard has numbers. Log in as each one to check that
 * people only see their own department.
 *
 *   npm run seed:test-users
 *
 * Refuses to run against anything but a database on this computer, so it can never put
 * test accounts on the live site. Safe to run again (it updates instead of duplicating).
 */

const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('Refusing: DATABASE_URL is not a database on this computer. This script is for local testing only.')
  process.exit(1)
}

const prisma = new PrismaClient()
const PASSWORD = 'Password123!'

const PEOPLE: { email: string; name: string; role: Role; dept?: DepartmentType; sub?: string }[] = [
  { email: 'itad.lead@test.local', name: 'Test ITAD Lead', role: 'TEAM_LEAD', dept: 'ITAD' },
  { email: 'itad.member@test.local', name: 'Test ITAD Member', role: 'MEMBER', dept: 'ITAD' },
  { email: 'leadgen.lead@test.local', name: 'Test LeadGen Lead', role: 'TEAM_LEAD', dept: 'LEAD_GEN' },
  { email: 'leadgen.member@test.local', name: 'Test LeadGen Member', role: 'MEMBER', dept: 'LEAD_GEN' },
  { email: 'marketing.lead@test.local', name: 'Test Marketing Lead', role: 'TEAM_LEAD', dept: 'MARKETING' },
  { email: 'marketing.seo@test.local', name: 'Test SEO Member', role: 'MEMBER', dept: 'MARKETING', sub: 'seo' },
  { email: 'marketing.social@test.local', name: 'Test Social Member', role: 'MEMBER', dept: 'MARKETING', sub: 'social' },
  { email: 'marketing.content@test.local', name: 'Test Content Member', role: 'MEMBER', dept: 'MARKETING', sub: 'content' },
  { email: 'csr.lead@test.local', name: 'Test CSR Lead', role: 'TEAM_LEAD', dept: 'CSR' },
  { email: 'csr.member@test.local', name: 'Test CSR Agent', role: 'MEMBER', dept: 'CSR' },
  { email: 'ecommerce.lead@test.local', name: 'Test Ecommerce Lead', role: 'TEAM_LEAD', dept: 'ECOMMERCE' },
  { email: 'ecommerce.member@test.local', name: 'Test Ecommerce Member', role: 'MEMBER', dept: 'ECOMMERCE' },
  { email: 'talkloop.lead@test.local', name: 'Test Talkloop Lead', role: 'TEAM_LEAD', dept: 'TALKLOOP' },
  { email: 'talkloop.member@test.local', name: 'Test Talkloop Member', role: 'MEMBER', dept: 'TALKLOOP' },
  { email: 'inventory.lead@test.local', name: 'Test Inventory Lead', role: 'TEAM_LEAD', dept: 'INVENTORY' },
  { email: 'inventory.member@test.local', name: 'Test Inventory Member', role: 'MEMBER', dept: 'INVENTORY' },
  { email: 'qa@test.local', name: 'Test QA', role: 'QA' },
  { email: 'admin@test.local', name: 'Test Super Admin', role: 'SUPER_ADMIN' },
]

async function main() {
  const passwordHash = await hashPassword(PASSWORD)
  const depts = new Map((await prisma.department.findMany()).map((d) => [d.type, d.id]))
  if (depts.size < 7) throw new Error('Departments are missing. Run "npm run seed" first.')
  const id: Record<string, string> = {}

  for (const p of PEOPLE) {
    const departmentId = p.dept ? depts.get(p.dept)! : null
    const subDepartmentId = p.sub && departmentId
      ? (await prisma.subDepartment.findUnique({ where: { departmentId_slug: { departmentId, slug: p.sub } } }))?.id ?? null
      : null
    const data = { name: p.name, role: p.role, status: 'ACTIVE' as const, isActive: true, passwordHash, departmentId, subDepartmentId }
    const u = await prisma.user.upsert({ where: { email: p.email }, update: data, create: { email: p.email, ...data } })
    if (departmentId) {
      await prisma.userDepartment.upsert({
        where: { userId_departmentId: { userId: u.id, departmentId } },
        update: { role: p.role, subDepartmentId },
        create: { userId: u.id, departmentId, role: p.role, subDepartmentId },
      })
    }
    id[p.email.split('@')[0]] = u.id
  }

  // A little activity for today, so each dashboard shows numbers.
  const date = dbDateFromString(companyToday())
  const day = (userId: string) => ({ userId_date: { userId, date } })
  await prisma.itadDailyEntry.upsert({ where: day(id['itad.member']), update: {}, create: { userId: id['itad.member'], date, callsDialed: 120, connected: 30, voicemail: 40, emailsSent: 15, interested: 4, closed: 1 } })
  await prisma.leadGenDailyEntry.upsert({ where: day(id['leadgen.member']), update: {}, create: { userId: id['leadgen.member'], date, leadsGenerated: 25, accountsResearched: 40, contactsFound: 60, qualifiedMql: 8, handedToSql: 3 } })
  await prisma.talkloopDailyEntry.upsert({ where: day(id['talkloop.member']), update: {}, create: { userId: id['talkloop.member'], date, callsMade: 80, connects: 20, demosScheduled: 4, demosConducted: 3 } })
  await prisma.seoDailyEntry.upsert({ where: day(id['marketing.seo']), update: {}, create: { userId: id['marketing.seo'], date, body: 'Optimised 3 pages' } })

  const ecom = depts.get('ECOMMERCE')!
  const tag = (name: string, type: 'MARKETPLACE' | 'TASK_TYPE') =>
    prisma.tag.upsert({ where: { departmentId_type_name: { departmentId: ecom, type, name } }, update: {}, create: { departmentId: ecom, type, name } })
  const [amazon, listing] = await Promise.all([tag('Amazon', 'MARKETPLACE'), tag('Listings', 'TASK_TYPE')])
  if (!(await prisma.ecommerceDailyEntry.findUnique({ where: day(id['ecommerce.member']) }))) {
    await prisma.ecommerceDailyEntry.create({ data: { userId: id['ecommerce.member'], date, lines: { create: [{ taskTypeId: listing.id, marketplaceId: amazon.id, listings: 18 }] } } })
  }

  if (!(await prisma.marketingTask.findFirst({ where: { title: 'Test: launch post' } }))) {
    await prisma.marketingTask.create({ data: { title: 'Test: launch post', discipline: 'SOCIAL', status: 'PUBLISHED', completedAt: new Date(), publishedDate: date, assigneeId: id['marketing.social'] } })
  }

  const csr = depts.get('CSR')!
  if (!(await prisma.qaEvaluation.findFirst({ where: { agentId: id['csr.member'] } }))) {
    for (const score of [92, 84, 88]) {
      await prisma.qaEvaluation.create({ data: { scorecardName: 'Test CSR scorecard', evaluatorId: id.qa, agentId: id['csr.member'], departmentId: csr, totalScore: score, passed: true, band: 'Good', submittedAt: new Date() } })
    }
  }

  const inv = depts.get('INVENTORY')!
  let item = await prisma.inventoryItem.findFirst({ where: { departmentId: inv, name: 'Test SSD 512GB' } })
  if (!item) {
    item = await prisma.inventoryItem.create({ data: { departmentId: inv, name: 'Test SSD 512GB', category: 'Storage', quantity: 2, lowStockAt: 5 } })
    await prisma.inventoryMovement.create({ data: { itemId: item.id, type: 'STOCK_OUT', quantity: 3, status: 'COMPLETED', assignedToId: id['inventory.member'], assignedAt: new Date(), resolvedAt: new Date() } })
    await prisma.inventoryMovement.create({ data: { itemId: item.id, type: 'STOCK_IN', quantity: 10, requestedByName: 'Warehouse' } })
  }

  console.log(`\nTest accounts ready (password for all: ${PASSWORD}):`)
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(30)} ${p.role.padEnd(10)} ${p.dept ?? ''}${p.sub ? ` / ${p.sub}` : ''}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
