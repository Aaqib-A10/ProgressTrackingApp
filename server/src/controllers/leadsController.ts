import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse } from '../lib/pm/http'
import { isOn } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import { sendCsv } from '../lib/csv'
import { canManage, isMemberOf, leadFor, leadScope, leadWhere, requireLeadAdmin, type LeadScope, type LeadViewer } from '../lib/leads/access'
import { cleanInput, fromFields, hasSubstance, OPEN_STATUSES, receiveLead, sourceText, STATUSES, type LeadInput } from '../lib/leads/intake'
import { leadManagers, tellAboutLead } from '../lib/leads/notify'
import { encryptSecret, decryptSecret, testInbox } from '../lib/leads/inbox'

/**
 * Lead Management (/api/leads): the leads list, one lead, adding and importing leads, assigning,
 * and (Super Admin) the businesses that receive leads. The public website form is leadIn below.
 */

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
export const formUrl = (key: string) => `${APP_URL()}/api/lead-in/${key}`
const newFormKey = () => 'lf_' + crypto.randomBytes(18).toString('base64url')

function me(req: AuthedRequest): LeadViewer {
  if (!req.user) throw new HttpError(401, 'Not authenticated')
  return { id: req.user.id, role: req.user.role, companyId: req.user.companyId }
}

async function ctx(req: AuthedRequest): Promise<{ me: LeadViewer; s: LeadScope }> {
  const m = me(req)
  if (!(await isOn('lead-management', m.companyId))) throw new HttpError(403, 'Lead Management is not switched on for your company.')
  return { me: m, s: await leadScope(m) }
}

const PERSON = { select: { id: true, name: true, email: true } } as const

/** Is this lead late? (not given out in time, or given out and nobody got in touch in time) */
function lateness(l: { status: string; assigneeId: string | null; createdAt: Date; assignedAt: Date | null; firstContactAt: Date | null }, b: { slaAssignMins: number; slaContactMins: number }, now = Date.now()): 'assign' | 'contact' | null {
  if (l.status !== 'NEW') return null
  if (!l.assigneeId) return b.slaAssignMins > 0 && now - l.createdAt.getTime() > b.slaAssignMins * 60_000 ? 'assign' : null
  if (!l.firstContactAt && l.assignedAt && b.slaContactMins > 0 && now - l.assignedAt.getTime() > b.slaContactMins * 60_000) return 'contact'
  return null
}

// ------------------------------------------------------------------ meta

/** GET /api/leads/meta — the businesses I work in, their people (for "Assign to"), and what I may do. */
export async function leadsMeta(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const businesses = await prisma.leadBusiness.findMany({
    where: s.admin ? {} : { id: { in: [...s.roles.keys()] }, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true, isActive: true, slaAssignMins: true, slaContactMins: true, members: { select: { role: true, user: PERSON }, orderBy: { user: { name: 'asc' } } } },
  })
  res.json({
    me: { id: m.id, admin: s.admin },
    businesses: businesses.map((b) => ({ ...b, myRole: s.admin ? 'MANAGER' : s.roles.get(b.id) ?? null, members: b.members.map((x) => ({ ...x.user, role: x.role })) })),
    statuses: STATUSES,
  })
}

// ------------------------------------------------------------------ list

const listQuery = z.object({
  business: z.string().max(60).optional(),
  status: z.string().max(80).optional(),
  assignee: z.string().max(60).optional(),
  source: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
  late: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  sort: z.enum(['newest', 'oldest', 'activity']).optional(),
})

