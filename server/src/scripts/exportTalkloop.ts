// Talkloop is no longer used and is being removed from Metriq (Oct 2026). Before its pages go,
// this saves everything it holds as CSV files, OUTSIDE the app folder:
//   npx tsx src/scripts/exportTalkloop.ts            (writes to ~/backups/pulsetrack/talkloop-export-<date>/)
//   npx tsx src/scripts/exportTalkloop.ts <folder>   (writes to that folder)
// It only reads; nothing is changed or deleted. Safe to run more than once.
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',')

async function main(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10)
  const out = process.argv[2] ?? path.join(os.homedir(), 'backups', 'pulsetrack', `talkloop-export-${stamp}`)
  mkdirSync(out, { recursive: true })

  const entries = await prisma.talkloopDailyEntry.findMany({
    include: { user: { select: { name: true, email: true } }, countryCounts: { include: { tag: { select: { name: true } } } } },
    orderBy: [{ date: 'asc' }, { userId: 'asc' }],
  })
  const daily = [csvRow(['date', 'person', 'email', 'status', 'calls made', 'connects', 'demos scheduled', 'demos conducted', 'notes'])]
  const countries = [csvRow(['date', 'person', 'email', 'country', 'calls', 'demos'])]
  for (const e of entries) {
    daily.push(csvRow([e.date, e.user.name, e.user.email, e.status, e.callsMade, e.connects, e.demosScheduled, e.demosConducted, e.notes]))
    for (const c of e.countryCounts) countries.push(csvRow([e.date, e.user.name, e.user.email, c.tag.name, c.calls, c.demos]))
  }

  const dept = await prisma.department.findUnique({ where: { type: 'TALKLOOP' } })
  const people = dept
    ? await prisma.user.findMany({ where: { departmentId: dept.id }, select: { name: true, email: true, role: true, isActive: true, status: true }, orderBy: { name: 'asc' } })
    : []
  const members = [csvRow(['person', 'email', 'role', 'active'])]
  for (const p of people) members.push(csvRow([p.name, p.email, p.role, p.isActive && p.status === 'ACTIVE' ? 'yes' : 'no']))

  writeFileSync(path.join(out, 'talkloop-daily-log.csv'), daily.join('\n') + '\n')
  writeFileSync(path.join(out, 'talkloop-by-country.csv'), countries.join('\n') + '\n')
  writeFileSync(path.join(out, 'talkloop-people.csv'), members.join('\n') + '\n')

  const active = people.filter((p) => p.isActive && p.status === 'ACTIVE')
  /* eslint-disable no-console */
  console.log(`Saved to ${out}`)
  console.log(`  ${entries.length} daily log entries, ${countries.length - 1} country rows, ${people.length} people in the Talkloop department`)
  if (active.length) {
    console.log(`  Still active in Talkloop (move them to another department in Admin > Users):`)
    for (const p of active) console.log(`    - ${p.name} (${p.email})`)
  } else {
    console.log('  Nobody active is in the Talkloop department.')
  }
  /* eslint-enable no-console */
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1) }) // eslint-disable-line no-console
    .finally(() => prisma.$disconnect())
}
