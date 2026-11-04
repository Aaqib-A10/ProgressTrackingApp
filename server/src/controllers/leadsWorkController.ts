import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse } from '../lib/pm/http'
import { isOn } from '../lib/flags'
import { sendCsv } from '../lib/csv'
import { sendMail } from '../lib/mail'
import { notifyMentions } from '../lib/notify'
import { companyTz } from '../lib/time'
import { canDecide, canManage, isMemberOf, leadFor, leadScope, leadWhere, requireManager, type LeadScope, type LeadViewer } from '../lib/leads/access'
import { OPEN_STATUSES, receiveLead, sourceText, type LeadInput as IntakeInput } from '../lib/leads/intake'
import { keysOf, listMatches, reflagLeads } from '../lib/leads/lists'
import {
  ALL_STATUSES, CLOSE_REASONS, DISPOSITIONS, FREIGHT, MATERIAL_FORMS, MATERIALS, MEETING_OUTCOMES, OWNERS, PAYS_UNITS, PHOENIX, PROMISE_WORDS, YES_NO,
  addBusinessDays, businessDaysBetween, composeSummary, emailKey, fiveFacts, kindOf, leadWarnings, normalizePhone, openStatusesOf, orgKey, pipelineOf, settingsOf, statusFromText, statusLabel, threeTimes, websiteKey, yesNoFromText, zoneOfState, type CmrSettings,
} from '../lib/leads/pipeline'
import { atPhoenix, closeTasks, makeTask } from '../lib/leads/tasks'
import { leadManagers, tellAboutLead } from '../lib/leads/notify'
import { sendMeetingInvite } from '../lib/leads/meeting'

/**
 * Lead Management, the working part (/api/leads): the leads list like LeadWise (filters, columns,
 * export), one lead with its details, calls, comments, agent tasks, the dashboard, and the CMR
 * flow for CMR-kind businesses (five facts, qualify → Jesse → meeting, Jesse Queue, Jesse Summary,
 * the daily report, lists and the sheet import). Businesses themselves: leadsController.ts.
 */

const PERSON = { select: { id: true, name: true, email: true } } as const
const BIZ = { select: { id: true, name: true, color: true, kind: true, pipeline: true, settings: true, headId: true, slaAssignMins: true, slaContactMins: true } } as const
type Biz = Prisma.LeadBusinessGetPayload<typeof BIZ>
const CMR_DEFAULT = { contactRole: null, decisionMaker: 'UNKNOWN', decisionMakerName: null, dmAgreed: 'UNKNOWN', handlesAlkaline: 'UNKNOWN', material: [] as string[], materialForm: [] as string[], lbsPerMonth: null, lbsPerShipment: null, currentVendor: null, paysToday: null, paysUnit: 'UNKNOWN', vendorRelatedParty: false, usesBatteryNetwork: false, sortsAlkaline: 'UNKNOWN', shipsLtl: 'UNKNOWN', nextShipmentDate: null, pickupCity: null, freight: 'UNKNOWN', jesseInputNeeded: false, jesseAsk: null, jesseComment: null, flaggedAt: null, qualifyRequestedAt: null, qualifiedAt: null, qualifiedById: null, jesseDecision: null, jesseDecidedAt: null, meetingSlots: null, meetingAt: null, meetingTz: null, meetingLink: null, inviteSentAt: null, reconfirmedAt: null, meetingBrief: null, meetingOutcome: null, meetingOutcomeAt: null, infoSentAt: null }

function me(req: AuthedRequest): LeadViewer & { name: string } {
  if (!req.user) throw new HttpError(401, 'Not authenticated')
  return { id: req.user.id, role: req.user.role, companyId: req.user.companyId, name: '' }
}
async function ctx(req: AuthedRequest): Promise<{ me: LeadViewer & { name: string }; s: LeadScope }> {
  const m = me(req)
  if (!(await isOn('lead-management', m.companyId))) throw new HttpError(403, 'Lead Management is not switched on for your company.')
  const [s, u] = await Promise.all([leadScope(m), prisma.user.findUnique({ where: { id: m.id }, select: { name: true } })])
  m.name = u?.name ?? ''
  return { me: m, s }
}
const isCmr = (b: Pick<Biz, 'kind'>) => kindOf(b) === 'CMR'
async function cmrOn(b: Biz, companyId: string): Promise<void> {
  if (!isCmr(b)) throw new HttpError(422, 'This is part of the CMR flow; this business is not a CMR business.')
  if (!(await isOn('cmr', companyId))) throw new HttpError(403, 'The CMR flow is not switched on for your company.')
}

const event = (leadId: string, userId: string | null, kind: string, text = '', data?: Prisma.InputJsonValue) => prisma.leadEvent.create({ data: { leadId, userId, kind, text, data } })
const isoDate = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: PHOENIX }).toISODate() : null)
const startOfTodayPhx = () => DateTime.now().setZone(PHOENIX).startOf('day').toJSDate()
const dateOrNull = (s: string | null | undefined): Date | null | undefined => (s === undefined ? undefined : s ? DateTime.fromISO(s, { zone: PHOENIX }).startOf('day').toJSDate() : null)
const emailOk = (e: string) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(e)

/** Is this lead late? (not given out in time, or given out and nobody got in touch in time) */
function lateness(l: { status: string; assigneeId: string | null; createdAt: Date; assignedAt: Date | null; firstContactAt: Date | null }, b: { slaAssignMins: number; slaContactMins: number }, now = Date.now()): 'assign' | 'contact' | null {
  if (l.status !== 'NEW') return null
  if (!l.assigneeId) return b.slaAssignMins > 0 && now - l.createdAt.getTime() > b.slaAssignMins * 60_000 ? 'assign' : null
  if (!l.firstContactAt && l.assignedAt && b.slaContactMins > 0 && now - l.assignedAt.getTime() > b.slaContactMins * 60_000) return 'contact'
  return null
}

const LEAD_INCLUDE = { business: BIZ, assignee: PERSON, cmr: true } as const
type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>

/** A lead as the app sees it: the CMR part folded in, the facts, the warnings, late and overdue. */
function leadOut(l: LeadRow, openTasks = 0) {
  const b = l.business
  const cmr = l.cmr ?? CMR_DEFAULT
  const set = settingsOf(b)
  const open = openStatusesOf(b).includes(l.status)
  const facts = isCmr(b) ? fiveFacts(cmr) : []
  const { business: _b, cmr: _c, raw: _r, ...rest } = l
  // The CMR part folds in without its own row keys (its id would hide the lead's).
  const { id: _i, leadId: _li, companyId: _ci, createdAt: _ca, updatedAt: _ua, ...cmrFields } = cmr as typeof cmr & { id?: string; leadId?: string; companyId?: string; createdAt?: Date; updatedAt?: Date }
  return {
    ...rest,
    ...(isCmr(b) ? cmrFields : {}),
    business: { id: b.id, name: b.name, color: b.color, kind: kindOf(b) },
    statusLabel: statusLabel(b, l.status),
    open,
    late: lateness(l, b),
    overdue: !!l.nextStepDate && open && l.nextStepDate.getTime() < startOfTodayPhx().getTime(),
    facts, factsDone: facts.filter((f) => f.done).length,
    warnings: isCmr(b) ? leadWarnings({ ...cmr, prohibited: l.prohibited, existingCustomer: l.existingCustomer, state: l.state }, set) : (l.prohibited ? [{ key: 'prohibited', level: 'stop' as const, text: 'On the Prohibited list (do not call).' }] : []),
    belowMin: isCmr(b) && (cmr.lbsPerShipment ?? 0) > 0 && (cmr.lbsPerShipment ?? 0) < set.minLoadLbs,
    zone: zoneOfState(l.state),
    waitingDays: isCmr(b) && cmr.flaggedAt && cmr.jesseInputNeeded ? businessDaysBetween(cmr.flaggedAt, new Date()) : null,
    openTasks,
  }
}

async function bizFor(id: string): Promise<Biz> {
  const b = await prisma.leadBusiness.findUnique({ where: { id }, ...BIZ })
  if (!b) throw new HttpError(404, 'Business not found')
  return b
}
async function fullLead(me: LeadViewer, s: LeadScope, id: string): Promise<LeadRow> {
  const base = await leadFor(me, s, id)
  return prisma.lead.findUniqueOrThrow({ where: { id: base.id }, include: LEAD_INCLUDE })
}

// ------------------------------------------------------------------ meta

/** GET /api/leads/meta — the businesses I work in (with their pipelines and people) and what I may do. */
export async function leadsMeta(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const businesses = await prisma.leadBusiness.findMany({
    where: s.admin ? {} : { id: { in: [...s.roles.keys()] }, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true, kind: true, pipeline: true, settings: true, headId: true, isActive: true, slaAssignMins: true, slaContactMins: true, head: PERSON, members: { select: { role: true, user: PERSON }, orderBy: { user: { name: 'asc' } } } },
  })
  const cmr = await isOn('cmr', m.companyId)
  res.json({
    me: { id: m.id, name: m.name, admin: s.admin, headOf: s.headOf, managerOf: s.managerOf },
    businesses: businesses.map((b) => {
      const set = settingsOf(b)
      const { settings: _s, ...rest } = b
      return {
        ...rest, kind: isCmr(b) && cmr ? 'CMR' : 'GENERAL', pipeline: pipelineOf(b), myRole: s.admin ? 'MANAGER' : s.roles.get(b.id) ?? null, isHead: s.headOf.includes(b.id),
        members: b.members.map((x) => ({ ...x.user, role: x.role })),
        settings: { segments: set.segments, states: set.states, consentStates: set.consentStates, minLoadLbs: set.minLoadLbs, publishedRate: set.publishedRate, copyName: set.copyName, connectedSecs: set.connectedSecs },
      }
    }),
    cmrOn: cmr,
  })
}

// ------------------------------------------------------------------ list, export, check

const listQuery = z.object({
  business: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
  status: z.string().max(200).optional(),
  assignee: z.string().max(60).optional(),
  source: z.string().max(60).optional(),
  industry: z.string().max(80).optional(),
  state: z.string().max(40).optional(),
  owner: z.string().max(20).optional(),
  tag: z.string().max(40).optional(),
  flag: z.enum(['1']).optional(),
  overdue: z.enum(['1']).optional(),
  belowMin: z.enum(['1']).optional(),
  late: z.enum(['1']).optional(),
  prohibited: z.enum(['1']).optional(),
  active: z.enum(['1', '0']).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  updatedSince: z.string().max(30).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(10).max(200).optional(),
  sort: z.enum(['newest', 'oldest', 'activity', 'nextStep', 'name', 'company', 'calls']).optional(),
})
type ListQuery = z.infer<typeof listQuery>

function listWhere(m: LeadViewer, s: LeadScope, q: ListQuery): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [leadWhere(m, s)]
  if (q.business) and.push({ businessId: q.business })
  if (q.status === 'open' || q.active === '1') and.push({ status: { in: OPEN_STATUSES } })
  else if (q.active === '0') and.push({ status: { notIn: OPEN_STATUSES } })
  else if (q.status && q.status !== 'all') and.push({ status: { in: q.status.split(',').filter((x) => ALL_STATUSES.includes(x)) } })
  else if (!q.status) and.push({ status: { not: 'SPAM' } })
  if (q.assignee === 'me') and.push({ assigneeId: m.id })
  else if (q.assignee === 'none') and.push({ assigneeId: null })
  else if (q.assignee) and.push({ assigneeId: q.assignee })
  if (q.source) and.push({ source: q.source })
  if (q.industry) and.push({ industry: q.industry })
  if (q.state) and.push({ state: q.state })
  if (q.owner) and.push({ owner: q.owner })
  if (q.tag) and.push({ tags: { has: q.tag } })
  if (q.flag) and.push({ cmr: { is: { jesseInputNeeded: true } } })
  if (q.overdue) and.push({ nextStepDate: { lt: startOfTodayPhx() }, status: { in: OPEN_STATUSES } })
  if (q.belowMin) and.push({ cmr: { is: { lbsPerShipment: { gt: 0, lt: 2500 } } } })
  if (q.prohibited) and.push({ OR: [{ prohibited: true }, { existingCustomer: true }] })
  if (q.from) and.push({ createdAt: { gte: DateTime.fromISO(q.from, { zone: PHOENIX }).startOf('day').toJSDate() } })
  if (q.to) and.push({ createdAt: { lte: DateTime.fromISO(q.to, { zone: PHOENIX }).endOf('day').toJSDate() } })
  if (q.updatedSince) and.push({ updatedAt: { gte: new Date(q.updatedSince) } })
  if (q.q?.trim()) {
    const t = q.q.trim()
    const { e164 } = normalizePhone(t)
    and.push({ OR: [{ name: { contains: t, mode: 'insensitive' } }, { email: { contains: t, mode: 'insensitive' } }, { phone: { contains: t } }, ...(e164 ? [{ phoneE164: e164 }] : []), { organization: { contains: t, mode: 'insensitive' } }, { website: { contains: t, mode: 'insensitive' } }, { city: { contains: t, mode: 'insensitive' } }, { message: { contains: t, mode: 'insensitive' } }, { cmr: { is: { currentVendor: { contains: t, mode: 'insensitive' } } } }] })
  }
  return { AND: and }
}

