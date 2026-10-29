import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { contactNameFor, industryFromRaw, websiteFromRaw } from '../lib/dialerRaw'
import { OUTCOMES, type Outcome } from '../lib/dialer/calls'
import type { AuthedRequest } from '../middleware/auth'
import { findState, stateFromPhone } from '../lib/dialer/states'
import { DEFAULT_SETTINGS, FOLLOW_UP_MAX, FOLLOW_UP_MIN, funnel, normalizeStatus, stageOf, withDefaults, type DialerSettingsData, type FunnelNumbers } from '../lib/dialer/rules'

/**
 * Lead Dialer (ITAD). Plan: "Lead Dialer Dashboard, Final Plan" (Oct 2026).
 *
 *  - A rep imports their own CRM export (CSV/Excel, parsed in the browser and sent as rows with
 *    the column mapping). Leads are matched by CRM lead ID, else email, else company + phone:
 *    a known lead is updated, a new one is added. History, snoozes and notes are never touched
 *    by an import; only the CRM fields are refreshed.
 *  - Data is tidied on the way in: state names, blank statuses (Unknown), extra spaces.
 *  - Each rep sees only their own leads. A lead another rep already holds is flagged as a
 *    duplicate for a manager (ITAD Team Lead or Super Admin) to resolve.
 *  - Every import keeps a summary (added, changed, movement, funnel change) and the funnel
 *    numbers at that moment (funnel history). Each status change is kept in a change log.
 */

const SETTINGS_ID = 'default'

export async function loadSettings(): Promise<DialerSettingsData> {
  const row = await prisma.dialerSettings.findUnique({ where: { id: SETTINGS_ID } })
  return withDefaults(row?.data)
}

export async function whoAmI(req: AuthedRequest) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, departmentId: true, department: { select: { type: true } } } })
  const isManager = me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'ITAD')
  return { ...me, isManager }
}

/** ITAD people whose leads a manager may look at. */
async function itadUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { department: { type: 'ITAD' } }, select: { id: true } })
  return users.map((u) => u.id)
}

/** Which owners the request covers: ?rep=me (default) | all | <userId>. Only managers go past "me". */
async function scopeOwners(req: AuthedRequest, me: Awaited<ReturnType<typeof whoAmI>>): Promise<string[] | null> {
  const rep = String(req.query.rep ?? 'me')
  if (rep === 'me' || rep === me.id) return [me.id]
  if (!me.isManager) return null
  if (rep === 'all') return [...new Set([...(await itadUserIds()), me.id])]
  const ids = await itadUserIds()
  return ids.includes(rep) || rep === me.id ? [rep] : null
}

// ---------------------------------------------------------------------------- shared

/** The rep's working day starts at noon Pakistan time, so a night shift (7 PM to 4 AM) is one day. */
export function shiftDayStart(now: Date): Date {
  const pkt = new Date(now.getTime() + 5 * 3600000) // Pakistan is UTC+5 all year
  const noon = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate(), 12) - 5 * 3600000
  return new Date(noon <= now.getTime() ? noon : noon - 86400000)
}

export interface SavedView { id: string; name: string; filters: Record<string, string> }
export interface DialerPrefs { views: SavedView[]; followUp: Record<string, number> }
export function readPrefs(data: unknown): DialerPrefs {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<DialerPrefs>
  return { views: Array.isArray(d.views) ? d.views : [], followUp: d.followUp && typeof d.followUp === 'object' ? d.followUp : {} }
}

// ---------------------------------------------------------------------------- import

export const IMPORT_FIELDS = ['leadId', 'company', 'contactName', 'email', 'phone', 'city', 'state', 'status', 'industry', 'source', 'leadDate', 'lastActivity', 'website', 'companySize'] as const
type Field = (typeof IMPORT_FIELDS)[number]

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  headers: z.array(z.string().max(200)).min(1).max(200),
  mapping: z.record(z.string(), z.string().max(200).nullable()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(20000),
  /** "CRM" for the SMB export; another name (Vendors...) keeps that list apart. */
  listName: z.string().trim().min(1).max(40).optional(),
})

const clean = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/** Dates as CRMs export them: ISO, 10/15/2026 (US), 2026-10-15 3:22 PM, or an Excel day number. */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) {
    const n = Number(v)
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000))
    return null
  }
  const s = String(v).trim()
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/)
  if (us) {
    let [, mo, d, y, h, mi, sec, ap] = us
    if (y.length === 2) y = `20${y}`
    let hour = h ? Number(h) : 12
    if (ap) { const pm = ap.toLowerCase() === 'pm'; if (hour === 12) hour = pm ? 12 : 0; else if (pm) hour += 12 }
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, mi ? Number(mi) : 0, sec ? Number(sec) : 0))
    return Number.isNaN(dt.getTime()) ? null : dt
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

const digits = (p: string | null) => (p ? p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '')

