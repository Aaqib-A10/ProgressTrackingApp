import { PrismaClient, type DepartmentType } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'

const prisma = new PrismaClient()
const PASSWORD = 'Password123!'

// Question builders for QA scorecards: Yes/No (1 pt) and 1–10 rating.
const yesNo = (texts: string[]) => ({ create: texts.map((text, i) => ({ text, type: 'YES_NO' as const, maxScore: 1, order: i })) })
const rating = (texts: string[]) => ({ create: texts.map((text, i) => ({ text, type: 'RATING' as const, maxScore: 10, order: i })) })

async function main() {
  const passwordHash = await hashPassword(PASSWORD)

  // --- Departments ---
  const departments: Record<DepartmentType, string> = {} as Record<DepartmentType, string>
  for (const [type, name] of [
    ['ITAD', 'ITAD'],
    ['LEAD_GEN', 'Lead Generation'],
    ['MARKETING', 'Marketing'],
    ['CSR', 'CSR'],
    ['ECOMMERCE', 'Ecommerce'],
  ] as [DepartmentType, string][]) {
    const dept = await prisma.department.upsert({ where: { type }, update: { name }, create: { type, name } })
    departments[type] = dept.id
  }

  // --- Marketing sub-departments ---
  for (const [slug, name] of [
    ['seo', 'SEO'],
    ['social', 'Social Media'],
    ['content', 'Content Creation'],
  ]) {
    await prisma.subDepartment.upsert({
      where: { departmentId_slug: { departmentId: departments.MARKETING, slug } },
      update: { name },
      create: { departmentId: departments.MARKETING, slug, name },
    })
  }

  // --- Tags (Lead Gen verticals + lead types, Social platforms) ---
  for (const name of ['School District', 'Telecommunication', 'Manufacturing', 'Education']) {
    await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.LEAD_GEN, type: 'VERTICAL', name } },
      update: {},
      create: { departmentId: departments.LEAD_GEN, type: 'VERTICAL', name },
    })
  }
  for (const name of ['New Lead', 'BBR – Bulk Buy Report', 'RTLG – Report to Lead Gen']) {
    await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.LEAD_GEN, type: 'LEAD_TYPE', name } },
      update: {},
      create: { departmentId: departments.LEAD_GEN, type: 'LEAD_TYPE', name },
    })
  }
  for (const name of ['Facebook', 'Instagram', 'LinkedIn', 'X']) {
    await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.MARKETING, type: 'PLATFORM', name } },
      update: {},
      create: { departmentId: departments.MARKETING, type: 'PLATFORM', name },
    })
  }
  // Ecommerce marketplaces + listing task types (admin-editable).
  for (const name of ['Amazon', 'eBay', 'Walmart', 'Newegg']) {
    await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.ECOMMERCE, type: 'MARKETPLACE', name } },
      update: {},
      create: { departmentId: departments.ECOMMERCE, type: 'MARKETPLACE', name },
    })
  }
  for (const name of ['BTO Listings', 'Kits', 'Pricing', 'General Listings']) {
    await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.ECOMMERCE, type: 'TASK_TYPE', name } },
      update: {},
      create: { departmentId: departments.ECOMMERCE, type: 'TASK_TYPE', name },
    })
  }

  // --- Admin account (the only seeded user; all real users are created in-app) ---
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pulsetrack.app' },
    update: { name: 'Super Admin', role: 'SUPER_ADMIN' },
    create: { email: 'admin@pulsetrack.app', name: 'Super Admin', role: 'SUPER_ADMIN', passwordHash },
  })

  // --- Department targets (drive green/amber/red status) ---
  async function ensureTarget(departmentId: string, metricKey: string, period: 'DAILY' | 'WEEKLY' | 'MONTHLY', value: number) {
    const existing = await prisma.target.findFirst({ where: { scope: 'DEPARTMENT', departmentId, metricKey, period } })
    if (!existing) await prisma.target.create({ data: { scope: 'DEPARTMENT', departmentId, metricKey, period, value } })
  }
  await ensureTarget(departments.ITAD, 'callsDialed', 'DAILY', 100)
  await ensureTarget(departments.LEAD_GEN, 'leadsGenerated', 'WEEKLY', 40)

  // --- QA scorecard: standard Call Quality Monitoring Form (any department) ---
  if (!(await prisma.qaScorecard.findFirst({ where: { name: 'Call Quality Monitoring Form', departmentType: null } }))) {
    await prisma.qaScorecard.create({
      data: {
        name: 'Call Quality Monitoring Form',
        description: 'Standard 20-question call-quality form (Yes/No + 1–10), scored by total points.',
        passThreshold: 50,
        bandGood: 64,
        bandExcellent: 82,
        createdById: admin.id,
        categories: {
          create: [
            { name: 'Greeting', order: 0, questions: yesNo([
              'Did the agent say thank you for calling or apply a local greeting?',
              'Did the agent mention the company name?',
              'Did the agent mention his/her name?',
              'Did the agent offer assistance to the caller?',
              'If the call was transferred did the agent adapt the greeting accordingly?',
            ]) },
            { name: 'Handling Contact', order: 1, questions: yesNo([
              'Did the agent ask for / confirm the caller’s name?',
              'Did the agent ask for / confirm the caller’s company name?',
              'Did the agent maintain professionalism throughout?',
              'Did the agent display an accurate and appropriate tone during the call?',
              'Did the agent avoid jargon or technical confusion?',
            ]) },
            { name: 'Solution Information', order: 2, questions: rating([
              'Full details of the call were obtained and understood',
              'Did the agent build rapport with the prospect?',
            ]) },
            { name: 'Notifications', order: 3, questions: rating([
              'Did the agent maintain an engaging and confident tone?',
              'Agent did not interrupt or talk over the customer',
            ]) },
            { name: 'Telephony skills', order: 4, questions: rating([
              'Correct procedures followed for placing a customer on hold',
              'Did the agent tailor the pitch based on customer needs?',
            ]) },
            { name: 'Soft skills', order: 5, questions: rating([
              'Agent used effective questioning skills',
              'Agent demonstrated active listening',
            ]) },
            { name: 'End call', order: 6, questions: rating([
              'Did the agent avoid misleading statements?',
              'Did the agent handle the interaction efficiently?',
            ]) },
          ],
        },
      },
    })
  }

  // --- QA scorecard: CSR Call Quality Monitoring Form ---
  if (!(await prisma.qaScorecard.findFirst({ where: { name: 'Call Quality Monitoring Form', departmentType: 'CSR' } }))) {
    await prisma.qaScorecard.create({
      data: {
        name: 'Call Quality Monitoring Form',
        description: 'CSR call-quality scorecard',
        departmentType: 'CSR',
        passThreshold: 50,
        bandGood: 64,
        bandExcellent: 82,
        createdById: admin.id,
        categories: {
          create: [
            { name: 'Greeting', order: 0, questions: yesNo([
              'Professional Greeting Used?',
              'Active Listening/Engagement',
              'Maintained Professionalism',
              'Appropriate Tone Used',
              'Tone Confidence/Engagement',
            ]) },
            { name: 'Handling Contact', order: 1, questions: yesNo([
              'Avoided Technical Jargon',
              'Used Effective Questioning',
              'Was the Core Issue Identified',
              'Was the Root Cause Explained',
              'Product Expertise Shown',
            ]) },
            { name: 'Solution Information', order: 2, questions: rating([
              'Was Troubleshooting done properly without providing Replacement',
              'Rebuttals/Objection Handling of the agent',
            ]) },
            { name: 'Notifications', order: 3, questions: rating([
              'Did the agent demonstrate Active Listening',
              'Agent sounded friendly, polite and welcoming',
            ]) },
            { name: 'Telephony skills', order: 4, questions: rating([
              'Agent avoided long silences during the call',
              'Correct procedures followed for placing a customer on hold',
            ]) },
            { name: 'Soft skills', order: 5, questions: rating([
              'Was the final resolution provided clear and confirmed?',
              'Was the transition from "problem" to "solution" smooth?',
            ]) },
            { name: 'End call', order: 6, questions: rating([
              'Did the agent avoid misleading statements?',
              'Did the agent ask if there was anything else they could assist with?',
            ]) },
          ],
        },
      },
    })
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete — departments, tags, targets, QA scorecards (standard + CSR), and the admin account.')
  // eslint-disable-next-line no-console
  console.log(`Admin login: admin@pulsetrack.app / "${PASSWORD}". All other users are added in-app.`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
