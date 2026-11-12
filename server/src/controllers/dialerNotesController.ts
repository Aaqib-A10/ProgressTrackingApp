import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { cleanName, findContacts, parseHiddenDescription, parseNotesCell, phoneDigits, splitPhones, type EzLink } from '../lib/dialer/ezNotes'
import { syncAutoTasks } from '../lib/dialer/tasks'
import { contactView } from '../lib/dialer/contacts'
import { itadUserIds, loadSettings, noteSelect, noteView, scopeOwners, whoAmI } from './dialerController'

/**
 * ITAD update 12 Nov 2026 (docs/itad-notes/DESIGN.md): the one-time Earth Zone sync (section 1), notes that can be
 * deleted and that keep their Earth Zone override (section 2), second contacts found in notes, and the Claude log
 * (section 3). Metriq never calls or writes to Earth Zone: the file the agent pulled is read here, nothing goes back.
 */

// ---------------------------------------------------------------------------- Earth Zone sync (section 1)

const cell = z.union([z.string().max(60000), z.number(), z.null()]).optional()
const ezRow = z.object({
  ezId: cell, firstName: cell, lastName: cell, company: cell, phone: cell, altPhones: cell, email: cell, email2: cell,
  jobTitle: cell, hiddenDescription: cell, notes: cell,
})
const ezSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  rows: z.array(ezRow).min(1).max(20000),
  apply: z.boolean(),
  /** Replace a different existing Secondary Email / Job Title / description (default: keep what the lead has). */
  replace: z.boolean().optional(),
})
type EzRow = z.infer<typeof ezRow>

const txt = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).replace(/[ \t]+/g, ' ').trim()
  return t ? t : null
}
const key = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const lastWord = (name: string | null | undefined) => key((name ?? '').trim().split(/\s+/).pop())

const LEAD_SEL = {
  id: true, company: true, contactName: true, email: true, email2: true, phone: true, phone2: true, altPhones: true, jobTitle: true,
  description: true, ezLinks: true, ezLeadId: true, externalId: true, linkedin: true, crmUpdateWhat: true,
} as const
type SyncLead = Prisma.DialerLeadGetPayload<{ select: typeof LEAD_SEL }>

export interface EzPlanLead {
  lead: SyncLead
  ezLeadId: string | null
  set: Partial<Record<'email2' | 'jobTitle' | 'description', string>>
  altPhones: string[]
  links: EzLink[]
  notes: { at: Date; author: string; text: string; key: string }[]
}

/**
 * Match each row to one of the agent's own leads (the matching order is a setting; default Earth Zone Lead ID
 * already saved, then primary email, then primary phone, then company + last name) and work out what to fill.
 * A row that matches two leads is ambiguous and left out. Pure apart from the inputs: tested in the integration test.
 */
