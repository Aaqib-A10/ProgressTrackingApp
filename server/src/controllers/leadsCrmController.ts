import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse } from '../lib/pm/http'
import { sendCsv } from '../lib/csv'
import { canManage, isMemberOf, leadWhere, type LeadScope, type LeadViewer } from '../lib/leads/access'
import { listMatches } from '../lib/leads/lists'
import { kindOf, normalizePhone, pipelineOf, settingsOf, statusLabel } from '../lib/leads/pipeline'
import { attachUnmatched } from '../lib/talkloop/unmatched'
import { isOn } from '../lib/flags'
import { ctx, event, fullLead, LEAD_INCLUDE, leadOut, listWhere, PERSON, statusSets, type ListQuery } from './leadsWorkController'

/**
 * The CRM views on top of Lead Management (/api/leads): the deal board (the pipeline as columns,
 * with what each stage is worth) and contacts (several people per company). Nothing here changes
 * how leads work; the first contact stays on the lead, so every older screen reads the same data.
 */

/** Closed stages show what closed lately, not the whole history. */
const CLOSED_DAYS = 60
const CARDS_PER_STAGE = 60

/** Lead Management on, and the deal board and contacts on for this company (switch "deal-board"). */
async function crmCtx(req: AuthedRequest) {
  const c = await ctx(req)
  if (!(await isOn('deal-board', c.me.companyId))) throw new HttpError(403, 'The deal board and contacts are not switched on for your company.')
  return c
}

/** GET /api/leads/board?business=&assignee=&q= — one column per stage: how many, what they are worth, the newest cards. */
export async function dealBoard(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const q = parse(z.object({ business: z.string().min(1).max(60), assignee: z.string().max(60).optional(), q: z.string().max(200).optional() }), req.query)
  if (!isMemberOf(s, q.business)) throw new HttpError(403, 'You do not work leads for that business.')
  const biz = await prisma.leadBusiness.findUnique({ where: { id: q.business }, select: { id: true, name: true, kind: true, pipeline: true, settings: true } })
  if (!biz) throw new HttpError(404, 'Business not found')
  const st = await statusSets(biz.id)
  const base = listWhere(m, s, { business: biz.id, status: 'all', assignee: q.assignee, q: q.q } as ListQuery, st)
  const since = DateTime.now().minus({ days: CLOSED_DAYS }).toJSDate()
  // Spam is not a stage of a deal.
  const stages = pipelineOf(biz).filter((x) => x.key !== 'SPAM')
  const columns = await Promise.all(stages.map(async (stage) => {
    const where: Prisma.LeadWhereInput = { AND: [base, { status: stage.key }, stage.open ? {} : { lastActivityAt: { gte: since } }] }
    const [agg, rows] = await Promise.all([
      prisma.lead.aggregate({ where, _count: { _all: true }, _sum: { value: true } }),
      prisma.lead.findMany({ where, include: LEAD_INCLUDE, orderBy: [{ lastActivityAt: 'desc' }], take: CARDS_PER_STAGE }),
    ])
    return { ...stage, count: agg._count._all, value: agg._sum.value ?? 0, rows }
  }))
  const ids = columns.flatMap((c) => c.rows.map((r) => r.id))
  const openTasks = ids.length ? await prisma.leadTask.groupBy({ by: ['leadId'], where: { leadId: { in: ids }, doneAt: null }, _count: { _all: true } }) : []
  const tasksOf = new Map(openTasks.map((t) => [t.leadId, t._count._all]))
  const open = columns.filter((c) => c.open), won = columns.filter((c) => !c.open && /WON/.test(c.key))
  res.json({
    business: { id: biz.id, name: biz.name, kind: kindOf(biz) },
    currency: settingsOf(biz).currency,
    closedDays: CLOSED_DAYS,
    canManage: canManage(s, biz.id),
    columns: columns.map(({ rows, ...c }) => ({ ...c, leads: rows.map((l) => ({ ...leadOut(l, tasksOf.get(l.id) ?? 0), message: null })) })),
    totals: {
      open: { count: open.reduce((a, c) => a + c.count, 0), value: open.reduce((a, c) => a + c.value, 0) },
      won: { count: won.reduce((a, c) => a + c.count, 0), value: won.reduce((a, c) => a + c.value, 0) },
    },
  })
}

