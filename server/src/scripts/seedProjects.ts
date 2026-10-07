// Idempotent: creates the team's standard projects (default columns + # chat channel)
// if they don't exist yet. Safe to run on production; it never touches existing
// projects and adds no members other than the owner (add people in the app).
//   npx tsx src/scripts/seedProjects.ts [owner-email]
// Owner defaults to the first active Super Admin.
import { PrismaClient } from '@prisma/client'
import { createProjectWithDefaults } from '../lib/pm/tasks'
import { STANDARD_PROJECTS } from '../lib/pm/standardProjects'

const prisma = new PrismaClient()


async function main(): Promise<void> {
  const email = process.argv[2]
  const owner = email
    ? await prisma.user.findUnique({ where: { email } })
    : await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
  if (!owner) throw new Error(email ? `No user with email ${email}` : 'No active Super Admin found')
  for (const p of STANDARD_PROJECTS) {
    const exists = await prisma.pmProject.findFirst({ where: { OR: [{ key: p.key }, { name: p.name }] } })
    if (exists) {
      // eslint-disable-next-line no-console
      console.log(`  = ${p.key} already exists`)
      continue
    }
    await createProjectWithDefaults({ ...p, ownerId: owner.id })
    // eslint-disable-next-line no-console
    console.log(`  + ${p.key} ${p.name}`)
  }
  // eslint-disable-next-line no-console
  console.log(`Projects ready (owner ${owner.email}).`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