function listWhere(m: LeadViewer, s: LeadScope, q: z.infer<typeof listQuery>): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [leadWhere(m, s)]
  if (q.business) and.push({ businessId: q.business })
  if (q.status === 'open') and.push({ status: { in: OPEN_STATUSES } })
  else if (q.status && q.status !== 'all') and.push({ status: { in: q.status.split(',').filter((x) => (STATUSES as readonly string[]).includes(x)) } })
  else if (!q.status) and.push({ status: { not: 'SPAM' } })
  if (q.assignee === 'me') and.push({ assigneeId: m.id })
  else if (q.assignee === 'none') and.push({ assigneeId: null })
  else if (q.assignee) and.push({ assigneeId: q.assignee })
  if (q.source) and.push({ source: q.source })
  if (q.q?.trim()) {
    const t = q.q.trim()
    and.push({ OR: [{ name: { contains: t, mode: 'insensitive' } }, { email: { contains: t, mode: 'insensitive' } }, { phone: { contains: t } }, { organization: { contains: t, mode: 'insensitive' } }, { message: { contains: t, mode: 'insensitive' } }] })
  }
  return { AND: and }
}

const LIST_SELECT = {
  id: true, businessId: true, name: true, email: true, phone: true, organization: true, location: true, source: true, sourceDetail: true, status: true,
  utmCampaign: true, utmSource: true, repeats: true, createdAt: true, assignedAt: true, firstContactAt: true, lastActivityAt: true, assigneeId: true,
  assignee: PERSON, message: true,
} as const

/** GET /api/leads — the leads I can see, newest first, 50 a page, with counts for the tabs. */
export async function listLeads(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(listQuery, req.query)
  const page = q.page ?? 1
  const businesses = new Map((await prisma.leadBusiness.findMany({ select: { id: true, slaAssignMins: true, slaContactMins: true } })).map((b) => [b.id, b]))
  const orderBy: Prisma.LeadOrderByWithRelationInput = q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'activity' ? { lastActivityAt: 'desc' } : { createdAt: 'desc' }
  let rows: Awaited<ReturnType<typeof prisma.lead.findMany<{ select: typeof LIST_SELECT }>>>
  let total: number
  if (q.late) {
    // Late leads are worked out here (the time limit is each business's own).
    const all = await prisma.lead.findMany({ where: { AND: [listWhere(m, s, q), { status: 'NEW' }] }, select: LIST_SELECT, orderBy: { createdAt: 'asc' }, take: 2000 })
    const late = all.filter((l) => { const b = businesses.get(l.businessId); return b && lateness(l, b) })
    total = late.length
    rows = late.slice((page - 1) * 50, page * 50)
  } else {
    const where = listWhere(m, s, q)
    ;[rows, total] = await Promise.all([prisma.lead.findMany({ where, select: LIST_SELECT, orderBy, skip: (page - 1) * 50, take: 50 }), prisma.lead.count({ where })])
  }
  // Counts for the tabs, over everything I can see in the chosen business.
  const base: Prisma.LeadWhereInput = { AND: [leadWhere(m, s), q.business ? { businessId: q.business } : {}] }
  const [byStatus, unassigned, mine, open] = await Promise.all([
    prisma.lead.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.lead.count({ where: { AND: [base, { assigneeId: null, status: { in: OPEN_STATUSES } }] } }),
    prisma.lead.count({ where: { AND: [base, { assigneeId: m.id, status: { in: OPEN_STATUSES } }] } }),
    prisma.lead.findMany({ where: { AND: [base, { status: 'NEW' }] }, select: { businessId: true, status: true, assigneeId: true, createdAt: true, assignedAt: true, firstContactAt: true }, take: 5000 }),
  ])
  const late = open.filter((l) => { const b = businesses.get(l.businessId); return b && lateness(l, b) }).length
  res.json({
    leads: rows.map((l) => { const b = businesses.get(l.businessId); return { ...l, message: l.message?.slice(0, 200) ?? null, late: b ? lateness(l, b) : null } }),
    total, page, pageSize: 50,
    counts: { byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])), unassigned, mine, late },
  })
}

