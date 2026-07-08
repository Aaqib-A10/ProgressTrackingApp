import { PrismaClient, type RdpTeam } from '@prisma/client'
import { RDP_IMPORT_DATA } from './rdpImportData'

const prisma = new PrismaClient()

/**
 * One-time (idempotent) import of the RDP inventory from the source spreadsheet.
 * - Upserts each RDP by (provider, address).
 * - Ensures each agent's *current* usage exists as an active assignment.
 * Safe to re-run: existing RDPs/active assignments are left untouched.
 */
async function main() {
  let assignCreated = 0

  for (const row of RDP_IMPORT_DATA) {
    const rdp = await prisma.rdp.upsert({
      where: { provider_address: { provider: row.provider, address: row.address } },
      update: {}, // don't clobber in-app edits on re-run
      create: { team: row.team as RdpTeam, provider: row.provider, address: row.address },
    })

    const existingActive = await prisma.rdpAssignment.findFirst({
      where: { rdpId: rdp.id, agentName: row.agent, unassignedAt: null },
    })
    if (!existingActive) {
      await prisma.rdpAssignment.create({ data: { rdpId: rdp.id, agentName: row.agent } })
      assignCreated++
    }
  }

  const rdpTotal = await prisma.rdp.count()
  const assignTotal = await prisma.rdpAssignment.count()
  // eslint-disable-next-line no-console
  console.log(`RDP import complete — ${assignCreated} new assignments added. Totals: ${rdpTotal} RDPs, ${assignTotal} assignments.`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
