// Seed/replace a month's Lead Gen breakdown from a JSON file. Idempotent.
//   npx tsx src/scripts/seedLeadGenBreakdown.ts /tmp/leadgen-breakdown-2026-06.json
// JSON: { "month": "YYYY-MM", "items": [{ "category", "kind": "CAMPAIGN"|"INDUSTRY", "count" }] }
import { readFileSync } from 'node:fs'
import { PrismaClient, type BreakdownKind } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: tsx seedLeadGenBreakdown.ts <file.json>')
    process.exit(1)
  }
  const { month, items } = JSON.parse(readFileSync(file, 'utf8')) as {
    month: string
    items: { category: string; kind: BreakdownKind; count: number }[]
  }
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM')

  await prisma.$transaction([
    prisma.leadGenBreakdown.deleteMany({ where: { month } }),
    prisma.leadGenBreakdown.createMany({ data: items.map((i) => ({ month, category: i.category, kind: i.kind, count: i.count })) }),
  ])

  const rows = await prisma.leadGenBreakdown.findMany({ where: { month }, orderBy: [{ kind: 'asc' }, { count: 'desc' }] })
  console.log(`Seeded ${rows.length} rows for ${month}:`)
  for (const r of rows) console.log(`  [${r.kind}] ${r.category}: ${r.count}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