/** GET /api/leads/export.csv — the same list as a spreadsheet (managers and Super Admin). */
export async function exportLeads(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  if (!s.admin && !s.managerOf.length) throw new HttpError(403, 'Only managers can download leads.')
  const q = parse(listQuery, req.query)
  const rows = await prisma.lead.findMany({ where: listWhere(m, s, q), orderBy: { createdAt: 'desc' }, take: 20000, include: { business: { select: { name: true } }, assignee: PERSON } })
  const head = ['Received', 'Business', 'Name', 'Email', 'Phone', 'Company', 'Location', 'Status', 'Assigned to', 'Source', 'From', 'Campaign', 'UTM source', 'UTM medium', 'Keyword', 'gclid', 'Message']
  sendCsv(res, 'leads.csv', [head, ...rows.map((l) => [l.createdAt.toISOString(), l.business.name, l.name, l.email ?? '', l.phone ?? '', l.organization ?? '', l.location ?? '', l.status, l.assignee?.name ?? '', sourceText(l.source), l.sourceDetail ?? '', l.utmCampaign ?? '', l.utmSource ?? '', l.utmMedium ?? '', l.utmTerm ?? '', l.gclid ?? '', l.message ?? ''])])
}

// ------------------------------------------------------------------ one lead

/** GET /api/leads/:id — the lead, its timeline and who can take it. */
export async function getLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const base = await leadFor(m, s, String(req.params.id))
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      business: { select: { id: true, name: true, color: true, slaAssignMins: true, slaContactMins: true } },
      assignee: PERSON, assignedBy: PERSON, createdBy: PERSON,
      events: { orderBy: { createdAt: 'desc' }, take: 200, include: { user: PERSON } },
    },
  })
  const names = new Map((await prisma.user.findMany({ where: { id: { in: lead.events.map((e) => (e.data as { to?: string } | null)?.to).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  res.json({
    lead: {
      ...lead,
      late: lateness(lead, lead.business),
      events: lead.events.map((e) => ({ ...e, toName: (e.data as { to?: string } | null)?.to ? names.get((e.data as { to: string }).to) ?? null : undefined })),
    },
    canManage: canManage(s, lead.businessId),
  })
}

const editSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(254).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  organization: z.string().max(200).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  message: z.string().max(8000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  lostReason: z.string().max(300).nullable().optional(),
  value: z.number().min(0).max(1e12).nullable().optional(),
}).strict()

/** PATCH /api/leads/:id — change the details or the status. */
export async function updateLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await leadFor(m, s, String(req.params.id))
  const b = parse(editSchema, req.body)
  const data: Prisma.LeadUpdateInput = { lastActivityAt: new Date() }
  const events: Prisma.LeadEventCreateManyInput[] = []
  const fields = ['name', 'email', 'phone', 'organization', 'location', 'message', 'lostReason', 'value'] as const
  const changed: string[] = []
  for (const f of fields) {
    if (b[f] === undefined) continue
    let v: string | number | null = b[f] ?? null
    if (typeof v === 'string') v = v.trim() || (f === 'name' ? '' : null)
    if (f === 'email' && typeof v === 'string') {
      v = v.toLowerCase()
      if (!/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(v)) throw new HttpError(422, 'That email address does not look right')
    }
    if ((lead as Record<string, unknown>)[f] === v) continue
    ;(data as Record<string, unknown>)[f] = v
    if (f !== 'lostReason' && f !== 'value') changed.push(f === 'organization' ? 'company' : f)
  }
  if (changed.length) events.push({ leadId: lead.id, userId: m.id, kind: 'EDIT', text: `Changed ${changed.join(', ')}` })
  if (b.status && b.status !== lead.status) {
    data.status = b.status
    // Leaving New means someone got in touch.
    if (lead.status === 'NEW' && !lead.firstContactAt && b.status !== 'SPAM') data.firstContactAt = new Date()
    events.push({ leadId: lead.id, userId: m.id, kind: 'STATUS', text: b.status === 'LOST' && b.lostReason ? `Lost: ${b.lostReason}` : '', data: { from: lead.status, to: b.status } })
  }
  const saved = await prisma.lead.update({ where: { id: lead.id }, data })
  if (events.length) await prisma.leadEvent.createMany({ data: events })
  res.json({ lead: saved })
}

/** POST /api/leads/:id/assign { assigneeId | null } — managers give a lead to someone in the business. */
export async function assignLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await leadFor(m, s, String(req.params.id))
  if (!canManage(s, lead.businessId)) throw new HttpError(403, 'Only a manager of this business can assign its leads.')
  const { assigneeId } = parse(z.object({ assigneeId: z.string().max(60).nullable() }), req.body)
  if (assigneeId === lead.assigneeId) { res.json({ lead }); return }
  if (assigneeId) {
    const member = await prisma.leadBusinessMember.findUnique({ where: { businessId_userId: { businessId: lead.businessId, userId: assigneeId } }, select: { user: { select: { isActive: true } } } })
    if (!member || !member.user.isActive) throw new HttpError(422, 'That person does not work leads for this business. Add them under Lead settings first.')
  }
  const now = new Date()
  const saved = await prisma.lead.update({
    where: { id: lead.id },
    // A new owner gets a fresh clock to get in touch.
    data: { assigneeId, assignedAt: assigneeId ? now : null, assignedById: assigneeId ? m.id : null, slaContactAlertAt: null, lastActivityAt: now },
  })
  await prisma.leadEvent.create({ data: { leadId: lead.id, userId: m.id, kind: 'ASSIGNED', text: assigneeId ? '' : 'Taken back (no one)', data: assigneeId ? { to: assigneeId } : undefined } })
  if (assigneeId && assigneeId !== m.id) {
    const b = await prisma.leadBusiness.findUniqueOrThrow({ where: { id: lead.businessId }, select: { name: true, slaContactMins: true } })
    await tellAboutLead([assigneeId], { type: 'LEAD_ASSIGNED', title: `New lead for you: ${lead.name || lead.organization || lead.email || lead.phone || 'a lead'}`, body: `${b.name} · ${sourceText(lead.source)}${b.slaContactMins ? ` · get in touch within ${b.slaContactMins >= 60 ? `${Math.round(b.slaContactMins / 60)} h` : `${b.slaContactMins} min`}` : ''}`, leadId: lead.id, actorId: m.id })
  }
  res.json({ lead: saved })
}

/** POST /api/leads/:id/events { kind: NOTE | CALL | EMAIL, text } — a note, or a call or email that happened. */
export async function addLeadEvent(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await leadFor(m, s, String(req.params.id))
  const b = parse(z.object({ kind: z.enum(['NOTE', 'CALL', 'EMAIL']), text: z.string().trim().max(5000) }), req.body)
  if (b.kind === 'NOTE' && !b.text) throw new HttpError(422, 'Write the note first')
  const now = new Date()
  const ev = await prisma.leadEvent.create({ data: { leadId: lead.id, userId: m.id, kind: b.kind, text: b.text }, include: { user: PERSON } })
  const contact = b.kind !== 'NOTE'
  await prisma.lead.update({
    where: { id: lead.id },
    data: { lastActivityAt: now, ...(contact && !lead.firstContactAt ? { firstContactAt: now } : {}), ...(contact && lead.status === 'NEW' ? { status: 'CONTACTED' } : {}) },
  })
  if (contact && lead.status === 'NEW') await prisma.leadEvent.create({ data: { leadId: lead.id, userId: m.id, kind: 'STATUS', text: '', data: { from: 'NEW', to: 'CONTACTED' } } })
  res.status(201).json({ event: ev })
}

// ------------------------------------------------------------------ adding leads

const addSchema = z.object({
  businessId: z.string().min(1).max(60),
  name: z.string().max(200).optional(),
  email: z.string().max(254).optional(),
  phone: z.string().max(50).optional(),
  organization: z.string().max(200).optional(),
  location: z.string().max(120).optional(),
  message: z.string().max(8000).optional(),
  /** Who gets it: "me", a person of the business (managers only), or nobody (the managers assign it). */
  assignTo: z.string().max(60).nullable().optional(),
})

/** POST /api/leads — a lead from a phone call (or met in person), added by hand. */
export async function addLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(addSchema, req.body)
  if (!isMemberOf(s, b.businessId)) throw new HttpError(403, 'You do not work leads for that business.')
  const business = await prisma.leadBusiness.findFirst({ where: { id: b.businessId, isActive: true }, select: { id: true, name: true } })
  if (!business) throw new HttpError(404, 'Business not found')
  const input = cleanInput({ ...b })
  if (b.email?.trim() && !input.email) throw new HttpError(422, 'That email address does not look right')
  if (!input.name && !input.email && !input.phone) throw new HttpError(422, 'Give at least a name, a phone number or an email')
  let assigneeId: string | null = null
  if (b.assignTo === 'me' || (b.assignTo === undefined && !canManage(s, b.businessId))) assigneeId = m.id
  else if (b.assignTo) {
    if (!canManage(s, b.businessId)) throw new HttpError(403, 'Only a manager can give a lead to someone else.')
    const member = await prisma.leadBusinessMember.findUnique({ where: { businessId_userId: { businessId: b.businessId, userId: b.assignTo } } })
    if (!member) throw new HttpError(422, 'That person does not work leads for this business.')
    assigneeId = b.assignTo
  }
  // The Super Admin adding a lead for themselves only works if they are in the business.
  if (assigneeId === m.id && !s.roles.has(b.businessId) && s.admin) assigneeId = null
  const r = await receiveLead(business, input, { source: 'PHONE', createdById: m.id, assigneeId })
  res.status(201).json({ lead: r.lead })
}

const importSchema = z.object({
  businessId: z.string().min(1).max(60),
  fileName: z.string().max(300).optional(),
  headers: z.array(z.string().max(200)).min(1).max(200),
  mapping: z.record(z.string(), z.string().max(200).nullable()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(20000),
  assigneeId: z.string().max(60).nullable().optional(),
})
export const IMPORT_FIELDS = ['name', 'firstName', 'lastName', 'email', 'phone', 'organization', 'location', 'message', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm'] as const

/** POST /api/leads/import — a sheet of leads (managers). The browser reads the file; columns come mapped. */
export async function importLeads(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(importSchema, req.body)
  if (!canManage(s, b.businessId)) throw new HttpError(403, 'Only a manager of this business can import leads.')
  const business = await prisma.leadBusiness.findFirst({ where: { id: b.businessId, isActive: true }, select: { id: true, name: true } })
  if (!business) throw new HttpError(404, 'Business not found')
  if (b.assigneeId) {
    const member = await prisma.leadBusinessMember.findUnique({ where: { businessId_userId: { businessId: b.businessId, userId: b.assigneeId } } })
    if (!member) throw new HttpError(422, 'That person does not work leads for this business.')
  }
  const col = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, b.mapping[f] ? b.headers.indexOf(b.mapping[f]!) : -1])) as Record<(typeof IMPORT_FIELDS)[number], number>
  if (col.email < 0 && col.phone < 0) throw new HttpError(422, 'Pick the email or the phone column')
  const cell = (row: (string | number | null)[], i: number) => (i < 0 ? '' : String(row[i] ?? '').trim())
  let added = 0, skipped = 0, already = 0
  for (const row of b.rows) {
    const input: LeadInput = {
      name: cell(row, col.name) || [cell(row, col.firstName), cell(row, col.lastName)].filter(Boolean).join(' '),
      email: cell(row, col.email), phone: cell(row, col.phone), organization: cell(row, col.organization), location: cell(row, col.location), message: cell(row, col.message),
      utmSource: cell(row, col.utmSource), utmMedium: cell(row, col.utmMedium), utmCampaign: cell(row, col.utmCampaign), utmTerm: cell(row, col.utmTerm),
      sourceDetail: b.fileName ?? null,
      raw: Object.fromEntries(b.headers.map((h, i) => [h, row[i] ?? null])),
    }
    if (!hasSubstance(cleanInput(input))) { skipped++; continue }
    // An open lead with the same email or phone is not imported again.
    const c = cleanInput(input)
    const or: Prisma.LeadWhereInput[] = []
    if (c.email) or.push({ email: c.email })
    if (c.phone) or.push({ phone: c.phone })
    if (or.length && await prisma.lead.findFirst({ where: { businessId: business.id, status: { in: OPEN_STATUSES }, OR: or }, select: { id: true } })) { already++; continue }
    await receiveLead(business, input, { source: 'IMPORT', createdById: m.id, assigneeId: b.assigneeId ?? null, notify: false })
    added++
  }
  if (added) {
    const to = b.assigneeId ? [b.assigneeId] : await leadManagers(business.id)
    const first = await prisma.lead.findFirst({ where: { businessId: business.id, source: 'IMPORT', createdById: m.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (first) await tellAboutLead(to, { type: b.assigneeId ? 'LEAD_ASSIGNED' : 'LEAD_NEW', title: `${added} lead${added === 1 ? '' : 's'} imported for ${business.name}`, body: b.fileName ? `From ${b.fileName}` : 'From a sheet', leadId: first.id, actorId: m.id })
  }
  res.json({ added, skipped, already })
}

// ------------------------------------------------------------------ businesses (Super Admin)

const bizSchema = z.object({
  name: z.string().trim().min(1).max(120),
  website: z.string().trim().max(300).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  slaAssignMins: z.number().int().min(0).max(10080).optional(),
  slaContactMins: z.number().int().min(0).max(10080).optional(),
})

function bizOut(b: Prisma.LeadBusinessGetPayload<{ include: { members: { include: { user: { select: { id: true; name: true; email: true; isActive: true } } } } } }> & { _open?: number }) {
  const { inboxPassEnc, members, ...rest } = b
  return { ...rest, inboxHasPassword: !!inboxPassEnc, formUrl: formUrl(b.formKey), members: members.map((x) => ({ id: x.user.id, name: x.user.name, email: x.user.email, isActive: x.user.isActive, role: x.role })) }
}
const BIZ_INCLUDE = { members: { include: { user: { select: { id: true, name: true, email: true, isActive: true } } }, orderBy: { createdAt: 'asc' as const } } }

/** GET /api/leads/businesses — every business with its people, form link and inbox (Super Admin). */
export async function listBusinesses(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const list = await prisma.leadBusiness.findMany({ include: BIZ_INCLUDE, orderBy: { name: 'asc' } })
  const open = await prisma.lead.groupBy({ by: ['businessId'], where: { status: { in: OPEN_STATUSES } }, _count: { _all: true } })
  const people = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, department: { select: { name: true } } }, orderBy: { name: 'asc' } })
  res.json({
    businesses: list.map((b) => ({ ...bizOut(b), openLeads: open.find((o) => o.businessId === b.id)?._count._all ?? 0 })),
    people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, department: p.department?.name ?? null })),
  })
}

