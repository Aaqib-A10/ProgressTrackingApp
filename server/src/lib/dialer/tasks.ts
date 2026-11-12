import cron from 'node-cron'
import { DateTime } from 'luxon'
import type { Prisma, WorkLogEntry } from '@prisma/client'
import { prisma } from '../prisma'
import { companyTz } from '../time'
import { forEachCompany } from '../company'
import { runTracked } from '../health/jobs'
import { withDefaults, type DialerSettingsData } from './rules'
import { lastTouchedAt, touchStats } from './touches'
import { autoCloseBy } from './noteTouches'
import { REGION_META, daysQuiet, isBlocked, isClosed, lastTouched, leadRegion, neverWorked, regionWindow, ruleDays, type DialerLead as ViewLead, type DialerSettings as ViewSettings } from './view'

/**
 * Lead Dialer tasks (ITAD revised spec, 30 Oct 2026, section 4). They are My To-Do entries
 * (WorkLogEntry) linked to a lead, not a second task system:
 *
 *  - Each task belongs to the agent who owns the lead. Nobody moves another agent's task.
 *  - Manual: + Add task (Call, Email or To-do, a due date and time, a note, reminders).
 *  - Automatic, at most one open per lead and reason:
 *      FOLLOW_UP_RULE  the lead is (or by tomorrow will be) quiet longer than its stage rule;
 *                      due at 9 AM on the lead's clock on the day the rule runs out.
 *      CALL_LATER      Call later (or a note's next-action date) set a call back.
 *    When the lead no longer qualifies (its status moved, it was snoozed, dropped...), the open
 *    automatic task is closed as no longer needed (cancelledAt), never as done by the rep. When
 *    the rep logs a touch on the lead, its call tasks are done, with the outcome.
 *  - Reminders: in the app, 15 minutes before and at the due time (the company can change it),
 *    saying whether the lead can be called then (9 AM to 5 PM on the lead's clock).
 *  - Automatic follow-up tasks stay out of My To-Do itself (there can be hundreds); they live in
 *    the Lead Dialer's Follow-ups. Call backs and manual tasks show in My To-Do too.
 */

export type TaskKind = 'CALL' | 'EMAIL' | 'TODO'
export type AutoReason = 'FOLLOW_UP_RULE' | 'CALL_LATER'

export async function dialerSettings(): Promise<DialerSettingsData> {
  const row = await prisma.dialerSettings.findUnique({ where: { id: 'default' } })
  return withDefaults(row?.data)
}

/** The day a task shows on in My To-Do (company time zone). */
export function periodStartOf(dueAt: Date): Date {
  return new Date(`${DateTime.fromJSDate(dueAt).setZone(companyTz()).toISODate()}T00:00:00.000Z`)
}

export function taskView(e: Pick<WorkLogEntry, 'id' | 'dialerLeadId' | 'userId' | 'taskKind' | 'title' | 'details' | 'dueAt' | 'origin' | 'autoReason' | 'status' | 'cancelledAt' | 'doneAt' | 'outcome' | 'remindMinutes'> & { autoClosedBy?: string | null }) {
  return {
    id: e.id, leadId: e.dialerLeadId ?? '', ownerId: e.userId, kind: (e.taskKind ?? 'TODO') as TaskKind, title: e.title, note: e.details,
    dueAt: e.dueAt?.toISOString() ?? null, origin: (e.origin ?? 'MANUAL') as 'MANUAL' | 'AUTO', reason: (e.autoReason ?? null) as AutoReason | null,
    status: e.cancelledAt ? 'CANCELLED' as const : e.status === 'DONE' ? 'DONE' as const : 'OPEN' as const,
    doneAt: e.doneAt?.toISOString() ?? null, outcome: e.outcome, reminders: e.remindMinutes,
    /** Closed by itself (ITAD update 12 Nov, section 4): the agent's contact that closed it ("Note on 14 Nov (Earth Zone)"). */
    autoClosedBy: e.autoClosedBy ?? null,
  }
}
export type TaskView = ReturnType<typeof taskView>
export const taskSelect = { id: true, dialerLeadId: true, userId: true, taskKind: true, title: true, details: true, dueAt: true, origin: true, autoReason: true, status: true, cancelledAt: true, doneAt: true, outcome: true, remindMinutes: true, autoClosedBy: true, createdAt: true } as const

