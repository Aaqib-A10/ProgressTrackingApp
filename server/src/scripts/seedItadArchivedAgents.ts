// Idempotent: create archived (inactive) ITAD accounts for former agents whose
// historical QA evaluations we're importing (Hammad, Adeel, Imran).
//   npx tsx src/scripts/seedItadArchivedAgents.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export const ARCHIVED_ITAD = [
  { name: 'Hammad', email: 'hammad@archived.minnesotacomputers.us' },
  { name: 'Adeel', email: 'adeel@archived.minnesotacomputers.us' },
  { name: 'Imran', email: 'imran@archived.minnesotacomputers.us' },
]

async function main() {
  const dept = await prisma.department.findUnique({ where: { type: 'ITAD' } })
  if (!dept) throw new Error('ITAD department not found — run the base seed first.')
  for (const a of ARCHIVED_ITAD) {
    await prisma.user.upsert({
      where: { email: a.email },
      update: { departmentId: dept.id, isActive: false },
      create: { email: a.email, name: a.name, role: 'MEMBER', isActive: false, departmentId: dept.id },
    })
  }
  console.log(`Ensured ${ARCHIVED_ITAD.length} archived ITAD agents (inactive).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