export async function createBusiness(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const b = parse(bizSchema, req.body)
  const made = await prisma.leadBusiness.create({ data: { ...b, website: b.website || null, formKey: newFormKey() }, include: BIZ_INCLUDE })
  res.status(201).json({ business: bizOut(made) })
}

async function bizById(id: string) {
  const b = await prisma.leadBusiness.findUnique({ where: { id }, include: BIZ_INCLUDE })
  if (!b) throw new HttpError(404, 'Business not found')
  return b
}

export async function updateBusiness(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const b = parse(bizSchema.partial(), req.body)
  const saved = await prisma.leadBusiness.update({ where: { id: cur.id }, data: { ...b, ...(b.website !== undefined ? { website: b.website || null } : {}) }, include: BIZ_INCLUDE })
  res.json({ business: bizOut(saved) })
}

/** DELETE /api/leads/businesses/:id — only a business with no leads; otherwise switch it off. */
export async function deleteBusiness(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  if (await prisma.lead.count({ where: { businessId: cur.id } })) throw new HttpError(409, 'This business has leads. Switch it off instead, so its leads stay.')
  await prisma.leadBusiness.delete({ where: { id: cur.id } })
  res.json({ ok: true })
}

/** POST /api/leads/businesses/:id/members { userId, role } — add a person or change their role. */
export async function setMember(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const b = parse(z.object({ userId: z.string().min(1).max(60), role: z.enum(['MANAGER', 'REP']) }), req.body)
  const u = await prisma.user.findFirst({ where: { id: b.userId, isActive: true }, select: { id: true } })
  if (!u) throw new HttpError(404, 'Person not found')
  await prisma.leadBusinessMember.upsert({ where: { businessId_userId: { businessId: cur.id, userId: u.id } }, create: { businessId: cur.id, userId: u.id, role: b.role }, update: { role: b.role } })
  res.json({ business: bizOut(await bizById(cur.id)) })
}

