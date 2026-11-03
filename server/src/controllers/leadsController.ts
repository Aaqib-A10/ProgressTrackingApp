import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse } from '../lib/pm/http'
import { isOn } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import { canManage, leadScope, requireLeadAdmin, type LeadScope, type LeadViewer } from '../lib/leads/access'
import { cleanInput, fromFields, hasSubstance, OPEN_STATUSES, receiveLead, type LeadInput } from '../lib/leads/intake'
import { KINDS, PROMISE_WORDS, pipelineOf, settingsOf, type CmrSettings } from '../lib/leads/pipeline'
import { leadManagers, tellAboutLead } from '../lib/leads/notify'
import { encryptSecret, decryptSecret, testInbox } from '../lib/leads/inbox'

/**
 * Lead Management (/api/leads), the setup part: importing a sheet of plain leads, and (Super
 * Admin) the businesses that receive leads, their people, kind, pipeline, head and settings,
 * form link and inbox. The public website form is leadIn below. The working part (lists, one
 * lead, calls, tasks, the CMR flow): leadsWorkController.ts.
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

const settingsSchema = z.object({
  copyEmail: z.string().trim().max(254),
  copyName: z.string().trim().max(100),
  consentStates: z.array(z.string().trim().min(2).max(10)).max(60),
  segments: z.array(z.string().trim().min(1).max(80)).min(1).max(60),
  states: z.array(z.string().trim().min(2).max(20)).min(1).max(70),
  infoSubject: z.string().trim().min(1).max(200),
  infoBody: z.string().trim().min(1).max(20000),
  publishedRate: z.number().min(0).max(100),
  minLoadLbs: z.number().int().min(0).max(1e7),
  connectedSecs: z.number().int().min(0).max(600),
}).partial().strict()
const bizSchema = z.object({
  name: z.string().trim().min(1).max(120),
  website: z.string().trim().max(300).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  slaAssignMins: z.number().int().min(0).max(10080).optional(),
  slaContactMins: z.number().int().min(0).max(10080).optional(),
  /** GENERAL or CMR (the CMR flow; needs the "cmr" switch). */
  kind: z.enum(KINDS as [string, ...string[]]).optional(),
  /** The head (CMR: Jesse). */
  headId: z.string().max(60).nullable().optional(),
  /** The business's own statuses; null = the ones its kind comes with. */
  pipeline: z.array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/), label: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), open: z.boolean() })).min(2).max(20).nullable().optional(),
  settings: settingsSchema.optional(),
})

async function checkBiz(b: Partial<z.infer<typeof bizSchema>>, companyId: string, cur?: { settings: Prisma.JsonValue; kind: string }): Promise<{ settings?: Prisma.InputJsonValue }> {
  if (b.kind === 'CMR' && !(await isOn('cmr', companyId))) throw new HttpError(403, 'The CMR flow is not switched on for your company (owner console, Switches).')
  if (b.headId) {
    const u = await prisma.user.findFirst({ where: { id: b.headId, isActive: true }, select: { id: true } })
    if (!u) throw new HttpError(422, 'That person was not found')
  }
  if (b.pipeline) {
    if (!b.pipeline.some((x) => x.key === 'NEW')) throw new HttpError(422, 'The pipeline needs a NEW status (where leads start)')
    if (new Set(b.pipeline.map((x) => x.key)).size !== b.pipeline.length) throw new HttpError(422, 'Two statuses have the same key')
    if (!b.pipeline.some((x) => x.open) || !b.pipeline.some((x) => !x.open)) throw new HttpError(422, 'The pipeline needs at least one open and one closed status')
  }
  if (!b.settings) return {}
  const merged: CmrSettings = { ...settingsOf({ settings: cur?.settings ?? null }), ...b.settings }
  if (merged.copyEmail && !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(merged.copyEmail)) throw new HttpError(422, 'That copy email address does not look right')
  if (b.settings.infoBody && PROMISE_WORDS.test(b.settings.infoBody.replace(/\{\{rate\}\}/g, ''))) throw new HttpError(422, 'The email text reads like a price, freight or pickup promise beyond the published rate ({{rate}}). Jesse gives those.')
  return { settings: merged as unknown as Prisma.InputJsonValue }
}