/** Open Lead Dialer tasks of these owners, and the ones done since `since`. */
export async function tasksFor(ownerIds: string[], since: Date): Promise<TaskView[]> {
  const rows = await prisma.workLogEntry.findMany({
    where: { userId: { in: ownerIds }, dialerLeadId: { not: null }, cancelledAt: null, OR: [{ status: { not: 'DONE' } }, { doneAt: { gte: since } }] },
    select: taskSelect,
  })
  return rows.map(taskView)
}

const LEAD_SELECT = {
  id: true, ownerId: true, company: true, status: true, stage: true, state: true, stateOverride: true, region: true, zoneOverride: true, duplicate: true,
  followUpDropped: true, snoozeUntil: true, callLaterAt: true, lastActivityAt: true, leadDate: true, createdAt: true, statusChangedAt: true, doNotCall: true, wrongNumber: true,
} as const
type LeadRow = Prisma.DialerLeadGetPayload<{ select: typeof LEAD_SELECT }>

/**
 * When each lead's latest follow-up closed by itself, at the time of the contact that closed it (ITAD update
 * 12 Nov, section 4): the quiet clock restarts there, so the next follow-up comes one stage interval later even
 * when the contact was a status change rather than a note.
 */
export async function autoClosedAt(leadIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (!leadIds.length) return out
  for (let i = 0; i < leadIds.length; i += 5000) {
    const rows = await prisma.workLogEntry.groupBy({ by: ['dialerLeadId'], where: { dialerLeadId: { in: leadIds.slice(i, i + 5000) }, autoClosedBy: { not: null }, status: 'DONE' }, _max: { doneAt: true } })
    for (const r of rows) if (r.dialerLeadId && r._max.doneAt) out.set(r.dialerLeadId, r._max.doneAt)
  }
  return out
}

/** The quiet clock's start when a closed follow-up restarted it after the last touch; null = Last touched as usual. */
export function quietFromOf(lastTouched: Date | null, closedAt: Date | undefined): Date | null {
  return closedAt && (!lastTouched || closedAt > lastTouched) ? closedAt : null
}

/** The lead as the shared screen logic reads it. */
function asView(l: LeadRow, extra: { lastTouchedAt: Date | null; manual: number; quietFrom?: Date | null }): ViewLead {
  return {
    ...l, ownerName: '', contactName: null, email: null, phone: null, city: null, stateRaw: null, verifyZone: false, industry: null, maxStage: l.stage, source: null,
    leadDate: l.leadDate?.toISOString() ?? null, lastActivityAt: l.lastActivityAt?.toISOString() ?? null, statusChangedAt: l.statusChangedAt?.toISOString() ?? null,
    snoozeUntil: l.snoozeUntil?.toISOString() ?? null, callLaterAt: l.callLaterAt?.toISOString() ?? null, createdAt: l.createdAt.toISOString(), lastActionAt: null,
    sentToLeadGen: false, actionCount: 0, noteCount: 0, pinnedNote: null, suggestedState: null, externalId: null, website: null, companySize: null, listName: 'CRM',
    phone2: null, email2: null, linkedin: null, decisionMaker: null, bestTime: null, tags: [], needsCrmUpdate: false, crmUpdateWhat: null, backlogKeptAt: null,
    lastImportId: null, firstImportId: null, lastTouchedAt: extra.lastTouchedAt?.toISOString() ?? null, manualTouches: extra.manual,
    quietFrom: extra.quietFrom?.toISOString() ?? null,
  } as unknown as ViewLead
}

const zoneOf = (l: ViewLead, now: Date) => REGION_META[leadRegion(l, now) ?? 'ET'].zone

/** 9 AM on the lead's clock on a given day (YYYY-MM-DD). */
export function nineOnLeadClock(day: string, zone: string): Date {
  return DateTime.fromISO(`${day}T09:00`, { zone }).toJSDate()
}

/**
 * Bring the automatic tasks of these owners in line with their leads: create the missing ones,
 * move a call back's due time, close the ones no longer needed. Safe to run any time; runs
 * one owner at a time under a database lock, so two runs never make the same task twice.
 */