export function planEzSync(rows: EzRow[], leads: SyncLead[], existingKeys: Map<string, Set<string>>, order: string[], replace: boolean) {
  const idx = { ezId: new Map<string, SyncLead[]>(), email: new Map<string, SyncLead[]>(), phone: new Map<string, SyncLead[]>(), companyLastName: new Map<string, SyncLead[]>() }
  const add = (m: Map<string, SyncLead[]>, k: string, l: SyncLead) => { if (!k) return; const a = m.get(k) ?? []; if (!a.includes(l)) a.push(l); m.set(k, a) }
  for (const l of leads) {
    add(idx.ezId, (l.ezLeadId ?? '').toLowerCase(), l)
    add(idx.ezId, (l.externalId ?? '').toLowerCase(), l)
    add(idx.email, (l.email ?? '').toLowerCase(), l)
    add(idx.phone, phoneDigits(l.phone), l)
    if (l.contactName) add(idx.companyLastName, `${key(l.company)}|${lastWord(l.contactName)}`, l)
  }
  const plans = new Map<string, EzPlanLead>()
  const unmatched: { row: number; company: string | null; reason: string }[] = []
  const ambiguous: { row: number; company: string | null; by: string; leads: string[] }[] = []
  const conflicts: { leadId: string; company: string; field: string; current: string; incoming: string }[] = []
  let notesFound = 0, notesKnown = 0
  rows.forEach((r, i) => {
    const rowNo = i + 2
    const company = txt(r.company)
    const probes: Record<string, string> = {
      ezId: (txt(r.ezId) ?? '').toLowerCase(),
      email: (txt(r.email) ?? '').toLowerCase(),
      phone: phoneDigits(txt(r.phone)),
      companyLastName: company && txt(r.lastName) ? `${key(company)}|${key(txt(r.lastName))}` : '',
    }
    let lead: SyncLead | null = null
    for (const by of order) {
      const k = probes[by]
      if (!k) continue
      const hits = idx[by as keyof typeof idx].get(k) ?? []
      if (hits.length === 1) { lead = hits[0]; break }
      if (hits.length > 1) { ambiguous.push({ row: rowNo, company, by, leads: hits.map((h) => h.company).slice(0, 5) }); return }
    }
    if (!lead) { unmatched.push({ row: rowNo, company, reason: Object.values(probes).some(Boolean) ? 'Not one of your leads' : 'Nothing to match on (no Lead ID, email, phone or company + last name)' }); return }
    const p = plans.get(lead.id) ?? { lead, ezLeadId: null, set: {}, altPhones: [], links: [], notes: [] }
    if (probes.ezId && !lead.ezLeadId) p.ezLeadId = txt(r.ezId)
    // Alternative Numbers: each new number once; the lead's own numbers are not repeated.
    for (const n of splitPhones(txt(r.altPhones), [lead.phone, lead.phone2, ...lead.altPhones, ...p.altPhones])) p.altPhones.push(n)
    // Secondary Email, Job Title, the Hidden Description text: filled when empty; a different value is a conflict.
    const fill = (field: 'email2' | 'jobTitle' | 'description', incoming: string | null) => {
      if (!incoming) return // a blank cell never overwrites
      const cur = lead![field]
      if (cur && cur.trim().toLowerCase() === incoming.trim().toLowerCase()) return
      if (cur) { conflicts.push({ leadId: lead!.id, company: lead!.company, field, current: cur, incoming }); if (!replace) return }
      p.set[field] = incoming
    }
    fill('email2', txt(r.email2)?.toLowerCase() ?? null)
    fill('jobTitle', txt(r.jobTitle))
    const hd = parseHiddenDescription(txt(r.hiddenDescription))
    fill('description', hd.description)
    const haveLinks = new Set([...((lead.ezLinks as EzLink[] | null) ?? []), ...p.links].map((l) => l.url.toLowerCase()))
    for (const l of hd.links) if (!haveLinks.has(l.url.toLowerCase())) { p.links.push(l); haveLinks.add(l.url.toLowerCase()) }
    // Notes: an entry already here (even one deleted or edited here) is never added again.
    const known = existingKeys.get(lead.id) ?? new Set<string>()
    for (const e of parseNotesCell(txt(r.notes)).entries) {
      notesFound++
      if (known.has(e.key) || p.notes.some((n) => n.key === e.key)) { notesKnown++; continue }
      p.notes.push({ at: e.at, author: e.author, text: e.text, key: e.key })
    }
    plans.set(lead.id, p)
  })
  const changing = [...plans.values()].filter((p) => p.ezLeadId || Object.keys(p.set).length || p.altPhones.length || p.links.length || p.notes.length)
  return { plans: changing, matched: plans.size, unmatched, ambiguous, conflicts, notesFound, notesKnown }
}

/**
 * POST /api/dialer/ez-sync { rows, apply, replace? } — the one-time sync from the Earth Zone pull, on the running
 * agent's own leads only. apply=false: the preview (matched, unmatched, ambiguous, what will be filled); nothing
 * is saved. apply=true: fills Alternative Numbers, Secondary Email, Hidden Description (links + text), Job Title
 * and the notes timeline, and saves the Earth Zone Lead ID. Every other field stays as it is.
 */