/** DELETE /api/leads/businesses/:id/members/:userId — their open leads go back to the managers to give out again. */
export async function removeMember(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const userId = String(req.params.userId)
  await prisma.leadBusinessMember.deleteMany({ where: { businessId: cur.id, userId } })
  const back = await prisma.lead.findMany({ where: { businessId: cur.id, assigneeId: userId, status: { in: OPEN_STATUSES } }, select: { id: true } })
  if (back.length) {
    await prisma.lead.updateMany({ where: { id: { in: back.map((x) => x.id) } }, data: { assigneeId: null, assignedAt: null, assignedById: null, slaAssignAlertAt: null, slaContactAlertAt: null } })
    await prisma.leadEvent.createMany({ data: back.map((x) => ({ leadId: x.id, userId: m.id, kind: 'ASSIGNED', text: 'Taken back (the rep left this business)' })) })
  }
  res.json({ business: bizOut(await bizById(cur.id)), returned: back.length })
}

/** POST /api/leads/businesses/:id/form-key — a new form link (the old one stops working). */
export async function newBusinessFormKey(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const saved = await prisma.leadBusiness.update({ where: { id: cur.id }, data: { formKey: newFormKey() }, include: BIZ_INCLUDE })
  res.json({ business: bizOut(saved) })
}