/** GET /api/leads — the leads I can see, with filters, a page at a time, and the counts the cards need. */
export async function listLeads(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(listQuery, req.query)
  const page = q.page ?? 1, pageSize = q.pageSize ?? 50
  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    q.sort === 'oldest' ? [{ createdAt: 'asc' }] : q.sort === 'activity' ? [{ lastActivityAt: 'desc' }] : q.sort === 'nextStep' ? [{ nextStepDate: { sort: 'asc', nulls: 'last' } }] : q.sort === 'name' ? [{ name: 'asc' }] : q.sort === 'company' ? [{ organization: 'asc' }] : q.sort === 'calls' ? [{ callsCount: 'desc' }] : [{ createdAt: 'desc' }]
  let rows: LeadRow[], total: number
  if (q.late) {
    const all = await prisma.lead.findMany({ where: { AND: [listWhere(m, s, q), { status: 'NEW' }] }, include: LEAD_INCLUDE, orderBy: { createdAt: 'asc' }, take: 2000 })
    const late = all.filter((l) => lateness(l, l.business))
    total = late.length
    rows = late.slice((page - 1) * pageSize, page * pageSize)
  } else {
    const where = listWhere(m, s, q)
    ;[rows, total] = await Promise.all([prisma.lead.findMany({ where, include: LEAD_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize }), prisma.lead.count({ where })])
  }
  const openTasks = rows.length ? await prisma.leadTask.groupBy({ by: ['leadId'], where: { leadId: { in: rows.map((r) => r.id) }, doneAt: null }, _count: { _all: true } }) : []
  // Counts for the tabs, over everything I can see in the chosen business.
  const base: Prisma.LeadWhereInput = { AND: [leadWhere(m, s), q.business ? { businessId: q.business } : {}] }
  const [byStatus, unassigned, mine, openNew, waiting, overdueN] = await Promise.all([
    prisma.lead.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.lead.count({ where: { AND: [base, { assigneeId: null, status: { in: OPEN_STATUSES } }] } }),
    prisma.lead.count({ where: { AND: [base, { assigneeId: m.id, status: { in: OPEN_STATUSES } }] } }),
    prisma.lead.findMany({ where: { AND: [base, { status: 'NEW' }] }, select: { status: true, assigneeId: true, createdAt: true, assignedAt: true, firstContactAt: true, business: { select: { slaAssignMins: true, slaContactMins: true } } }, take: 5000 }),
    prisma.lead.count({ where: { AND: [base, { cmr: { is: { jesseInputNeeded: true } } }] } }),
    prisma.lead.count({ where: { AND: [base, { nextStepDate: { lt: startOfTodayPhx() }, status: { in: OPEN_STATUSES } }] } }),
  ])
  res.json({
    leads: rows.map((l) => ({ ...leadOut(l, openTasks.find((t) => t.leadId === l.id)?._count._all ?? 0), message: l.message?.slice(0, 200) ?? null })),
    total, page, pageSize,
    counts: { byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])), unassigned, mine, late: openNew.filter((l) => lateness(l, l.business)).length, waiting, overdue: overdueN },
  })
}

/** GET /api/leads/export.csv — the filtered list as a spreadsheet (managers), the sheet's columns first. */
export async function exportLeads(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  if (!s.admin && !s.managerOf.length) throw new HttpError(403, 'Only managers can download leads.')
  const q = parse(listQuery, req.query)
  const rows = await prisma.lead.findMany({ where: { AND: [listWhere(m, s, q), s.admin ? {} : { businessId: { in: s.managerOf } }] }, include: LEAD_INCLUDE, orderBy: { createdAt: 'desc' }, take: 20000 })
  const last = new Map((await prisma.leadCall.findMany({ where: { leadId: { in: rows.map((r) => r.id) } }, orderBy: { at: 'desc' }, distinct: ['leadId'], select: { leadId: true, summary: true } })).map((c) => [c.leadId, c.summary]))
  const yn = (v: string) => (v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'Unknown')
  const head = ['Date', 'Business', 'SDR / Assigned to', 'Company', 'Segment / Industry', 'State', 'Contact', 'Role', 'Decision Maker', 'Phone', 'Email', 'Website', 'Handles Alkaline', 'Est. Volume (lbs/month)', 'Lbs per shipment', 'Current Vendor', 'Pays Today ($/lb)', 'Status', 'Call Summary', 'Next Step', 'Next Step Date', 'Owner', 'Jesse Input Needed', 'Jesse Comment', 'Calls', 'Last call', 'Source', 'From', 'Campaign', 'City', 'Tags', 'Lost reason', 'Message', 'Created']
  if (rows.length) await event(rows[0].id, m.id, 'EXPORT', `Exported ${rows.length} leads`)
  sendCsv(res, 'leads.csv', [head, ...rows.map((l) => {
    const c = l.cmr ?? CMR_DEFAULT
    return [isoDate(l.lastCallAt ?? l.createdAt) ?? '', l.business.name, l.assignee?.name ?? '', l.organization ?? '', l.industry ?? '', l.state ?? '', l.name, c.contactRole ?? l.jobTitle ?? '', yn(c.decisionMaker), l.phone ?? '', l.email ?? '', l.website ?? '', yn(c.handlesAlkaline),
      c.lbsPerMonth ?? '', c.lbsPerShipment ?? '', c.currentVendor ?? '', c.paysToday ?? '', statusLabel(l.business, l.status), last.get(l.id) ?? '', l.nextStep ?? '', isoDate(l.nextStepDate) ?? '', l.owner, c.jesseInputNeeded ? 'Yes' : 'No', c.jesseComment ?? '',
      l.callsCount, l.lastCallAt?.toISOString() ?? '', sourceText(l.source), l.sourceDetail ?? '', l.utmCampaign ?? '', l.city ?? '', l.tags.join('; '), l.lostReason ?? '', l.message ?? '', l.createdAt.toISOString()]
  })])
}

/** GET /api/leads/check?business&organization&phone&email&website — before adding: the same company already here, or on a list. */
export async function checkLead(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  const q = parse(z.object({ business: z.string().max(60), organization: z.string().max(200).optional(), phone: z.string().max(50).optional(), email: z.string().max(254).optional(), website: z.string().max(300).optional(), except: z.string().max(60).optional() }), req.query)
  if (!isMemberOf(s, q.business)) throw new HttpError(403, 'You do not work leads for that business.')
  const key = keysOf(q)
  const or: Prisma.LeadWhereInput[] = []
  if (key.orgKey) or.push({ orgKey: key.orgKey })
  if (key.phoneE164) or.push({ phoneE164: key.phoneE164 })
  if (key.email) or.push({ email: key.email })
  if (key.websiteKey) or.push({ websiteKey: key.websiteKey })
  const same = or.length ? await prisma.lead.findMany({ where: { businessId: q.business, OR: or, ...(q.except ? { id: { not: q.except } } : {}) }, include: LEAD_INCLUDE, take: 5, orderBy: { lastActivityAt: 'desc' } }) : []
  const lists = await listMatches(q.business, key)
  res.json({ duplicates: same.map((l) => ({ id: l.id, name: l.name, organization: l.organization, status: l.status, statusLabel: statusLabel(l.business, l.status), assignee: l.assignee, lastActivityAt: l.lastActivityAt })), ...lists })
}

// ------------------------------------------------------------------ fields

const yesNo = z.enum(YES_NO)
const str = (n: number) => z.string().max(n).nullable()
/** Everything on a lead a person may type (the CMR part included; it is ignored for other kinds). */
const leadFields = z.object({
  name: z.string().max(200), email: str(254), phone: str(50), organization: str(200), message: str(8000), location: str(120),
  jobTitle: str(200), employees: str(60), industry: str(120), website: str(300), mobile: str(50), ext: str(20), secondaryEmail: str(254), secondaryContact: str(200), recipientName: str(200), recipientEmail: str(254),
  tags: z.array(z.string().trim().min(1).max(40)).max(20), street: str(200), city: str(120), state: str(40), zip: str(20), country: str(80), productInfo: str(4000),
  nextStep: str(300), nextStepDate: str(10), owner: z.enum(OWNERS), value: z.number().min(0).max(1e12).nullable(), lostReason: str(300), lostNote: str(2000),
  // CMR
  contactRole: str(200), decisionMaker: yesNo, decisionMakerName: str(200), dmAgreed: yesNo, handlesAlkaline: yesNo, material: z.array(z.enum(MATERIALS)).max(6), materialForm: z.array(z.enum(MATERIAL_FORMS)).max(3),
  lbsPerMonth: z.number().min(0).max(1e9).nullable(), lbsPerShipment: z.number().min(0).max(1e9).nullable(), currentVendor: str(200), paysToday: z.number().min(0).max(1e6).nullable(), paysUnit: z.enum(PAYS_UNITS),
  vendorRelatedParty: z.boolean(), usesBatteryNetwork: z.boolean(), sortsAlkaline: yesNo, shipsLtl: yesNo, nextShipmentDate: str(10), pickupCity: str(120), freight: z.enum(FREIGHT),
}).partial().strict()
type LeadFields = z.infer<typeof leadFields>
const CMR_KEYS = new Set(['contactRole', 'decisionMaker', 'decisionMakerName', 'dmAgreed', 'handlesAlkaline', 'material', 'materialForm', 'lbsPerMonth', 'lbsPerShipment', 'currentVendor', 'paysToday', 'paysUnit', 'vendorRelatedParty', 'usesBatteryNetwork', 'sortsAlkaline', 'shipsLtl', 'nextShipmentDate', 'pickupCity', 'freight'])

/** Split typed fields into the lead's own columns and the CMR part, in their saved shape. */
function cleanFields(b: LeadFields, cmr: boolean): { lead: Prisma.LeadUpdateInput; cmr: Prisma.LeadCmrUncheckedUpdateInput } {
  const lead: Record<string, unknown> = {}, part: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue
    const val = typeof v === 'string' ? v.trim() || null : v
    if (CMR_KEYS.has(k)) { if (cmr) part[k] = val } else lead[k] = val
  }
  if (b.name !== undefined) lead.name = b.name.trim()
  if (b.organization !== undefined) lead.orgKey = orgKey(b.organization)
  if (b.phone !== undefined) { const p = normalizePhone(b.phone); lead.phone = p.phone; lead.phoneE164 = p.e164 }
  for (const k of ['email', 'secondaryEmail', 'recipientEmail'] as const) {
    if (b[k] !== undefined && lead[k]) {
      if (!emailOk(String(lead[k]))) throw new HttpError(422, `That ${k === 'email' ? 'email' : k === 'secondaryEmail' ? 'secondary email' : 'recipient email'} address does not look right`)
      lead[k] = String(lead[k]).toLowerCase()
    }
  }
  if (b.website !== undefined) lead.websiteKey = websiteKey(b.website)
  if (b.nextStepDate !== undefined) lead.nextStepDate = dateOrNull(b.nextStepDate)
  if (cmr && b.nextShipmentDate !== undefined) part.nextShipmentDate = dateOrNull(b.nextShipmentDate)
  if (cmr && b.paysUnit === 'NONE') part.paysToday = 0
  return { lead: lead as Prisma.LeadUpdateInput, cmr: part as Prisma.LeadCmrUncheckedUpdateInput }
}
const prettyField = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^dm /, 'decision maker ').replace('organization', 'company')

// ------------------------------------------------------------------ add, get, update, assign

/** POST /api/leads — a lead added by hand (a phone call, the first CMR call). 409 when the company is already here, unless force. */
export async function addLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(leadFields.extend({ businessId: z.string().min(1).max(60), assignTo: z.string().max(60).nullable().optional(), force: z.boolean().optional() }), req.body)
  if (!isMemberOf(s, b.businessId)) throw new HttpError(403, 'You do not work leads for that business.')
  const business = await bizFor(b.businessId)
  const { businessId, assignTo, force, ...fields } = b
  const cmr = isCmr(business)
  const { lead: data, cmr: part } = cleanFields(fields, cmr)
  if (!data.name && !data.email && !data.phone && !data.organization) throw new HttpError(422, 'Give at least a company, a name, a phone number or an email')
  if (!force) {
    const or: Prisma.LeadWhereInput[] = []
    if (data.orgKey) or.push({ orgKey: String(data.orgKey) })
    if (data.phoneE164) or.push({ phoneE164: String(data.phoneE164) })
    if (data.websiteKey) or.push({ websiteKey: String(data.websiteKey) })
    const dup = or.length ? await prisma.lead.findFirst({ where: { businessId, status: { in: OPEN_STATUSES }, OR: or }, select: { id: true, name: true, organization: true, status: true } }) : null
    if (dup) { res.status(409).json({ error: `${dup.organization || dup.name} is already here (${statusLabel(business, dup.status)}). Open it and log the call there, or add anyway.`, duplicateId: dup.id }); return }
  }
  let assigneeId: string | null = null
  if (assignTo === 'me' || (assignTo === undefined && !canManage(s, businessId))) assigneeId = m.id
  else if (assignTo) {
    if (!canManage(s, businessId)) throw new HttpError(403, 'Only a manager can give a lead to someone else.')
    if (!(await prisma.leadBusinessMember.findUnique({ where: { businessId_userId: { businessId, userId: assignTo } } }))) throw new HttpError(422, 'That person does not work leads for this business.')
    assigneeId = assignTo
  }
  if (assigneeId === m.id && !s.roles.has(businessId) && s.admin) assigneeId = null
  const input: IntakeInput = { name: String(data.name ?? ''), email: (data.email as string | null) ?? null, phone: (data.phone as string | null) ?? null, organization: (data.organization as string | null) ?? null, message: (data.message as string | null) ?? null, location: (data.location as string | null) ?? null }
  const r = await receiveLead(business, input, { source: 'PHONE', createdById: m.id, assigneeId })
  // The rest of the details (and the CMR part) go on after the lead exists.
  const { name: _n, email: _e, phone: _p, phoneE164: _pe, organization: _o, orgKey: _ok, message: _msg, location: _loc, ...more } = data as Record<string, unknown>
  await prisma.lead.update({ where: { id: r.lead.id }, data: { ...(more as Prisma.LeadUpdateInput), ...(cmr ? { cmr: { create: { ...(part as Prisma.LeadCmrCreateWithoutLeadInput) } } } : {}) } })
  if (more.nextStep && more.nextStepDate) await makeTask({ leadId: r.lead.id, businessId, assigneeId, kind: 'NEXT_STEP', title: String(more.nextStep), dueAt: atPhoenix(DateTime.fromJSDate(more.nextStepDate as Date)), actorId: m.id, notify: false })
  let lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.lead.id }, include: LEAD_INCLUDE })
  const lists = await listMatches(businessId, lead)
  if (lists.prohibited !== lead.prohibited || lists.existingCustomer !== lead.existingCustomer) lead = await prisma.lead.update({ where: { id: lead.id }, data: { prohibited: lists.prohibited, existingCustomer: lists.existingCustomer }, include: LEAD_INCLUDE })
  if (lists.hits.length) await event(lead.id, m.id, 'NOTE', `On the ${lists.hits.map((h) => (h.kind === 'PROHIBITED' ? 'Prohibited' : 'existing customer')).join(' and ')} list (${lists.hits[0].on}).`)
  res.status(201).json({ lead: leadOut(lead), listHits: lists.hits })
}