export async function syncAutoTasks(ownerIds: string[], now = new Date()): Promise<{ created: number; updated: number; cancelled: number; autoClosed: number }> {
  const total = { created: 0, updated: 0, cancelled: 0, autoClosed: 0 }
  if (!ownerIds.length) return total
  const settings = await dialerSettings()
  const prefs = await prisma.dialerUserPrefs.findMany({ where: { userId: { in: ownerIds } }, select: { userId: true, data: true } })
  for (const owner of ownerIds) {
    const own = (prefs.find((p) => p.userId === owner)?.data as { followUp?: Record<string, number> } | null)?.followUp ?? {}
    const by = { [owner]: { ...settings.followUp, ...own } }
    const r = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dialer-tasks:${owner}`}))`
      const leads = await tx.dialerLead.findMany({ where: { ownerId: owner, inLatestImport: true, duplicate: false }, select: LEAD_SELECT })
      const stats = await touchStats(leads, { touchesFromNotes: settings.touchesFromNotes, manualTouchesCount: settings.manualTouchesCount })
      const closedAt = settings.touchesFromNotes ? await autoClosedAt(leads.map((l) => l.id)) : new Map<string, Date>()
      const openAll = await tx.workLogEntry.findMany({ where: { userId: owner, origin: 'AUTO', status: { not: 'DONE' }, cancelledAt: null, dialerLeadId: { not: null } }, select: { id: true, dialerLeadId: true, autoReason: true, dueAt: true, createdAt: true, reopenedAt: true } })

      // 1) Follow-ups the agent already answered (ITAD update 12 Nov, section 4): a contact by the agent after the
      //    follow-up was made (or reopened) closes it by itself, naming that contact. This runs first, so the
      //    quiet clock restarts at that contact and the next follow-up comes one stage interval later.
      const autoDone: { id: string; at: Date; text: string }[] = []
      const fuOpen = settings.touchesFromNotes ? openAll.filter((t) => t.autoReason === 'FOLLOW_UP_RULE' && t.dialerLeadId) : []
      if (fuOpen.length) {
        const ownerName = (await tx.user.findUnique({ where: { id: owner }, select: { name: true } }))?.name ?? null
        const ids = [...new Set(fuOpen.map((t) => t.dialerLeadId!))]
        const changes = await tx.dialerStatusChange.findMany({ where: { leadId: { in: ids }, fromStatus: { not: null } }, select: { leadId: true, fromStatus: true, toStatus: true, createdAt: true, byName: true } })
        const statusOf = new Map(leads.map((l) => [l.id, l.status]))
        for (const t of fuOpen) {
          const st = stats.get(t.dialerLeadId!)
          const r = autoCloseBy({
            since: t.reopenedAt ?? t.createdAt,
            leadStatus: statusOf.get(t.dialerLeadId!) ?? '',
            contacts: st?.contacts ?? [],
            // An import (no name) or the agent's own change; a manager's change is not the agent's contact.
            statusChanges: changes.filter((c) => c.leadId === t.dialerLeadId).map((c) => ({ at: c.createdAt, fromStatus: c.fromStatus, toStatus: c.toStatus, byOwner: !c.byName || c.byName === ownerName })),
            importTouches: st?.importTouches ?? [],
            noteOnly: settings.noteOnlyStatuses,
          })
          if (!r) continue
          autoDone.push({ id: t.id, at: r.at, text: r.text })
          const prev = closedAt.get(t.dialerLeadId!)
          if (!prev || r.at > prev) closedAt.set(t.dialerLeadId!, r.at)
        }
        // doneAt is the contact's time: Task history shows when the agent reached the lead, and the clock restarts there.
        for (const d of autoDone) await tx.workLogEntry.update({ where: { id: d.id }, data: { status: 'DONE', doneAt: d.at, outcome: 'Completed automatically', autoClosedBy: d.text } })
      }
      const doneIds = new Set(autoDone.map((d) => d.id))
      const open = openAll.filter((t) => !doneIds.has(t.id))

      // 2) What should be open now.
      const want = new Map<string, { leadId: string; reason: AutoReason; dueAt: Date; company: string }>()
      const tomorrow = new Date(now.getTime() + 86400000)
      for (const row of leads) {
        const st = stats.get(row.id)
        const touched = lastTouchedAt(row.lastActivityAt, st)
        const l = asView(row, { lastTouchedAt: touched, manual: st?.manual ?? 0, quietFrom: quietFromOf(touched, closedAt.get(row.id)) })
        if (isClosed(l, settings as unknown as ViewSettings) || isBlocked(l)) continue
        if (row.callLaterAt) { want.set(`${row.id}|CALL_LATER`, { leadId: row.id, reason: 'CALL_LATER', dueAt: row.callLaterAt, company: row.company }); continue }
        if (row.followUpDropped || (row.snoozeUntil && row.snoozeUntil > now)) continue
        const rule = ruleDays(l, settings as unknown as ViewSettings, by)
        if (rule == null) continue
        // Due now, or by this time tomorrow (so its reminders can come before it is late).
        if (daysQuiet(l, tomorrow) < rule) continue
        const base = new Date(neverWorked(l) ? l.leadDate ?? l.createdAt : l.quietFrom ?? lastTouched(l))
        const breachDay = new Date(base.getTime() + rule * 86400000).toISOString().slice(0, 10)
        want.set(`${row.id}|FOLLOW_UP_RULE`, { leadId: row.id, reason: 'FOLLOW_UP_RULE', dueAt: nineOnLeadClock(breachDay, zoneOf(l, now)), company: row.company })
      }
      // 3) Keep what is still wanted; one no longer due for any other reason (snoozed, dropped, closed status) is
      //    cancelled as before.
      const have = new Map<string, (typeof open)[number]>()
      const stale: string[] = []
      for (const t of open) {
        const k = `${t.dialerLeadId}|${t.autoReason}`
        if (want.has(k) && !have.has(k)) have.set(k, t)
        // A follow-up the agent reopened stays open until they finish it or reach the lead again (step 1 above).
        else if (t.reopenedAt && t.autoReason === 'FOLLOW_UP_RULE' && !have.has(k)) have.set(k, t)
        else stale.push(t.id)
      }
      const creates: Prisma.WorkLogEntryCreateManyInput[] = []
      let updated = 0
      for (const [k, w] of want) {
        const t = have.get(k)
        if (!t) {
          creates.push({
            userId: owner, period: 'DAY', periodStart: periodStartOf(w.reason === 'FOLLOW_UP_RULE' && w.dueAt < now ? now : w.dueAt),
            title: `${w.reason === 'CALL_LATER' ? 'Call back' : 'Follow up'}: ${w.company}`.slice(0, 200),
            details: w.reason === 'CALL_LATER' ? 'Call back set in the Lead Dialer.' : 'Quiet longer than its follow-up rule.',
            dialerLeadId: w.leadId, taskKind: 'CALL', dueAt: w.dueAt, origin: 'AUTO', autoReason: w.reason, remindMinutes: settings.taskReminders,
          })
        } else if (w.reason === 'CALL_LATER' && t.dueAt?.getTime() !== w.dueAt.getTime()) {
          await tx.workLogEntry.update({ where: { id: t.id }, data: { dueAt: w.dueAt, periodStart: periodStartOf(w.dueAt), remindersSent: [] } })
          updated++
        }
      }
      if (creates.length) await tx.workLogEntry.createMany({ data: creates })
      if (stale.length) await tx.workLogEntry.updateMany({ where: { id: { in: stale } }, data: { cancelledAt: now, cancelReason: 'No longer due (the lead moved on).' } })
      return { created: creates.length, updated, cancelled: stale.length, autoClosed: autoDone.length }
    }, { timeout: 60_000, maxWait: 30_000 })
    total.created += r.created; total.updated += r.updated; total.cancelled += r.cancelled; total.autoClosed += r.autoClosed
  }
  return total
}

