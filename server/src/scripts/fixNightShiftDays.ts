/**
 * One-off repair for night-shift check-ins filed on the wrong day (see lib/nightShiftRepair.ts).
 *
 *   node dist/scripts/fixNightShiftDays.js                     # preview, saves nothing
 *   node dist/scripts/fixNightShiftDays.js --apply             # save it
 *   node dist/scripts/fixNightShiftDays.js --since 2026-10-01  # where to start (default)
 */
import { prisma } from '../lib/prisma'
import { repairNightShiftDays } from '../lib/nightShiftRepair'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const sinceIdx = args.indexOf('--since')
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : '2026-10-01'

async function main(): Promise<void> {
  const { moved, lines, manual } = await repairNightShiftDays({ apply: APPLY, since: SINCE })
  for (const l of lines) console.log((APPLY ? 'Moved  ' : 'Would move  ') + l)
  console.log(`\n${APPLY ? 'Moved' : 'Would move'} ${moved} check-in(s) since ${SINCE}.`)
  if (manual.length) {
    console.log('\nPlease correct these by hand in Attendance:')
    for (const m of manual) console.log('  ' + m)
  }
  if (!APPLY && moved) console.log('\nNothing is saved yet. Run again with --apply to save it.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