/** GET /api/leads/:id — the lead with its details, facts, warnings, calls, comments, tasks and timeline. */
export async function getLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const base = await leadFor(m, s, String(req.params.id))
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...LEAD_INCLUDE, assignedBy: PERSON, createdBy: PERSON,
      calls: { orderBy: { at: 'desc' }, include: { user: PERSON } },
      comments: { orderBy: { createdAt: 'asc' }, include: { user: PERSON } },
      tasks: { orderBy: [{ doneAt: 'asc' }, { dueAt: 'asc' }], include: { assignee: PERSON } },
      events: { orderBy: { createdAt: 'desc' }, take: 300, include: { user: PERSON } },
    },
  })
  const b = lead.business
  const ids = new Set<string>()
  for (const e of lead.events) { const to = (e.data as { to?: string } | null)?.to; if (to) ids.add(to) }
  for (const c of lead.comments) for (const id of c.mentions) ids.add(id)
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const manage = canManage(s, b.id)
  const canHear = (c: { userId: string | null }) => manage || c.userId === m.id
  const members = await prisma.leadBusinessMember.findMany({ where: { businessId: b.id, user: { isActive: true } }, select: { role: true, user: PERSON } })
  const head = b.headId ? await prisma.user.findUnique({ where: { id: b.headId }, select: { id: true, name: true, email: true } }) : null
  const mentionable = [...members.map((x) => ({ ...x.user, role: x.role })), ...(head && !members.some((x) => x.user.id === head.id) ? [{ ...head, role: 'HEAD' }] : [])]
  const { calls, comments, tasks, events, ...rest } = lead
  res.json({
    lead: {
      ...leadOut(rest, tasks.filter((t) => !t.doneAt).length),
      raw: lead.raw,
      assignedBy: lead.assignedBy, createdBy: lead.createdBy,
      calls: calls.map((c) => ({ ...c, recordingUrl: c.recordingUrl && c.recordingKept && canHear(c) ? `/api/leads/calls/${c.id}/recording` : null, hasRecording: !!c.recordingUrl && c.recordingKept })),
      comments: comments.map((c) => ({ ...c, mentionNames: c.mentions.map((id) => names.get(id) ?? '') })),
      tasks,
      events: events.map((e) => ({ ...e, toName: (e.data as { to?: string } | null)?.to ? names.get((e.data as { to: string }).to) ?? null : undefined })),
    },
    listHits: (await listMatches(b.id, lead)).hits,
    can: { manage, decide: canDecide(s, b.id), approve: manage, edit: manage || lead.assigneeId === m.id, cmr: isCmr(b) && (await isOn('cmr', m.companyId)) },
    head, mentionable, pipeline: pipelineOf(b), settings: isCmr(b) ? settingsOf(b) : null,
  })
}

/** PATCH /api/leads/:id — the details, the five facts, the status, the next step. */
export async function updateLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  const b = parse(leadFields.extend({ status: z.string().max(40).optional() }), req.body)
  const { status, ...fields } = b
  const cmr = isCmr(lead.business)
  const { lead: data, cmr: part } = cleanFields(fields, cmr)
  const events: Prisma.LeadEventCreateManyInput[] = []
  const before = { ...lead, ...(lead.cmr ?? CMR_DEFAULT) } as Record<string, unknown>
  const changed = [...Object.keys(data), ...Object.keys(part)].filter((k) => !['orgKey', 'phoneE164', 'websiteKey'].includes(k) && JSON.stringify(before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k]) !== JSON.stringify((data as Record<string, unknown>)[k] instanceof Date ? ((data as Record<string, unknown>)[k] as Date).toISOString() : (data as Record<string, unknown>)[k] ?? ((part as Record<string, unknown>)[k] instanceof Date ? ((part as Record<string, unknown>)[k] as Date).toISOString() : (part as Record<string, unknown>)[k])))
  if (changed.length) events.push({ leadId: lead.id, userId: m.id, kind: 'EDIT', text: `Changed ${[...new Set(changed.map(prettyField))].join(', ')}` })
  if (data.organization !== undefined || data.phone !== undefined || data.email !== undefined || data.website !== undefined) {
    const lists = await listMatches(lead.businessId, { orgKey: (data.orgKey as string | null) ?? lead.orgKey, phoneE164: (data.phoneE164 as string | null) ?? lead.phoneE164, email: (data.email as string | null) ?? lead.email, websiteKey: (data.websiteKey as string | null) ?? lead.websiteKey })
    data.prohibited = lists.prohibited; data.existingCustomer = lists.existingCustomer
  }
  if (status && status !== lead.status) {
    const pipe = pipelineOf(lead.business)
    if (!pipe.some((x) => x.key === status)) throw new HttpError(422, `"${status}" is not a status of ${lead.business.name}`)
    if (cmr && status === 'QUALIFIED') throw new HttpError(422, 'Use "Qualify" to flag a lead for Jesse (the five facts are checked).')
    if (cmr && status === 'CLOSED_WON' && !canManage(s, lead.businessId)) throw new HttpError(403, 'Only a manager marks a lead Closed Won.')
    data.status = status
    if (lead.status === 'NEW' && !lead.firstContactAt && status !== 'SPAM') data.firstContactAt = new Date()
    if (!openStatusesOf(lead.business).includes(status)) { data.nextStep = null; data.nextStepDate = null }
    events.push({ leadId: lead.id, userId: m.id, kind: 'STATUS', text: status === 'LOST' && b.lostReason ? `Lost: ${b.lostReason}` : '', data: { from: lead.status, to: status } })
  }
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { ...data, lastActivityAt: new Date(), ...(cmr && Object.keys(part).length ? { cmr: { upsert: { create: part as Prisma.LeadCmrCreateWithoutLeadInput, update: part } } } : {}) }, include: LEAD_INCLUDE })
  if (events.length) await prisma.leadEvent.createMany({ data: events })
  if (b.nextStepDate !== undefined || b.nextStep !== undefined || (data.status && !openStatusesOf(lead.business).includes(String(data.status)))) {
    if (saved.nextStep && saved.nextStepDate && openStatusesOf(lead.business).includes(saved.status)) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: saved.assigneeId, kind: 'NEXT_STEP', title: saved.nextStep, dueAt: atPhoenix(DateTime.fromJSDate(saved.nextStepDate)), actorId: m.id, notify: false })
    else await closeTasks(lead.id, ['NEXT_STEP'], m.id, saved.nextStep ? 'changed' : 'cleared')
  }
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/assign { assigneeId | null } — managers give a lead to someone in the business. */
export async function assignLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  requireManager(s, lead.businessId, 'assign its leads')
  const { assigneeId } = parse(z.object({ assigneeId: z.string().max(60).nullable() }), req.body)
  if (assigneeId === lead.assigneeId) { res.json({ lead: leadOut(lead) }); return }
  if (assigneeId) {
    const member = await prisma.leadBusinessMember.findUnique({ where: { businessId_userId: { businessId: lead.businessId, userId: assigneeId } }, select: { user: { select: { isActive: true } } } })
    if (!member || !member.user.isActive) throw new HttpError(422, 'That person does not work leads for this business. Add them under Lead settings first.')
  }
  const now = new Date()
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { assigneeId, assignedAt: assigneeId ? now : null, assignedById: assigneeId ? m.id : null, slaContactAlertAt: null, lastActivityAt: now }, include: LEAD_INCLUDE })
  await prisma.leadTask.updateMany({ where: { leadId: lead.id, doneAt: null, kind: { in: ['FOLLOW_UP', 'NEXT_STEP', 'SEND_INVITE', 'RELAY', 'RECONFIRM', 'OUTCOME', 'CALL', 'REPLY'] } }, data: { assigneeId } })
  await event(lead.id, m.id, 'ASSIGNED', assigneeId ? '' : 'Taken back (no one)', assigneeId ? { to: assigneeId } : undefined)
  if (assigneeId && assigneeId !== m.id) await tellAboutLead([assigneeId], { type: 'LEAD_ASSIGNED', title: `New lead for you: ${lead.organization || lead.name || lead.email || lead.phone || 'a lead'}`, body: `${lead.business.name} · ${statusLabel(lead.business, lead.status)}${lead.business.slaContactMins ? ` · get in touch within ${lead.business.slaContactMins >= 60 ? `${Math.round(lead.business.slaContactMins / 60)} h` : `${lead.business.slaContactMins} min`}` : ''}`, leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/events { kind: NOTE | EMAIL, text } — a note, or an email that happened (calls: /calls). */
export async function addLeadEvent(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  const b = parse(z.object({ kind: z.enum(['NOTE', 'EMAIL', 'CALL']), text: z.string().trim().max(5000) }), req.body)
  if (b.kind === 'NOTE' && !b.text) throw new HttpError(422, 'Write the note first')
  const now = new Date()
  const ev = await prisma.leadEvent.create({ data: { leadId: lead.id, userId: m.id, kind: b.kind, text: b.text }, include: { user: PERSON } })
  const contact = b.kind !== 'NOTE'
  const toContacted = contact && lead.status === 'NEW' && !isCmr(lead.business)
  await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: now, ...(contact && !lead.firstContactAt ? { firstContactAt: now } : {}), ...(toContacted ? { status: 'CONTACTED' } : {}) } })
  if (toContacted) await event(lead.id, m.id, 'STATUS', '', { from: 'NEW', to: 'CONTACTED' })
  res.status(201).json({ event: ev })
}

// ------------------------------------------------------------------ calls

const callSchema = z.object({
  at: z.string().max(30).optional(),
  direction: z.enum(['OUT', 'IN']).optional(),
  durationSec: z.number().int().min(0).max(36000).optional(),
  disposition: z.enum(DISPOSITIONS),
  /** The template's "Outcome" line; the summary is composed from it and the facts, or typed whole. */
  outcome: z.string().trim().max(2000).optional(),
  summary: z.string().trim().max(5000).optional(),
  consentGiven: z.boolean().nullable().optional(),
  recordingUrl: z.string().max(1000).nullable().optional(),
  nextStep: z.string().max(300).nullable().optional(),
  nextStepDate: z.string().max(10).nullable().optional(),
  owner: z.enum(OWNERS).optional(),
  /** Facts learned on the call, saved with it. */
  facts: leadFields.optional(),
})

