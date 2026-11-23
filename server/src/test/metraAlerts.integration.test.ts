import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany } from '../lib/tenancy'
import { setCompanyFlag, resetFlagCache } from '../lib/flags'
import { mailLog } from '../lib/mail'
import { findAlerts, runAlerts, ALERT_RULES } from '../lib/metra/alerts'
import { runWeekly, weekLines, isWeeklyTime } from '../lib/metra/weekly'

// Metra tells people what needs them without being asked (plan 2026-11, 3.3) and sends leads their week (3.4).

let w: SeededWorld
const NOW = new Date('2026-11-23T04:30:00Z') // Monday 09:30 in Karachi
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000)
const home = <T>(fn: () => Promise<T>) => runAsCompany(HOME_COMPANY_ID, fn)

beforeAll(async () => {
  w = await seedWorld()
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'test')
  await setCompanyFlag('metra-proactive', HOME_COMPANY_ID, true, 'test') // off for 99 Technologies until the owner turns it on
  resetFlagCache()
  await prisma.aiInsight.deleteMany({})
  await prisma.notification.deleteMany({})
  await prisma.lead.deleteMany({})

  // A deal nobody touched for 20 days, one due tomorrow and still active, and one that is fine.
  const deal = (title: string, dueDate: Date, status: 'ACTIVE' | 'SUBMITTED' = 'ACTIVE') => prisma.bid.create({ data: { title, company: 'Acme', type: 'RFQ', agentId: w.itadMember.id, status, dueDate } })
  const stale = await deal('Old laptops', daysAgo(-30), 'SUBMITTED')
  await prisma.$executeRawUnsafe(`UPDATE "Bid" SET "updatedAt" = $1 WHERE id = $2`, daysAgo(20), stale.id)
  await deal('Servers lot', new Date(NOW.getTime() + 20 * 3600_000))
  await deal('Fresh one', daysAgo(-30))

  // Two open leads gone quiet for the same person, one still fresh.
  const biz = await prisma.leadBusiness.create({ data: { name: 'Alert Sales', formKey: `alert-${Date.now().toString(36)}` } })
  const lead = (organization: string, quietDays: number) => prisma.lead.create({ data: { businessId: biz.id, name: 'Someone', organization, status: 'NEW', assigneeId: w.leadgenMember.id, lastActivityAt: daysAgo(quietDays), createdAt: daysAgo(quietDays) } })
  await lead('Globex', 12)
  await lead('Initech', 9)
  await lead('Hooli', 1)

  // One person with six overdue tasks.
  const project = await prisma.pmProject.create({ data: { name: 'Alerts', key: 'ALR', ownerId: w.superAdmin.id } })
  const todo = await prisma.pmColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO' } })
  const done = await prisma.pmColumn.create({ data: { projectId: project.id, name: 'Done', category: 'DONE', position: 1 } })
  for (let i = 0; i < 6; i++) {
    await prisma.pmTask.create({ data: { projectId: project.id, code: `ALR-${i + 1}`, title: `Late ${i}`, columnId: todo.id, createdById: w.superAdmin.id, dueAt: daysAgo(3), isOverdue: true, assignees: { create: { userId: w.inventoryMember.id } } } })
  }
  // Tasks finished: 12 the week before, 3 this week (a fall of 75%).
  for (let i = 0; i < 15; i++) {
    await prisma.pmTask.create({ data: { projectId: project.id, code: `ALR-D${i}`, title: `Done ${i}`, columnId: done.id, createdById: w.superAdmin.id, completedAt: daysAgo(i < 3 ? 2 : 10), assignees: { create: { userId: w.itadMember.id } } } })
  }
  // Attendance last week for the ITAD member (so the weekly summary has something to say).
  for (const d of ['2026-11-16', '2026-11-17', '2026-11-18']) await prisma.attendanceDay.create({ data: { userId: w.itadMember.id, date: new Date(`${d}T00:00:00Z`), checkInAt: new Date(`${d}T05:00:00Z`) } })
})
afterAll(async () => { await prisma.$disconnect() })

