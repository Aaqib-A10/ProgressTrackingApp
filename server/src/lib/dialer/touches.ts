import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { agentContacts, noteTouchStats, type Contact, type ContactNote, type ContactTouch } from './noteTouches'

/**
 * Touches (attempts) on a lead, ITAD revised spec (30 Oct 2026), section 6.
 *
 * The CRM export has no call log, so Metriq works touches out by comparing each import with the
 * one before (leads matched as for every import):
 *
 *   Between two imports                                 Counts as
 *   Status changed                                      1 touch (status change)
 *   Same status, Updated At moved to another day        1 touch (re-attempt)
 *   Status changed and Updated At moved                 1 touch (not 2)
 *   Updated At moved, status still Assigned             0 (an assignment, not a call)
 *   Nothing changed                                     0
 *
 * A bulk update (more than bulkUpdatePct % of the import's leads share one new Updated At) is not
 * calls: same-status leads on that date count 0, unless most of them are still Assigned (a batch
 * of new leads landing), in which case the ones that are not Assigned were worked and count.
 * A touch the rep added by hand between the two Updated At dates is the same call: the import
 * adds nothing, and the two are kept as one. New leads and the first import add no touches.
 */

export interface ImportCompare {
  leadId: string
  oldStatus: string
  newStatus: string
  oldUpdated: Date | null
  newUpdated: Date | null
}
export interface ManualTouchLite { id: string; leadId: string; at: Date }
export interface TouchPlan {
  create: { leadId: string; at: Date; kind: 'STATUS_CHANGE' | 'RE_ATTEMPT'; confidence: 'EXACT' | 'ESTIMATED'; status: string }[]
  /** Manual touches this import also saw: kept, counted once. */
  merge: string[]
  /** For the import summary and tests. */
  bulkDays: string[]
}

/** A calendar day (as the CRM writes it: dates are compared as days, in UTC). */
export const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export function planImportTouches(cmps: ImportCompare[], leadsInImport: number, importAt: Date, bulkUpdatePct: number, manual: ManualTouchLite[]): TouchPlan {
  const moved = (c: ImportCompare) => !!c.newUpdated && (!c.oldUpdated || dayKey(c.newUpdated) !== dayKey(c.oldUpdated))
  // Dates many leads moved to in this import.
  const byDay = new Map<string, { n: number; assigned: number }>()
  for (const c of cmps) {
    if (!moved(c)) continue
    const k = dayKey(c.newUpdated!)
    const v = byDay.get(k) ?? { n: 0, assigned: 0 }
    v.n++
    if (c.newStatus === 'Assigned') v.assigned++
    byDay.set(k, v)
  }
  const bulk = new Set([...byDay].filter(([, v]) => leadsInImport > 0 && (v.n / leadsInImport) * 100 > bulkUpdatePct).map(([k]) => k))
  const assignmentBatch = (k: string) => { const v = byDay.get(k); return !!v && v.assigned * 2 > v.n }

  const manualBy = new Map<string, ManualTouchLite[]>()
  for (const m of manual) { const a = manualBy.get(m.leadId) ?? []; a.push(m); manualBy.set(m.leadId, a) }

  const plan: TouchPlan = { create: [], merge: [], bulkDays: [...bulk] }
  for (const c of cmps) {
    const statusChanged = c.oldStatus !== c.newStatus
    let kind: 'STATUS_CHANGE' | 'RE_ATTEMPT' | null = null
    if (statusChanged) kind = 'STATUS_CHANGE'
    else if (moved(c) && c.newStatus !== 'Assigned') {
      const k = dayKey(c.newUpdated!)
      kind = bulk.has(k) && !assignmentBatch(k) ? null : 'RE_ATTEMPT'
    }
    if (!kind) continue
    const at = c.newUpdated ?? importAt
    // The same call, already added by hand between the two Updated At dates: count it once.
    const lo = c.oldUpdated ? dayKey(c.oldUpdated) : ''
    const hi = dayKey(at)
    const same = (manualBy.get(c.leadId) ?? []).find((m) => dayKey(m.at) > lo && dayKey(m.at) <= hi)
    if (same) { plan.merge.push(same.id); continue }
    plan.create.push({ leadId: c.leadId, at, kind, confidence: c.newUpdated ? 'EXACT' : 'ESTIMATED', status: c.newStatus })
  }
  return plan
}

/** Save an import's touches (after the leads are saved). */
export async function saveImportTouches(plan: TouchPlan, importId: string): Promise<void> {
  if (plan.create.length) {
    const rows: Prisma.DialerTouchCreateManyInput[] = plan.create.map((t) => ({ leadId: t.leadId, at: t.at, source: 'IMPORT', kind: t.kind, confidence: t.confidence, status: t.status, importId }))
    for (let i = 0; i < rows.length; i += 500) await prisma.dialerTouch.createMany({ data: rows.slice(i, i + 500) })
  }
  if (plan.merge.length) await prisma.dialerTouch.updateMany({ where: { id: { in: plan.merge } }, data: { mergedImportId: importId } })
}