/** POST /api/leads/:id/calls — a call happened: the disposition, the summary, the facts learned and the next step. */
export async function addCall(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  if (lead.prohibited) throw new HttpError(422, 'This company is on the Prohibited list: calls are not logged. Ask the team lead.')
  const b = parse(callSchema, req.body)
  const biz = lead.business, cmr = isCmr(biz), set = settingsOf(biz)
  const now = new Date()
  const at = b.at ? new Date(b.at) : now
  if (Number.isNaN(at.getTime())) throw new HttpError(422, 'That call time does not look right')
  const { lead: facts, cmr: part } = b.facts ? cleanFields(b.facts, cmr) : { lead: {}, cmr: {} }
  const twoParty = cmr && !!lead.state && set.consentStates.map((x) => x.toUpperCase()).includes(lead.state.toUpperCase())
  const kept = !twoParty || b.consentGiven === true
  const nextStepDate = b.nextStepDate !== undefined ? dateOrNull(b.nextStepDate) : undefined
  const connected = b.disposition === 'CONNECTED'
  const merged = { ...lead, ...(lead.cmr ?? CMR_DEFAULT), ...(facts as object), ...(part as object), ...(b.nextStep !== undefined ? { nextStep: b.nextStep } : {}), ...(nextStepDate !== undefined ? { nextStepDate } : {}), ...(b.owner ? { owner: b.owner } : {}) } as typeof lead & typeof CMR_DEFAULT
  const summary = b.summary?.trim() || (connected
    ? (cmr ? composeSummary({ ...merged, company: lead.organization || lead.name, contact: lead.organization ? lead.name || null : null }, b.outcome || 'spoke with the contact') : (b.outcome || 'Spoke with the contact.'))
    : `${b.disposition === 'VOICEMAIL' ? 'Left a voicemail' : b.disposition === 'NO_ANSWER' ? 'No answer' : b.disposition === 'BUSY' ? 'Line busy' : b.disposition === 'WRONG_NUMBER' ? 'Wrong number' : 'Reached the gatekeeper'}${b.outcome ? `: ${b.outcome}` : '.'}`)
  const call = await prisma.leadCall.create({ data: { leadId: lead.id, businessId: biz.id, userId: m.id, at, direction: b.direction ?? 'OUT', durationSec: b.durationSec ?? 0, disposition: b.disposition, summary, outcome: b.outcome || null, consentGiven: twoParty ? (b.consentGiven ?? false) : b.consentGiven ?? null, recordingUrl: kept ? b.recordingUrl ?? null : null, recordingKept: kept }, include: { user: PERSON } })
  // A connected call moves New → Contacted (GENERAL) or Info Sent → Follow Up (CMR).
  const status = connected ? (cmr ? (lead.status === 'INFO_SENT' ? 'FOLLOW_UP' : undefined) : (lead.status === 'NEW' ? 'CONTACTED' : undefined)) : undefined
  const data: Prisma.LeadUpdateInput = {
    ...facts, lastActivityAt: now, lastCallAt: at, firstCallAt: lead.firstCallAt ?? at, callsCount: { increment: 1 }, ...(connected && !lead.firstContactAt ? { firstContactAt: now } : {}),
    ...(b.nextStep !== undefined ? { nextStep: b.nextStep?.trim() || null } : {}), ...(nextStepDate !== undefined ? { nextStepDate } : {}), ...(b.owner ? { owner: b.owner } : {}), ...(status ? { status } : {}),
    ...(cmr && Object.keys(part).length ? { cmr: { upsert: { create: part as Prisma.LeadCmrCreateWithoutLeadInput, update: part } } } : {}),
  }
  const saved = await prisma.lead.update({ where: { id: lead.id }, data, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'CALL', summary, { callId: call.id, disposition: b.disposition, durationSec: b.durationSec ?? 0 })
  if (status) await event(lead.id, m.id, 'STATUS', '', { from: lead.status, to: status })
  if (twoParty && !kept && b.recordingUrl) await event(lead.id, m.id, 'CALL', `Recording not kept: ${lead.state} needs consent and it was not given.`)
  await closeTasks(lead.id, ['CALL', 'FOLLOW_UP'], m.id, `Called: ${b.disposition.toLowerCase().replace(/_/g, ' ')}`)
  if (saved.nextStep && saved.nextStepDate) await makeTask({ leadId: lead.id, businessId: biz.id, assigneeId: saved.assigneeId ?? m.id, kind: 'NEXT_STEP', title: saved.nextStep, dueAt: atPhoenix(DateTime.fromJSDate(saved.nextStepDate)), actorId: m.id, notify: false })
  res.status(201).json({ call: { ...call, hasRecording: !!call.recordingUrl && call.recordingKept, recordingUrl: call.recordingUrl && call.recordingKept ? `/api/leads/calls/${call.id}/recording` : null }, lead: leadOut(saved) })
}

/** GET /api/leads/calls — every call I may hear (managers: their businesses; reps: their own), with filters. */
export async function listCalls(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(z.object({ business: z.string().max(60).optional(), user: z.string().max(60).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional(), disposition: z.string().max(30).optional(), minSecs: z.coerce.number().int().min(0).optional(), lead: z.string().max(60).optional(), recorded: z.enum(['1']).optional(), page: z.coerce.number().int().min(1).optional() }), req.query)
  const and: Prisma.LeadCallWhereInput[] = [s.admin ? {} : { OR: [{ userId: m.id }, { businessId: { in: s.managerOf } }] }]
  if (q.business) and.push({ businessId: q.business })
  if (q.user) and.push({ userId: q.user === 'me' ? m.id : q.user })
  if (q.from) and.push({ at: { gte: DateTime.fromISO(q.from, { zone: PHOENIX }).startOf('day').toJSDate() } })
  if (q.to) and.push({ at: { lte: DateTime.fromISO(q.to, { zone: PHOENIX }).endOf('day').toJSDate() } })
  if (q.disposition) and.push({ disposition: q.disposition })
  if (q.minSecs) and.push({ durationSec: { gte: q.minSecs } })
  if (q.lead) and.push({ leadId: q.lead })
  if (q.recorded) and.push({ recordingUrl: { not: null }, recordingKept: true })
  const where = { AND: and }
  const page = q.page ?? 1
  const [rows, total] = await Promise.all([prisma.leadCall.findMany({ where, orderBy: { at: 'desc' }, skip: (page - 1) * 50, take: 50, include: { user: PERSON, lead: { select: { id: true, name: true, organization: true, state: true, status: true, industry: true, business: { select: { id: true, name: true, kind: true, pipeline: true } } } } } }), prisma.leadCall.count({ where })])
  res.json({ calls: rows.map((c) => ({ ...c, lead: { ...c.lead, statusLabel: statusLabel(c.lead.business, c.lead.status), business: { id: c.lead.business.id, name: c.lead.business.name } }, recordingUrl: c.recordingUrl && c.recordingKept ? `/api/leads/calls/${c.id}/recording` : null, hasRecording: !!c.recordingUrl && c.recordingKept })), total, page, pageSize: 50 })
}

/** GET /api/leads/calls/:id/recording — the recording, only for people who may hear it (managers and the head: all; a rep: their own). */
export async function callRecording(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const c = await prisma.leadCall.findFirst({ where: { id: String(req.params.id), ...(s.admin ? {} : { OR: [{ userId: m.id }, { businessId: { in: s.managerOf } }] }) }, select: { recordingUrl: true, recordingKept: true, leadId: true } })
  if (!c || !c.recordingUrl || !c.recordingKept) throw new HttpError(404, 'No recording')
  await event(c.leadId, m.id, 'LISTEN', 'Played a recording')
  res.redirect(c.recordingUrl)
}

// ------------------------------------------------------------------ the CMR flow

/** POST /api/leads/:id/send-info { note } — step 3: the profile email from the template; Info Sent; follow up in 2 business days. */
export async function sendInfo(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const set = settingsOf(lead.business)
  const { note } = parse(z.object({ note: z.string().trim().max(2000).optional() }), req.body)
  if (!lead.email) throw new HttpError(422, 'Add the contact’s email address first')
  if (lead.prohibited) throw new HttpError(422, 'This company is on the Prohibited list.')
  if (note && PROMISE_WORDS.test(note)) throw new HttpError(422, 'The note reads like a price, freight or pickup promise. Those come from Jesse: leave them out.')
  const sdr = await prisma.user.findUniqueOrThrow({ where: { id: m.id }, select: { name: true, email: true } })
  const company = lead.organization || lead.name
  const fill = (t: string) => t.replace(/\{\{company\}\}/g, company).replace(/\{\{contact\}\}/g, lead.name || 'there').replace(/\{\{sdr\}\}/g, sdr.name).replace(/\{\{rate\}\}/g, `$${set.publishedRate.toFixed(2)}/lb`).replace(/\{\{note\}\}/g, note ?? '').replace(/\n{3,}/g, '\n\n')
  const subject = fill(set.infoSubject), text = fill(set.infoBody)
  await sendMail({ to: lead.email, subject, text, html: `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;color:#0F172A;white-space:pre-wrap">${text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</div>`, category: 'Lead info', replyTo: sdr.email })
  const now = new Date()
  const due = DateTime.fromJSDate(addBusinessDays(now, 2), { zone: PHOENIX }).startOf('day').toJSDate()
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { status: 'INFO_SENT', nextStep: 'Follow up on the info email', nextStepDate: due, owner: 'REP', lastActivityAt: now, firstContactAt: lead.firstContactAt ?? now, cmr: { upsert: { create: { infoSentAt: now }, update: { infoSentAt: now } } } }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'EMAIL', `Info sent to ${lead.email}${note ? ` · note: ${note.slice(0, 200)}` : ''}`, { subject })
  if (lead.status !== 'INFO_SENT') await event(lead.id, m.id, 'STATUS', '', { from: lead.status, to: 'INFO_SENT' })
  await closeTasks(lead.id, ['NEXT_STEP'], m.id, 'info sent')
  await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: lead.assigneeId ?? m.id, kind: 'FOLLOW_UP', title: `Follow up with ${company}`, notes: 'Two business days after the info email: ask for the facts still missing.', dueAt: atPhoenix(DateTime.fromJSDate(due)), actorId: m.id, notify: false })
  res.json({ lead: leadOut(saved), sentTo: lead.email })
}

async function flagForHead(lead: LeadRow, ask: string, byId: string) {
  const now = new Date()
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { status: 'QUALIFIED', owner: 'HEAD', nextStep: 'Jesse review', nextStepDate: DateTime.fromJSDate(addBusinessDays(now, 1), { zone: PHOENIX }).startOf('day').toJSDate(), lastActivityAt: now, cmr: { upsert: { create: { jesseInputNeeded: true, jesseAsk: ask, flaggedAt: now, qualifiedAt: now, qualifiedById: byId }, update: { jesseInputNeeded: true, jesseAsk: ask, flaggedAt: now, qualifiedAt: now, qualifiedById: byId, qualifyRequestedAt: null, jesseDecision: null, jesseDecidedAt: null } } } }, include: LEAD_INCLUDE })
  await event(lead.id, byId, 'FLAG', `Qualified and flagged for Jesse: ${ask}`)
  await closeTasks(lead.id, ['APPROVE', 'NEXT_STEP', 'FOLLOW_UP'], byId, 'qualified')
  const company = lead.organization || lead.name
  if (lead.business.headId) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: lead.business.headId, kind: 'HEAD_REVIEW', title: `Review flagged lead: ${company}`, notes: ask, dueAt: atPhoenix(DateTime.fromJSDate(addBusinessDays(now, 1)), 17), actorId: byId, notify: false })
  await tellAboutLead([lead.business.headId], { type: 'LEAD_REVIEW', title: `Waiting on you: ${company}`, body: ask, leadId: lead.id, actorId: byId })
  return saved
}

/** POST /api/leads/:id/qualify { ask } — step 5: the SDR asks; the team lead approves (a manager or the head qualifies at once). */
export async function qualifyLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const { ask } = parse(z.object({ ask: z.string().trim().min(5).max(300) }), req.body)
  const missing = fiveFacts(lead.cmr ?? CMR_DEFAULT).filter((f) => !f.done)
  if (missing.length) throw new HttpError(422, `Fill the five facts first. Missing: ${missing.map((f) => f.label).join(', ')}.`)
  if (!openStatusesOf(lead.business).includes(lead.status)) throw new HttpError(422, 'This lead is closed. Reopen it first.')
  const now = new Date()
  if (canManage(s, lead.businessId)) { res.json({ lead: leadOut(await flagForHead(lead, ask, m.id)), flagged: true }); return }
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: now, cmr: { upsert: { create: { qualifyRequestedAt: now, jesseAsk: ask }, update: { qualifyRequestedAt: now, jesseAsk: ask } } } }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'QUALIFY', `Asked the team lead to qualify · for Jesse: ${ask}`)
  const managers = (await leadManagers(lead.businessId)).filter((id) => id !== lead.business.headId)
  for (const id of managers) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: id, kind: 'APPROVE', title: `Approve qualified lead: ${lead.organization || lead.name}`, notes: ask, dueAt: atPhoenix(DateTime.fromJSDate(addBusinessDays(now, 1))), actorId: m.id })
  res.json({ lead: leadOut(saved), flagged: false })
}

/** POST /api/leads/:id/approve — the team lead checks the SDR's request and flags the lead for Jesse. */
export async function approveLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  requireManager(s, lead.businessId, 'approve a qualified lead')
  const { ask } = parse(z.object({ ask: z.string().trim().max(300).optional() }), req.body)
  const line = ask || lead.cmr?.jesseAsk
  if (!line) throw new HttpError(422, 'Write the one line on what Jesse must decide')
  const missing = fiveFacts(lead.cmr ?? CMR_DEFAULT).filter((f) => !f.done)
  if (missing.length) throw new HttpError(422, `Not all five facts are filled. Missing: ${missing.map((f) => f.label).join(', ')}.`)
  const saved = await flagForHead(lead, line, m.id)
  if (lead.assigneeId) await tellAboutLead([lead.assigneeId], { type: 'LEAD_DECISION', title: `Flagged for Jesse: ${lead.organization || lead.name}`, body: 'The team lead approved it. Jesse has 1 business day.', leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

const decideSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('MEETING'), slot: z.string().max(40), text: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('DIRECTION'), text: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal('CLOSE'), status: z.enum(['NOT_A_FIT', 'EXISTING_CUSTOMER', 'REFERRAL_PARTNER', 'CLOSED_LOST']), reason: z.enum(CLOSE_REASONS), text: z.string().trim().max(2000).optional() }),
])

/** POST /api/leads/:id/decide — step 6: Jesse approves a meeting (and a slot), gives pricing/freight direction, or closes with a reason. */
export async function decideLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  if (!canDecide(s, lead.businessId)) throw new HttpError(403, 'Only Jesse (or the Super Admin) decides on flagged leads.')
  const b = parse(decideSchema, req.body)
  const now = new Date(), company = lead.organization || lead.name, c = lead.cmr ?? CMR_DEFAULT
  const data: Prisma.LeadUpdateInput = { lastActivityAt: now }
  const part: Prisma.LeadCmrUncheckedUpdateInput = { jesseInputNeeded: false, jesseDecision: b.action, jesseDecidedAt: now }
  let comment = ''
  const toSdr = (title: string, body: string) => tellAboutLead([lead.assigneeId], { type: 'LEAD_DECISION', title, body, leadId: lead.id, actorId: m.id })
  if (b.action === 'MEETING') {
    const slots = (c.meetingSlots as string[] | null) ?? []
    const at = new Date(b.slot)
    if (Number.isNaN(at.getTime())) throw new HttpError(422, 'Pick one of the offered slots (or type a time)')
    if (slots.length && !slots.some((x) => new Date(x).getTime() === at.getTime())) throw new HttpError(422, 'That is not one of the offered slots')
    const times = threeTimes(at, zoneOfState(lead.state))
    Object.assign(data, { owner: 'REP', nextStep: 'Send the Teams invite', nextStepDate: DateTime.fromJSDate(now, { zone: PHOENIX }).startOf('day').toJSDate(), status: 'QUALIFIED' })
    Object.assign(part, { meetingAt: at, meetingTz: zoneOfState(lead.state) })
    comment = `Meeting approved: ${times.line}.${b.text ? ` ${b.text}` : ''}`
    await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: lead.assigneeId, kind: 'SEND_INVITE', title: `Send the Teams invite to ${company} today`, notes: times.line, dueAt: atPhoenix(DateTime.fromJSDate(now), 17), actorId: m.id, notify: false })
    await toSdr(`Jesse approved a meeting with ${company}`, `${times.phoenix} (Phoenix). Send the Teams invite today.`)
  } else if (b.action === 'DIRECTION') {
    Object.assign(data, { owner: 'REP', nextStep: 'Relay Jesse’s answer', nextStepDate: DateTime.fromJSDate(addBusinessDays(now, 1), { zone: PHOENIX }).startOf('day').toJSDate(), status: 'FOLLOW_UP' })
    comment = b.text
    await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: lead.assigneeId, kind: 'RELAY', title: `Relay Jesse’s answer to ${company}`, notes: b.text, dueAt: atPhoenix(DateTime.fromJSDate(addBusinessDays(now, 1))), actorId: m.id, notify: false })
    await toSdr(`Jesse answered on ${company}`, b.text.slice(0, 200))
  } else {
    Object.assign(data, { status: b.status, lostReason: b.reason, lostNote: b.text ?? null, owner: 'REP', nextStep: null, nextStepDate: null })
    comment = `Closed out: ${statusLabel(lead.business, b.status)} (${b.reason.toLowerCase().replace(/_/g, ' ')})${b.text ? `. ${b.text}` : ''}`
    await prisma.leadTask.updateMany({ where: { leadId: lead.id, doneAt: null }, data: { doneAt: now, doneById: m.id, outcome: 'closed by Jesse' } })
    await toSdr(`Jesse closed ${company}`, comment)
  }
  await closeTasks(lead.id, ['HEAD_REVIEW'], m.id, b.action.toLowerCase())
  part.jesseComment = comment
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { ...data, cmr: { upsert: { create: part as Prisma.LeadCmrCreateWithoutLeadInput, update: part } } }, include: LEAD_INCLUDE })
  await prisma.leadComment.create({ data: { leadId: lead.id, userId: m.id, body: comment } })
  await event(lead.id, m.id, 'DECISION', comment, { action: b.action })
  if (b.action === 'CLOSE') await event(lead.id, m.id, 'STATUS', '', { from: lead.status, to: b.status })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/slots { slots: ISO[] } — the SDR offers 2–3 slots. */