/**
 * The rep logged a touch (an outcome or Add touch): the lead's follow-up task, and call tasks due
 * by the end of today, are done with that outcome. A call back that was done clears Call later.
 */
export async function completeOnTouch(leadId: string, ownerId: string, outcome: string | null, now = new Date()): Promise<number> {
  const endOfDay = new Date(now.getTime() + 86400000)
  const tasks = await prisma.workLogEntry.findMany({
    where: { dialerLeadId: leadId, userId: ownerId, status: { not: 'DONE' }, cancelledAt: null, OR: [{ autoReason: 'FOLLOW_UP_RULE' }, { taskKind: 'CALL', dueAt: { lte: endOfDay } }] },
    select: { id: true, autoReason: true, dueAt: true },
  })
  if (!tasks.length) return 0
  await prisma.workLogEntry.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { status: 'DONE', doneAt: now, outcome } })
  // The call back that was done clears Call later (a new call back set by the same call stays).
  const done = tasks.filter((t) => t.autoReason === 'CALL_LATER' && t.dueAt).map((t) => t.dueAt!)
  if (done.length) await prisma.dialerLead.updateMany({ where: { id: leadId, callLaterAt: { in: done } }, data: { callLaterAt: null } })
  return tasks.length
}

// ------------------------------------------------------------------ reminders

