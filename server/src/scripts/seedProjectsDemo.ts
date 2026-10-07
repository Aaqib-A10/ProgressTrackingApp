// LOCAL DEVELOPMENT ONLY: fills RTI, MNC and Pulse Track with members and ~30
// demo tasks (some overdue, some due soon) so the board, notifications and the
// dashboard can be tried out. Refuses to run against a non-local database.
//   npx tsx src/scripts/seedProjectsDemo.ts
import 'dotenv/config'
import { PrismaClient, type PmProjectRole, type Priority } from '@prisma/client'
import { createProjectWithDefaults, syncProjectChannel } from '../lib/pm/tasks'
import { STANDARD_PROJECTS } from '../lib/pm/standardProjects'

const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  // eslint-disable-next-line no-console
  console.error('Refusing to seed demo data into a non-local database.')
  process.exit(1)
}

const prisma = new PrismaClient()
const H = 3600000

const TITLES = [
  'Update case study page', 'Fix contact form routing', 'Write Q4 blog outline', 'Refresh location pages', 'Design LinkedIn carousel',
  'Audit GSC coverage errors', 'Draft mail back kit FAQ', 'Prepare monthly report', 'Shoot facility b-roll', 'Compress hero images',
  'Add schema markup', 'Review ad copy', 'Plan November content calendar', 'Set up rank tracking keywords', 'Rewrite services page intro',
  'Collect client testimonials', 'QA mobile navigation', 'Build lead form webhook', 'Edit explainer voiceover', 'Publish ITAD checklist post',
  'Update certifications section', 'Create email nurture flow', 'Fix broken internal links', 'Prepare board review deck', 'Translate landing page',
  'Clean CRM duplicates', 'Draft press release', 'Optimize page speed', 'Record onboarding video', 'Archive old campaigns',
]

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } })
  if (!admin) throw new Error('No Super Admin')
  const people = await prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE', role: { in: ['TEAM_LEAD', 'MEMBER'] }, department: { type: 'MARKETING' } }, take: 8 })
  for (const p of STANDARD_PROJECTS) {
    if (!(await prisma.pmProject.findUnique({ where: { key: p.key } }))) await createProjectWithDefaults({ ...p, ownerId: admin.id })
  }
  let n = 0
  for (const key of ['RTI', 'MNC', 'PLS']) {
    const project = await prisma.pmProject.findUniqueOrThrow({ where: { key }, include: { columns: { orderBy: { position: 'asc' } } } })
    const roles: PmProjectRole[] = ['ADMIN', 'MEMBER', 'MEMBER', 'MEMBER', 'VIEWER']
    for (const [i, u] of people.slice(0, 5).entries()) {
      await prisma.pmProjectMember.upsert({ where: { projectId_userId: { projectId: project.id, userId: u.id } }, create: { projectId: project.id, userId: u.id, role: roles[i], addedById: admin.id }, update: {} })
    }
    await syncProjectChannel(project.id)
    if (await prisma.pmTask.count({ where: { projectId: project.id } })) continue
    const label = await prisma.pmLabel.upsert({ where: { projectId_name: { projectId: project.id, name: 'Website' } }, create: { projectId: project.id, name: 'Website', color: '#4F46E5' }, update: {} })
    for (let i = 0; i < 10; i++) {
      const col = project.columns[i % project.columns.length]
      const assignee = people[(i + n) % Math.min(4, people.length)]
      const p = await prisma.pmProject.update({ where: { id: project.id }, data: { taskCounter: { increment: 1 } } })
      const dueOffset = [-30, -2, 0.5, 3, 24, 48, 72, -50, 200, 10][i]
      const priority: Priority = (['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const)[i % 4]
      await prisma.pmTask.create({
        data: {
          projectId: project.id,
          code: `${key}-${p.taskCounter}`,
          title: TITLES[(n + i) % TITLES.length],
          description: 'Demo task created by seedProjectsDemo.ts',
          columnId: col.id,
          position: (i + 1) * 1024,
          priority,
          createdById: admin.id,
          dueAt: new Date(Date.now() + dueOffset * H),
          completedAt: col.category === 'DONE' ? new Date(Date.now() - 5 * H) : null,
          assignees: { create: [{ userId: assignee.id, assignedById: admin.id }] },
          watchers: { create: [{ userId: admin.id }, ...(assignee.id !== admin.id ? [{ userId: assignee.id }] : [])] },
          labels: i % 3 === 0 ? { create: [{ labelId: label.id }] } : undefined,
          checklist: i % 2 === 0 ? { create: [{ text: 'Draft', isDone: true, position: 0 }, { text: 'Review', position: 1 }] } : undefined,
          activity: { create: [{ userId: admin.id, action: 'created', meta: { column: col.name } }] },
        },
      })
    }
    n += 10
  }
  // eslint-disable-next-line no-console
  console.log(`Demo data ready: ${people.length} people, ${n} tasks.`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