export async function offerSlots(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const { slots } = parse(z.object({ slots: z.array(z.string().max(40)).min(1).max(5) }), req.body)
  const parsed = slots.map((x) => new Date(x))
  if (parsed.some((d) => Number.isNaN(d.getTime()))) throw new HttpError(422, 'A slot time does not look right')
  const zone = zoneOfState(lead.state)
  const iso = parsed.map((d) => d.toISOString())
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date(), cmr: { upsert: { create: { meetingSlots: iso }, update: { meetingSlots: iso } } } }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'MEETING', `Offered ${parsed.length} slot${parsed.length === 1 ? '' : 's'}: ${parsed.map((d) => threeTimes(d, zone).phoenix).join('; ')}`)
  if (lead.cmr?.jesseInputNeeded) await tellAboutLead([lead.business.headId], { type: 'LEAD_REVIEW', title: `Slots offered for ${lead.organization || lead.name}`, body: parsed.map((d) => threeTimes(d, zone).phoenix).join(' · '), leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/invite { link, minutes, at } — step 7: the calendar invite to the prospect, Jesse and the copy address; the flag clears; the reconfirm and outcome tasks are made. */
export async function sendInvite(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const set = settingsOf(lead.business), c = lead.cmr ?? CMR_DEFAULT
  const b = parse(z.object({ link: z.string().trim().max(1000).nullable().optional(), minutes: z.number().int().min(15).max(180).optional(), at: z.string().max(40).optional() }), req.body)
  const at = b.at ? new Date(b.at) : c.meetingAt
  if (!at || Number.isNaN(at.getTime())) throw new HttpError(422, 'Jesse has not approved a meeting time yet')
  if (!lead.email) throw new HttpError(422, 'Add the contact’s email address first')
  if (b.link && !/^https?:\/\//i.test(b.link)) throw new HttpError(422, 'The Teams link must start with https://')
  const [sdr, head] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: m.id }, select: { name: true, email: true } }), lead.business.headId ? prisma.user.findUnique({ where: { id: lead.business.headId }, select: { name: true, email: true } }) : null])
  const zone = zoneOfState(lead.state), company = lead.organization || lead.name
  const r = await sendMeetingInvite({ leadId: lead.id, business: lead.business.name, company, contact: lead.name || null, prospectEmail: lead.email, prospectZone: zone, at, minutes: b.minutes ?? 30, link: b.link ?? c.meetingLink, sdr, head, copy: set.copyEmail ? { name: set.copyName || 'Aaqib', email: set.copyEmail } : null })
  const now = new Date()
  const dayBefore = DateTime.fromJSDate(at, { zone: PHOENIX }).minus({ days: 1 })
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { nextStep: 'Meeting', nextStepDate: DateTime.fromJSDate(at, { zone: PHOENIX }).startOf('day').toJSDate(), owner: 'REP', lastActivityAt: now, cmr: { upsert: { create: { meetingAt: at, meetingTz: zone, meetingLink: b.link ?? null, inviteSentAt: now }, update: { meetingAt: at, meetingTz: zone, meetingLink: b.link ?? c.meetingLink, inviteSentAt: now, jesseInputNeeded: false } } } }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'MEETING', `Invite sent to ${r.to.join(', ')} · ${r.times.line}`)
  await closeTasks(lead.id, ['SEND_INVITE', 'NEXT_STEP'], m.id, 'invite sent')
  await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: saved.assigneeId ?? m.id, kind: 'RECONFIRM', title: `Reconfirm with ${company} and write the 3-line brief`, notes: r.times.line, dueAt: dayBefore < DateTime.fromJSDate(now) ? atPhoenix(DateTime.fromJSDate(now), 10) : atPhoenix(dayBefore, 10), actorId: m.id, notify: false })
  await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: saved.assigneeId ?? m.id, kind: 'OUTCOME', title: `Log the outcome of the ${company} meeting`, notes: 'Quote sent, shipment booked, nurture, or Closed Lost.', dueAt: atPhoenix(DateTime.fromJSDate(at, { zone: PHOENIX }).plus({ days: 2 }), 17), actorId: m.id, notify: false })
  res.json({ lead: leadOut(saved), sentTo: r.to, times: r.times })
}

/** POST /api/leads/:id/reconfirm { brief } — the day before: reconfirmed, and the 3-line brief for Jesse. */
export async function reconfirmMeeting(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const { brief } = parse(z.object({ brief: z.string().trim().min(10).max(2000) }), req.body)
  if (!lead.cmr?.meetingAt) throw new HttpError(422, 'There is no meeting to reconfirm')
  const now = new Date()
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: now, cmr: { update: { reconfirmedAt: now, meetingBrief: brief, jesseComment: `Brief: ${brief}` } } }, include: LEAD_INCLUDE })
  await prisma.leadComment.create({ data: { leadId: lead.id, userId: m.id, body: `Brief for the meeting:\n${brief}`, mentions: lead.business.headId ? [lead.business.headId] : [] } })
  await event(lead.id, m.id, 'MEETING', `Reconfirmed · brief: ${brief.slice(0, 300)}`)
  await closeTasks(lead.id, ['RECONFIRM'], m.id, 'reconfirmed')
  await tellAboutLead([lead.business.headId], { type: 'LEAD_COMMENT', title: `Brief for ${lead.organization || lead.name}`, body: brief.slice(0, 300), leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/outcome { outcome, note, nextStepDate } — within 2 days of the meeting. */
export async function meetingOutcome(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  await cmrOn(lead.business, m.companyId)
  const b = parse(z.object({ outcome: z.enum(MEETING_OUTCOMES), note: z.string().trim().max(2000).optional(), nextStepDate: z.string().max(10).nullable().optional() }), req.body)
  const now = new Date()
  const status = b.outcome === 'CLOSED_LOST' ? 'CLOSED_LOST' : b.outcome === 'SHIPMENT_BOOKED' ? 'CLOSED_WON' : 'FOLLOW_UP'
  const nextStep = b.outcome === 'QUOTE_SENT' ? 'Follow up on the quote' : b.outcome === 'NURTURE' ? 'Nurture: check in' : null
  const nextStepDate = nextStep ? (b.nextStepDate ? dateOrNull(b.nextStepDate)! : DateTime.fromJSDate(addBusinessDays(now, b.outcome === 'NURTURE' ? 20 : 3), { zone: PHOENIX }).startOf('day').toJSDate()) : null
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { status, owner: 'REP', nextStep, nextStepDate, ...(status === 'CLOSED_LOST' ? { lostReason: 'OTHER', lostNote: b.note ?? null } : {}), lastActivityAt: now, cmr: { upsert: { create: { meetingOutcome: b.outcome, meetingOutcomeAt: now }, update: { meetingOutcome: b.outcome, meetingOutcomeAt: now } } } }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'MEETING', `Outcome: ${b.outcome.toLowerCase().replace(/_/g, ' ')}${b.note ? ` · ${b.note.slice(0, 300)}` : ''}`)
  if (status !== lead.status) await event(lead.id, m.id, 'STATUS', '', { from: lead.status, to: status })
  await closeTasks(lead.id, ['OUTCOME', 'RECONFIRM'], m.id, b.outcome.toLowerCase())
  if (nextStep && nextStepDate) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: saved.assigneeId ?? m.id, kind: 'NEXT_STEP', title: nextStep, dueAt: atPhoenix(DateTime.fromJSDate(nextStepDate)), actorId: m.id, notify: false })
  await tellAboutLead([lead.business.headId], { type: 'LEAD_COMMENT', title: `${lead.organization || lead.name}: ${b.outcome.toLowerCase().replace(/_/g, ' ')}`, body: b.note ?? '', leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/close { status, reason, note } — a side exit: Not a Fit, Existing Customer (Jesse confirms), Referral Partner, Closed Lost / Won; GENERAL: Lost / Spam / Won. */
export async function closeLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  const b = parse(z.object({ status: z.string().max(40), reason: z.string().max(60).optional(), note: z.string().trim().max(2000).optional() }), req.body)
  const pipe = pipelineOf(lead.business)
  const target = pipe.find((x) => x.key === b.status)
  if (!target || target.open) throw new HttpError(422, 'Pick a closing status of this business')
  const cmr = isCmr(lead.business)
  if (cmr && b.reason && !(CLOSE_REASONS as readonly string[]).includes(b.reason)) throw new HttpError(422, 'Pick a close reason from the list')
  if ((b.status === 'CLOSED_WON' || b.status === 'WON') && !canManage(s, lead.businessId)) throw new HttpError(403, 'Only a manager marks a lead as won.')
  const now = new Date()
  // Existing Customer is Jesse's call: an SDR's mark goes to him as a flag.
  const needsHead = cmr && b.status === 'EXISTING_CUSTOMER' && !canDecide(s, lead.businessId)
  const company = lead.organization || lead.name
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: {
    status: b.status, lostReason: b.reason ?? null, lostNote: b.note ?? null, nextStep: needsHead ? 'Jesse to confirm existing customer' : null, nextStepDate: needsHead ? DateTime.fromJSDate(addBusinessDays(now, 1), { zone: PHOENIX }).startOf('day').toJSDate() : null, owner: needsHead ? 'HEAD' : 'REP', lastActivityAt: now,
    ...(cmr ? { cmr: { upsert: { create: { jesseInputNeeded: needsHead, jesseAsk: needsHead ? `Confirm ${company} is an existing customer` : null, flaggedAt: needsHead ? now : null }, update: needsHead ? { jesseInputNeeded: true, jesseAsk: `Confirm ${company} is an existing customer`, flaggedAt: now } : {} } } } : {}),
  }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'STATUS', `${(b.reason ?? '').toLowerCase().replace(/_/g, ' ')}${b.note ? ` · ${b.note.slice(0, 300)}` : ''}`.trim(), { from: lead.status, to: b.status })
  await prisma.leadTask.updateMany({ where: { leadId: lead.id, doneAt: null, kind: { notIn: ['HEAD_REVIEW'] } }, data: { doneAt: now, doneById: m.id, outcome: 'closed' } })
  if (needsHead) await tellAboutLead([lead.business.headId], { type: 'LEAD_REVIEW', title: `Confirm existing customer: ${company}`, body: b.note ?? '', leadId: lead.id, actorId: m.id })
  res.json({ lead: leadOut(saved) })
}

/** POST /api/leads/:id/reopen — back to the first open status after New (managers). */
export async function reopenLead(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  requireManager(s, lead.businessId, 'reopen a lead')
  const to = isCmr(lead.business) ? 'FOLLOW_UP' : 'CONTACTED'
  const saved = await prisma.lead.update({ where: { id: lead.id }, data: { status: to, lostReason: null, lostNote: null, owner: 'REP', lastActivityAt: new Date(), ...(lead.cmr ? { cmr: { update: { jesseInputNeeded: false } } } : {}) }, include: LEAD_INCLUDE })
  await event(lead.id, m.id, 'STATUS', 'Reopened', { from: lead.status, to })
  res.json({ lead: leadOut(saved) })
}

// ------------------------------------------------------------------ comments

/** POST /api/leads/:id/comments { body, mentions, callId, atSec } — comments (CMR: Jesse's comments and replies); @mentions notify. */
export async function addComment(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const lead = await fullLead(m, s, String(req.params.id))
  const b = parse(z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.string().max(60)).max(20).optional(), callId: z.string().max(60).nullable().optional(), atSec: z.number().int().min(0).max(86400).nullable().optional() }), req.body)
  if (b.callId && !(await prisma.leadCall.findFirst({ where: { id: b.callId, leadId: lead.id }, select: { id: true } }))) throw new HttpError(422, 'That call is not on this lead')
  const members = new Set((await prisma.leadBusinessMember.findMany({ where: { businessId: lead.businessId }, select: { userId: true } })).map((x) => x.userId))
  if (lead.business.headId) members.add(lead.business.headId)
  const people = await prisma.user.findMany({ where: { id: { in: [...members] } }, select: { id: true, name: true } })
  const mentions = [...new Set((b.mentions ?? []).filter((id) => members.has(id)))]
  const head = canDecide(s, lead.businessId) && !!lead.business.headId
  const c = await prisma.leadComment.create({ data: { leadId: lead.id, userId: m.id, body: b.body, mentions, callId: b.callId ?? null, atSec: b.atSec ?? null }, include: { user: PERSON } })
  const now = new Date()
  await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: now, ...(head && lead.cmr ? { cmr: { update: { jesseComment: b.body } } } : {}) } })
  await event(lead.id, m.id, 'COMMENT', b.body.slice(0, 300), { commentId: c.id, callId: b.callId ?? null, atSec: b.atSec ?? null })
  const inThread = new Set<string>([lead.assigneeId ?? '', lead.business.headId ?? '', ...(await prisma.leadComment.findMany({ where: { leadId: lead.id }, select: { userId: true }, distinct: ['userId'] })).map((x) => x.userId)].filter(Boolean))
  for (const id of mentions) inThread.delete(id)
  const company = lead.organization || lead.name
  await notifyMentions({ mentionIds: mentions, actorId: m.id, actorName: m.name, taskTitle: `${company}: ${b.body.slice(0, 60)}`, link: `/app/leads/${lead.id}#comments`, entityType: 'Lead', entityId: lead.id })
  await tellAboutLead([...inThread], { type: 'LEAD_COMMENT', title: `${m.name} on ${company}`, body: b.body.slice(0, 300), leadId: lead.id, link: `/app/leads/${lead.id}#comments`, actorId: m.id })
  if (head) for (const id of mentions) if (id !== m.id) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: id, kind: 'REPLY', title: `Reply to Jesse on ${company}`, notes: b.body.slice(0, 500), dueAt: atPhoenix(DateTime.fromJSDate(addBusinessDays(now, 1))), actorId: m.id, notify: false })
  res.status(201).json({ comment: { ...c, mentionNames: mentions.map((id) => people.find((p) => p.id === id)?.name ?? '') } })
}

