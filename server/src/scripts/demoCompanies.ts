// LOCAL ONLY (erp): two made-up companies with a few complaints, to try the owner console on your PC.
//   npx tsx src/scripts/demoCompanies.ts           add them
//   npx tsx src/scripts/demoCompanies.ts remove    take them out again
// It refuses to run against anything but a database on this computer, so demo companies can
// never reach the live server.
import { PrismaClient } from '@prisma/client'
import { ensureHomeCompany } from '../lib/company'

export function isLocalDatabase(url: string | undefined, nodeEnv = process.env.NODE_ENV): boolean {
  if (nodeEnv === 'production' || !url) return false
  return /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)
}

const DEMO = [
  { id: 'demo-acme', name: 'Acme Traders', slug: 'acme-traders', status: 'TRIAL' as const, plan: 'starter', helpEnabled: true },
  { id: 'demo-bluesky', name: 'Blue Sky Logistics', slug: 'blue-sky-logistics', status: 'ACTIVE' as const, plan: 'business', helpEnabled: true },
]

async function main() {
  if (!isLocalDatabase(process.env.DATABASE_URL)) {
    console.log('Demo companies are only for a database on your own computer. Nothing was changed.')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  try {
    if (process.argv[2] === 'remove') {
      const r = await prisma.company.deleteMany({ where: { id: { in: DEMO.map((d) => d.id) } } })
      console.log(`Removed ${r.count} demo companies (and their complaints).`)
      return
    }
    await ensureHomeCompany()
    for (const d of DEMO) {
      await prisma.company.upsert({ where: { id: d.id }, update: {}, create: { ...d, timeZone: 'Asia/Karachi' } })
    }
    if (!(await prisma.supportTicket.count({ where: { companyId: { in: DEMO.map((d) => d.id) } } }))) {
      await prisma.supportTicket.createMany({
        data: [
          { companyId: 'demo-acme', userName: 'Sara Ahmed', userEmail: 'sara@acme.example', subject: 'Cannot invite my team', body: 'The invite email never arrives.', pageUrl: '/app/admin/users', priority: 'HIGH' },
          { companyId: 'demo-bluesky', userName: 'Omar Khan', userEmail: 'omar@bluesky.example', subject: 'How do I export attendance?', body: 'I need last month as Excel.', pageUrl: '/app/attendance/team' },
        ],
      })
    }
    console.log('Added "Acme Traders" and "Blue Sky Logistics" with two complaints. Open /owner to see them.')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