export async function ezSync(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = ezSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The file could not be read.' }); return }
  const me = await whoAmI(req)
  const settings = await loadSettings()
  const leads = await prisma.dialerLead.findMany({ where: { ownerId: me.id }, select: LEAD_SEL })
  if (!leads.length) { res.status(400).json({ error: 'You have no leads yet: import your CRM export first.' }); return }
  const keyRows = await prisma.dialerNote.findMany({ where: { lead: { ownerId: me.id }, ezKey: { not: null } }, select: { leadId: true, ezKey: true } })
  const existingKeys = new Map<string, Set<string>>()
  for (const k of keyRows) { const s = existingKeys.get(k.leadId) ?? new Set<string>(); s.add(k.ezKey!); existingKeys.set(k.leadId, s) }
  const plan = planEzSync(parsed.data.rows, leads, existingKeys, settings.ezMatchOrder, !!parsed.data.replace)

  // Earth Zone authors → Metriq people, by name (case and spacing ignored). A name two people share is left unmatched.
  const people = await prisma.user.findMany({ select: { id: true, name: true } })
  const byName = new Map<string, string | null>()
  for (const u of people) { const k = cleanName(u.name).toLowerCase(); byName.set(k, byName.has(k) ? null : u.id) }
  const authors = new Map<string, { name: string; userId: string | null; notes: number }>()
  for (const p of plan.plans) for (const n of p.notes) {
    const k = n.author.toLowerCase()
    const a = authors.get(k) ?? { name: n.author, userId: byName.get(k) ?? null, notes: 0 }
    a.notes++
    authors.set(k, a)
  }

  const fieldCounts = {
    altPhones: plan.plans.reduce((n, p) => n + p.altPhones.length, 0),
    email2: plan.plans.filter((p) => p.set.email2).length,
    jobTitle: plan.plans.filter((p) => p.set.jobTitle).length,
    description: plan.plans.filter((p) => p.set.description).length,
    links: plan.plans.reduce((n, p) => n + p.links.length, 0),
    notes: plan.plans.reduce((n, p) => n + p.notes.length, 0),
    ezLeadId: plan.plans.filter((p) => p.ezLeadId).length,
  }
  const summary = {
    rows: parsed.data.rows.length, matched: plan.matched, unmatchedCount: plan.unmatched.length, ambiguousCount: plan.ambiguous.length,
    leadsToUpdate: plan.plans.length, fields: fieldCounts, notesInFile: plan.notesFound, notesAlreadyHere: plan.notesKnown,
    conflictCount: plan.conflicts.length, matchOrder: settings.ezMatchOrder,
    authors: [...authors.values()].sort((a, b) => b.notes - a.notes).map((a) => ({ name: a.name, matched: !!a.userId, isMe: a.userId === me.id, notes: a.notes })),
  }
  if (!parsed.data.apply) {
    res.json({
      ...summary,
      unmatched: plan.unmatched.slice(0, 300), ambiguous: plan.ambiguous.slice(0, 300), conflicts: plan.conflicts.slice(0, 300),
      sample: plan.plans.slice(0, 20).map((p) => ({ leadId: p.lead.id, company: p.lead.company, altPhones: p.altPhones, set: p.set, links: p.links, notes: p.notes.length })),
    })
    return
  }

  const now = new Date()
  const ops: Prisma.PrismaPromise<unknown>[] = []
  const noteRows: Prisma.DialerNoteCreateManyInput[] = []
  for (const p of plan.plans) {
    const data: Prisma.DialerLeadUpdateInput = { ezSyncedAt: now }
    if (p.ezLeadId) data.ezLeadId = p.ezLeadId
    if (p.altPhones.length) data.altPhones = [...p.lead.altPhones, ...p.altPhones]
    if (p.links.length) data.ezLinks = [...((p.lead.ezLinks as EzLink[] | null) ?? []), ...p.links] as unknown as Prisma.InputJsonValue
    Object.assign(data, p.set)
    ops.push(prisma.dialerLead.update({ where: { id: p.lead.id }, data }))
    const what = [p.altPhones.length && `${p.altPhones.length} alternative number${p.altPhones.length > 1 ? 's' : ''}`, p.set.email2 && 'secondary email', p.set.jobTitle && 'job title', (p.set.description || p.links.length) && 'description and links', p.notes.length && `${p.notes.length} note${p.notes.length > 1 ? 's' : ''}`].filter(Boolean)
    if (what.length) ops.push(prisma.dialerAction.create({ data: { leadId: p.lead.id, userId: me.id, kind: 'EZ_SYNC', note: `From Earth Zone: ${what.join(', ')}` } }))
    for (const n of p.notes) {
      noteRows.push({ leadId: p.lead.id, userId: authors.get(n.author.toLowerCase())?.userId ?? null, authorName: n.author || null, source: 'EARTHZONE', text: n.text || '(no text)', ezText: n.text, ezKey: n.key, createdAt: n.at })
    }
  }
  for (let i = 0; i < ops.length; i += 200) await prisma.$transaction(ops.slice(i, i + 200))
  let notesAdded = 0
  for (let i = 0; i < noteRows.length; i += 500) notesAdded += (await prisma.dialerNote.createMany({ data: noteRows.slice(i, i + 500), skipDuplicates: true })).count

  // New people named in the new notes: offered as second contacts (one per person per lead).
  const contactRows: Prisma.DialerContactCreateManyInput[] = []
  if (noteRows.length) {
    const saved = await prisma.dialerNote.findMany({ where: { leadId: { in: plan.plans.map((p) => p.lead.id) }, ezKey: { in: noteRows.map((n) => n.ezKey!) } }, select: { id: true, leadId: true, text: true } })
    const leadOf = new Map(plan.plans.map((p) => [p.lead.id, p]))
    for (const n of saved) {
      const p = leadOf.get(n.leadId)!
      for (const c of findContacts(n.text, [p.lead.email, p.lead.email2, p.set.email2, p.lead.phone, p.lead.phone2, ...p.lead.altPhones, ...p.altPhones, p.lead.linkedin])) {
        contactRows.push({ leadId: n.leadId, name: c.name, title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin, noteId: n.id, key: c.key })
      }
    }
  }
  let contactsOffered = 0
  for (let i = 0; i < contactRows.length; i += 500) contactsOffered += (await prisma.dialerContact.createMany({ data: contactRows.slice(i, i + 500), skipDuplicates: true })).count

  // Notes change Last touched and close follow-ups the agent already answered (section 4).
  await syncAutoTasks([me.id])
  res.json({ ...summary, applied: true, updated: plan.plans.length, notesAdded, contactsOffered })
}