// ------------------------------------------------------------------ contacts

const contactFields = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  mobile: z.string().trim().max(50).nullable().optional(),
  decisionMaker: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})
const emailOk = (e: string) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(e)

function cleanContact(b: Partial<z.infer<typeof contactFields>>) {
  const out: Prisma.LeadContactUncheckedUpdateInput = {}
  if (b.name !== undefined) out.name = b.name
  if (b.role !== undefined) out.role = b.role || null
  if (b.email !== undefined) {
    if (b.email && !emailOk(b.email)) throw new HttpError(422, 'That email address does not look right')
    out.email = b.email ? b.email.toLowerCase() : null
  }
  if (b.phone !== undefined) { const p = normalizePhone(b.phone); out.phone = p.phone; out.phoneE164 = p.e164 }
  if (b.mobile !== undefined) out.mobile = b.mobile || null
  if (b.decisionMaker !== undefined) out.decisionMaker = b.decisionMaker
  if (b.notes !== undefined) out.notes = b.notes || null
  return out
}

/** Who may change a lead's people: its managers and the person it is assigned to (the same rule as editing the lead). */
function requireEdit(m: LeadViewer, s: LeadScope, lead: { businessId: string; assigneeId: string | null }): void {
  if (!canManage(s, lead.businessId) && lead.assigneeId !== m.id) throw new HttpError(403, 'Only the person this lead is assigned to, or a manager, changes its contacts.')
}

async function contactFor(m: LeadViewer, s: LeadScope, id: string) {
  const c = await prisma.leadContact.findFirst({ where: { id, lead: leadWhere(m, s) } })
  if (!c) throw new HttpError(404, 'Contact not found')
  return c
}

/** POST /api/leads/:id/contacts — another person at this company. Earlier kept calls to their number move under the lead. */
export async function addContact(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  requireEdit(m, s, lead)
  const b = parse(contactFields, req.body)
  const data = cleanContact(b)
  const contact = await prisma.leadContact.create({ data: { ...(data as Prisma.LeadContactUncheckedCreateInput), leadId: lead.id, businessId: lead.businessId, createdById: m.id } })
  await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date() } })
  await event(lead.id, m.id, 'EDIT', `Added contact ${contact.name}${contact.role ? ` (${contact.role})` : ''}`, { contactId: contact.id })
  let moved = 0
  if (contact.phoneE164) moved = await attachUnmatched(m.companyId, contact.phoneE164, lead.id, m.id).catch(() => 0)
  res.status(201).json({ contact, moved })
}

/** PATCH /api/leads/contacts/:contactId */
export async function updateContact(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const c = await contactFor(m, s, String(req.params.contactId))
  const lead = await fullLead(m, s, c.leadId)
  requireEdit(m, s, lead)
  const data = cleanContact(parse(contactFields.partial(), req.body))
  const contact = await prisma.leadContact.update({ where: { id: c.id }, data })
  if (contact.phoneE164 && contact.phoneE164 !== c.phoneE164) await attachUnmatched(m.companyId, contact.phoneE164, lead.id, m.id).catch(() => 0)
  res.json({ contact })
}

/** DELETE /api/leads/contacts/:contactId */
export async function removeContact(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const c = await contactFor(m, s, String(req.params.contactId))
  const lead = await fullLead(m, s, c.leadId)
  requireEdit(m, s, lead)
  await prisma.leadContact.delete({ where: { id: c.id } })
  await event(lead.id, m.id, 'EDIT', `Removed contact ${c.name}`)
  res.json({ ok: true })
}

/**
 * POST /api/leads/contacts/:contactId/primary — this person becomes the lead's main contact (the
 * name, phone and email the list, the dialer and the emails use); the one who was moves down here.
 */