/** The value that recognises a lead between imports. */
export function matchKeyOf(r: { leadId: string | null; email: string | null; company: string | null; contactName: string | null; phone: string | null }): string | null {
  if (r.leadId) return `id:${r.leadId.toLowerCase()}`
  if (r.email && /@/.test(r.email)) return `email:${r.email.toLowerCase()}`
  const who = (r.company ?? r.contactName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const ph = digits(r.phone)
  if (who && ph) return `cp:${who}:${ph}`
  if (who && r.contactName) return `cn:${who}:${r.contactName.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  return null
}

// Region and the split-state flag follow from the state, so they are not compared on their own.
const CRM_FIELDS = ['externalId', 'company', 'contactName', 'email', 'phone', 'city', 'stateRaw', 'state', 'industry', 'status', 'source', 'website', 'companySize', 'listName'] as const

/** POST /api/dialer/imports — import my CRM export. */
export async function importLeads(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The file could not be read.' })
    return
  }
  const { fileName, headers, mapping, rows } = parsed.data
  const listName = parsed.data.listName && parsed.data.listName.toUpperCase() !== 'CRM' ? parsed.data.listName : 'CRM'
  const col: Partial<Record<Field, number>> = {}
  for (const f of IMPORT_FIELDS) {
    const h = mapping[f]
    if (h) {
      const i = headers.indexOf(h)
      if (i >= 0) col[f] = i
    }
  }
  if (col.status == null) { res.status(400).json({ error: 'Pick the column that holds the lead status.' }); return }
  if (col.company == null && col.contactName == null) { res.status(400).json({ error: 'Pick the column with the company or contact name.' }); return }
  if (col.leadId == null && col.email == null && col.phone == null) { res.status(400).json({ error: 'Pick a lead ID, email or phone column so leads can be recognised between imports.' }); return }

  const meId = req.user!.id
  const settings = await loadSettings()
  const now = new Date()
  const get = (row: (string | number | null)[], f: Field) => (col[f] == null ? null : row[col[f]!] ?? null)

  // 1) Tidy every row.
  type Rec = {
    key: string; externalId: string | null; company: string; contactName: string | null; email: string | null; phone: string | null
    city: string | null; stateRaw: string | null; state: string | null; region: string | null; verifyZone: boolean
    industry: string | null; status: string; stage: number; source: string | null; leadDate: Date | null; lastActivityAt: Date | null
    website: string | null; companySize: string | null; listName: string
    raw: Record<string, string | number | null>
  }
  const recs = new Map<string, Rec>()
  let skipped = 0
  let repeated = 0
  for (const row of rows) {
    const raw: Record<string, string | number | null> = {}
    headers.forEach((h, i) => { raw[h] = row[i] ?? null })
    const leadId = clean(get(row, 'leadId'))
    const company = clean(get(row, 'company'))
    // First + last name columns, "Full Name", "Website URL"...: found even when not picked on the import screen.
    const contactName = contactNameFor(clean(get(row, 'contactName')), mapping.contactName ?? null, raw, company)
    const email = clean(get(row, 'email'))?.toLowerCase() ?? null
    const phone = clean(get(row, 'phone'))
    const key = matchKeyOf({ leadId, email, company, contactName, phone })
    if (!key || (!company && !contactName)) { if (row.some((c) => clean(c))) skipped++; continue }
    const stateRaw = clean(get(row, 'state'))
    const st = findState(stateRaw)
    const status = normalizeStatus(clean(get(row, 'status')))
    if (recs.has(key)) repeated++
    recs.set(key, {
      key, externalId: leadId, company: company ?? contactName!, contactName, email, phone,
      city: clean(get(row, 'city')), stateRaw, state: st?.name ?? null, region: st?.region ?? null, verifyZone: !!st?.split,
      industry: clean(get(row, 'industry')) ?? industryFromRaw(raw), status, stage: stageOf(status, settings), source: clean(get(row, 'source')),
      leadDate: parseDate(get(row, 'leadDate')), lastActivityAt: parseDate(get(row, 'lastActivity')),
      website: clean(get(row, 'website')) ?? websiteFromRaw(raw), companySize: clean(get(row, 'companySize')), listName, raw,
    })
  }
  if (recs.size === 0) { res.status(400).json({ error: 'No leads found in the file. Check the column choices.' }); return }

  // 2) Compare with what the dashboard already has.
  const keys = [...recs.keys()]
  const [mine, others, prevImport] = await Promise.all([
    prisma.dialerLead.findMany({ where: { ownerId: meId } }),
    prisma.dialerLead.findMany({ where: { matchKey: { in: keys }, ownerId: { not: meId }, duplicate: false }, select: { matchKey: true, owner: { select: { name: true } } } }),
    // The previous import of the same list (older imports have no list name: they were the CRM export).
    prisma.dialerImport.findMany({ where: { userId: meId }, orderBy: { createdAt: 'desc' }, take: 30, select: { funnel: true, createdAt: true, summary: true } })
      .then((xs) => xs.find((x) => ((x.summary as { listName?: string } | null)?.listName ?? 'CRM') === listName) ?? null),
  ])
  const mineByKey = new Map(mine.map((l) => [l.matchKey, l]))
  const heldBy = new Map(others.map((o) => [o.matchKey, o.owner.name]))
  const knownIndustries = new Set(mine.map((l) => l.industry?.toLowerCase()).filter(Boolean) as string[])

  const imp = await prisma.dialerImport.create({
    data: { userId: meId, fileName, headerSignature: headers.join('|'), mapping, rowCount: rows.length, summary: {}, funnel: {} },
  })

  let added = 0, changed = 0, unchanged = 0, forward = 0, back = 0, duplicates = 0
  const moves = new Map<string, number>()
  const newIndustries = new Map<string, number>()
  const creates: Prisma.DialerLeadCreateManyInput[] = []
  const updates: Prisma.PrismaPromise<unknown>[] = []
  const changeRows: Prisma.DialerStatusChangeCreateManyInput[] = []
  const unchangedIds: string[] = []
  const dupList: { company: string; heldBy: string }[] = []

  for (const r of recs.values()) {
    if (r.industry && !knownIndustries.has(r.industry.toLowerCase())) newIndustries.set(r.industry, (newIndustries.get(r.industry) ?? 0) + 1)
    const old = mineByKey.get(r.key)
    if (!old) {
      added++
      const dupOf = heldBy.get(r.key)
      if (dupOf) { duplicates++; if (dupList.length < 20) dupList.push({ company: r.company, heldBy: dupOf }) }
      const id = `dl_${imp.id.slice(-8)}_${creates.length}_${Math.random().toString(36).slice(2, 8)}`
      creates.push({
        id, ownerId: meId, matchKey: r.key, externalId: r.externalId, company: r.company, contactName: r.contactName, email: r.email, phone: r.phone,
        city: r.city, stateRaw: r.stateRaw, state: r.state, region: r.region, verifyZone: r.verifyZone, industry: r.industry,
        status: r.status, stage: r.stage, maxStage: r.stage, source: r.source, leadDate: r.leadDate, lastActivityAt: r.lastActivityAt,
        website: r.website, companySize: r.companySize, listName: r.listName,
        statusChangedAt: now, duplicate: !!dupOf, raw: r.raw as Prisma.InputJsonValue, firstImportId: imp.id, lastImportId: imp.id,
      })
      changeRows.push({ leadId: id, fromStatus: null, toStatus: r.status, fromStage: null, toStage: r.stage, importId: imp.id })
      continue
    }
    const statusChanged = old.status !== r.status
    const crmSame = CRM_FIELDS.every((f) => (old as Record<string, unknown>)[f] === (r as unknown as Record<string, unknown>)[f === 'externalId' ? 'externalId' : f])
      && (old.lastActivityAt?.getTime() ?? null) === (r.lastActivityAt?.getTime() ?? null)
      && (old.leadDate?.getTime() ?? null) === (r.leadDate?.getTime() ?? null)
    if (crmSame && old.inLatestImport) { unchanged++; unchangedIds.push(old.id); continue }
    if (crmSame) { unchanged++ } else { changed++ }
    if (statusChanged) {
      if (r.stage > old.stage) forward++
      else if (r.stage < old.stage) back++
      const k = `${old.status}\u0000${r.status}`
      moves.set(k, (moves.get(k) ?? 0) + 1)
      changeRows.push({ leadId: old.id, fromStatus: old.status, toStatus: r.status, fromStage: old.stage, toStage: r.stage, importId: imp.id })
    }
    // A state the CRM now sends replaces one fixed on the dashboard; otherwise the fix stays.
    const keepOverride = !r.state && old.stateOverride
    const ovr = keepOverride ? findState(old.stateOverride) : null
    updates.push(prisma.dialerLead.update({
      where: { id: old.id },
      data: {
        externalId: r.externalId, company: r.company, contactName: r.contactName, email: r.email, phone: r.phone, city: r.city,
        stateRaw: r.stateRaw, state: r.state, stateOverride: keepOverride ? old.stateOverride : null,
        region: ovr ? ovr.region : r.region, verifyZone: ovr ? !!ovr.split : r.verifyZone,
        industry: r.industry, status: r.status, stage: r.stage, maxStage: Math.max(old.maxStage, r.stage), source: r.source,
        leadDate: r.leadDate, lastActivityAt: r.lastActivityAt, statusChangedAt: statusChanged ? now : old.statusChangedAt,
        website: r.website, companySize: r.companySize, listName: r.listName,
        // A new number from the CRM may work: "wrong number" from the dialer is cleared.
        ...(old.wrongNumber && r.phone !== old.phone ? { wrongNumber: false } : {}),
        inLatestImport: true, raw: r.raw as Prisma.InputJsonValue, lastImportId: imp.id,
        // Added-here fields (second phone, notes...) are never touched. A status change means the lead
        // moved on: a pending call-later, snooze or follow-up drop from before no longer applies.
        ...(statusChanged ? { snoozeUntil: null, callLaterAt: null, followUpDropped: false, backlogKeptAt: null } : {}),
      },
    }))
  }
  const seen = new Set(keys)
  // Only leads of the same list can drop out: importing a vendor list never hides CRM leads.
  const dropped = mine.filter((l) => l.inLatestImport && l.listName === listName && !seen.has(l.matchKey)).map((l) => l.id)

  const CHUNK = 500
  for (let i = 0; i < creates.length; i += CHUNK) await prisma.dialerLead.createMany({ data: creates.slice(i, i + CHUNK) })
  for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200))
  if (unchangedIds.length) await prisma.dialerLead.updateMany({ where: { id: { in: unchangedIds } }, data: { lastImportId: imp.id, inLatestImport: true } })
  if (dropped.length) await prisma.dialerLead.updateMany({ where: { id: { in: dropped } }, data: { inLatestImport: false } })
  for (let i = 0; i < changeRows.length; i += CHUNK) await prisma.dialerStatusChange.createMany({ data: changeRows.slice(i, i + CHUNK) })

  // 3) Funnel now vs the previous import, and the summary.
  // Counted leads (one definition everywhere): in the latest import of this list and not waiting for a manager as a duplicate.
  const current = await prisma.dialerLead.findMany({ where: { ownerId: meId, inLatestImport: true, duplicate: false, listName }, select: { stage: true, state: true, stateOverride: true, status: true } })
  const fNow = funnel(current.map((l) => l.stage))
  const fPrev = (prevImport?.funnel && typeof prevImport.funnel === 'object' && 'total' in (prevImport.funnel as object)) ? (prevImport.funnel as unknown as FunnelNumbers) : null
  const unknownStatuses = new Map<string, number>()
  for (const r of recs.values()) if (settings.stageMap[r.status] == null) unknownStatuses.set(r.status, (unknownStatuses.get(r.status) ?? 0) + 1)
  const summary = {
    listName,
    rows: rows.length, leads: recs.size, added, changed, unchanged, skipped, repeatedInFile: repeated,
    notInFile: dropped.length, duplicates, duplicateExamples: dupList,
    newIndustries: [...newIndustries.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    movedForward: forward, movedBack: back,
    topChanges: [...moves.entries()].map(([k, count]) => { const [from, to] = k.split('\u0000'); return { from, to, count } }).sort((a, b) => b.count - a.count).slice(0, 8),
    unknownStatuses: [...unknownStatuses.entries()].map(([status, count]) => ({ status, count })),
    missingState: current.filter((l) => !l.state && !l.stateOverride).length,
    previousImportAt: prevImport?.createdAt.toISOString() ?? null,
    funnelBefore: fPrev,
    funnelNow: fNow,
  }
  await prisma.dialerImport.update({ where: { id: imp.id }, data: { summary: summary as unknown as Prisma.InputJsonValue, funnel: fNow as unknown as Prisma.InputJsonValue } })
  res.status(201).json({ import: { id: imp.id, createdAt: imp.createdAt.toISOString(), fileName, summary } })
}

// ---------------------------------------------------------------------------- data

/** GET /api/dialer/data?rep=me|all|<userId> — everything the dashboard counts from. */
export async function dialerData(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const owners = await scopeOwners(req, me)
  if (!owners) { res.status(403).json({ error: 'You can only see your own leads.' }); return }
  const [settings, leads, lastImport, reps] = await Promise.all([
    loadSettings(),
    prisma.dialerLead.findMany({
      where: { ownerId: { in: owners }, inLatestImport: true, NOT: { duplicate: true, dupResolved: true } },
      select: {
        id: true, ownerId: true, company: true, contactName: true, email: true, phone: true, city: true, state: true, stateOverride: true, stateRaw: true,
        region: true, verifyZone: true, zoneOverride: true, industry: true, status: true, stage: true, maxStage: true, source: true,
        leadDate: true, lastActivityAt: true, statusChangedAt: true, duplicate: true, sentToLeadGen: true, snoozeUntil: true, callLaterAt: true,
        lastActionAt: true, createdAt: true, website: true, companySize: true, listName: true, externalId: true,
        phone2: true, email2: true, linkedin: true, decisionMaker: true, bestTime: true, tags: true,
        needsCrmUpdate: true, crmUpdateWhat: true, followUpDropped: true, backlogKeptAt: true, lastImportId: true, firstImportId: true, doNotCall: true, wrongNumber: true,
        _count: { select: { actions: true, notes: true } },
      },
    }),
    prisma.dialerImport.findFirst({ where: { userId: { in: owners } }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, fileName: true, headerSignature: true, mapping: true, summary: true, user: { select: { name: true } } } }),
    me.isManager
      ? prisma.user.findMany({ where: { department: { type: 'ITAD' }, isActive: true }, select: { id: true, name: true, dialerImports: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
  ])
  // The mapping the rep used last time (to fill the import screen and spot changed columns).
  const myLast = owners.length === 1 && owners[0] === me.id ? lastImport : await prisma.dialerImport.findFirst({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, select: { headerSignature: true, mapping: true } })
  const names = new Map(reps.map((r) => [r.id, r.name]))
  if (!names.has(me.id)) names.set(me.id, me.name)
  const leadIds = leads.map((l) => l.id)
  const dayStart = shiftDayStart(new Date())
  const [pinned, prefsRows, actedActions, actedNotes] = await Promise.all([
    prisma.dialerNote.findMany({ where: { leadId: { in: leadIds }, pinned: true }, orderBy: { createdAt: 'desc' }, select: { leadId: true, text: true } }),
    prisma.dialerUserPrefs.findMany({ where: { userId: { in: [...new Set([...owners, me.id])] } } }),
    prisma.dialerAction.findMany({ where: { leadId: { in: leadIds }, createdAt: { gte: dayStart } }, select: { leadId: true, userId: true, kind: true, createdAt: true } }),
    prisma.dialerNote.findMany({ where: { leadId: { in: leadIds }, createdAt: { gte: dayStart } }, select: { leadId: true, userId: true, createdAt: true } }),
  ])
  const pinnedBy = new Map<string, string>()
  for (const n of pinned) if (!pinnedBy.has(n.leadId)) pinnedBy.set(n.leadId, n.text)
  const prefsOf = (id: string) => readPrefs(prefsRows.find((p) => p.userId === id)?.data)
  // Counted leads, one definition everywhere (header, funnel, import summary): not a duplicate waiting for a manager.
  const counted = leads.filter((l) => !l.duplicate)
  res.json({
    counts: { counted: counted.length, duplicates: leads.length - counted.length, byList: Object.fromEntries([...new Set(leads.map((l) => l.listName))].map((n) => [n, counted.filter((l) => l.listName === n).length])) },
    prefs: prefsOf(me.id),
    // Follow-up days in force for each rep (company defaults with the rep's own changes).
    followUpByOwner: Object.fromEntries(owners.map((o) => [o, { ...settings.followUp, ...prefsOf(o).followUp }])),
    // What was done today (since noon Pakistan time, so a night shift is one day): the Done tab and "cleared today".
    actedToday: [...actedActions.map((a) => ({ leadId: a.leadId, userId: a.userId, kind: a.kind, at: a.createdAt.toISOString() })), ...actedNotes.map((n) => ({ leadId: n.leadId, userId: n.userId, kind: 'NOTE', at: n.createdAt.toISOString() }))],
    dayStart: dayStart.toISOString(),
    me: { id: me.id, name: me.name, isManager: me.isManager },
    scope: owners.length === 1 ? (owners[0] === me.id ? 'me' : owners[0]) : 'all',
    settings,
    leads: leads.map(({ _count, ...l }) => ({
      ...l,
      ownerName: names.get(l.ownerId) ?? '',
      leadDate: l.leadDate?.toISOString() ?? null,
      lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
      statusChangedAt: l.statusChangedAt?.toISOString() ?? null,
      snoozeUntil: l.snoozeUntil?.toISOString() ?? null,
      callLaterAt: l.callLaterAt?.toISOString() ?? null,
      lastActionAt: l.lastActionAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      actionCount: _count.actions,
      noteCount: _count.notes,
      pinnedNote: pinnedBy.get(l.id) ?? null,
      backlogKeptAt: l.backlogKeptAt?.toISOString() ?? null,
      suggestedState: !l.state && !l.stateOverride ? stateFromPhone(l.phone) : null,
    })),
    lastImport: lastImport ? { id: lastImport.id, at: lastImport.createdAt.toISOString(), fileName: lastImport.fileName, by: lastImport.user.name, summary: lastImport.summary } : null,
    myMapping: myLast ? { headerSignature: myLast.headerSignature, mapping: myLast.mapping } : null,
    reps: reps.map((r) => ({ id: r.id, name: r.name, lastImportAt: r.dialerImports[0]?.createdAt.toISOString() ?? null })),
  })
}

/** GET /api/dialer/imports?rep= — import history with summaries and funnel snapshots. */
export async function importHistory(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const owners = await scopeOwners(req, me)
  if (!owners) { res.status(403).json({ error: 'You can only see your own imports.' }); return }
  const rows = await prisma.dialerImport.findMany({
    where: { userId: { in: owners } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, createdAt: true, fileName: true, rowCount: true, summary: true, funnel: true, user: { select: { id: true, name: true } } },
  })
  res.json({ imports: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) })
}

// ---------------------------------------------------------------------------- one lead

async function loadOwnLead(req: AuthedRequest, res: Response) {
  const me = await whoAmI(req)
  const lead = await prisma.dialerLead.findUnique({ where: { id: req.params.id } })
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return null }
  if (lead.ownerId !== me.id) {
    const ok = me.isManager && (await itadUserIds()).includes(lead.ownerId)
    if (!ok) { res.status(404).json({ error: 'Lead not found' }); return null }
  }
  return { me, lead }
}

/** GET /api/dialer/leads/:id — the lead, its notes and actions, and its status path. */
export async function leadDetail(req: AuthedRequest, res: Response): Promise<void> {
  const got = await loadOwnLead(req, res)
  if (!got) return
  const [actions, changes, notes, calls] = await Promise.all([
    prisma.dialerAction.findMany({ where: { leadId: got.lead.id }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, kind: true, note: true, at: true, createdAt: true, user: { select: { name: true } } } }),
    prisma.dialerStatusChange.findMany({ where: { leadId: got.lead.id }, orderBy: { createdAt: 'asc' }, select: { id: true, fromStatus: true, toStatus: true, createdAt: true, importId: true } }),
    prisma.dialerNote.findMany({ where: { leadId: got.lead.id }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], select: noteSelect }),
    // Calls the predictive dialer reported for this lead.
    prisma.dialerCall.findMany({ where: { leadId: got.lead.id }, orderBy: { calledAt: 'desc' }, take: 200, select: { id: true, calledAt: true, disposition: true, outcome: true, notes: true, durationSec: true, agentRaw: true, effect: true, agent: { select: { name: true } } } }),
  ])
  const { raw, ...lead } = got.lead
  res.json({
    lead: { ...lead, suggestedState: !lead.state && !lead.stateOverride ? stateFromPhone(lead.phone) : null }, raw, actions, changes, notes: notes.map(noteView),
    calls: calls.map((c) => ({ id: c.id, calledAt: c.calledAt.toISOString(), disposition: c.disposition, outcome: c.outcome, outcomeLabel: c.outcome ? OUTCOMES[c.outcome as Outcome] ?? c.outcome : null, notes: c.notes, durationSec: c.durationSec, agent: c.agent?.name ?? c.agentRaw ?? null, effect: c.effect })),
  })
}

const noteSelect = { id: true, leadId: true, text: true, pinned: true, nextActionAt: true, editedAt: true, createdAt: true, user: { select: { id: true, name: true } } } as const
type NoteRow = Prisma.DialerNoteGetPayload<{ select: typeof noteSelect }>
const noteView = (n: NoteRow) => ({ id: n.id, leadId: n.leadId, text: n.text, pinned: n.pinned, nextActionAt: n.nextActionAt?.toISOString() ?? null, editedAt: n.editedAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(), author: n.user.name, authorId: n.user.id })

const actionSchema = z.object({
  kind: z.enum(['CALL_NOW', 'CALL_LATER', 'SNOOZE', 'NOTE', 'CLEAR']),
  at: z.string().datetime().optional(),
  note: z.string().trim().max(2000).optional(),
})

/** POST /api/dialer/leads/:id/actions — Call now, Call later, Snooze, Log note (or clear a snooze). */
export async function leadAction(req: AuthedRequest, res: Response): Promise<void> {
  const got = await loadOwnLead(req, res)
  if (!got) return
  const parsed = actionSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Choose an action.' }); return }
  const { kind, note } = parsed.data
  const at = parsed.data.at ? new Date(parsed.data.at) : null
  const now = new Date()
  let data: Prisma.DialerLeadUpdateInput = { lastActionAt: now }
  if (kind === 'CALL_NOW') data = { ...data, snoozeUntil: new Date(now.getTime() + 20 * 3600000), callLaterAt: null } // back tomorrow if the CRM still shows nothing
  if (kind === 'CALL_LATER') {
    if (!at || at <= now) { res.status(400).json({ error: 'Pick a time in the future.' }); return }
    data = { ...data, callLaterAt: at, snoozeUntil: null }
  }
  if (kind === 'SNOOZE') {
    if (!at || at <= now) { res.status(400).json({ error: 'Pick a date in the future.' }); return }
    data = { ...data, snoozeUntil: at, callLaterAt: null }
  }
  if (kind === 'NOTE' && !note) { res.status(400).json({ error: 'Write the note first.' }); return }
  if (kind === 'CLEAR') data = { snoozeUntil: null, callLaterAt: null }
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: got.lead.id }, data }),
    // A note is kept as a note (author, time, pin); the other actions in the action log.
    kind === 'NOTE'
      ? prisma.dialerNote.create({ data: { leadId: got.lead.id, userId: got.me.id, text: note! } })
      : prisma.dialerAction.create({ data: { leadId: got.lead.id, userId: got.me.id, kind, note: note ?? null, at } }),
  ])
  res.status(201).json({ ok: true })
}

const opt = (max: number) => z.string().trim().max(max).nullable().optional()
const fixSchema = z.object({
  state: z.string().trim().max(60).nullable().optional(),
  zone: z.enum(['ET', 'CT', 'MT', 'PT']).nullable().optional(),
  sentToLeadGen: z.boolean().optional(),
  // Added here: kept by the dialer, never touched by an import.
  phone2: opt(40), email2: opt(200), linkedin: opt(300), decisionMaker: opt(120), bestTime: opt(80),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  /** false = this change does not need to go into Earthzone. Default: it does (when the tick is on). */
  needsCrm: z.boolean().optional(),
  /** "Done in Earthzone": clears the marker. */
  crmDone: z.boolean().optional(),
})
const ADDED_FIELDS = { phone2: 'second phone', email2: 'second email', linkedin: 'LinkedIn', decisionMaker: 'decision maker', bestTime: 'best time to call', tags: 'tags' } as const

/** PATCH /api/dialer/leads/:id — Fix data: set the state, pick the zone of a split state, send back to lead gen. */
export async function fixLead(req: AuthedRequest, res: Response): Promise<void> {
  const got = await loadOwnLead(req, res)
  if (!got) return
  const parsed = fixSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid change' }); return }
  const data: Prisma.DialerLeadUpdateInput = {}
  const log: { kind: string; note: string }[] = []
  if (parsed.data.state !== undefined) {
    if (parsed.data.state === null) {
      data.stateOverride = null
      const st = findState(got.lead.state)
      data.region = st?.region ?? null
      data.verifyZone = !!st?.split
    } else {
      const st = findState(parsed.data.state)
      if (!st) { res.status(400).json({ error: 'Pick a US state from the list.' }); return }
      data.stateOverride = st.name
      data.region = st.region
      data.verifyZone = !!st.split
      data.sentToLeadGen = false
      log.push({ kind: 'STATE_FIX', note: `State set to ${st.name}` })
    }
  }
  if (parsed.data.zone !== undefined) {
    data.zoneOverride = parsed.data.zone
    log.push({ kind: 'ZONE', note: parsed.data.zone ? `Zone set to ${parsed.data.zone}` : 'Zone cleared' })
  }
  if (parsed.data.sentToLeadGen !== undefined) {
    data.sentToLeadGen = parsed.data.sentToLeadGen
    if (parsed.data.sentToLeadGen) log.push({ kind: 'BACK_TO_LEADGEN', note: 'Sent back to lead gen to find the state' })
  }
  const changedWhat: string[] = []
  for (const [k, label] of Object.entries(ADDED_FIELDS) as [keyof typeof ADDED_FIELDS, string][]) {
    const v = parsed.data[k]
    if (v === undefined) continue
    const before = got.lead[k]
    const same = Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(before) : (v || null) === (before ?? null)
    if (same) continue
    ;(data as Record<string, unknown>)[k] = Array.isArray(v) ? v : v || null
    changedWhat.push(label)
    log.push({ kind: 'EDIT', note: `${label[0].toUpperCase()}${label.slice(1)} ${Array.isArray(v) ? `set to ${v.join(', ') || 'none'}` : v ? `set to ${v}` : 'removed'}` })
  }
  if (log.some((l) => l.kind === 'STATE_FIX')) changedWhat.push('state')
  // Something added here that Earthzone should also have: mark the lead until the rep ticks "Done in Earthzone".
  const settings = await loadSettings()
  if (settings.earthzoneTick && parsed.data.needsCrm !== false && changedWhat.filter((w) => w !== 'tags').length) {
    data.needsCrmUpdate = true
    data.crmUpdateWhat = [...new Set([...(got.lead.crmUpdateWhat?.split(', ').filter(Boolean) ?? []), ...changedWhat.filter((w) => w !== 'tags')])].join(', ')
  }
  if (parsed.data.crmDone) {
    data.needsCrmUpdate = false
    data.crmUpdateWhat = null
    log.push({ kind: 'CRM_DONE', note: `Updated in Earthzone${got.lead.crmUpdateWhat ? ` (${got.lead.crmUpdateWhat})` : ''}` })
  }
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: got.lead.id }, data }),
    ...log.map((l) => prisma.dialerAction.create({ data: { leadId: got.lead.id, userId: got.me.id, kind: l.kind, note: l.note } })),
  ])
  res.json({ ok: true })
}

// ---------------------------------------------------------------------------- settings

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const slot = z.object({ pktStart: hhmm, pktEnd: hhmm, localStart: hhmm, localEnd: hhmm })
const settingsSchema = z.object({
  stageMap: z.record(z.string().min(1).max(60), z.number().int().min(1).max(4)),
  closed: z.array(z.string().max(60)).max(40),
  followUp: z.record(z.string().min(1).max(60), z.number().int().min(1).max(365)),
  highlight: z.object({ amberPct: z.number().min(1).max(100), redPct: z.number().min(1).max(100), redCount: z.number().int().min(1).max(100000) }),
  slots: z.object({ ET: slot, CT: slot, MT: slot, PT: slot }),
  clockMode: z.enum(['FIXED_PKT', 'FIXED_LOCAL']),
  peak: z.object({ ET: z.string().max(80), CT: z.string().max(80), MT: z.string().max(80), PT: z.string().max(80) }),
  minSegment: z.number().int().min(1).max(1000),
  weekdaysOnly: z.boolean(),
  version: z.number().int().optional(),
  primeTimes: z.array(z.object({ start: hhmm, end: hhmm })).max(4).optional(),
  earthzoneTick: z.boolean().optional(),
})

export async function getSettings(_req: AuthedRequest, res: Response): Promise<void> {
  res.json({ settings: await loadSettings(), defaults: DEFAULT_SETTINGS })
}

/** PUT /api/dialer/settings — ITAD Team Lead or Super Admin. Changing a stage changes everyone's numbers. */
export async function putSettings(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  if (!me.isManager) { res.status(403).json({ error: 'Only an ITAD Team Lead or Super Admin can change these settings.' }); return }
  const parsed = settingsSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }); return }
  const data = { ...DEFAULT_SETTINGS, ...parsed.data, version: 2 } as DialerSettingsData
  await prisma.dialerSettings.upsert({ where: { id: SETTINGS_ID }, update: { data: data as unknown as Prisma.InputJsonValue, updatedById: me.id }, create: { id: SETTINGS_ID, data: data as unknown as Prisma.InputJsonValue, updatedById: me.id } })
  // A changed stage map re-stages every lead, so the numbers follow at once.
  const leads = await prisma.dialerLead.findMany({ select: { id: true, status: true, stage: true } })
  const restage = leads.filter((l) => stageOf(l.status, data) !== l.stage)
  for (let i = 0; i < restage.length; i += 200) {
    await prisma.$transaction(restage.slice(i, i + 200).map((l) => prisma.dialerLead.update({ where: { id: l.id }, data: { stage: stageOf(l.status, data) } })))
  }
  res.json({ settings: data, restaged: restage.length })
}

// ---------------------------------------------------------------------------- duplicates (manager)

/** GET /api/dialer/duplicates — leads two reps both imported, waiting for a manager. */
export async function listDuplicates(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  if (!me.isManager) { res.status(403).json({ error: 'Only a manager can see duplicates.' }); return }
  const flagged = await prisma.dialerLead.findMany({ where: { duplicate: true, dupResolved: false }, select: { matchKey: true } })
  const keys = [...new Set(flagged.map((f) => f.matchKey))]
  const holders = keys.length
    ? await prisma.dialerLead.findMany({ where: { matchKey: { in: keys } }, select: { id: true, matchKey: true, company: true, status: true, state: true, duplicate: true, dupResolved: true, createdAt: true, owner: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } })
    : []
  const groups = keys.map((k) => {
    const hs = holders.filter((h) => h.matchKey === k)
    return { matchKey: k, company: hs[0]?.company ?? '', holders: hs.map((h) => ({ leadId: h.id, ownerId: h.owner.id, ownerName: h.owner.name, status: h.status, state: h.state, since: h.createdAt.toISOString(), first: !h.duplicate })) }
  })
  res.json({ duplicates: groups })
}

/** POST /api/dialer/duplicates/resolve { matchKey, keepOwnerId } — one rep keeps the lead, the others' copies are hidden. */
export async function resolveDuplicate(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  if (!me.isManager) { res.status(403).json({ error: 'Only a manager can resolve duplicates.' }); return }
  const body = z.object({ matchKey: z.string().min(1), keepOwnerId: z.string().min(1) }).safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: 'Pick who keeps the lead.' }); return }
  const holders = await prisma.dialerLead.findMany({ where: { matchKey: body.data.matchKey }, select: { id: true, ownerId: true } })
  const keep = holders.find((h) => h.ownerId === body.data.keepOwnerId)
  if (!keep) { res.status(400).json({ error: 'That rep does not hold this lead.' }); return }
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: keep.id }, data: { duplicate: false, dupResolved: false } }),
    prisma.dialerLead.updateMany({ where: { matchKey: body.data.matchKey, id: { not: keep.id } }, data: { duplicate: true, dupResolved: true } }),
    ...holders.map((h) => prisma.dialerAction.create({ data: { leadId: h.id, userId: me.id, kind: 'DUPLICATE', note: h.id === keep.id ? 'Kept by this rep (duplicate resolved)' : 'Another rep keeps this lead (duplicate resolved)' } })),
  ])
  res.json({ ok: true })
}

// ---------------------------------------------------------------------------- notes

const noteSchema = z.object({
  text: z.string().trim().min(1, 'Write the note first.').max(4000),
  pinned: z.boolean().optional(),
  /** Optional next-action date ("call back Thursday"): the lead comes back in follow-ups then. */
  nextActionAt: z.string().datetime().nullable().optional(),
  /** This note should also go into Earthzone. */
  needsCrm: z.boolean().optional(),
})

/** POST /api/dialer/leads/:id/notes */
export async function addNote(req: AuthedRequest, res: Response): Promise<void> {
  const got = await loadOwnLead(req, res)
  if (!got) return
  const parsed = noteSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid note' }); return }
  const d = parsed.data
  const next = d.nextActionAt ? new Date(d.nextActionAt) : null
  const settings = await loadSettings()
  const leadData: Prisma.DialerLeadUpdateInput = { lastActionAt: new Date() }
  if (next) { leadData.callLaterAt = next; leadData.snoozeUntil = null }
  if (d.needsCrm && settings.earthzoneTick) {
    leadData.needsCrmUpdate = true
    leadData.crmUpdateWhat = [...new Set([...(got.lead.crmUpdateWhat?.split(', ').filter(Boolean) ?? []), 'note'])].join(', ')
  }
  const [note] = await prisma.$transaction([
    prisma.dialerNote.create({ data: { leadId: got.lead.id, userId: got.me.id, text: d.text, pinned: !!d.pinned, nextActionAt: next }, select: noteSelect }),
    ...(d.pinned ? [prisma.dialerNote.updateMany({ where: { leadId: got.lead.id, pinned: true }, data: { pinned: false } })] : []),
    prisma.dialerLead.update({ where: { id: got.lead.id }, data: leadData }),
  ])
  // The new note is the pinned one (the update above unpinned the others first).
  if (d.pinned) await prisma.dialerNote.update({ where: { id: note.id }, data: { pinned: true } })
  res.status(201).json({ note: noteView({ ...note, pinned: !!d.pinned }) })
}

/** PATCH /api/dialer/notes/:id — edit (author only, shown as edited) or pin / unpin. */
export async function updateNote(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const note = await prisma.dialerNote.findUnique({ where: { id: req.params.id }, include: { lead: { select: { ownerId: true } } } })
  if (!note) { res.status(404).json({ error: 'Note not found' }); return }
  const canSee = note.lead.ownerId === me.id || (me.isManager && (await itadUserIds()).includes(note.lead.ownerId))
  if (!canSee) { res.status(404).json({ error: 'Note not found' }); return }
  const parsed = z.object({ text: z.string().trim().min(1).max(4000).optional(), pinned: z.boolean().optional() }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid note' }); return }
  const d = parsed.data
  if (d.text !== undefined && note.userId !== me.id) { res.status(403).json({ error: 'Only the person who wrote a note can edit it.' }); return }
  const ops: Prisma.PrismaPromise<unknown>[] = []
  if (d.pinned) ops.push(prisma.dialerNote.updateMany({ where: { leadId: note.leadId, pinned: true }, data: { pinned: false } }))
  ops.push(prisma.dialerNote.update({
    where: { id: note.id },
    data: { ...(d.pinned !== undefined ? { pinned: d.pinned } : {}), ...(d.text !== undefined && d.text !== note.text ? { text: d.text, editedAt: new Date() } : {}) },
  }))
  await prisma.$transaction(ops)
  const fresh = await prisma.dialerNote.findUniqueOrThrow({ where: { id: note.id }, select: noteSelect })
  res.json({ note: noteView(fresh) })
}

/** GET /api/dialer/notes?rep=&leadId=&from=&to= — notes for export (one lead, a rep, a date range). Never used for statistics. */
export async function listNotes(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const owners = await scopeOwners(req, me)
  if (!owners) { res.status(403).json({ error: 'You can only export your own notes.' }); return }
  const from = req.query.from ? new Date(String(req.query.from)) : null
  const to = req.query.to ? new Date(String(req.query.to)) : null
  const rows = await prisma.dialerNote.findMany({
    where: {
      lead: { ownerId: { in: owners } },
      ...(req.query.leadId ? { leadId: String(req.query.leadId) } : {}),
      ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 20000,
    select: { ...noteSelect, lead: { select: { company: true, contactName: true, phone: true, externalId: true, status: true, owner: { select: { name: true } } } } },
  })
  res.json({ notes: rows.map((n) => ({ ...noteView(n), company: n.lead.company, contactName: n.lead.contactName, phone: n.lead.phone, crmId: n.lead.externalId, status: n.lead.status, rep: n.lead.owner.name })) })
}

// ---------------------------------------------------------------------------- follow-up tracker

const bulkSchema = z.object({ leadIds: z.array(z.string().min(1)).min(1).max(2000), action: z.enum(['KEEP', 'SNOOZE30', 'DROP', 'UNDROP']) })

/** POST /api/dialer/followups/bulk — 90+ day backlog: Keep, Snooze 30 days, Drop (only your own leads). */
export async function followUpBulk(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = bulkSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Pick leads and an action.' }); return }
  const me = await whoAmI(req)
  const own = await prisma.dialerLead.findMany({ where: { id: { in: parsed.data.leadIds }, ownerId: me.id }, select: { id: true } })
  const ids = own.map((l) => l.id)
  if (!ids.length) { res.status(404).json({ error: 'No leads of yours were picked.' }); return }
  const now = new Date()
  const a = parsed.data.action
  const data: Prisma.DialerLeadUpdateManyMutationInput =
    a === 'KEEP' ? { backlogKeptAt: now, lastActionAt: now }
      : a === 'SNOOZE30' ? { snoozeUntil: new Date(now.getTime() + 30 * 86400000), callLaterAt: null, lastActionAt: now }
        : a === 'DROP' ? { followUpDropped: true, lastActionAt: now }
          : { followUpDropped: false }
  const kind = a === 'SNOOZE30' ? 'SNOOZE' : a === 'KEEP' ? 'KEEP' : a === 'DROP' ? 'DROP' : 'UNDROP'
  const note = a === 'KEEP' ? 'Kept in follow-ups (backlog)' : a === 'SNOOZE30' ? 'Snoozed 30 days (backlog)' : a === 'DROP' ? 'Dropped from follow-ups until the status changes' : 'Back in follow-ups'
  await prisma.$transaction([
    prisma.dialerLead.updateMany({ where: { id: { in: ids } }, data }),
    prisma.dialerAction.createMany({ data: ids.map((id) => ({ leadId: id, userId: me.id, kind, note, at: a === 'SNOOZE30' ? (data.snoozeUntil as Date) : null })) }),
  ])
  res.json({ updated: ids.length })
}

// ---------------------------------------------------------------------------- my settings (saved views, follow-up days)

const viewSchema = z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(40), filters: z.record(z.string().max(40), z.string().max(4000)) })
const prefsSchema = z.object({
  views: z.array(viewSchema).max(20).optional(),
  followUp: z.record(z.string().min(1).max(60), z.number().int().min(FOLLOW_UP_MIN, `Follow-up days must be ${FOLLOW_UP_MIN} to ${FOLLOW_UP_MAX}.`).max(FOLLOW_UP_MAX, `Follow-up days must be ${FOLLOW_UP_MIN} to ${FOLLOW_UP_MAX}.`)).optional(),
})

export async function getPrefs(req: AuthedRequest, res: Response): Promise<void> {
  const row = await prisma.dialerUserPrefs.findUnique({ where: { userId: req.user!.id } })
  res.json({ prefs: readPrefs(row?.data), limits: { min: FOLLOW_UP_MIN, max: FOLLOW_UP_MAX } })
}

/** PUT /api/dialer/prefs — my saved views and my follow-up days (each part optional; {} on followUp = back to the defaults). */
export async function putPrefs(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = prefsSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }); return }
  const row = await prisma.dialerUserPrefs.findUnique({ where: { userId: req.user!.id } })
  const cur = readPrefs(row?.data)
  const next = { views: parsed.data.views ?? cur.views, followUp: parsed.data.followUp ?? cur.followUp }
  await prisma.dialerUserPrefs.upsert({ where: { userId: req.user!.id }, update: { data: next as unknown as Prisma.InputJsonValue }, create: { userId: req.user!.id, data: next as unknown as Prisma.InputJsonValue } })
  res.json({ prefs: next })
}

// ---------------------------------------------------------------------------- import history: leads behind a status change

/** GET /api/dialer/imports/:id/changes?from=&to= — the leads that made one "top status change" line. */
export async function importChanges(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const imp = await prisma.dialerImport.findUnique({ where: { id: req.params.id }, select: { userId: true } })
  if (!imp) { res.status(404).json({ error: 'Import not found' }); return }
  if (imp.userId !== me.id && !(me.isManager && (await itadUserIds()).includes(imp.userId))) { res.status(404).json({ error: 'Import not found' }); return }
  const rows = await prisma.dialerStatusChange.findMany({
    where: { importId: req.params.id, ...(req.query.from ? { fromStatus: String(req.query.from) } : {}), ...(req.query.to ? { toStatus: String(req.query.to) } : {}) },
    take: 5000,
    select: { leadId: true, fromStatus: true, toStatus: true, lead: { select: { company: true, contactName: true, phone: true, status: true, state: true, stateOverride: true } } },
  })
  res.json({ leads: rows.map((r) => ({ leadId: r.leadId, from: r.fromStatus, to: r.toStatus, company: r.lead.company, contactName: r.lead.contactName, phone: r.lead.phone, status: r.lead.status, state: r.lead.stateOverride ?? r.lead.state })) })
}

// ---------------------------------------------------------------------------- bulk fill of extra contacts

const fillRow = z.object({
  matchKey: z.string().max(400).nullable().optional(),
  crmId: z.string().max(200).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  company: z.string().max(300).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  phone2: z.string().max(40).nullable().optional(),
  email2: z.string().max(200).nullable().optional(),
  linkedin: z.string().max(300).nullable().optional(),
  decisionMaker: z.string().max(120).nullable().optional(),
  bestTime: z.string().max(80).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
})
const fillSchema = z.object({ rows: z.array(fillRow).min(1).max(20000), apply: z.boolean(), overwrite: z.boolean().optional(), needsCrm: z.boolean().optional() })
const FILL_FIELDS = ['phone2', 'email2', 'linkedin', 'decisionMaker', 'bestTime'] as const

/**
 * POST /api/dialer/bulk-fill — the rep's own sheet of extra numbers, emails, LinkedIn and notes.
 * apply=false: preview (matched, not matched, conflicts). apply=true: save. Matching uses the same
 * key as the main import, only against the rep's own leads; existing values are only replaced
 * when overwrite is true.
 */
export async function bulkFill(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = fillSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The file could not be read.' }); return }
  const me = await whoAmI(req)
  const { rows, apply, overwrite } = parsed.data
  const mine = await prisma.dialerLead.findMany({ where: { ownerId: me.id }, select: { id: true, matchKey: true, company: true, listName: true, phone2: true, email2: true, linkedin: true, decisionMaker: true, bestTime: true, crmUpdateWhat: true } })
  const byKey = new Map(mine.map((l) => [l.matchKey, l]))
  const c = (v: string | null | undefined) => { const t = (v ?? '').replace(/\s+/g, ' ').trim(); return t || null }
  const unmatched: { row: number; company: string | null; reason: string }[] = []
  const conflicts: { leadId: string; company: string; field: string; current: string; incoming: string }[] = []
  const plan = new Map<string, { lead: (typeof mine)[number]; set: Record<string, string>; note: string | null }>()
  rows.forEach((r, i) => {
    const key = c(r.matchKey) ?? matchKeyOf({ leadId: c(r.crmId), email: c(r.email)?.toLowerCase() ?? null, company: c(r.company), contactName: c(r.contactName), phone: c(r.phone) })
    const lead = key ? byKey.get(key) : undefined
    if (!lead) { unmatched.push({ row: i + 2, company: c(r.company), reason: key ? 'Not one of your leads (another list, or another rep\'s lead)' : 'Nothing to recognise the lead by' }); return }
    const p = plan.get(lead.id) ?? { lead, set: {}, note: null }
    for (const f of FILL_FIELDS) {
      const v = c(r[f])
      if (!v) continue
      const cur = lead[f]
      if (cur && cur !== v) {
        conflicts.push({ leadId: lead.id, company: lead.company, field: f, current: cur, incoming: v })
        if (!overwrite) continue
      }
      if (cur !== v) p.set[f] = v
    }
    const n = c(r.note)
    if (n) p.note = n
    plan.set(lead.id, p)
  })
  const toChange = [...plan.values()].filter((p) => Object.keys(p.set).length || p.note)
  if (!apply) {
    res.json({ matched: plan.size, willUpdate: toChange.length, notes: toChange.filter((p) => p.note).length, unmatched: unmatched.slice(0, 200), unmatchedCount: unmatched.length, conflicts: conflicts.slice(0, 200), conflictCount: conflicts.length })
    return
  }
  const settings = await loadSettings()
  const flag = settings.earthzoneTick && parsed.data.needsCrm !== false
  const ops: Prisma.PrismaPromise<unknown>[] = []
  for (const p of toChange) {
    const fields = Object.keys(p.set)
    const labels = fields.map((f) => ADDED_FIELDS[f as keyof typeof ADDED_FIELDS])
    ops.push(prisma.dialerLead.update({
      where: { id: p.lead.id },
      data: {
        ...p.set,
        ...(flag && labels.length ? { needsCrmUpdate: true, crmUpdateWhat: [...new Set([...(p.lead.crmUpdateWhat?.split(', ').filter(Boolean) ?? []), ...labels])].join(', ') } : {}),
      },
    }))
    if (labels.length) ops.push(prisma.dialerAction.create({ data: { leadId: p.lead.id, userId: me.id, kind: 'BULK_FILL', note: `Filled from your sheet: ${labels.join(', ')}` } }))
    if (p.note) ops.push(prisma.dialerNote.create({ data: { leadId: p.lead.id, userId: me.id, text: p.note } }))
  }
  for (let i = 0; i < ops.length; i += 300) await prisma.$transaction(ops.slice(i, i + 300))
  res.json({ updated: toChange.length, unmatchedCount: unmatched.length, conflictCount: conflicts.length, skippedConflicts: overwrite ? 0 : conflicts.length })
}