// ---------------------------------------------------------------------------- notes (section 2)

async function noteForWrite(req: AuthedRequest, res: Response) {
  const me = await whoAmI(req)
  const note = await prisma.dialerNote.findUnique({ where: { id: req.params.id }, include: { lead: { select: { ownerId: true } } } })
  if (!note || note.deletedAt) { res.status(404).json({ error: 'Note not found' }); return null }
  const canSee = note.lead.ownerId === me.id || (me.isManager && (await itadUserIds(me)).includes(note.lead.ownerId))
  if (!canSee) { res.status(404).json({ error: 'Note not found' }); return null }
  if (note.userId !== me.id && note.lead.ownerId !== me.id) { res.status(403).json({ error: 'Only the person who wrote a note, or the lead\'s agent, can change it.' }); return null }
  return { me, note }
}

/**
 * DELETE /api/dialer/notes/:id — every note can be deleted (section 2). It is hidden, not erased: an Earth Zone note
 * stays known by its Earth Zone key, so a later sync or import never brings it back.
 */
export async function deleteNote(req: AuthedRequest, res: Response): Promise<void> {
  const got = await noteForWrite(req, res)
  if (!got) return
  await prisma.dialerNote.update({ where: { id: got.note.id }, data: { deletedAt: new Date(), pinned: false } })
  await prisma.dialerAction.create({ data: { leadId: got.note.leadId, userId: got.me.id, kind: 'NOTE_DELETED', note: `Note of ${got.note.createdAt.toISOString().slice(0, 10)} deleted${got.note.source === 'EARTHZONE' ? ' (kept deleted after any Earth Zone sync)' : ''}` } })
  // A deleted note no longer counts as a touch.
  await syncAutoTasks([got.note.lead.ownerId])
  res.json({ ok: true })
}