const inboxSchema = z.object({
  inboxOn: z.boolean(),
  inboxHost: z.string().trim().max(200).nullable(),
  inboxPort: z.number().int().min(1).max(65535),
  inboxSecure: z.boolean(),
  inboxUser: z.string().trim().max(200).nullable(),
  /** Empty or missing: keep the saved password. */
  password: z.string().max(500).optional(),
  inboxFolder: z.string().trim().min(1).max(200),
})

/** PUT /api/leads/businesses/:id/inbox — the email inbox whose new emails become leads. */
export async function saveInbox(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const b = parse(inboxSchema, req.body)
  const pass = b.password ? await encryptSecret(b.password) : cur.inboxPassEnc
  if (b.inboxOn && (!b.inboxHost || !b.inboxUser || !pass)) throw new HttpError(422, 'Fill in the mail server, the user name and the password first')
  const changedBox = b.inboxHost !== cur.inboxHost || b.inboxUser !== cur.inboxUser || b.inboxFolder !== cur.inboxFolder
  const saved = await prisma.leadBusiness.update({
    where: { id: cur.id },
    data: {
      inboxOn: b.inboxOn, inboxHost: b.inboxHost || null, inboxPort: b.inboxPort, inboxSecure: b.inboxSecure, inboxUser: b.inboxUser || null, inboxFolder: b.inboxFolder, inboxPassEnc: pass,
      // A different mailbox (or turning it on) starts from the emails that arrive from now on.
      ...(changedBox || (b.inboxOn && !cur.inboxOn) ? { inboxLastUid: 0, inboxError: null } : {}),
    },
    include: BIZ_INCLUDE,
  })
  res.json({ business: bizOut(saved) })
}

