import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyTz } from '../lib/time'
import { completeOnTouch, dialerSettings, periodStartOf, syncAutoTasks, taskSelect, taskView } from '../lib/dialer/tasks'
import { loadOwnLead, scopeOwners, whoAmI } from './dialerController'

/**
 * Lead Dialer touches and tasks (ITAD revised spec, 30 Oct 2026). A rep logs a touch (an outcome
 * chip or Add touch), adds a task, ticks it, and sees their task history. Everything is the rep's
 * own: tasks belong to the agent who owns the lead, and nobody changes another agent's task or
 * touches. Managers can look (as on the rest of the Lead Dialer), not change.
 */

const OUTCOME = z.enum(['NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER', 'CONNECTED', 'WRONG_NUMBER'])
const OUTCOME_LABEL: Record<string, string> = { NO_ANSWER: 'No answer', VOICEMAIL: 'Voicemail', GATEKEEPER: 'Gatekeeper', CONNECTED: 'Connected', WRONG_NUMBER: 'Wrong number' }
const KIND = z.enum(['CALL', 'EMAIL', 'TODO'])
const KIND_LABEL: Record<string, string> = { CALL: 'Call', EMAIL: 'Email', TODO: 'To-do' }
const reminders = z.array(z.number().int().min(0).max(1440)).max(4)

