import { PrismaClient, type Role, type DepartmentType } from '@prisma/client'
import { DateTime } from 'luxon'
import { hashPassword } from '../src/lib/auth'
import { dbDateFromString } from '../src/lib/time'

const prisma = new PrismaClient()
const TZ = process.env.APP_TIMEZONE || 'Asia/Karachi'
const PASSWORD = 'Password123!'

/** Last `count` weekdays (Mon–Fri) up to and including today, oldest first. */
function recentWeekdays(count: number): string[] {
  const out: string[] = []
  let d = DateTime.now().setZone(TZ).startOf('day')
  while (out.length < count) {
    if (d.weekday <= 5) out.unshift(d.toISODate()!)
    d = d.minus({ days: 1 })
  }
  return out
}

async function main() {
  const passwordHash = await hashPassword(PASSWORD)

  // --- Departments ---
  const departments: Record<DepartmentType, string> = {} as Record<DepartmentType, string>
  for (const [type, name] of [
    ['ITAD', 'ITAD'],
    ['LEAD_GEN', 'Lead Generation'],
    ['MARKETING', 'Marketing'],
    ['CSR', 'CSR'],
  ] as [DepartmentType, string][]) {
    const dept = await prisma.department.upsert({
      where: { type },
      update: { name },
      create: { type, name },
    })
    departments[type] = dept.id
  }

  // --- Marketing sub-departments ---
  const subDepts: Record<string, string> = {}
  for (const [slug, name] of [
    ['seo', 'SEO'],
    ['social', 'Social Media'],
    ['content', 'Content Creation'],
  ]) {
    const sd = await prisma.subDepartment.upsert({
      where: { departmentId_slug: { departmentId: departments.MARKETING, slug } },
      update: { name },
      create: { departmentId: departments.MARKETING, slug, name },
    })
    subDepts[slug] = sd.id
  }

  // --- Tags (Lead Gen verticals + Social platforms) ---
  const verticalNames = ['School District', 'Telecommunication', 'Manufacturing', 'Education']
  const verticalIds: string[] = []
  for (const name of verticalNames) {
    const tag = await prisma.tag.upsert({
      where: { departmentId_type_name: { departmentId: departments.LEAD_GEN, type: 'VERTICAL', name } },
      update: {},
      create: { departmentId: departments.LEAD_GEN, type: 'VERTICAL', name },
    })
    verticalIds.push(tag.id)
  }

  // Lead Gen lead types (New Lead / BBR / RTLG) — a separate breakdown dimension.
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

  // --- Users ---
  async function user(email: string, name: string, role: Role, dept?: DepartmentType, subDeptSlug?: string) {
    const subDepartmentId = subDeptSlug ? subDepts[subDeptSlug] : null
    return prisma.user.upsert({
      where: { email },
      update: { name, role, departmentId: dept ? departments[dept] : null, subDepartmentId },
      create: { email, name, role, passwordHash, departmentId: dept ? departments[dept] : null, subDepartmentId },
    })
  }

  const admin = await user('admin@pulsetrack.app', 'Alex Rivera', 'SUPER_ADMIN')
  await user('maria.lopez@pulsetrack.app', 'Maria Lopez', 'TEAM_LEAD', 'ITAD')
  const itadMembers = [
    await user('sarah.jenkins@pulsetrack.app', 'Sarah Jenkins', 'MEMBER', 'ITAD'),
    await user('david.chen@pulsetrack.app', 'David Chen', 'MEMBER', 'ITAD'),
    await user('mark.thompson@pulsetrack.app', 'Mark Thompson', 'MEMBER', 'ITAD'),
    await user('jordan.michaels@pulsetrack.app', 'Jordan Michaels', 'MEMBER', 'ITAD'),
  ]
  await user('omar.farid@pulsetrack.app', 'Omar Farid', 'TEAM_LEAD', 'LEAD_GEN')
  const leadGenMembers = [
    await user('aisha.khan@pulsetrack.app', 'Aisha Khan', 'MEMBER', 'LEAD_GEN'),
    await user('leo.martin@pulsetrack.app', 'Leo Martin', 'MEMBER', 'LEAD_GEN'),
  ]

  // --- CSR department (evaluated by QA, no daily form) ---
  await user('bilal.csr@pulsetrack.app', 'Bilal Ahmed', 'TEAM_LEAD', 'CSR')
  await user('zoya.csr@pulsetrack.app', 'Zoya Malik', 'MEMBER', 'CSR')
  await user('hamza.csr@pulsetrack.app', 'Hamza Sheikh', 'MEMBER', 'CSR')

  // --- QA team (no department; scores ITAD + CSR agents) ---
  await user('hina.qa@pulsetrack.app', 'Hina Qureshi', 'QA')
  await user('omar.qalead@pulsetrack.app', 'Omar Sheikh', 'QA_LEAD')

  // Marketing team (TL + sub-department leads/members)
  await user('nadia.marketing@pulsetrack.app', 'Nadia Hassan', 'TEAM_LEAD', 'MARKETING')
  const seoMember = await user('sam.seo@pulsetrack.app', 'Sam Okafor', 'SUB_DEPT_LEAD', 'MARKETING', 'seo')
  const socialMember = await user('sara.social@pulsetrack.app', 'Sara Mendoza', 'MEMBER', 'MARKETING', 'social')
  const contentMember = await user('chris.content@pulsetrack.app', 'Chris Bauer', 'MEMBER', 'MARKETING', 'content')

  // --- Targets ---
  async function ensureTarget(
    departmentId: string,
    metricKey: string,
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    value: number,
  ) {
    const existing = await prisma.target.findFirst({
      where: { scope: 'DEPARTMENT', departmentId, metricKey, period },
    })
    if (!existing) {
      await prisma.target.create({
        data: { scope: 'DEPARTMENT', departmentId, metricKey, period, value },
      })
    }
  }
  await ensureTarget(departments.ITAD, 'callsDialed', 'DAILY', 100)
  await ensureTarget(departments.LEAD_GEN, 'leadsGenerated', 'WEEKLY', 40)

  // --- Sample daily entries (deterministic, ~2 working weeks) ---
  const days = recentWeekdays(10)

  for (let m = 0; m < itadMembers.length; m++) {
    const member = itadMembers[m]
    for (let d = 0; d < days.length; d++) {
      const isLeave = member.name === 'Jordan Michaels' && d === days.length - 1
      const dialed = 80 + ((m * 11 + d * 7) % 70)
      const connected = Math.round(dialed * (0.28 + ((m + d) % 4) * 0.02))
      const interested = Math.round(connected * 0.35)
      const data = isLeave
        ? { status: 'ON_LEAVE' as const }
        : {
            status: 'SUBMITTED' as const,
            callsDialed: dialed,
            connected,
            voicemail: dialed - connected - 5,
            emailsSent: 20 + (d % 5),
            interested,
            workingOn: Math.round(interested * 1.5),
            closed: Math.round(interested * 0.25),
            rfqs: Math.round(interested * 0.4),
          }
      await prisma.itadDailyEntry.upsert({
        where: { userId_date: { userId: member.id, date: dbDateFromString(days[d]) } },
        update: data,
        create: { userId: member.id, date: dbDateFromString(days[d]), ...data },
      })
    }
  }

  for (let m = 0; m < leadGenMembers.length; m++) {
    const member = leadGenMembers[m]
    for (let d = 0; d < days.length; d++) {
      const leads = 30 + ((m * 9 + d * 5) % 25)
      const qualified = Math.round(leads * 0.45)
      const entry = await prisma.leadGenDailyEntry.upsert({
        where: { userId_date: { userId: member.id, date: dbDateFromString(days[d]) } },
        update: {
          leadsGenerated: leads,
          accountsResearched: leads + 15,
          contactsFound: Math.round(leads * 1.4),
          qualifiedMql: qualified,
          handedToSql: Math.round(qualified * 0.4),
        },
        create: {
          userId: member.id,
          date: dbDateFromString(days[d]),
          status: 'SUBMITTED',
          leadsGenerated: leads,
          accountsResearched: leads + 15,
          contactsFound: Math.round(leads * 1.4),
          qualifiedMql: qualified,
          handedToSql: Math.round(qualified * 0.4),
        },
      })
      // Split leads across the three verticals.
      const splits = [Math.round(leads * 0.5), Math.round(leads * 0.3), leads - Math.round(leads * 0.5) - Math.round(leads * 0.3)]
      for (let v = 0; v < verticalIds.length; v++) {
        await prisma.leadGenVerticalCount.upsert({
          where: { entryId_tagId: { entryId: entry.id, tagId: verticalIds[v] } },
          update: { count: splits[v] },
          create: { entryId: entry.id, tagId: verticalIds[v], count: splits[v] },
        })
      }
    }
  }

  // --- Marketing tasks (Kanban board + editorial calendar) ---
  await prisma.marketingTask.deleteMany({})
  const todayDt = DateTime.now().setZone(TZ).startOf('day')
  const d = (offset: number) => dbDateFromString(todayDt.plus({ days: offset }).toISODate()!)
  await prisma.marketingTask.createMany({
    data: [
      { title: 'Technical SEO audit — sitemap & redirects', discipline: 'SEO', status: 'IN_PROGRESS', assigneeId: seoMember.id, dueDate: d(3) },
      { title: 'Build 10 backlinks (industry directories)', discipline: 'SEO', status: 'BACKLOG', assigneeId: seoMember.id },
      { title: 'Optimize 5 product landing pages', discipline: 'SEO', status: 'IN_REVIEW', assigneeId: seoMember.id, dueDate: d(1) },
      { title: 'Core Web Vitals fixes', discipline: 'SEO', status: 'PUBLISHED', assigneeId: seoMember.id, publishedDate: d(-4) },
      { title: 'LinkedIn campaign — Q3 launch', discipline: 'SOCIAL', status: 'SCHEDULED', assigneeId: socialMember.id, scheduledDate: d(2) },
      { title: 'Instagram reel — customer story', discipline: 'SOCIAL', status: 'IN_PROGRESS', assigneeId: socialMember.id, dueDate: d(4) },
      { title: 'Schedule week of platform posts', discipline: 'SOCIAL', status: 'SCHEDULED', assigneeId: socialMember.id, scheduledDate: d(1) },
      { title: 'Recap post — webinar highlights', discipline: 'SOCIAL', status: 'PUBLISHED', assigneeId: socialMember.id, publishedDate: d(-2) },
      { title: 'Blog: "Outbound KPIs that matter in 2026"', discipline: 'CONTENT', status: 'IN_REVIEW', assigneeId: contentMember.id, contentType: 'BLOG', wordCount: 1200, wordTarget: 1500, dueDate: d(1) },
      { title: 'Landing page copy — ITAD services', discipline: 'CONTENT', status: 'BACKLOG', assigneeId: contentMember.id, contentType: 'LANDING_PAGE', wordTarget: 800 },
      { title: 'Email nurture sequence (3 parts)', discipline: 'CONTENT', status: 'SCHEDULED', assigneeId: contentMember.id, contentType: 'EMAIL', scheduledDate: d(3), wordTarget: 600 },
      { title: 'Case study — Verlex rollout', discipline: 'CONTENT', status: 'PUBLISHED', assigneeId: contentMember.id, contentType: 'BLOG', wordCount: 1400, wordTarget: 1400, publishedDate: d(-3) },
    ],
  })

  // --- SEO & Social daily activity ---
  const mDays = recentWeekdays(8)
  for (let i = 0; i < mDays.length; i++) {
    await prisma.seoDailyEntry.upsert({
      where: { userId_date: { userId: seoMember.id, date: dbDateFromString(mDays[i]) } },
      update: {},
      create: { userId: seoMember.id, date: dbDateFromString(mDays[i]), status: 'SUBMITTED', keywordsTracked: 40 + i, pagesOptimized: 2 + (i % 3), backlinksBuilt: 1 + (i % 4), technicalFixes: i % 3, organicTraffic: 1200 + i * 40 },
    })
    await prisma.socialDailyEntry.upsert({
      where: { userId_date: { userId: socialMember.id, date: dbDateFromString(mDays[i]) } },
      update: {},
      create: { userId: socialMember.id, date: dbDateFromString(mDays[i]), status: 'SUBMITTED', postsPublished: 2 + (i % 3), postsScheduled: 3, reach: 5000 + i * 200, engagement: 300 + i * 15, followersGained: 20 + i },
    })
  }

  // --- QA scorecard: exact Call Quality Monitoring Form (flat points, bands 50/64/82) ---
  const existingCard = await prisma.qaScorecard.findFirst({ where: { name: 'Call Quality Monitoring Form' } })
  if (!existingCard) {
    const yesNo = (texts: string[]) => ({ create: texts.map((text, i) => ({ text, type: 'YES_NO' as const, maxScore: 1, order: i })) })
    const rating = (texts: string[]) => ({ create: texts.map((text, i) => ({ text, type: 'RATING' as const, maxScore: 10, order: i })) })
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

  // eslint-disable-next-line no-console
  console.log(`Seed complete. Login with any seeded email and password "${PASSWORD}".`)
  // eslint-disable-next-line no-console
  console.log('e.g. admin@pulsetrack.app (Super Admin), maria.lopez@pulsetrack.app (ITAD Team Lead), sarah.jenkins@pulsetrack.app (ITAD Member)')
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