export async function makePrimaryContact(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const c = await contactFor(m, s, String(req.params.contactId))
  const lead = await fullLead(m, s, c.leadId)
  requireEdit(m, s, lead)
  const cmr = kindOf(lead.business) === 'CMR'
  const was = { name: lead.name, role: (cmr ? lead.cmr?.contactRole : lead.jobTitle) ?? null, email: lead.email, phone: lead.phone, phoneE164: lead.phoneE164, mobile: lead.mobile, decisionMaker: cmr ? lead.cmr?.decisionMaker === 'YES' : false }
  const hadPrimary = !!(was.name || was.email || was.phone)
  const lists = await listMatches(lead.businessId, { orgKey: lead.orgKey, phoneE164: c.phoneE164, email: c.email, websiteKey: lead.websiteKey })
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: {
      name: c.name, email: c.email, phone: c.phone, phoneE164: c.phoneE164, mobile: c.mobile, lastActivityAt: new Date(), prohibited: lists.prohibited, existingCustomer: lists.existingCustomer,
      ...(cmr ? { cmr: { upsert: { create: { contactRole: c.role, decisionMaker: c.decisionMaker ? 'YES' : 'UNKNOWN' }, update: { contactRole: c.role, ...(c.decisionMaker ? { decisionMaker: 'YES' } : {}) } } } } : { jobTitle: c.role }),
    } }),
    hadPrimary
      ? prisma.leadContact.update({ where: { id: c.id }, data: { name: was.name || was.email || was.phone || 'Contact', role: was.role, email: was.email, phone: was.phone, phoneE164: was.phoneE164, mobile: was.mobile, decisionMaker: was.decisionMaker } })
      : prisma.leadContact.delete({ where: { id: c.id } }),
  ])
  await event(lead.id, m.id, 'EDIT', `Main contact is now ${c.name}${hadPrimary && was.name ? ` (was ${was.name})` : ''}`)
  res.json({ ok: true })
}

interface ContactRow {
  id: string; contactId: string | null; leadId: string; primary: boolean
  name: string; role: string | null; email: string | null; phone: string | null; mobile: string | null; decisionMaker: boolean
  company: string | null; industry: string | null; state: string | null; status: string; statusLabel: string; statusColor: string; open: boolean
  business: { id: string; name: string }; assignee: { id: string; name: string } | null; lastCallAt: Date | null
}

const CONTACT_CAP = 3000
const contactQuery = z.object({ business: z.string().max(60).optional(), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(10000).optional(), pageSize: z.coerce.number().int().min(10).max(200).optional() })