/** A touch date: a day (YYYY-MM-DD, logged at the current time of day) or a full time. Backdating is fine; the future is not. */
function touchDate(v: string | undefined, now: Date): Date | null {
  if (!v) return now
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${now.toISOString().slice(11)}`) : new Date(v)
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 3600000 || d.getTime() < now.getTime() - 2 * 365 * 86400000) return null
  return d
}

/** Log one touch on a lead of the rep's own (shared by the single and bulk calls). */
async function logTouch(lead: { id: string; ownerId: string; status: string; crmUpdateWhat: string | null }, userId: string, at: Date, outcome: string | null, earthzoneTick: boolean) {
  const now = new Date()
  const leadData: Prisma.DialerLeadUpdateInput = { lastActionAt: now }
  if (outcome === 'WRONG_NUMBER') leadData.wrongNumber = true
  // The call itself belongs in Earthzone (the CRM): the lead is marked until the rep says it is done there.
  if (outcome && earthzoneTick) {
    leadData.needsCrmUpdate = true
    leadData.crmUpdateWhat = [...new Set([...(lead.crmUpdateWhat?.split(', ').filter(Boolean) ?? []), 'call outcome'])].join(', ')
  }
  await prisma.$transaction([
    prisma.dialerTouch.create({ data: { leadId: lead.id, at, source: 'MANUAL', kind: 'TOUCH', outcome, confidence: 'EXACT', status: lead.status, userId } }),
    prisma.dialerAction.create({ data: { leadId: lead.id, userId, kind: 'TOUCH', note: outcome ? OUTCOME_LABEL[outcome] : 'Touch logged', at } }),
    prisma.dialerLead.update({ where: { id: lead.id }, data: leadData }),
  ])
  await completeOnTouch(lead.id, lead.ownerId, outcome ? OUTCOME_LABEL[outcome] : 'Touched', now)
}

const touchSchema = z.object({ at: z.string().max(40).optional(), outcome: OUTCOME.nullable().optional() })

/** POST /api/dialer/leads/:id/touches — an outcome chip (one tap) or Add touch (any date, optional outcome). */
export async function addTouch(req: AuthedRequest, res: Response): Promise<void> {
  const got = await loadOwnLead(req, res)
  if (!got) return
  if (got.lead.ownerId !== got.me.id) { res.status(403).json({ error: 'Only the rep who owns this lead can log a touch on it.' }); return }
  const p = touchSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Pick a date and, if you like, an outcome.' }); return }
  const at = touchDate(p.data.at, new Date())
  if (!at) { res.status(400).json({ error: 'Pick a date that is not in the future.' }); return }
  const settings = await dialerSettings()
  await logTouch(got.lead, got.me.id, at, p.data.outcome ?? null, settings.earthzoneTick)
  await syncAutoTasks([got.lead.ownerId])
  res.status(201).json({ ok: true })
}

/** DELETE /api/dialer/touches/:id — dismiss a touch from the lead's timeline (e.g. a re-assignment that looked like a call). */
export async function dismissTouch(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const t = await prisma.dialerTouch.findUnique({ where: { id: req.params.id }, select: { id: true, dismissedAt: true, lead: { select: { ownerId: true } } } })
  if (!t) { res.status(404).json({ error: 'Touch not found' }); return }
  if (t.lead.ownerId !== me.id) { res.status(403).json({ error: 'Only the rep who owns this lead can change its touches.' }); return }
  if (!t.dismissedAt) await prisma.dialerTouch.update({ where: { id: t.id }, data: { dismissedAt: new Date() } })
  await syncAutoTasks([me.id])
  res.status(204).end()
}

const taskSchema = z.object({
  leadId: z.string().min(1),
  kind: KIND,
  dueAt: z.string().datetime(),
  note: z.string().trim().max(2000).optional(),
  reminders: reminders.optional(),
})

async function createTask(lead: { id: string; ownerId: string; company: string }, d: { kind: string; dueAt: Date; note?: string | null; reminders?: number[] }, defaults: number[]) {
  return prisma.workLogEntry.create({
    data: {
      userId: lead.ownerId, period: 'DAY', periodStart: periodStartOf(d.dueAt), title: `${KIND_LABEL[d.kind]}: ${lead.company}`.slice(0, 200), details: d.note || null,
      dialerLeadId: lead.id, taskKind: d.kind, dueAt: d.dueAt, origin: 'MANUAL', remindMinutes: d.reminders ?? defaults,
    },
    select: taskSelect,
  })
}

/** POST /api/dialer/tasks — + Add task on one of my leads: Call, Email or To-do, due date and time, note, reminders. */
export async function addTask(req: AuthedRequest, res: Response): Promise<void> {
  const p = taskSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Pick a lead, a type and a due time.' }); return }
  const me = await whoAmI(req)
  const lead = await prisma.dialerLead.findUnique({ where: { id: p.data.leadId }, select: { id: true, ownerId: true, company: true } })
  if (!lead || lead.ownerId !== me.id) { res.status(404).json({ error: 'Pick one of your own leads.' }); return }
  const settings = await dialerSettings()
  const t = await createTask(lead, { kind: p.data.kind, dueAt: new Date(p.data.dueAt), note: p.data.note, reminders: p.data.reminders }, settings.taskReminders)
  res.status(201).json({ task: taskView(t) })
}

const taskEdit = z.object({
  done: z.boolean().optional(),
  outcome: z.string().trim().max(60).nullable().optional(),
  dueAt: z.string().datetime().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  reminders: reminders.optional(),
})

/** PATCH /api/dialer/tasks/:id — tick it (done, with an outcome), untick, move the due time, change the note. Own tasks only. */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  const p = taskEdit.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid change' }); return }
  const me = await whoAmI(req)
  const t = await prisma.workLogEntry.findUnique({ where: { id: req.params.id }, select: { ...taskSelect, dialerLead: { select: { id: true, ownerId: true } } } })
  if (!t || !t.dialerLeadId) { res.status(404).json({ error: 'Task not found' }); return }
  if (t.userId !== me.id) { res.status(403).json({ error: 'This task belongs to another rep.' }); return }
  if (t.cancelledAt) { res.status(400).json({ error: 'This task is no longer needed.' }); return }
  const d = p.data
  const now = new Date()
  const data: Prisma.WorkLogEntryUpdateInput = {}
  if (d.done === true) Object.assign(data, { status: 'DONE', doneAt: t.doneAt ?? now, outcome: d.outcome ?? t.outcome })
  if (d.done === false) Object.assign(data, { status: 'PLANNED', doneAt: null, outcome: null })
  if (d.done === undefined && d.outcome !== undefined) data.outcome = d.outcome
  if (d.dueAt) { const due = new Date(d.dueAt); Object.assign(data, { dueAt: due, periodStart: periodStartOf(due), remindersSent: [] }) }
  if (d.note !== undefined) data.details = d.note || null
  if (d.reminders) Object.assign(data, { remindMinutes: d.reminders, remindersSent: [] })
  const saved = await prisma.workLogEntry.update({ where: { id: t.id }, data, select: taskSelect })
  // A call back is the lead's Call later: done clears it, a new time moves it.
  if (t.autoReason === 'CALL_LATER' && t.dialerLead) {
    if (d.done === true) await prisma.dialerLead.update({ where: { id: t.dialerLead.id }, data: { callLaterAt: null } })
    else if (d.dueAt) await prisma.dialerLead.update({ where: { id: t.dialerLead.id }, data: { callLaterAt: new Date(d.dueAt) } })
  }
  res.json({ task: taskView(saved) })
}

/**
 * GET /api/dialer/tasks/history?from=&to=&kind=&rep= — Task history: open tasks (overdue, due
 * today and upcoming) and completed ones in the range (newest first, done on time or late), with
 * the summary: completed this week, share done on time, average days late.
 */
export async function taskHistory(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const owners = await scopeOwners(req, me)
  if (!owners) { res.status(403).json({ error: 'You can only see your own tasks.' }); return }
  const now = new Date()
  const parse = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? DateTime.fromISO(v, { zone: companyTz() }) : null)
  const from = (parse(req.query.from) ?? DateTime.fromJSDate(now).setZone(companyTz()).minus({ days: 30 })).startOf('day').toJSDate()
  const to = (parse(req.query.to) ?? DateTime.fromJSDate(now).setZone(companyTz())).endOf('day').toJSDate()
  const kind = KIND.safeParse(req.query.kind).success ? String(req.query.kind) : null
  const rows = await prisma.workLogEntry.findMany({
    where: {
      userId: { in: owners }, dialerLeadId: { not: null }, cancelledAt: null, ...(kind ? { taskKind: kind } : {}),
      OR: [{ status: { not: 'DONE' } }, { doneAt: { gte: from, lte: to } }],
    },
    orderBy: [{ dueAt: 'asc' }],
    take: 5000,
    select: { ...taskSelect, dialerLead: { select: { company: true, contactName: true, status: true } }, user: { select: { name: true } } },
  })
  const weekStart = DateTime.fromJSDate(now).setZone(companyTz()).startOf('week').toJSDate()
  const doneWithDue = rows.filter((r) => r.status === 'DONE' && r.doneAt && r.dueAt)
  const late = doneWithDue.filter((r) => r.doneAt! > r.dueAt!)
  const daysLate = late.map((r) => (r.doneAt!.getTime() - r.dueAt!.getTime()) / 86400000)
  res.json({
    tasks: rows.map((r) => ({ ...taskView(r), company: r.dialerLead?.company ?? '', contactName: r.dialerLead?.contactName ?? null, leadStatus: r.dialerLead?.status ?? null, owner: r.user.name, createdAt: r.createdAt.toISOString(), onTime: r.status === 'DONE' && r.doneAt && r.dueAt ? r.doneAt <= r.dueAt : null })),
    summary: {
      completedThisWeek: rows.filter((r) => r.status === 'DONE' && r.doneAt && r.doneAt >= weekStart).length,
      onTimePct: doneWithDue.length ? Math.round(((doneWithDue.length - late.length) / doneWithDue.length) * 100) : null,
      avgDaysLate: daysLate.length ? Math.round((daysLate.reduce((a, b) => a + b, 0) / daysLate.length) * 10) / 10 : null,
    },
    range: { from: from.toISOString(), to: to.toISOString() },
  })
}

const bulkSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(2000),
  action: z.enum(['SNOOZE', 'ADD_TASK', 'LOG_TOUCH', 'RESCHEDULE']),
  at: z.string().max(40).optional(),
  kind: KIND.optional(),
  outcome: OUTCOME.nullable().optional(),
  note: z.string().trim().max(2000).optional(),
})

/**
 * POST /api/dialer/bulk — the bar over picked rows: Snooze, Reassign the due date of their open
 * tasks, Add task, Log touch. Only the rep's own leads and own tasks are changed.
 */
export async function bulkAction(req: AuthedRequest, res: Response): Promise<void> {
  const p = bulkSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Pick leads and an action.' }); return }
  const me = await whoAmI(req)
  const leads = await prisma.dialerLead.findMany({ where: { id: { in: p.data.leadIds }, ownerId: me.id }, select: { id: true, ownerId: true, company: true, status: true, crmUpdateWhat: true } })
  if (!leads.length) { res.status(404).json({ error: 'None of the picked leads are yours.' }); return }
  const d = p.data
  const now = new Date()
  const settings = await dialerSettings()
  const ids = leads.map((l) => l.id)
  let updated = 0
  if (d.action === 'SNOOZE') {
    const until = d.at ? new Date(d.at) : null
    if (!until || Number.isNaN(until.getTime()) || until <= now) { res.status(400).json({ error: 'Pick a date in the future.' }); return }
    await prisma.$transaction([
      prisma.dialerLead.updateMany({ where: { id: { in: ids } }, data: { snoozeUntil: until, callLaterAt: null, lastActionAt: now } }),
      prisma.dialerAction.createMany({ data: ids.map((id) => ({ leadId: id, userId: me.id, kind: 'SNOOZE', note: d.note ?? 'Snoozed (bulk)', at: until })) }),
    ])
    updated = ids.length
  } else if (d.action === 'ADD_TASK') {
    const due = d.at ? new Date(d.at) : null
    if (!due || Number.isNaN(due.getTime()) || !d.kind) { res.status(400).json({ error: 'Pick a type and a due time.' }); return }
    for (const l of leads) { await createTask(l, { kind: d.kind, dueAt: due, note: d.note }, settings.taskReminders); updated++ }
  } else if (d.action === 'LOG_TOUCH') {
    const at = touchDate(d.at, now)
    if (!at) { res.status(400).json({ error: 'Pick a date that is not in the future.' }); return }
    for (const l of leads) { await logTouch(l, me.id, at, d.outcome ?? null, settings.earthzoneTick); updated++ }
  } else {
    const due = d.at ? new Date(d.at) : null
    if (!due || Number.isNaN(due.getTime())) { res.status(400).json({ error: 'Pick the new due time.' }); return }
    const open = await prisma.workLogEntry.findMany({ where: { dialerLeadId: { in: ids }, userId: me.id, status: { not: 'DONE' }, cancelledAt: null, OR: [{ autoReason: null }, { autoReason: { not: 'FOLLOW_UP_RULE' } }] }, select: { id: true, autoReason: true, dialerLeadId: true } })
    if (open.length) {
      await prisma.workLogEntry.updateMany({ where: { id: { in: open.map((t) => t.id) } }, data: { dueAt: due, periodStart: periodStartOf(due), remindersSent: [] } })
      const callBacks = open.filter((t) => t.autoReason === 'CALL_LATER').map((t) => t.dialerLeadId!)
      if (callBacks.length) await prisma.dialerLead.updateMany({ where: { id: { in: callBacks } }, data: { callLaterAt: due } })
    }
    updated = open.length
  }
  await syncAutoTasks([me.id])
  res.json({ updated, skipped: p.data.leadIds.length - leads.length })
}
