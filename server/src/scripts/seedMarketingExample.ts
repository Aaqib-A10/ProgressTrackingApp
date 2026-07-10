// Idempotent: seed the Marketing example — brands (Minnesota Computers, Recycle
// Technologies) + the July 2026 Master Plan from "99 TECH. MONTHLY TASKS.xlsx".
//   npx tsx src/scripts/seedMarketingExample.ts
import { PrismaClient, type PlanItemStatus } from '@prisma/client'

const prisma = new PrismaClient()
const MONTH = '2026-07'

const BRANDS = [
  { slug: 'mnc', name: 'Minnesota Computers' },
  { slug: 'rti', name: 'Recycle Technologies' },
]

// project: 'mnc' | 'rti' | null (General)
type Row = {
  title: string
  taskType: string
  project: 'mnc' | 'rti' | null
  status: PlanItemStatus
  planned: string
  completion: string | null
  doc: string | null
}
const ITEMS: Row[] = [
  { title: 'Audience Personas Creation for Minnesota Computers', taskType: 'Strategy & Planning', project: 'mnc', status: 'COMPLETED', planned: '2026-07-07', completion: '2026-07-07', doc: 'Minnesota Computers Audience Personas.docx' },
  { title: 'SEO & Content Audit Report Template Creation', taskType: 'Strategy & Planning', project: null, status: 'COMPLETED', planned: '2026-07-07', completion: '2026-07-07', doc: 'SEO & Content Audit Report Template - Minnesota Computers' },
  { title: 'MNC Copywriting Guidebook', taskType: 'Strategy & Planning', project: 'mnc', status: 'COMPLETED', planned: '2026-07-07', completion: '2026-07-07', doc: 'Minnesota Computers Copywriting Guidebook.docx' },
  { title: 'RTI Website Homepage Elements', taskType: 'Website Content', project: 'rti', status: 'COMPLETED', planned: '2026-07-09', completion: '2026-07-09', doc: 'Recommended Homepage Sequence - Recycle Technologies' },
  { title: 'List of Pages & Sections for RTI Website', taskType: 'Website Content', project: 'rti', status: 'COMPLETED', planned: '2026-07-09', completion: '2026-07-09', doc: 'List of Pages with Sections - Recycle Technologies' },
  { title: 'MNC Website Homepage Elements', taskType: 'Website Content', project: 'mnc', status: 'COMPLETED', planned: '2026-07-09', completion: '2026-07-09', doc: 'Minnesota Computers - Homepage Elements List' },
  { title: 'Social Media Calendar Template', taskType: 'Social Media', project: null, status: 'COMPLETED', planned: '2026-07-10', completion: '2026-07-10', doc: 'Social Media Calendar 2026.xlsx' },
  { title: 'Annual Website Content Planner', taskType: 'Strategy & Planning', project: null, status: 'IN_PROGRESS', planned: '2026-07-10', completion: null, doc: null },
]
const STAKEHOLDER = 'Rizwan Haider'
const dbDate = (s: string) => new Date(`${s}T00:00:00.000Z`)

async function main() {
  const dept = await prisma.department.findUnique({ where: { type: 'MARKETING' } })
  if (!dept) throw new Error('Marketing department not found — run the base seed first.')

  // Brands (idempotent by departmentId+slug)
  const brandIds: Record<string, string> = {}
  for (const b of BRANDS) {
    const brand = await prisma.brand.upsert({
      where: { departmentId_slug: { departmentId: dept.id, slug: b.slug } },
      update: { name: b.name, isActive: true },
      create: { departmentId: dept.id, slug: b.slug, name: b.name },
    })
    brandIds[b.slug] = brand.id
  }

  // Master plan for the content sub-dept, month 2026-07
  const contentSub = await prisma.subDepartment.findFirst({ where: { departmentId: dept.id, slug: 'content' } })
  const existing = await prisma.marketingPlan.findFirst({
    where: { departmentId: dept.id, subDepartmentId: contentSub?.id ?? null, month: MONTH },
    include: { items: true },
  })
  if (existing && existing.items.length) {
    console.log(`July plan already has ${existing.items.length} items — skipping.`)
    await prisma.$disconnect()
    return
  }
  const plan =
    existing ??
    (await prisma.marketingPlan.create({
      data: { departmentId: dept.id, subDepartmentId: contentSub?.id ?? null, month: MONTH, title: 'July 2026 Content Plan' },
    }))

  await prisma.marketingPlanItem.createMany({
    data: ITEMS.map((it, i) => ({
      planId: plan.id,
      title: it.title,
      taskType: it.taskType,
      brandId: it.project ? brandIds[it.project] : null,
      stakeholder: STAKEHOLDER,
      status: it.status,
      plannedDate: dbDate(it.planned),
      completionDate: it.completion ? dbDate(it.completion) : null,
      documentLink: it.doc,
      order: i,
    })),
  })
  console.log(`Seeded ${BRANDS.length} brands + July plan with ${ITEMS.length} items.`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
