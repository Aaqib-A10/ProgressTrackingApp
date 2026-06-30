// One-shot importer for historical Lead Gen daily entries from a normalized JSON
// file. Idempotent (upsert on userId+date) and SAFE to re-run.
//
//   Dry run (default — writes nothing, prints what it would do):
//     npx tsx src/scripts/importLeadGenDaily.ts /tmp/leadgen-june-2026.json
//   Apply:
//     npx tsx src/scripts/importLeadGenDaily.ts /tmp/leadgen-june-2026.json --apply
//
// JSON shape: [{ email, name?, date: "YYYY-MM-DD", status: "SUBMITTED"|"ON_LEAVE", leadsGenerated: number }]
//
// On update we only touch leadsGenerated + status + dataSource, so any MQL/SQL/
// vertical data already entered in the app for that day is preserved.
import { readFileSync } from 'node:fs'
import { PrismaClient, type DayStatus } from '@prisma/client'

const prisma = new PrismaClient()
const DATA_SOURCE = 'Historical import (Lead Gen monthly sheet)'

interface Rec {
  email: string
  name?: string
  date: string
  status: DayStatus
  leadsGenerated: number
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file) {
    console.error('Usage: tsx importLeadGenDaily.ts <file.json> [--apply]')
    process.exit(1)
  }
  const recs = JSON.parse(readFileSync(file, 'utf8')) as Rec[]
  console.log(`Loaded ${recs.length} records from ${file}`)
  console.log(apply ? '\n*** APPLY MODE — writing to the database ***\n' : '\n--- DRY RUN — no writes ---\n')

  // Resolve users by email.
  const emails = [...new Set(recs.map((r) => r.email))]
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, name: true, role: true } })
  const byEmail = new Map(users.map((u) => [u.email, u]))
  const missing = emails.filter((e) => !byEmail.has(e))
  if (missing.length) {
    console.error('ABORT — these emails are not in the DB:\n  ' + missing.join('\n  '))
    process.exit(1)
  }

  // Per-user summary + overwrite preview.
  let created = 0
  let updated = 0
  let overwriteWarnings = 0
  for (const email of emails) {
    const u = byEmail.get(email)!
    const mine = recs.filter((r) => r.email === email)
    const total = mine.filter((r) => r.status === 'SUBMITTED').reduce((s, r) => s + r.leadsGenerated, 0)
    const leave = mine.filter((r) => r.status === 'ON_LEAVE').length
    const dates = mine.map((r) => r.date).sort()
    console.log(`${(u.name || email).padEnd(20)} ${email.padEnd(38)} role=${u.role.padEnd(10)} ${mine.length} days, ${total} leads, ${leave} leave  (${dates[0]}..${dates[dates.length - 1]})`)

    for (const r of mine) {
      const existing = await prisma.leadGenDailyEntry.findUnique({ where: { userId_date: { userId: u.id, date: new Date(r.date) } } })
      if (existing) {
        updated++
        if (existing.leadsGenerated !== r.leadsGenerated || existing.status !== r.status) {
          overwriteWarnings++
          console.log(`    overwrite ${r.date}: leads ${existing.leadsGenerated}->${r.leadsGenerated}, status ${existing.status}->${r.status}`)
        }
      } else {
        created++
      }
      if (apply) {
        await prisma.leadGenDailyEntry.upsert({
          where: { userId_date: { userId: u.id, date: new Date(r.date) } },
          update: { leadsGenerated: r.leadsGenerated, status: r.status, dataSource: DATA_SOURCE },
          create: { userId: u.id, date: new Date(r.date), status: r.status, leadsGenerated: r.leadsGenerated, dataSource: DATA_SOURCE },
        })
      }
    }
  }

  console.log(`\nSummary: ${created} to create, ${updated} already exist (${overwriteWarnings} value changes).`)
  console.log(apply ? 'Done — changes written.' : 'Dry run complete. Re-run with --apply to write.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