function bizOut(b: Prisma.LeadBusinessGetPayload<{ include: { members: { include: { user: { select: { id: true; name: true; email: true; isActive: true } } } }; head: { select: { id: true; name: true; email: true } } } }> & { _open?: number }) {
  const { inboxPassEnc, members, settings: _s, ...rest } = b
  return { ...rest, settings: settingsOf(b), pipeline: pipelineOf(b), ownPipeline: !!b.pipeline, inboxHasPassword: !!inboxPassEnc, formUrl: formUrl(b.formKey), members: members.map((x) => ({ id: x.user.id, name: x.user.name, email: x.user.email, isActive: x.user.isActive, role: x.role })) }
}
const BIZ_INCLUDE = { members: { include: { user: { select: { id: true, name: true, email: true, isActive: true } } }, orderBy: { createdAt: 'asc' as const } }, head: { select: { id: true, name: true, email: true } } }

/** GET /api/leads/businesses — every business with its people, form link and inbox (Super Admin). */
export async function listBusinesses(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const list = await prisma.leadBusiness.findMany({ include: BIZ_INCLUDE, orderBy: { name: 'asc' } })
  const open = await prisma.lead.groupBy({ by: ['businessId'], where: { status: { in: OPEN_STATUSES } }, _count: { _all: true } })
  const people = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true, department: { select: { name: true, type: true } } }, orderBy: { name: 'asc' } })
  res.json({
    businesses: list.map((b) => ({ ...bizOut(b), openLeads: open.find((o) => o.businessId === b.id)?._count._all ?? 0 })),
    people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, department: p.department?.name ?? null, departmentType: p.department?.type ?? null })),
    cmrOn: await isOn('cmr', m.companyId),
  })
}

export async function createBusiness(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const b = parse(bizSchema, req.body)
  const extra = await checkBiz(b, m.companyId)
  const { settings: _st, pipeline, ...rest } = b
  const made = await prisma.leadBusiness.create({ data: { ...rest, ...extra, pipeline: pipeline === undefined ? undefined : pipeline === null ? Prisma.DbNull : pipeline, website: b.website || null, formKey: newFormKey() }, include: BIZ_INCLUDE })
  res.status(201).json({ business: bizOut(made) })
}

async function bizById(id: string) {
  const b = await prisma.leadBusiness.findUnique({ where: { id }, include: BIZ_INCLUDE })
  if (!b) throw new HttpError(404, 'Business not found')
  return b
}

/** PATCH /api/leads/businesses/:id — the Super Admin, or (settings, head, pipeline) a manager of the business. */
export async function updateBusiness(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const cur = await bizById(String(req.params.id))
  const b = parse(bizSchema.partial(), req.body)
  if (!s.admin) {
    if (!canManage(s, cur.id)) throw new HttpError(403, 'Only the Super Admin or a manager of this business can change it.')
    const allowed = new Set(['settings', 'headId', 'pipeline'])
    const bad = Object.keys(b).filter((k) => !allowed.has(k))
    if (bad.length) throw new HttpError(403, 'Only the Super Admin changes the name, kind, people, form link or inbox of a business.')
  }
  const extra = await checkBiz(b, m.companyId, cur)
  const { settings: _st, pipeline, ...rest } = b
  const saved = await prisma.leadBusiness.update({ where: { id: cur.id }, data: { ...rest, ...extra, ...(pipeline === undefined ? {} : { pipeline: pipeline === null ? Prisma.DbNull : pipeline }), ...(b.website !== undefined ? { website: b.website || null } : {}) }, include: BIZ_INCLUDE })
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