// ------------------------------------------------------------------ Jesse Queue

/** GET /api/leads/queue?business= — flagged leads, oldest first, with the timer (reps see their own). */
export async function headQueue(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const { business } = parse(z.object({ business: z.string().max(60).optional() }), req.query)
  const where: Prisma.LeadWhereInput = { AND: [leadWhere(m, s), business ? { businessId: business } : { business: { kind: 'CMR' } }] }
  const rows = await prisma.lead.findMany({ where: { AND: [where, { cmr: { is: { jesseInputNeeded: true } } }] }, include: { ...LEAD_INCLUDE, calls: { orderBy: { at: 'desc' }, take: 1, include: { user: PERSON } }, comments: { orderBy: { createdAt: 'desc' }, take: 3, include: { user: PERSON } } }, orderBy: { cmr: { flaggedAt: 'asc' } } })
  const decided = await prisma.lead.findMany({ where: { AND: [where, { cmr: { is: { jesseDecidedAt: { gte: DateTime.now().minus({ days: 14 }).toJSDate() } } } }] }, include: LEAD_INCLUDE, orderBy: { cmr: { jesseDecidedAt: 'desc' } }, take: 20 })
  res.json({
    queue: rows.map((l) => { const { calls, comments, ...rest } = l; return { ...leadOut(rest), lastCall: calls[0] ? { ...calls[0], recordingUrl: calls[0].recordingUrl && calls[0].recordingKept ? `/api/leads/calls/${calls[0].id}/recording` : null } : null, comments } }),
    decided: decided.map((l) => leadOut(l)),
    canDecide: s.admin || (business ? s.headOf.includes(business) : s.headOf.length > 0),
  })
}

// ------------------------------------------------------------------ Agent Tasks

/** GET /api/leads/tasks?tab=today|overdue|upcoming|done|all&assignee=&business=&lead= — my tasks (managers: anyone's in their businesses). */
export async function listTasks(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(z.object({ tab: z.enum(['today', 'overdue', 'upcoming', 'done', 'all']).optional(), assignee: z.string().max(60).optional(), business: z.string().max(60).optional(), lead: z.string().max(60).optional() }), req.query)
  const start = DateTime.now().setZone(PHOENIX).startOf('day'), end = start.endOf('day')
  const and: Prisma.LeadTaskWhereInput[] = [s.admin ? {} : { OR: [{ assigneeId: m.id }, { businessId: { in: s.managerOf } }] }]
  if (q.assignee && q.assignee !== 'all') and.push({ assigneeId: q.assignee === 'me' ? m.id : q.assignee })
  if (q.business) and.push({ businessId: q.business })
  if (q.lead) and.push({ leadId: q.lead })
  const tab = q.tab ?? 'today'
  const tabWhere: Prisma.LeadTaskWhereInput = tab === 'today' ? { doneAt: null, dueAt: { gte: start.toJSDate(), lte: end.toJSDate() } } : tab === 'overdue' ? { doneAt: null, dueAt: { lt: start.toJSDate() } } : tab === 'upcoming' ? { doneAt: null, dueAt: { gt: end.toJSDate() } } : tab === 'done' ? { doneAt: { not: null } } : { doneAt: null }
  const base: Prisma.LeadTaskWhereInput = { AND: and }
  const [rows, today, overdueN, upcoming] = await Promise.all([
    prisma.leadTask.findMany({ where: { AND: [base, tabWhere] }, orderBy: tab === 'done' ? { doneAt: 'desc' } : { dueAt: 'asc' }, take: 300, include: { assignee: PERSON, lead: { select: { id: true, name: true, organization: true, phone: true, state: true, status: true, industry: true, assigneeId: true, business: { select: { id: true, name: true, kind: true, pipeline: true } } } } } }),
    prisma.leadTask.count({ where: { AND: [base, { doneAt: null, dueAt: { gte: start.toJSDate(), lte: end.toJSDate() } }] } }),
    prisma.leadTask.count({ where: { AND: [base, { doneAt: null, dueAt: { lt: start.toJSDate() } }] } }),
    prisma.leadTask.count({ where: { AND: [base, { doneAt: null, dueAt: { gt: end.toJSDate() } }] } }),
  ])
  res.json({ tasks: rows.map((t) => ({ ...t, lead: { ...t.lead, statusLabel: statusLabel(t.lead.business, t.lead.status), business: { id: t.lead.business.id, name: t.lead.business.name } }, overdue: !t.doneAt && t.dueAt.getTime() < start.toMillis(), today: !t.doneAt && t.dueAt.getTime() >= start.toMillis() && t.dueAt.getTime() <= end.toMillis() })), counts: { today, overdue: overdueN, upcoming } })
}

/** POST /api/leads/tasks { leadId, title, notes, dueAt, assigneeId, kind } — a task by hand. */
export async function addTask(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(z.object({ leadId: z.string().max(60), title: z.string().trim().min(1).max(200), notes: z.string().trim().max(2000).optional(), dueAt: z.string().max(40), assigneeId: z.string().max(60).nullable().optional(), kind: z.enum(['CALL', 'CUSTOM']).optional() }), req.body)
  const lead = await fullLead(m, s, b.leadId)
  const dueAt = new Date(b.dueAt)
  if (Number.isNaN(dueAt.getTime())) throw new HttpError(422, 'That date does not look right')
  let assigneeId = b.assigneeId === undefined ? lead.assigneeId ?? m.id : b.assigneeId
  if (assigneeId !== m.id && !canManage(s, lead.businessId)) assigneeId = m.id
  const t = await prisma.leadTask.create({ data: { leadId: lead.id, businessId: lead.businessId, assigneeId, kind: b.kind ?? 'CUSTOM', title: b.title, notes: b.notes ?? '', dueAt }, include: { assignee: PERSON, lead: { select: { id: true, name: true, organization: true } } } })
  await event(lead.id, m.id, 'TASK', `Task: ${b.title} · due ${DateTime.fromJSDate(dueAt, { zone: PHOENIX }).toFormat('d LLL, h:mm a')}`, { taskId: t.id })
  if (assigneeId && assigneeId !== m.id) await tellAboutLead([assigneeId], { type: 'LEAD_TASK', title: `New task: ${b.title}`, body: lead.organization || lead.name, leadId: lead.id, link: `/app/leads/tasks?task=${t.id}`, actorId: m.id })
  res.status(201).json({ task: t })
}

async function taskFor(m: LeadViewer, s: LeadScope, id: string) {
  const t = await prisma.leadTask.findFirst({ where: { id, ...(s.admin ? {} : { OR: [{ assigneeId: m.id }, { businessId: { in: s.managerOf } }] }) }, include: { lead: { select: { id: true, name: true, organization: true, assigneeId: true, businessId: true } } } })
  if (!t) throw new HttpError(404, 'Task not found')
  return t
}

/** PATCH /api/leads/tasks/:id { dueAt, notes, title, assigneeId } — "Schedule": move it. */
export async function updateTask(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const t = await taskFor(m, s, String(req.params.id))
  const b = parse(z.object({ dueAt: z.string().max(40).optional(), notes: z.string().trim().max(2000).optional(), title: z.string().trim().min(1).max(200).optional(), assigneeId: z.string().max(60).nullable().optional() }), req.body)
  const dueAt = b.dueAt ? new Date(b.dueAt) : undefined
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new HttpError(422, 'That date does not look right')
  if (b.assigneeId !== undefined) requireManager(s, t.lead.businessId, 'give a task to someone else')
  const saved = await prisma.leadTask.update({ where: { id: t.id }, data: { ...(dueAt ? { dueAt, remindedAt: null } : {}), ...(b.notes !== undefined ? { notes: b.notes } : {}), ...(b.title ? { title: b.title } : {}), ...(b.assigneeId !== undefined ? { assigneeId: b.assigneeId } : {}) }, include: { assignee: PERSON, lead: { select: { id: true, name: true, organization: true } } } })
  if (dueAt) {
    await event(t.leadId, m.id, 'TASK', `Moved "${t.title}" to ${DateTime.fromJSDate(dueAt, { zone: PHOENIX }).toFormat('d LLL, h:mm a')}`, { taskId: t.id })
    if (t.kind === 'NEXT_STEP' || t.kind === 'FOLLOW_UP') await prisma.lead.update({ where: { id: t.leadId }, data: { nextStepDate: DateTime.fromJSDate(dueAt, { zone: PHOENIX }).startOf('day').toJSDate() } })
  }
  res.json({ task: saved })
}

/** POST /api/leads/tasks/:id/complete { outcome, nextStep, nextStepDate } — "Complete": asks for the outcome and the next step. */
export async function completeTask(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const t = await taskFor(m, s, String(req.params.id))
  const b = parse(z.object({ outcome: z.string().trim().max(1000).optional(), nextStep: z.string().trim().max(300).nullable().optional(), nextStepDate: z.string().max(10).nullable().optional() }), req.body)
  if (t.doneAt) throw new HttpError(409, 'Already done')
  const now = new Date()
  await prisma.leadTask.update({ where: { id: t.id }, data: { doneAt: now, doneById: m.id, outcome: b.outcome ?? null } })
  await event(t.leadId, m.id, 'TASK', `Done: ${t.title}${b.outcome ? ` · ${b.outcome.slice(0, 300)}` : ''}`, { taskId: t.id })
  const data: Prisma.LeadUpdateInput = { lastActivityAt: now }
  if (b.nextStep !== undefined) data.nextStep = b.nextStep?.trim() || null
  if (b.nextStepDate !== undefined) data.nextStepDate = dateOrNull(b.nextStepDate)
  const lead = await prisma.lead.update({ where: { id: t.leadId }, data, include: LEAD_INCLUDE })
  if (b.nextStep && lead.nextStepDate) await makeTask({ leadId: lead.id, businessId: lead.businessId, assigneeId: lead.assigneeId ?? m.id, kind: 'NEXT_STEP', title: b.nextStep, dueAt: atPhoenix(DateTime.fromJSDate(lead.nextStepDate)), actorId: m.id, notify: false })
  else if (b.nextStep === null) await closeTasks(lead.id, ['NEXT_STEP'], m.id, 'cleared')
  res.json({ ok: true, lead: leadOut(lead) })
}

// ------------------------------------------------------------------ dashboard and Jesse Summary

function rangeOf(q: { range?: string; from?: string; to?: string }): { from: Date | null; to: Date | null; label: string } {
  const now = DateTime.now().setZone(PHOENIX)
  switch (q.range) {
    case 'week': return { from: now.startOf('week').toJSDate(), to: null, label: 'This week' }
    case 'month': return { from: now.startOf('month').toJSDate(), to: null, label: 'This month' }
    case 'last_month': return { from: now.minus({ months: 1 }).startOf('month').toJSDate(), to: now.minus({ months: 1 }).endOf('month').toJSDate(), label: 'Last month' }
    case 'custom': return { from: q.from ? DateTime.fromISO(q.from, { zone: PHOENIX }).startOf('day').toJSDate() : null, to: q.to ? DateTime.fromISO(q.to, { zone: PHOENIX }).endOf('day').toJSDate() : null, label: 'Custom' }
    default: return { from: null, to: null, label: 'All time' }
  }
}
const inRange = (r: { from: Date | null; to: Date | null }): Prisma.LeadWhereInput => (r.from || r.to ? { createdAt: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } } : {})

/** GET /api/leads/dashboard?business&range=all|week|month|last_month|custom — the cards. */
export async function dashboard(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(z.object({ business: z.string().max(60).optional(), range: z.string().max(20).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional() }), req.query)
  const r = rangeOf(q)
  const mine: Prisma.LeadWhereInput = { AND: [leadWhere(m, s), q.business ? { businessId: q.business } : {}] }
  const now = DateTime.now().setZone(PHOENIX)
  const startOfToday = now.startOf('day').toJSDate(), endOfToday = now.endOf('day').toJSDate()
  const c = (w: Prisma.LeadWhereInput) => prisma.lead.count({ where: { AND: [mine, inRange(r), w] } })
  const cAll = (w: Prisma.LeadWhereInput) => prisma.lead.count({ where: { AND: [mine, w] } })
  const taskWhere: Prisma.LeadTaskWhereInput = { AND: [s.admin ? {} : { OR: [{ assigneeId: m.id }, { businessId: { in: s.managerOf } }] }, q.business ? { businessId: q.business } : {}] }
  const callWhere: Prisma.LeadCallWhereInput = { AND: [s.admin ? {} : { OR: [{ userId: m.id }, { businessId: { in: s.managerOf } }] }, q.business ? { businessId: q.business } : {}, r.from || r.to ? { at: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } } : {}] }
  const [total, newThisWeek, recentlyUpdated, noStatus, assigned, unassigned, waiting, overdueN, prohibited, belowMin, tasksToday, tasksOverdue, byStatus, calls, late] = await Promise.all([
    c({}), cAll({ createdAt: { gte: now.startOf('week').toJSDate() } }), cAll({ updatedAt: { gte: now.minus({ hours: 48 }).toJSDate() } }), c({ status: 'NEW', callsCount: 0, firstContactAt: null }), c({ assigneeId: { not: null } }), cAll({ assigneeId: null, status: { in: OPEN_STATUSES } }),
    cAll({ cmr: { is: { jesseInputNeeded: true } } }), cAll({ status: { in: OPEN_STATUSES }, nextStepDate: { lt: startOfToday } }), cAll({ OR: [{ prohibited: true }, { existingCustomer: true }] }), cAll({ status: { in: OPEN_STATUSES }, cmr: { is: { lbsPerShipment: { gt: 0, lt: 2500 } } } }),
    prisma.leadTask.count({ where: { AND: [taskWhere, { doneAt: null, dueAt: { gte: startOfToday, lte: endOfToday } }] } }), prisma.leadTask.count({ where: { AND: [taskWhere, { doneAt: null, dueAt: { lt: startOfToday } }] } }),
    prisma.lead.groupBy({ by: ['status'], where: { AND: [mine, inRange(r)] }, _count: { _all: true } }),
    prisma.leadCall.count({ where: callWhere }),
    prisma.lead.findMany({ where: { AND: [mine, { status: 'NEW' }] }, select: { status: true, assigneeId: true, createdAt: true, assignedAt: true, firstContactAt: true, business: { select: { slaAssignMins: true, slaContactMins: true } } }, take: 5000 }),
  ])
  res.json({
    range: r.label,
    cards: { total, newThisWeek, recentlyUpdated, noStatus, assigned, unassigned, waiting, overdue: overdueN, prohibited, belowMin, calls, late: late.filter((l) => lateness(l, l.business)).length },
    tasks: { today: tasksToday, overdue: tasksOverdue, total: tasksToday + tasksOverdue },
    byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])),
  })
}