// ---------------------------------------------------------------------------- second contacts found in notes

const contactSchema = z.object({
  state: z.enum(['ACCEPTED', 'IGNORED', 'SUGGESTED']).optional(),
  name: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  linkedin: z.string().trim().max(300).nullable().optional(),
})

/** PATCH /api/dialer/contacts/:id — accept (with edits) or ignore a second contact found in a note. The lead's agent only. */
export async function updateContact(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid contact' }); return }
  const me = await whoAmI(req)
  const c = await prisma.dialerContact.findUnique({ where: { id: req.params.id }, include: { lead: { select: { ownerId: true } } } })
  if (!c || c.lead.ownerId !== me.id) { res.status(404).json({ error: 'Contact not found' }); return }
  const saved = await prisma.dialerContact.update({ where: { id: c.id }, data: parsed.data })
  if (parsed.data.state && parsed.data.state !== c.state && parsed.data.state !== 'SUGGESTED') {
    await prisma.dialerAction.create({ data: { leadId: c.leadId, userId: me.id, kind: 'CONTACT', note: `${parsed.data.state === 'ACCEPTED' ? 'Added' : 'Ignored'} second contact${saved.name ? ` ${saved.name}` : ''}` } })
  }
  res.json({ contact: contactView(saved) })
}

// ---------------------------------------------------------------------------- the Claude log (section 3)

const LABEL: Record<string, string> = { altPhones: 'Alternative number', phone2: 'Second phone', email2: 'Second email', linkedin: 'LinkedIn', decisionMaker: 'Decision maker', bestTime: 'Best time to call' }

/**
 * GET /api/dialer/claude-log?rep=&leadId=&from=&to=&source=&kind= — everything written to leads by a source
 * (default Claude): notes, and the values it set (alternative numbers...), with the lead and the date.
 * source = CLAUDE | EARTHZONE | METRIQ | ALL (values set only exist for Claude); kind = all | notes | values.
 */