export interface TouchStats {
  lastManualAt: Date | null; attempts: number; tries: number; reAttempts: number; manual: number
  /** ITAD update 12 Nov, section 4: the agent's own latest contact (note or logged call); null = none (Updated At is used). */
  lastContactAt: Date | null
  /** The agent's own contacts, oldest first (for follow-ups that close themselves). */
  contacts: Contact[]
  /** Import touches (for leads with no notes: new activity in Earth Zone). */
  importTouches: { at: Date; kind: string }[]
}
export interface TouchOptions { touchesFromNotes: boolean; manualTouchesCount: boolean }

const empty = (): TouchStats => ({ lastManualAt: null, attempts: 0, tries: 0, reAttempts: 0, manual: 0, lastContactAt: null, contacts: [], importTouches: [] })

/**
 * Per lead: the latest touch added here, how many touches, how many since the status last
 * changed ("4 tries, same status") and how many were re-attempts. Dismissed touches never count.
 *
 * With `touchesFromNotes` (ITAD update 12 Nov, section 4) a lead with contacts by its agent (their own notes,
 * and their own logged calls) takes Last touched and "tries, same status" from those, two on one day counting
 * once; a colleague's note never counts. Leads with none keep the import-based numbers.
 */
export async function touchStats(
  leads: { id: string; ownerId?: string; statusChangedAt: Date | null; createdAt: Date }[],
  opts: TouchOptions = { touchesFromNotes: false, manualTouchesCount: true },
): Promise<Map<string, TouchStats>> {
  const out = new Map<string, TouchStats>()
  if (!leads.length) return out
  // Since the status last changed, as Metriq saw it; a status unchanged since the first import counts every touch (the baseline).
  const since = new Map(leads.map((l) => [l.id, l.statusChangedAt && l.statusChangedAt.getTime() - l.createdAt.getTime() > 60_000 ? l.statusChangedAt.getTime() : 0]))
  const ids = leads.map((l) => l.id)
  const touchRows = new Map<string, ContactTouch[]>()
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await prisma.dialerTouch.findMany({ where: { leadId: { in: ids.slice(i, i + 5000) }, dismissedAt: null }, select: { leadId: true, at: true, kind: true, source: true, userId: true } })
    for (const t of rows) {
      const s = out.get(t.leadId) ?? empty()
      s.attempts++
      if (t.kind === 'RE_ATTEMPT') s.reAttempts++
      if (t.source === 'MANUAL') { s.manual++; if (!s.lastManualAt || t.at > s.lastManualAt) s.lastManualAt = t.at }
      else s.importTouches.push({ at: t.at, kind: t.kind })
      // A try at the same status: any touch after the status last changed that is not the change itself.
      if (t.kind !== 'STATUS_CHANGE' && t.at.getTime() > (since.get(t.leadId) ?? 0)) s.tries++
      out.set(t.leadId, s)
      const a = touchRows.get(t.leadId) ?? []
      a.push(t)
      touchRows.set(t.leadId, a)
    }
  }
  if (!opts.touchesFromNotes) return out
  const noteRows = new Map<string, ContactNote[]>()
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await prisma.dialerNote.findMany({ where: { leadId: { in: ids.slice(i, i + 5000) }, deletedAt: null, userId: { not: null } }, select: { leadId: true, userId: true, createdAt: true, source: true } })
    for (const n of rows) {
      const a = noteRows.get(n.leadId) ?? []
      a.push({ userId: n.userId, at: n.createdAt, source: n.source })
      noteRows.set(n.leadId, a)
    }
  }
  for (const l of leads) {
    if (!l.ownerId) continue
    const contacts = agentContacts(l.ownerId, noteRows.get(l.id) ?? [], touchRows.get(l.id) ?? [], opts.manualTouchesCount)
    if (!contacts.length) continue
    const s = out.get(l.id) ?? empty()
    const ns = noteTouchStats(contacts, since.get(l.id) ?? 0)
    s.contacts = contacts
    s.lastContactAt = ns.lastContactAt
    s.tries = ns.tries
    out.set(l.id, s)
  }
  return out
}

/**
 * The latest touch. With contacts by the agent: the latest of those (Updated At is only the fallback for leads
 * with none). Otherwise the CRM's Updated At, or one added here if that is later.
 */
export function lastTouchedAt(lastActivityAt: Date | null, s: TouchStats | undefined): Date | null {
  if (s?.lastContactAt) return s.lastContactAt
  if (!s?.lastManualAt) return lastActivityAt
  return !lastActivityAt || s.lastManualAt > lastActivityAt ? s.lastManualAt : lastActivityAt
}