/** Everyone I can see: each lead's main contact plus the other people added to it, by name. */
async function contactRows(m: LeadViewer, s: LeadScope, q: z.infer<typeof contactQuery>, extra: Prisma.LeadWhereInput = {}): Promise<{ rows: ContactRow[]; total: number; capped: boolean }> {
  const mine: Prisma.LeadWhereInput = { AND: [leadWhere(m, s), q.business ? { businessId: q.business } : {}, { status: { not: 'SPAM' } }, extra] }
  const t = q.q?.trim()
  const e164 = t ? normalizePhone(t).e164 : null
  const like = (f: string) => ({ [f]: { contains: t, mode: 'insensitive' as const } })
  const leadWhereQ: Prisma.LeadWhereInput = { AND: [mine, { OR: [{ name: { not: '' } }, { email: { not: null } }, { phone: { not: null } }] }, t ? { OR: [like('name'), like('email'), { phone: { contains: t } }, like('organization'), like('jobTitle'), ...(e164 ? [{ phoneE164: e164 }] : [])] } : {}] }
  const contactWhereQ: Prisma.LeadContactWhereInput = { AND: [{ lead: mine }, t ? { OR: [like('name'), like('email'), like('role'), { phone: { contains: t } }, { lead: like('organization') }, ...(e164 ? [{ phoneE164: e164 }] : [])] } : {}] }
  const leadSel = { id: true, organization: true, industry: true, state: true, status: true, lastCallAt: true, business: { select: { id: true, name: true, kind: true, pipeline: true } }, assignee: { select: { id: true, name: true } } } as const
  const [leads, contacts, nLeads, nContacts] = await Promise.all([
    prisma.lead.findMany({ where: leadWhereQ, select: { ...leadSel, name: true, email: true, phone: true, mobile: true, jobTitle: true, cmr: { select: { contactRole: true, decisionMaker: true } } }, orderBy: [{ name: 'asc' }, { organization: 'asc' }], take: CONTACT_CAP }),
    prisma.leadContact.findMany({ where: contactWhereQ, include: { lead: { select: leadSel } }, orderBy: { name: 'asc' }, take: CONTACT_CAP }),
    prisma.lead.count({ where: leadWhereQ }),
    prisma.leadContact.count({ where: contactWhereQ }),
  ])
  const of = (l: { id: string; organization: string | null; industry: string | null; state: string | null; status: string; lastCallAt: Date | null; business: { id: string; name: string; kind: string; pipeline: Prisma.JsonValue }; assignee: { id: string; name: string } | null }) => {
    const pipe = pipelineOf(l.business)
    return { leadId: l.id, company: l.organization, industry: l.industry, state: l.state, status: l.status, statusLabel: statusLabel(l.business, l.status), statusColor: pipe.find((x) => x.key === l.status)?.color ?? '#64748B', open: pipe.find((x) => x.key === l.status)?.open ?? true, business: { id: l.business.id, name: l.business.name }, assignee: l.assignee, lastCallAt: l.lastCallAt }
  }
  const rows: ContactRow[] = [
    ...leads.map((l) => ({ id: `lead:${l.id}`, contactId: null, primary: true, name: l.name || l.email || l.phone || '', role: l.cmr?.contactRole ?? l.jobTitle ?? null, email: l.email, phone: l.phone, mobile: l.mobile, decisionMaker: l.cmr?.decisionMaker === 'YES', ...of(l) })),
    ...contacts.map((c) => ({ id: c.id, contactId: c.id, primary: false, name: c.name, role: c.role, email: c.email, phone: c.phone, mobile: c.mobile, decisionMaker: c.decisionMaker, ...of(c.lead) })),
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.company ?? '').localeCompare(b.company ?? ''))
  return { rows, total: nLeads + nContacts, capped: nLeads > CONTACT_CAP || nContacts > CONTACT_CAP }
}

/** GET /api/leads/contacts?business=&q=&page= — the people behind the leads I can see. */
export async function listContacts(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  const q = parse(contactQuery, req.query)
  const page = q.page ?? 1, pageSize = q.pageSize ?? 50
  const { rows, total, capped } = await contactRows(m, s, q)
  res.json({ contacts: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, capped })
}

/** GET /api/leads/contacts.csv — the same list as a spreadsheet (managers: their businesses; reps: their own leads' people). */
export async function exportContacts(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await crmCtx(req)
  if (!s.admin && !s.roles.size) throw new HttpError(403, 'You do not work leads for any business.')
  const q = parse(contactQuery, req.query)
  const { rows } = await contactRows(m, s, q, s.admin ? {} : { OR: [{ businessId: { in: s.managerOf } }, { assigneeId: m.id }] })
  sendCsv(res, 'contacts.csv', [
    ['Name', 'Role', 'Company', 'Email', 'Phone', 'Mobile', 'Decision maker', 'Main contact', 'Industry', 'State', 'Lead status', 'Business', 'Assigned to', 'Last call'],
    ...rows.map((r) => [r.name, r.role ?? '', r.company ?? '', r.email ?? '', r.phone ?? '', r.mobile ?? '', r.decisionMaker ? 'Yes' : '', r.primary ? 'Yes' : '', r.industry ?? '', r.state ?? '', r.statusLabel, r.business.name, r.assignee?.name ?? '', r.lastCallAt?.toISOString() ?? '']),
  ])
}
