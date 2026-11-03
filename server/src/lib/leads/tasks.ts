import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from '../prisma'
import { forEachCompany } from '../company'
import { runTracked } from '../health/jobs'
import { isOn } from '../flags'
import { maybeCompanyId } from '../tenancy'
import { PHOENIX, type TaskKind } from './pipeline'
import { tellAboutLead } from './notify'

/**
 * Agent Tasks made by Metriq from the flow, so nothing depends on anyone remembering. One open
 * task of a kind per lead: making it again moves the date instead of adding a second one.
 */
export async function makeTask(opts: { leadId: string; businessId: string; assigneeId: string | null; kind: TaskKind; title: string; notes?: string; dueAt: Date; actorId?: string | null; notify?: boolean }): Promise<{ id: string }> {
  const open = await prisma.leadTask.findFirst({ where: { leadId: opts.leadId, kind: opts.kind, doneAt: null }, select: { id: true } })
  const t = open
    ? await prisma.leadTask.update({ where: { id: open.id }, data: { assigneeId: opts.assigneeId, title: opts.title, notes: opts.notes ?? '', dueAt: opts.dueAt, remindedAt: null }, select: { id: true } })
    : await prisma.leadTask.create({ data: { leadId: opts.leadId, businessId: opts.businessId, assigneeId: opts.assigneeId, kind: opts.kind, title: opts.title, notes: opts.notes ?? '', dueAt: opts.dueAt }, select: { id: true } })
  await prisma.leadEvent.create({ data: { leadId: opts.leadId, userId: opts.actorId ?? null, kind: 'TASK', text: `${open ? 'Task moved' : 'Task'}: ${opts.title} · due ${DateTime.fromJSDate(opts.dueAt, { zone: PHOENIX }).toFormat('d LLL, h:mm a')}`, data: { taskId: t.id, kind: opts.kind } } })
  if (opts.notify !== false && opts.assigneeId && opts.assigneeId !== opts.actorId) {
    await tellAboutLead([opts.assigneeId], { type: 'LEAD_TASK', title: `New task: ${opts.title}`, body: `Due ${DateTime.fromJSDate(opts.dueAt, { zone: PHOENIX }).toFormat('ccc d LLL, h:mm a')} (Phoenix)`, leadId: opts.leadId, link: `/app/leads/tasks?task=${t.id}`, actorId: opts.actorId })
  }
  return t
}

/** Close every open task of these kinds on a lead (the step happened). */
export async function closeTasks(leadId: string, kinds: TaskKind[], byId: string | null, outcome?: string): Promise<number> {
  const r = await prisma.leadTask.updateMany({ where: { leadId, kind: { in: kinds }, doneAt: null }, data: { doneAt: new Date(), doneById: byId, outcome: outcome ?? null } })
  return r.count
}

/** 10:00 Phoenix on a day (or another hour). */
export const atPhoenix = (d: DateTime, hour = 10) => d.setZone(PHOENIX).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate()

/** Every 5 minutes: a bell when a task comes due (once per task). */
export async function runLeadTaskTick(now = new Date()): Promise<{ due: number }> {
  const companyId = maybeCompanyId()
  if (companyId && !(await isOn('lead-management', companyId))) return { due: 0 }
  const due = await prisma.leadTask.findMany({ where: { doneAt: null, remindedAt: null, dueAt: { lte: now }, assigneeId: { not: null } }, take: 200, include: { lead: { select: { name: true, organization: true } } } })
  let n = 0
  for (const t of due) {
    const c = await prisma.leadTask.updateMany({ where: { id: t.id, remindedAt: null }, data: { remindedAt: now } })
    if (c.count !== 1) continue
    n++
    await tellAboutLead([t.assigneeId], { type: 'LEAD_TASK', title: `Due now: ${t.title}`, body: t.lead.organization || t.lead.name, leadId: t.leadId, link: `/app/leads/tasks?task=${t.id}` })
  }
  return { due: n }
}

/** Every weekday morning 9:00 Phoenix: a digest to each person with today's and overdue tasks. */
export async function runLeadMorningDigest(now = new Date()): Promise<{ people: number }> {
  const companyId = maybeCompanyId()
  if (companyId && !(await isOn('lead-management', companyId))) return { people: 0 }
  const day = DateTime.fromJSDate(now, { zone: PHOENIX })
  const open = await prisma.leadTask.groupBy({ by: ['assigneeId'], where: { doneAt: null, dueAt: { lte: day.endOf('day').toJSDate() }, assigneeId: { not: null } }, _count: { _all: true } })
  let people = 0
  for (const g of open) {
    if (!g.assigneeId) continue
    const overdue = await prisma.leadTask.count({ where: { assigneeId: g.assigneeId, doneAt: null, dueAt: { lt: day.startOf('day').toJSDate() } } })
    people++
    await tellAboutLead([g.assigneeId], { type: 'LEAD_TASK', title: `Today: ${g._count._all} lead task${g._count._all === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}`, body: 'Open Agent Tasks to work through them.', leadId: '', link: '/app/leads/tasks' })
  }
  return { people }
}

export function startLeadTasks(): void {
  cron.schedule('*/5 * * * *', () => {
    runTracked('lead-tasks', () => forEachCompany(() => runLeadTaskTick())).catch((e) => console.error('[lead-tasks]', e))
  })
  cron.schedule('0 9 * * 1-5', () => {
    runTracked('lead-digest', () => forEachCompany(() => runLeadMorningDigest())).catch((e) => console.error('[lead-digest]', e))
  }, { timezone: PHOENIX })
}