/** POST /api/leads/businesses/:id/inbox/test — try the saved (or typed) settings. */
export async function testBusinessInbox(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const b = parse(inboxSchema.partial(), req.body ?? {})
  const pass = b.password || (cur.inboxPassEnc ? await decryptSecret(cur.inboxPassEnc) : '')
  if (!pass) throw new HttpError(422, 'Type the password first')
  try {
    const r = await testInbox({ inboxHost: b.inboxHost ?? cur.inboxHost, inboxPort: b.inboxPort ?? cur.inboxPort, inboxSecure: b.inboxSecure ?? cur.inboxSecure, inboxUser: b.inboxUser ?? cur.inboxUser, inboxFolder: b.inboxFolder ?? cur.inboxFolder }, pass)
    res.json({ ok: true, messages: r.messages })
  } catch (e) {
    res.json({ ok: false, error: ((e as { responseText?: string }).responseText || (e as Error).message || 'Could not connect').slice(0, 300) })
  }
}

/** POST /api/leads/businesses/:id/test-lead — a sample lead through the real form path, to see it arrive. */
export async function testBusinessLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const cur = await bizById(String(req.params.id))
  const r = await receiveLead(cur, fromFields({ name: 'Test Lead', email: `test+${Date.now()}@example.com`, phone: '+1 555 0100', message: 'A test lead sent from Lead settings. Mark it as Spam when you are done.', page: 'Lead settings (test)' }), { source: 'FORM', createdById: m.id })
  res.status(201).json({ lead: r.lead })
}