/** GET /api/leads/summary?business= — the sheet's Jesse Summary tab, live (managers of a CMR business). */
export async function headSummary(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const { business } = parse(z.object({ business: z.string().max(60).optional() }), req.query)
  const biz = business ? await bizFor(business) : await prisma.leadBusiness.findFirst({ where: { kind: 'CMR', isActive: true, ...(s.admin ? {} : { id: { in: s.managerOf } }) }, ...BIZ })
  if (!biz) throw new HttpError(404, 'No CMR business here yet. Make one under Lead Settings.')
  await cmrOn(biz, m.companyId)
  requireManager(s, biz.id, 'see the Jesse Summary')
  const w: Prisma.LeadWhereInput = { businessId: biz.id }
  const now = DateTime.now().setZone(PHOENIX)
  const startOfToday = now.startOf('day').toJSDate()
  const [total, waiting, qualified, overdueN, callsWeek, calls30, byStatus, callsBySdr, bySegment, flagged, meetingsMonth, decided, bySdr, members] = await Promise.all([
    prisma.lead.count({ where: w }), prisma.lead.count({ where: { ...w, cmr: { is: { jesseInputNeeded: true } } } }), prisma.lead.count({ where: { ...w, status: 'QUALIFIED' } }),
    prisma.lead.count({ where: { ...w, status: { in: OPEN_STATUSES }, nextStepDate: { lt: startOfToday } } }),
    prisma.leadCall.count({ where: { businessId: biz.id, at: { gte: now.startOf('week').toJSDate() } } }), prisma.leadCall.count({ where: { businessId: biz.id, at: { gte: now.minus({ days: 30 }).toJSDate() } } }),
    prisma.lead.groupBy({ by: ['status'], where: w, _count: { _all: true } }),
    prisma.leadCall.groupBy({ by: ['userId'], where: { businessId: biz.id, at: { gte: now.minus({ days: 30 }).toJSDate() } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['industry'], where: w, _count: { _all: true } }),
    prisma.leadCmr.findMany({ where: { jesseInputNeeded: true, lead: w }, select: { flaggedAt: true } }),
    prisma.leadCmr.count({ where: { lead: w, inviteSentAt: { gte: now.startOf('month').toJSDate() } } }),
    prisma.leadCmr.findMany({ where: { lead: w, jesseDecidedAt: { not: null }, flaggedAt: { not: null } }, select: { flaggedAt: true, jesseDecidedAt: true }, orderBy: { jesseDecidedAt: 'desc' }, take: 50 }),
    prisma.lead.groupBy({ by: ['assigneeId', 'status'], where: w, _count: { _all: true } }),
    prisma.leadBusinessMember.findMany({ where: { businessId: biz.id }, select: { user: { select: { id: true, name: true } } } }),
  ])
  const ids = [...new Set([...callsBySdr.map((x) => x.userId), ...bySdr.map((x) => x.assigneeId)].filter((x): x is string => !!x && !members.some((mm) => mm.user.id === x)))]
  const others = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const name = (id: string | null) => members.find((x) => x.user.id === id)?.user.name ?? others.find((x) => x.id === id)?.name ?? (id ? 'Former member' : 'Unassigned')
  const avgWait = flagged.length ? flagged.reduce((a, l) => a + businessDaysBetween(l.flaggedAt!, new Date()), 0) / flagged.length : 0
  const avgDecide = decided.length ? decided.reduce((a, l) => a + businessDaysBetween(l.flaggedAt!, l.jesseDecidedAt!), 0) / decided.length : 0
  const sdrIds = [...new Set(bySdr.map((x) => x.assigneeId))]
  res.json({
    business: { id: biz.id, name: biz.name },
    keyNumbers: { total, waiting, qualified, overdue: overdueN, callsWeek, calls30, avgWaitDays: Math.round(avgWait * 10) / 10, avgDecideDays: Math.round(avgDecide * 10) / 10, meetingsMonth },
    pipeline: pipelineOf(biz).map((st) => ({ status: st.key, label: st.label, color: st.color, count: byStatus.find((x) => x.status === st.key)?._count._all ?? 0 })),
    callsBySdr: callsBySdr.map((x) => ({ userId: x.userId, name: name(x.userId), calls: x._count._all })).sort((a, b) => b.calls - a.calls),
    bySegment: bySegment.map((x) => ({ segment: x.industry ?? 'Not set', count: x._count._all })).sort((a, b) => b.count - a.count),
    qualifyRate: sdrIds.map((id) => { const rows = bySdr.filter((x) => x.assigneeId === id); const all = rows.reduce((a, x) => a + x._count._all, 0); const q = rows.filter((x) => ['QUALIFIED', 'CLOSED_WON'].includes(x.status)).reduce((a, x) => a + x._count._all, 0); return { userId: id, name: name(id), leads: all, qualified: q, rate: all ? Math.round((q / all) * 100) : 0 } }).sort((a, b) => b.leads - a.leads),
  })
}

// ------------------------------------------------------------------ the daily report

async function countDay(businessId: string, userId: string, date: string, connectedSecs: number) {
  const zone = companyTz()
  const from = DateTime.fromISO(date, { zone }).startOf('day').toJSDate(), to = DateTime.fromISO(date, { zone }).endOf('day').toJSDate()
  const [calls, emails, interested] = await Promise.all([
    prisma.leadCall.findMany({ where: { businessId, userId, at: { gte: from, lte: to } }, select: { disposition: true, durationSec: true } }),
    prisma.leadEvent.count({ where: { userId, kind: 'EMAIL', createdAt: { gte: from, lte: to }, lead: { businessId } } }),
    prisma.leadEvent.findMany({ where: { userId, kind: 'STATUS', createdAt: { gte: from, lte: to }, lead: { businessId } }, select: { data: true, leadId: true } }),
  ])
  const interestedLeads = new Set(interested.filter((e) => ['INFO_SENT', 'FOLLOW_UP', 'QUALIFIED', 'CONTACTED'].includes((e.data as { to?: string } | null)?.to ?? '')).map((e) => e.leadId))
  return {
    dials: calls.length,
    connected: calls.filter((c) => c.disposition === 'CONNECTED' && c.durationSec >= connectedSecs).length,
    voicemails: calls.filter((c) => c.disposition === 'VOICEMAIL').length,
    emails,
    interested: interestedLeads.size,
    shortConnected: calls.filter((c) => c.disposition === 'CONNECTED' && c.durationSec < connectedSecs).length,
  }
}
async function reportBiz(s: LeadScope, business: string | undefined, me: LeadViewer): Promise<Biz> {
  const biz = business ? await bizFor(business) : await prisma.leadBusiness.findFirst({ where: { kind: 'CMR', isActive: true, ...(s.admin ? {} : { id: { in: [...s.roles.keys()] } }) }, ...BIZ })
  if (!biz) throw new HttpError(404, 'No CMR business here yet.')
  await cmrOn(biz, me.companyId)
  if (!isMemberOf(s, biz.id)) throw new HttpError(403, 'You do not work leads for that business.')
  return biz
}

/** GET /api/leads/report?business&date= — my day, counted from the calls, and what I submitted. */
export async function myReport(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(z.object({ business: z.string().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query)
  const biz = await reportBiz(s, q.business, m)
  const set = settingsOf(biz)
  const d = q.date ?? DateTime.now().setZone(companyTz()).toISODate()!
  const [counted, saved] = await Promise.all([countDay(biz.id, m.id, d, set.connectedSecs), prisma.leadDailyReport.findUnique({ where: { businessId_userId_date: { businessId: biz.id, userId: m.id, date: DateTime.fromISO(d, { zone: 'utc' }).toJSDate() } } })])
  res.json({ business: { id: biz.id, name: biz.name }, date: d, counted, report: saved, connectedSecs: set.connectedSecs })
}

/** POST /api/leads/report { business, date, dials, connected, voicemails, emails, interested, note } — submit (re-submitting updates). */
export async function submitReport(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(z.object({ business: z.string().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dials: z.number().int().min(0).max(5000), connected: z.number().int().min(0).max(5000), voicemails: z.number().int().min(0).max(5000), emails: z.number().int().min(0).max(5000), interested: z.number().int().min(0).max(5000), note: z.string().trim().max(2000).optional() }), req.body)
  const biz = await reportBiz(s, b.business, m)
  const counted = await countDay(biz.id, m.id, b.date, settingsOf(biz).connectedSecs)
  const date = DateTime.fromISO(b.date, { zone: 'utc' }).toJSDate()
  const data = { dials: b.dials, connected: b.connected, voicemails: b.voicemails, emails: b.emails, interested: b.interested, note: b.note ?? '', counted, submittedAt: new Date() }
  const r = await prisma.leadDailyReport.upsert({ where: { businessId_userId_date: { businessId: biz.id, userId: m.id, date } }, create: { businessId: biz.id, userId: m.id, date, ...data }, update: data })
  res.json({ report: r })
}

/** GET /api/leads/report/team?business&date= — every rep's day and the team lead's review list (managers). */
export async function teamReport(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const q = parse(z.object({ business: z.string().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query)
  const biz = await reportBiz(s, q.business, m)
  requireManager(s, biz.id, 'see the team report')
  const set = settingsOf(biz)
  const d = q.date ?? DateTime.now().setZone(companyTz()).toISODate()!
  const people = await prisma.leadBusinessMember.findMany({ where: { businessId: biz.id, user: { isActive: true } }, select: { role: true, user: { select: { id: true, name: true } } }, orderBy: { user: { name: 'asc' } } })
  const saved = await prisma.leadDailyReport.findMany({ where: { businessId: biz.id, date: DateTime.fromISO(d, { zone: 'utc' }).toJSDate() } })
  const rows = await Promise.all(people.filter((p) => p.role !== 'MANAGER').map(async (p) => ({ sdr: p.user, counted: await countDay(biz.id, p.user.id, d, set.connectedSecs), report: saved.find((r) => r.userId === p.user.id) ?? null })))
  const startOfToday = startOfTodayPhx()
  const zone = companyTz()
  const from = DateTime.fromISO(d, { zone }).startOf('day').toJSDate(), to = DateTime.fromISO(d, { zone }).endOf('day').toJSDate()
  const w = { businessId: biz.id }
  const [toApprove, overdueLeads, noSummary, shortConnected, outcomeDue] = await Promise.all([
    prisma.lead.findMany({ where: { ...w, cmr: { is: { qualifyRequestedAt: { not: null }, jesseInputNeeded: false } } }, include: LEAD_INCLUDE, orderBy: { cmr: { qualifyRequestedAt: 'asc' } } }),
    prisma.lead.findMany({ where: { ...w, status: { in: OPEN_STATUSES }, nextStepDate: { lt: startOfToday } }, include: LEAD_INCLUDE, orderBy: { nextStepDate: 'asc' }, take: 100 }),
    prisma.leadCall.findMany({ where: { ...w, at: { gte: from, lte: to }, disposition: 'CONNECTED', summary: '' }, include: { user: PERSON, lead: { select: { id: true, name: true, organization: true } } } }),
    prisma.leadCall.findMany({ where: { ...w, at: { gte: from, lte: to }, disposition: 'CONNECTED', durationSec: { lt: set.connectedSecs } }, include: { user: PERSON, lead: { select: { id: true, name: true, organization: true } } } }),
    prisma.lead.findMany({ where: { ...w, cmr: { is: { meetingAt: { lt: new Date() }, meetingOutcome: null, inviteSentAt: { not: null } } } }, include: LEAD_INCLUDE, orderBy: { cmr: { meetingAt: 'asc' } } }),
  ])
  res.json({ business: { id: biz.id, name: biz.name }, date: d, rows, review: { toApprove: toApprove.map((l) => leadOut(l)), overdue: overdueLeads.map((l) => leadOut(l)), noSummary, shortConnected, outcomeDue: outcomeDue.map((l) => leadOut(l)) } })
}

// ------------------------------------------------------------------ lists and the sheet import

/** GET /api/leads/businesses/:id/lists?kind=PROHIBITED|CUSTOMER */
export async function listEntries(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  const id = String(req.params.id)
  const { kind } = parse(z.object({ kind: z.enum(['PROHIBITED', 'CUSTOMER']) }), req.query)
  if (!isMemberOf(s, id)) throw new HttpError(403, 'You do not work leads for that business.')
  res.json({ entries: await prisma.leadListEntry.findMany({ where: { businessId: id, kind }, orderBy: { name: 'asc' } }) })
}

/** POST /api/leads/businesses/:id/lists { kind, entries } — add rows (typed or from a CSV); the same name is not added twice. */
export async function addEntries(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  const id = String(req.params.id)
  requireManager(s, id, 'change the lists')
  const b = parse(z.object({ kind: z.enum(['PROHIBITED', 'CUSTOMER']), entries: z.array(z.object({ name: z.string().trim().min(1).max(200), phone: z.string().max(50).nullable().optional(), email: z.string().max(254).nullable().optional(), website: z.string().max(300).nullable().optional(), note: z.string().max(500).nullable().optional() })).min(1).max(5000) }), req.body)
  const have = new Set((await prisma.leadListEntry.findMany({ where: { businessId: id, kind: b.kind }, select: { nameKey: true } })).map((x) => x.nameKey))
  let added = 0, already = 0
  for (const e of b.entries) {
    const key = orgKey(e.name) ?? e.name.toLowerCase()
    if (have.has(key)) { already++; continue }
    have.add(key)
    await prisma.leadListEntry.create({ data: { businessId: id, kind: b.kind, name: e.name.trim(), nameKey: key, phone: normalizePhone(e.phone).e164, email: emailKey(e.email), website: websiteKey(e.website), note: e.note?.trim() || null } })
    added++
  }
  res.status(201).json({ added, already, flagged: await reflagLeads(id) })
}

/** DELETE /api/leads/businesses/:id/lists/:entryId */
export async function removeEntry(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  const id = String(req.params.id)
  requireManager(s, id, 'change the lists')
  await prisma.leadListEntry.deleteMany({ where: { id: String(req.params.entryId), businessId: id } })
  await reflagLeads(id)
  res.json({ ok: true })
}

/** The sheet's columns (A–V) and the fields they land in; the import matches headers by these words. */
export const SHEET_COLUMNS: { field: string; label: string; match: RegExp }[] = [
  { field: 'date', label: 'Date', match: /^date$/i },
  { field: 'sdr', label: 'SDR', match: /^(sdr|assigned ?to|agent|owner name)$/i },
  { field: 'organization', label: 'Company', match: /^company( name)?$/i },
  { field: 'industry', label: 'Segment', match: /^(segment|industry)$/i },
  { field: 'state', label: 'State', match: /^state$/i },
  { field: 'name', label: 'Contact', match: /^(contact( name)?|name|lead)$/i },
  { field: 'contactRole', label: 'Role', match: /^(role|title|job title)$/i },
  { field: 'decisionMaker', label: 'Decision Maker', match: /^decision ?maker/i },
  { field: 'phone', label: 'Phone', match: /^phone/i },
  { field: 'email', label: 'Email', match: /^e-?mail$/i },
  { field: 'website', label: 'Website', match: /^(website|url|site)$/i },
  { field: 'handlesAlkaline', label: 'Handles Alkaline', match: /alkaline/i },
  { field: 'lbsPerMonth', label: 'Est. Volume (lbs/month)', match: /volume|lbs/i },
  { field: 'currentVendor', label: 'Current Vendor', match: /vendor/i },
  { field: 'paysToday', label: 'Pays Today', match: /pays/i },
  { field: 'status', label: 'Status', match: /^status$/i },
  { field: 'summary', label: 'Call Summary', match: /summary|^notes?$/i },
  { field: 'nextStep', label: 'Next Step', match: /^next step$/i },
  { field: 'nextStepDate', label: 'Next Step Date', match: /^next step date$/i },
  { field: 'owner', label: 'Owner', match: /^owner$/i },
  { field: 'jesseInputNeeded', label: 'Jesse Input Needed', match: /jesse input/i },
  { field: 'jesseComment', label: 'Jesse Comment', match: /jesse comment/i },
  { field: 'city', label: 'City', match: /^city$/i },
  { field: 'tags', label: 'Tags', match: /^tags?$/i },
]

/** The first number in a sheet cell: "1,500-2,000 (growing)" → 1500, "$2.00 per lb" → 2, "Unknown" → null. */
const num = (v: string): number | null => { const m = String(v).match(/\d[\d,]*(?:\.\d+)?/); const n = m ? Number(m[0].replace(/,/g, '')) : NaN; return Number.isFinite(n) ? n : null }
/** "Pays Today" as the sheet writes it: a fee per lb or drum, or nothing at all. */
const paysOf = (v: string): { paysToday: number | null; paysUnit: string } => {
  const t = v.trim()
  if (/^(nothing|none|no charge|free)\b/i.test(t) || /^\$?0(\.0+)?$/.test(t)) return { paysToday: 0, paysUnit: 'NONE' }
  const n = num(t)
  return n == null ? { paysToday: null, paysUnit: 'UNKNOWN' } : { paysToday: n, paysUnit: /drum/i.test(t) ? 'DRUM' : 'LB' }
}
/** The first email in a cell that may hold two, or a note ("info@x.com (verify)"). */
const firstEmail = (v: string): string => v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ''
/** The first phone number in a cell like "888-694-4978 / 972-427-7770". */
const firstPhone = (v: string): string => v.split(/\s*(?:\/|;|,|\bor\b|\n)\s*/).map((x) => x.trim()).find((x) => x.replace(/\D/g, '').length >= 7) ?? v.trim()
const dateOf = (v: string): Date | null => {
  const t = v.trim()
  if (!t) return null
  const iso = DateTime.fromISO(t, { zone: PHOENIX })
  if (iso.isValid) return iso.toJSDate()
  for (const f of ['M/d/yyyy', 'M/d/yy', 'd-MMM-yyyy', 'MMM d, yyyy', 'd MMM yyyy', 'yyyy/M/d']) { const d = DateTime.fromFormat(t, f, { zone: PHOENIX }); if (d.isValid) return d.toJSDate() }
  const js = new Date(t)
  return Number.isNaN(js.getTime()) ? null : js
}

const sheetSchema = z.object({
  businessId: z.string().min(1).max(60),
  fileName: z.string().max(300).optional(),
  headers: z.array(z.string().max(200)).min(1).max(100),
  /** field → header text (or null). Missing fields are matched by name. */
  mapping: z.record(z.string(), z.string().max(200).nullable()).optional(),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(20000),
  source: z.enum(['SHEET', 'LEADWISE']).optional(),
})

/** POST /api/leads/import-sheet — the CMR_Lead_Tracker sheet (or LeadWise's export): one lead per company, each row a call under it. */
export async function importSheet(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(sheetSchema, req.body)
  requireManager(s, b.businessId, 'import a sheet')
  const biz = await bizFor(b.businessId)
  const cmr = isCmr(biz), set = settingsOf(biz)
  const col: Record<string, number> = {}
  for (const c of SHEET_COLUMNS) {
    const mapped = b.mapping?.[c.field]
    col[c.field] = mapped ? b.headers.indexOf(mapped) : mapped === null ? -1 : b.headers.findIndex((h) => c.match.test(h.trim()))
  }
  if (col.organization < 0 && col.name < 0) throw new HttpError(422, 'Pick the Company (or Contact) column')
  const cell = (row: (string | number | null)[], f: string) => (col[f] < 0 ? '' : String(row[col[f]] ?? '').trim())
  const people = (await prisma.leadBusinessMember.findMany({ where: { businessId: biz.id }, select: { user: { select: { id: true, name: true } } } })).map((x) => x.user)
  const byName = (n: string) => people.find((p) => p.name.toLowerCase() === n.toLowerCase() || p.name.toLowerCase().split(' ')[0] === n.toLowerCase())?.id ?? null
  let companies = 0, calls = 0, skipped = 0
  const problems: string[] = []
  const seen = new Map<string, string>()
  const sorted = b.rows.map((r, i) => ({ r, i, d: dateOf(cell(r, 'date')) })).sort((a, c) => (a.d?.getTime() ?? 0) - (c.d?.getTime() ?? 0))
  for (const { r, i } of sorted) {
    const organization = cell(r, 'organization') || null
    // Some rows put the phone number in the Contact column: keep it as the phone, not as a name.
    const nameCell = cell(r, 'name'), nameIsPhone = /^[\d\s()+.-]{7,}$/.test(nameCell)
    const name = nameIsPhone ? '' : nameCell
    if (!organization && !name) { skipped++; continue }
    const key = orgKey(organization) ?? `contact:${name.toLowerCase()}`
    const sdrName = cell(r, 'sdr')
    const assigneeId = sdrName ? byName(sdrName) : null
    if (sdrName && !assigneeId && !problems.some((p) => p.includes(`"${sdrName}"`))) problems.push(`Row ${i + 2}: "${sdrName}" is not in this business (left unassigned)`)
    const statusText = cell(r, 'status')
    const status = statusText ? statusFromText(biz, statusText) : null
    if (statusText && !status) problems.push(`Row ${i + 2}: status "${statusText}" is not one of ${biz.name}'s; left as New`)
    const industry = cell(r, 'industry') || null
    if (cmr && industry && !set.segments.some((x) => x.toLowerCase() === industry.toLowerCase())) problems.push(`Row ${i + 2}: segment "${industry}" is not in the Segment list (kept as typed)`)
    const phone = normalizePhone(firstPhone(cell(r, 'phone') || (nameIsPhone ? nameCell : '')))
    const email = emailKey(firstEmail(cell(r, 'email')))
    const owner = /jesse/i.test(cell(r, 'owner')) ? 'HEAD' : /aaqib/i.test(cell(r, 'owner')) ? 'COPY' : 'REP'
    const when = dateOf(cell(r, 'date')) ?? new Date()
    const nextStepDate = dateOf(cell(r, 'nextStepDate'))
    const open = status ? openStatusesOf(biz).includes(status) : true
    const leadData: Prisma.LeadUncheckedCreateInput = {
      businessId: biz.id, source: 'IMPORT', sourceDetail: b.fileName ?? 'sheet', name: name || '', organization, orgKey: orgKey(organization), industry, state: cell(r, 'state') || null, city: cell(r, 'city') || null,
      phone: phone.phone, phoneE164: phone.e164, email: email && emailOk(email) ? email : null, website: cell(r, 'website') || null, websiteKey: websiteKey(cell(r, 'website')), tags: cell(r, 'tags') ? cell(r, 'tags').split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [],
      status: status ?? 'NEW', nextStep: open ? cell(r, 'nextStep') || null : null, nextStepDate: open ? nextStepDate : null, owner, assigneeId, assignedAt: assigneeId ? when : null, createdById: m.id, lastActivityAt: when, lastCallAt: when, firstCallAt: when, firstContactAt: when, createdAt: when,
    }
    const cmrData: Prisma.LeadCmrCreateWithoutLeadInput = cmr ? {
      contactRole: cell(r, 'contactRole') || null, decisionMaker: cell(r, 'decisionMaker') ? yesNoFromText(cell(r, 'decisionMaker')) : 'UNKNOWN', handlesAlkaline: cell(r, 'handlesAlkaline') ? yesNoFromText(cell(r, 'handlesAlkaline')) : 'UNKNOWN',
      // "Decision Maker = Yes" with a named contact: that contact is the decision maker (the fourth fact).
      decisionMakerName: yesNoFromText(cell(r, 'decisionMaker')) === 'YES' && name ? name : null,
      // What Jesse is asked: the row's next step when his input is needed (the sheet has no separate column).
      jesseAsk: /^y/i.test(cell(r, 'jesseInputNeeded')) ? cell(r, 'nextStep') || null : null,
      lbsPerMonth: num(cell(r, 'lbsPerMonth')), currentVendor: cell(r, 'currentVendor') || null, ...paysOf(cell(r, 'paysToday')),
      jesseInputNeeded: /^y/i.test(cell(r, 'jesseInputNeeded')), jesseComment: cell(r, 'jesseComment') || null, flaggedAt: /^y/i.test(cell(r, 'jesseInputNeeded')) ? when : null, qualifiedAt: status === 'QUALIFIED' ? when : null,
    } : {}
    const existingId = seen.get(key) ?? (organization ? (await prisma.lead.findFirst({ where: { businessId: biz.id, orgKey: key }, select: { id: true } }))?.id : undefined)
    let leadId: string
    if (existingId) {
      // A later row for the same company: the latest facts win, the call is added under it.
      const { createdAt: _c, firstCallAt: _f, firstContactAt: _fc, source: _s, sourceDetail: _sd, createdById: _b, businessId: _bz, ...upd } = leadData
      const clean = Object.fromEntries(Object.entries(upd).filter(([, v]) => v !== null && v !== '' && v !== 'NEW' && !(Array.isArray(v) && !v.length))) as Prisma.LeadUncheckedUpdateInput
      if (status) clean.status = status
      const cmrClean = Object.fromEntries(Object.entries(cmrData).filter(([, v]) => v !== null && v !== 'UNKNOWN' && v !== false)) as Prisma.LeadCmrUncheckedUpdateInput
      await prisma.lead.update({ where: { id: existingId }, data: { ...clean, lastActivityAt: new Date(), ...(cmr ? { cmr: { upsert: { create: cmrData, update: cmrClean } } } : {}) } })
      leadId = existingId
    } else {
      const lists = await listMatches(biz.id, { orgKey: leadData.orgKey ?? null, phoneE164: phone.e164, email: leadData.email ?? null, websiteKey: leadData.websiteKey ?? null })
      const lead = await prisma.lead.create({ data: { ...leadData, prohibited: lists.prohibited, existingCustomer: lists.existingCustomer, ...(cmr ? { cmr: { create: cmrData } } : {}) }, select: { id: true } })
      leadId = lead.id
      companies++
      await event(leadId, m.id, 'IMPORT', `Imported from ${b.fileName ?? 'the sheet'} (row ${i + 2})`)
    }
    seen.set(key, leadId)
    const summary = cell(r, 'summary')
    if (summary || cell(r, 'date')) {
      await prisma.leadCall.create({ data: { leadId, businessId: biz.id, userId: assigneeId, at: when, disposition: 'CONNECTED', summary } })
      await prisma.lead.update({ where: { id: leadId }, data: { callsCount: { increment: 1 }, lastCallAt: when } })
      calls++
    }
    if (cmr && cmrData.jesseComment) await prisma.leadComment.create({ data: { leadId, userId: biz.headId ?? m.id, body: cmrData.jesseComment, createdAt: when } })
    if (leadData.nextStep && nextStepDate && open) await makeTask({ leadId, businessId: biz.id, assigneeId, kind: 'NEXT_STEP', title: leadData.nextStep, dueAt: atPhoenix(DateTime.fromJSDate(nextStepDate)), actorId: m.id, notify: false })
  }
  const total = await prisma.lead.count({ where: { businessId: biz.id } })
  res.json({ companies, calls, skipped, problems: problems.slice(0, 50), totalCompanies: total })
}

/** GET /api/leads/import-sheet/columns — the sheet's columns, for the mapping screen. */
export async function sheetColumns(_req: AuthedRequest, res: Response): Promise<void> {
  res.json({ columns: SHEET_COLUMNS.map((c) => ({ field: c.field, label: c.label })) })
}