/** "Can call now (10:42 AM their time)" or "Their calling hours open in 3h". */
export function callWindowText(l: ViewLead, settings: DialerSettingsData, at: Date): string {
  const r = leadRegion(l, at)
  if (!r) return 'Their time zone is not known yet: check the state first.'
  const w = regionWindow(r, settings as unknown as ViewSettings, at)
  if (w.open) return `Can call now (${w.localTime} their time).`
  if (w.weekend) return `Their calling hours open on Monday (${w.localTime} their time now).`
  const h = Math.floor(w.minutesUntilOpen / 60), m = w.minutesUntilOpen % 60
  return `Their calling hours open in ${h ? `${h}h ` : ''}${m ? `${m}m` : ''}`.trim() + ` (${w.localTime} their time now).`
}

/** A reminder more than this late (the server was down, or a task made already late) is not sent. */
const STALE_MS = 10 * 60_000

export async function runDialerReminderTick(now = new Date()): Promise<number> {
  const tasks = await prisma.workLogEntry.findMany({
    where: { dialerLeadId: { not: null }, status: { not: 'DONE' }, cancelledAt: null, dueAt: { gte: new Date(now.getTime() - 26 * 3600000), lte: new Date(now.getTime() + 25 * 3600000) }, NOT: { remindMinutes: { isEmpty: true } } },
    select: { id: true, userId: true, title: true, dueAt: true, remindMinutes: true, remindersSent: true, dialerLead: { select: LEAD_SELECT } },
  })
  if (!tasks.length) return 0
  const settings = await dialerSettings()
  let sent = 0
  for (const t of tasks) {
    for (const m of t.remindMinutes) {
      if (t.remindersSent.includes(m) || !t.dueAt || !t.dialerLead) continue
      const fire = t.dueAt.getTime() - m * 60_000
      if (fire > now.getTime()) continue
      // Claim it, so two runs never send the same reminder.
      const claim = await prisma.workLogEntry.updateMany({ where: { id: t.id, NOT: { remindersSent: { has: m } } }, data: { remindersSent: { push: m } } })
      if (claim.count !== 1 || now.getTime() - fire > STALE_MS) continue
      const l = asView(t.dialerLead, { lastTouchedAt: null, manual: 0 })
      await prisma.notification.create({
        data: {
          userId: t.userId, type: 'TASK_DUE_SOON',
          title: m === 0 ? `Due now: ${t.title}` : `Due in ${m} min: ${t.title}`,
          body: callWindowText(l, settings, now),
          link: `/app/itad/dialer?view=followups&lead=${t.dialerLead.id}`, entityType: 'DialerTask', entityId: t.id,
        },
      }).catch(() => undefined)
      sent++
    }
  }
  return sent
}

let lastSync = 0
/** Every minute: reminders. Every 15 minutes: automatic tasks for every rep with leads (rules run out by the day). */
export function startDialerReminders(): void {
  cron.schedule('* * * * *', () => {
    runTracked('dialer-reminders', async () => {
      const doSync = Date.now() - lastSync > 15 * 60_000
      if (doSync) lastSync = Date.now()
      await forEachCompany(async () => {
        if (doSync) {
          const owners = await prisma.dialerLead.findMany({ where: { inLatestImport: true }, distinct: ['ownerId'], select: { ownerId: true } })
          await syncAutoTasks(owners.map((o) => o.ownerId))
        }
        await runDialerReminderTick()
      })
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[dialer-reminders] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[dialer-reminders] Lead Dialer task reminders started (every minute)')
}