// ------------------------------------------------------------------ the public website form

const thanksPage = (business: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}main{text-align:center;padding:24px}h1{font-size:24px;margin:0 0 8px}p{color:#64748b;margin:0}</style></head><body><main><h1>Thank you</h1><p>${business.replace(/[<>&"]/g, '')} has your message and will be in touch soon.</p></main></body></html>`

/** Send the visitor back to the site only (never to another site: no open redirect). */
function safeRedirect(target: unknown, website: string | null, origin: string | undefined): string | null {
  if (typeof target !== 'string' || !target) return null
  try {
    const u = new URL(target)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const allowed = new Set<string>()
    if (website) { try { allowed.add(new URL(/^https?:/.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, '')) } catch { /* not a url */ } }
    if (origin) { try { allowed.add(new URL(origin).hostname.replace(/^www\./, '')) } catch { /* none */ } }
    return allowed.has(u.hostname.replace(/^www\./, '')) ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * POST /api/lead-in/:key — a website form sends a lead (no sign-in; the key picks the business).
 * Takes JSON or an ordinary HTML form post, with any field names. A hidden "_hp" field must stay
 * empty (bots fill it). "_redirect" sends the visitor back to a thank-you page on the site.
 */
export async function leadIn(req: Request, res: Response): Promise<void> {
  const key = String(req.params.key ?? '')
  if (!/^lf_[A-Za-z0-9_-]{10,60}$/.test(key)) { res.status(404).json({ ok: false, error: 'Unknown form' }); return }
  const business = await prisma.leadBusiness.findUnique({ where: { formKey: key }, select: { id: true, name: true, companyId: true, website: true, isActive: true } })
  if (!business || !business.isActive || !(await isOn('lead-management', business.companyId))) { res.status(404).json({ ok: false, error: 'Unknown form' }); return }
  let fields: Record<string, unknown> = {}
  if (typeof req.body === 'string') { try { fields = JSON.parse(req.body) } catch { fields = Object.fromEntries(new URLSearchParams(req.body)) } }
  else if (req.body && typeof req.body === 'object') fields = req.body as Record<string, unknown>
  const wantsHtml = !req.is('application/json') && String(req.headers.accept ?? '').includes('text/html')
  const redirect = safeRedirect(fields._redirect, business.website, req.headers.origin)
  const done = () => {
    if (redirect) { res.redirect(303, redirect); return }
    if (wantsHtml) { res.type('html').send(thanksPage(business.name)); return }
    res.json({ ok: true })
  }
  // A bot filled the hidden field: say thanks and keep nothing.
  if (str(fields._hp) || str(fields._gotcha)) { done(); return }
  const input = fromFields(fields)
  if (!input.sourceDetail && typeof req.headers.referer === 'string') input.sourceDetail = req.headers.referer.slice(0, 500)
  if (!hasSubstance(cleanInput(input))) { res.status(422).json({ ok: false, error: 'Please give an email address or a phone number.' }); return }
  await runAsCompany(business.companyId, () => receiveLead(business, input, { source: 'FORM', mergeRepeats: true }))
  done()
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