describe('Metra alerts nobody asked for', () => {
  it('finds what needs someone, for the right person', async () => {
    const all = await home(() => findAlerts(NOW))
    const of = (type: string) => all.filter((a) => a.type === type)

    expect(of('STALE_DEAL').map((a) => [a.userId, a.title])).toEqual([[w.itadMember.id, 'No change on a deal for 20 days']])
    expect(of('STALE_DEAL')[0].body).toContain('Old laptops (Acme)')
    expect(of('DEAL_DUE').map((a) => a.body)).toEqual(['Servers lot (Acme) is still marked active. Submit it or change its date.'])

    const quiet = of('STALE_LEAD')
    expect(quiet).toHaveLength(1)
    expect(quiet[0].userId).toBe(w.leadgenMember.id)
    expect(quiet[0].title).toBe('2 open leads with nothing logged for a week')
    expect(quiet[0].body).toContain('Globex, Initech')
    expect(quiet[0].body).not.toContain('Hooli')

    // The person's lead is told, not the person.
    expect(of('OVERLOADED').map((a) => [a.userId, a.title])).toEqual([[w.inventoryLead.id, 'inventory member has 6 overdue tasks']])

    const moved = of('NUMBER_MOVED')
    expect(moved.map((a) => a.userId)).toEqual([w.superAdmin.id])
    expect(moved[0].title).toBe('Tasks finished fell 75% this week')
    expect(moved[0].body).toBe('3 in the last 7 days, 12 in the 7 days before.')
    expect(ALERT_RULES.overdueTasks).toBe(5)
  })

  it('tells each one once a week: a row in Metra and a notification', async () => {
    const first = await home(() => runAlerts(NOW))
    expect(first).toBe(5)
    expect(await home(() => runAlerts(new Date(NOW.getTime() + 86400_000)))).toBe(0) // the next day, same week: nothing again
    expect(await prisma.notification.count({ where: { type: 'AI_INSIGHT' } })).toBe(5)

    const mine = (await request(app).get('/api/metra/insights').set(...auth(w.inventoryLead)).expect(200)).body.insights.filter((i: { kind: string }) => i.kind === 'ALERT')
    expect(mine.map((i: { title: string }) => i.title)).toEqual(['inventory member has 6 overdue tasks'])
    expect(mine[0].payload).toMatchObject({ type: 'OVERLOADED', link: '/app/projects' })
    // Nobody else sees it, and "Done" takes it away.
    const others = (await request(app).get('/api/metra/insights').set(...auth(w.inventoryMember)).expect(200)).body.insights.filter((i: { kind: string }) => i.kind === 'ALERT')
    expect(others).toEqual([])
    await request(app).patch(`/api/metra/insights/${mine[0].id}`).set(...auth(w.inventoryLead)).send({ state: 'DONE' }).expect(200)
    expect((await request(app).get('/api/metra/insights').set(...auth(w.inventoryLead)).expect(200)).body.insights.filter((i: { kind: string }) => i.kind === 'ALERT')).toEqual([])

    // The week after, something still wrong is told again.
    expect(await home(() => runAlerts(new Date(NOW.getTime() + 7 * 86400_000)))).toBeGreaterThan(0)
  })

  it('says nothing when Metra is off for the company, or when "Metra speaks first" is off', async () => {
    await prisma.aiInsight.deleteMany({ where: { kind: 'ALERT' } })
    for (const flag of ['metra', 'metra-proactive'] as const) {
      await setCompanyFlag(flag, HOME_COMPANY_ID, false, 'test')
      resetFlagCache()
      expect(await home(() => runAlerts(NOW)), flag).toBe(0)
      expect(await home(() => runWeekly(NOW)), flag).toBe(0)
      await setCompanyFlag(flag, HOME_COMPANY_ID, true, 'test')
    }
    resetFlagCache()
  })
})

describe('The weekly summary for leads and admins', () => {
  it('goes out on Monday morning: the team to its lead, the company to the admin, by email too', async () => {
    expect(isWeeklyTime(NOW, 9)).toBe(true)
    expect(isWeeklyTime(new Date(NOW.getTime() + 86400_000), 9)).toBe(false)
    mailLog.length = 0
    await prisma.user.update({ where: { id: w.itadLead.id }, data: { notifyMuted: ['ai'] } })

    const sent = await home(() => runWeekly(NOW))
    // Each lead gets their team's week and the admin gets the company's.
    const rows = await prisma.aiInsight.findMany({ where: { kind: 'WEEKLY' }, select: { userId: true, title: true, payload: true } })
    expect(sent).toBe(rows.length)
    const byUser = new Map(rows.map((r) => [r.userId, r]))
    expect(byUser.get(w.itadLead.id)?.title).toBe('Your team: week of Nov 16 to Nov 22')
    expect(byUser.get(w.superAdmin.id)?.title).toBe('The company: week of Nov 16 to Nov 22')
    // A lead only hears about their own team: the Lead Generation lead gets leads, no attendance or tasks of others.
    expect((byUser.get(w.leadgenLead.id)!.payload as { text: string }).text).toBe('- Leads: 1 new (2 the week before).')

    const teamText = (byUser.get(w.itadLead.id)!.payload as { text: string }).text
    expect(teamText).toContain('- Attendance: 3 check-ins by 2 people (0 the week before). No check-in all week: itad lead.')
    expect(teamText).toContain('- Tasks: 3 finished (12 the week before).')

    // Everyone who got one is emailed, except the lead who muted AI insights (it is still in Metra for them).
    const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).email
    const to = mailLog.map((m) => m.to)
    expect(to).toContain(await emailOf(w.superAdmin.id))
    expect(to).toContain(await emailOf(w.leadgenLead.id))
    expect(to).not.toContain(await emailOf(w.itadLead.id))
    expect(to).toHaveLength(sent - 1)
    const adminMail = mailLog.find((m) => m.subject === 'The company: week of Nov 16 to Nov 22')!
    expect(adminMail.text).toContain('- Tasks: 3 finished (12 the week before), 6 overdue now.')

    // Shown in Metra, and not made twice.
    const seen = (await request(app).get('/api/metra/insights').set(...auth(w.itadLead)).expect(200)).body.insights.filter((i: { kind: string }) => i.kind === 'WEEKLY')
    expect(seen).toHaveLength(1)
    expect(await home(() => runWeekly(NOW))).toBe(0)
  })

  it('has nothing to say about an empty week', () => {
    expect(weekLines({ from: '2026-11-16', to: '2026-11-22', people: 4, checkIns: 0, checkInsBefore: 0, noCheckIn: [], tasksDone: 0, tasksDoneBefore: 0, tasksOverdue: 0, newLeads: 0, newLeadsBefore: 0, dealsWon: 0, dealsLost: 0, wonMoney: 0 })).toEqual([])
    expect(weekLines({ from: '2026-11-16', to: '2026-11-22', people: 1, checkIns: 1, checkInsBefore: 2, noCheckIn: [], tasksDone: 0, tasksDoneBefore: 0, tasksOverdue: 0, newLeads: 4, newLeadsBefore: 9, dealsWon: 2, dealsLost: 1, wonMoney: 12500 })).toEqual([
      'Attendance: 1 check-in by 1 person (2 the week before).',
      'Leads: 4 new (9 the week before).',
      'Deals: 2 won worth $12,500, 1 lost.',
    ])
  })
})