export async function claudeLog(req: AuthedRequest, res: Response): Promise<void> {
  const me = await whoAmI(req)
  const owners = await scopeOwners(req, me)
  if (!owners) { res.status(403).json({ error: 'You can only see your own leads.' }); return }
  const source = ['CLAUDE', 'EARTHZONE', 'METRIQ', 'ALL'].includes(String(req.query.source)) ? String(req.query.source) : 'CLAUDE'
  const kind = ['notes', 'values'].includes(String(req.query.kind)) ? String(req.query.kind) : 'all'
  const day = (v: unknown, end: boolean) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) : null)
  const from = day(req.query.from, false), to = day(req.query.to, true)
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined
  const leadId = typeof req.query.leadId === 'string' && req.query.leadId ? req.query.leadId : undefined
  const leadWhere = { ownerId: { in: owners } }
  const leadSel = { select: { id: true, company: true, contactName: true, ownerId: true } }
  const [notes, values] = await Promise.all([
    kind === 'values' ? Promise.resolve([]) : prisma.dialerNote.findMany({
      where: { lead: leadWhere, deletedAt: null, ...(leadId ? { leadId } : {}), ...(source !== 'ALL' ? { source } : {}), ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: 'desc' }, take: 2000, select: { ...noteSelect, lead: leadSel },
    }),
    kind === 'notes' || (source !== 'CLAUDE' && source !== 'ALL') ? Promise.resolve([]) : prisma.dialerAction.findMany({
      where: { lead: leadWhere, source: 'CLAUDE', field: { not: null }, removedAt: null, ...(leadId ? { leadId } : {}), ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: 'desc' }, take: 2000, select: { id: true, field: true, value: true, createdAt: true, lead: leadSel },
    }),
  ])
  const items = [
    ...notes.map((n) => ({ id: n.id, kind: 'NOTE' as const, leadId: n.lead.id, company: n.lead.company, contactName: n.lead.contactName, label: 'Note', text: n.text, source: n.source, at: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, author: noteView(n).author, canEdit: n.lead.ownerId === me.id || n.user?.id === me.id })),
    ...values.map((v) => ({ id: v.id, kind: 'VALUE' as const, leadId: v.lead.id, company: v.lead.company, contactName: v.lead.contactName, label: LABEL[v.field!] ?? v.field!, text: v.value ?? '', source: 'CLAUDE', at: v.createdAt.toISOString(), editedAt: null, author: 'Claude', canEdit: v.lead.ownerId === me.id })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  res.json({ items, source, kind })
}

const VALUE_FIELDS = ['altPhones', 'phone2', 'email2', 'linkedin', 'decisionMaker', 'bestTime'] as const
type ValueField = (typeof VALUE_FIELDS)[number]

async function valueForWrite(req: AuthedRequest, res: Response) {
  const me = await whoAmI(req)
  const a = await prisma.dialerAction.findUnique({ where: { id: req.params.id }, include: { lead: true } })
  if (!a || a.source !== 'CLAUDE' || !a.field || a.removedAt || !(VALUE_FIELDS as readonly string[]).includes(a.field)) { res.status(404).json({ error: 'Entry not found' }); return null }
  if (a.lead.ownerId !== me.id) { res.status(403).json({ error: 'Only the lead\'s agent can change this.' }); return null }
  return { me, a, field: a.field as ValueField }
}

/** PATCH /api/dialer/claude-log/values/:id { value } — correct a value Claude set: the lead changes with it. */
export async function editClaudeValue(req: AuthedRequest, res: Response): Promise<void> {
  const p = z.object({ value: z.string().trim().min(1).max(300) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Write the value.' }); return }
  const got = await valueForWrite(req, res)
  if (!got) return
  const { a, field } = got
  const data: Prisma.DialerLeadUpdateInput = {}
  if (field === 'altPhones') data.altPhones = a.lead.altPhones.map((x) => (x === a.value ? p.data.value : x))
  else if (a.lead[field] === a.value) (data as Record<string, unknown>)[field] = p.data.value
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: a.leadId }, data }),
    prisma.dialerAction.update({ where: { id: a.id }, data: { value: p.data.value, note: `${LABEL[field] ?? field}: ${p.data.value} (corrected)` } }),
  ])
  res.json({ ok: true })
}

/** DELETE /api/dialer/claude-log/values/:id — remove a value Claude set, from the lead too. */
export async function deleteClaudeValue(req: AuthedRequest, res: Response): Promise<void> {
  const got = await valueForWrite(req, res)
  if (!got) return
  const { a, me, field } = got
  const data: Prisma.DialerLeadUpdateInput = {}
  if (field === 'altPhones') data.altPhones = a.lead.altPhones.filter((x) => x !== a.value)
  else if (a.lead[field] === a.value) (data as Record<string, unknown>)[field] = null
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: a.leadId }, data }),
    prisma.dialerAction.update({ where: { id: a.id }, data: { removedAt: new Date() } }),
    prisma.dialerAction.create({ data: { leadId: a.leadId, userId: me.id, kind: 'EDIT', note: `${LABEL[field] ?? field} ${a.value} removed (Claude log)` } }),
  ])
  res.json({ ok: true })
}
