import { Prisma, type Lead, type LeadBusiness } from '@prisma/client'
import { prisma } from '../prisma'
import { keysOf, listMatches } from './lists'
import { leadManagers, tellAboutLead } from './notify'

/**
 * Lead Management: turning what arrives (a website form, an email, a CSV row, a phone call) into
 * a lead of a business, the same way every time.
 */

export const SOURCES = ['FORM', 'PHONE', 'IMPORT', 'EMAIL'] as const
export type LeadSource = (typeof SOURCES)[number]
/** The usual pipeline (a GENERAL business). A business's own statuses: lib/leads/pipeline.ts. */
export const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'SPAM'] as const
export type LeadStatus = (typeof STATUSES)[number]
/** Open in any pipeline (GENERAL and CMR), for filters that span businesses. */
export const OPEN_STATUSES: string[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'INFO_SENT', 'FOLLOW_UP']

export interface LeadInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  organization?: string | null
  message?: string | null
  location?: string | null
  sourceDetail?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  gclid?: string | null
  externalId?: string | null
  raw?: Record<string, unknown> | null
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The names website forms use for each thing (compared without case, spaces, dashes or underscores). */
const NAMES: Record<string, string[]> = {
  name: ['name', 'fullname', 'yourname', 'contactname', 'customername'],
  first: ['firstname', 'fname', 'first', 'givenname'],
  last: ['lastname', 'lname', 'last', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'youremail', 'mail', 'workemail', 'contactemail'],
  phone: ['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'mobilenumber', 'cell', 'cellphone', 'whatsapp', 'contactnumber'],
  organization: ['company', 'companyname', 'organization', 'organisation', 'business', 'businessname', 'org'],
  message: ['message', 'comments', 'comment', 'enquiry', 'inquiry', 'details', 'notes', 'description', 'question', 'yourmessage', 'msg', 'body'],
  zip: ['zip', 'zipcode', 'postcode', 'postalcode'],
  city: ['city', 'town', 'location', 'state', 'region'],
  page: ['page', 'pageurl', 'url', 'sourceurl', 'formpage', 'landingpage'],
  formName: ['form', 'formname', 'formid'],
  utmSource: ['utmsource'],
  utmMedium: ['utmmedium'],
  utmCampaign: ['utmcampaign', 'campaign'],
  utmTerm: ['utmterm', 'keyword', 'term'],
  utmContent: ['utmcontent'],
  gclid: ['gclid', 'gbraid', 'wbraid'],
}
const KNOWN = new Set(Object.values(NAMES).flat())
/** Fields that steer the form itself and are never shown. */
const CONTROL = new Set(['redirect', 'hp', 'honeypot', 'gotcha', 'key', 'formkey', 'gRecaptchaResponse'.toLowerCase(), 'cfturnstileresponse', 'submit'])

const str = (v: unknown): string => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()
const cap = (v: string | null | undefined, n: number): string | null => { const t = (v ?? '').trim(); return t ? t.slice(0, n) : null }
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/

/** A form's fields (any names, any order) as a lead. Fields it does not know go into the message as "Label: value" lines. */
export function fromFields(fields: Record<string, unknown>): LeadInput {
  const byNorm = new Map<string, { key: string; value: string }>()
  for (const [k, v] of Object.entries(fields)) {
    const n = norm(k)
    if (!n || n.startsWith('_') || CONTROL.has(n) || CONTROL.has(norm(k.replace(/^_+/, '')))) continue
    if (k.startsWith('_')) continue
    const value = str(v)
    if (!value) continue
    if (!byNorm.has(n)) byNorm.set(n, { key: k, value })
  }
  const pick = (what: keyof typeof NAMES) => { for (const n of NAMES[what]) { const f = byNorm.get(n); if (f) return f.value } return '' }
  const name = pick('name') || [pick('first'), pick('last')].filter(Boolean).join(' ')
  const extra: string[] = []
  for (const [n, f] of byNorm) if (!KNOWN.has(n)) extra.push(`${f.key.replace(/[_-]+/g, ' ').trim()}: ${f.value}`)
  const message = [pick('message'), extra.join('\n')].filter(Boolean).join('\n\n')
  const form = pick('formName')
  return {
    name, email: pick('email'), phone: pick('phone'), organization: pick('organization'), message,
    location: [pick('city'), pick('zip')].filter(Boolean).join(' ') || null,
    sourceDetail: [form, pick('page')].filter(Boolean).join(' · ') || null,
    utmSource: pick('utmSource'), utmMedium: pick('utmMedium'), utmCampaign: pick('utmCampaign'), utmTerm: pick('utmTerm'), utmContent: pick('utmContent'), gclid: pick('gclid'),
    raw: Object.fromEntries([...byNorm.values()].map((f) => [f.key, f.value.slice(0, 2000)])),
  }
}

/** Trim, cap and check a lead's fields (a bad email is dropped, not saved). */
export function cleanInput(i: LeadInput): LeadInput {
  const email = cap(i.email, 254)?.toLowerCase() ?? null
  return {
    name: cap(i.name, 200), email: email && EMAIL.test(email) ? email : null, phone: cap(i.phone, 50), organization: cap(i.organization, 200),
    message: cap(i.message, 8000), location: cap(i.location, 120), sourceDetail: cap(i.sourceDetail, 500),
    utmSource: cap(i.utmSource, 200), utmMedium: cap(i.utmMedium, 200), utmCampaign: cap(i.utmCampaign, 200), utmTerm: cap(i.utmTerm, 200), utmContent: cap(i.utmContent, 200), gclid: cap(i.gclid, 300),
    externalId: cap(i.externalId, 300), raw: i.raw ?? null,
  }
}

/** A lead must give some way to reach the person, or at least a name and a message. */
export function hasSubstance(i: LeadInput): boolean {
  return !!(i.email || i.phone || (i.name && i.message))
}

const SOURCE_TEXT: Record<LeadSource, string> = { FORM: 'Website form', PHONE: 'Phone call', IMPORT: 'CSV import', EMAIL: 'Email' }
export const sourceText = (s: string) => SOURCE_TEXT[s as LeadSource] ?? s

/** Same person again (email or phone) while their lead is still open, within 60 days: no second lead. */
async function openTwin(businessId: string, i: LeadInput): Promise<Lead | null> {
  const or: Prisma.LeadWhereInput[] = []
  if (i.email) or.push({ email: i.email })
  if (i.phone) or.push({ phone: i.phone })
  if (!or.length) return null
  return prisma.lead.findFirst({ where: { businessId, status: { in: OPEN_STATUSES }, createdAt: { gte: new Date(Date.now() - 60 * 86400_000) }, OR: or }, orderBy: { createdAt: 'desc' } })
}

export interface ReceiveOptions {
  source: LeadSource
  createdById?: string | null
  /** Give it straight to this person (a rep adding their own phone lead, or an import for one rep). */
  assigneeId?: string | null
  /** Alerts for the managers / rep. Off for big imports (one summary alert instead). */
  notify?: boolean
  /** Fold a repeat enquiry into the open lead (forms and emails). */
  mergeRepeats?: boolean
}

/** Make the lead (or add a repeat to the person's open lead). Runs inside the company of the business. */
export async function receiveLead(business: Pick<LeadBusiness, 'id' | 'name'>, input: LeadInput, o: ReceiveOptions): Promise<{ lead: Lead; repeat: boolean; duplicate: boolean }> {
  const i = cleanInput(input)
  const notify = o.notify !== false
  if (i.externalId) {
    const seen = await prisma.lead.findUnique({ where: { businessId_externalId: { businessId: business.id, externalId: i.externalId } } })
    if (seen) return { lead: seen, repeat: false, duplicate: true }
  }
  if (o.mergeRepeats) {
    const twin = await openTwin(business.id, i)
    if (twin) {
      const lead = await prisma.lead.update({ where: { id: twin.id }, data: { repeats: { increment: 1 }, lastActivityAt: new Date() } })
      await prisma.leadEvent.create({ data: { leadId: twin.id, kind: 'REPEAT', text: [`Came in again (${sourceText(o.source)}${i.sourceDetail ? `, ${i.sourceDetail}` : ''})`, i.message].filter(Boolean).join('\n\n').slice(0, 8000), data: (i.raw ?? undefined) as Prisma.InputJsonValue | undefined } })
      if (notify) {
        const to = twin.assigneeId ? [twin.assigneeId] : await leadManagers(business.id)
        await tellAboutLead(to, { type: 'LEAD_NEW', title: `${twin.name || twin.email || 'A lead'} got in touch again`, body: `${business.name}: ${(i.message ?? '').slice(0, 160) || sourceText(o.source)}`, leadId: twin.id })
      }
      return { lead, repeat: true, duplicate: false }
    }
  }
  const now = new Date()
  const keys = keysOf(i)
  const lists = await listMatches(business.id, keys)
  let lead: Lead
  try {
    lead = await prisma.lead.create({
      data: {
        businessId: business.id, source: o.source, name: i.name ?? '', email: i.email, phone: i.phone, organization: i.organization, message: i.message, location: i.location,
        sourceDetail: i.sourceDetail, utmSource: i.utmSource, utmMedium: i.utmMedium, utmCampaign: i.utmCampaign, utmTerm: i.utmTerm, utmContent: i.utmContent, gclid: i.gclid,
        externalId: i.externalId, raw: (i.raw ?? undefined) as Prisma.InputJsonValue | undefined, createdById: o.createdById ?? null,
        orgKey: keys.orgKey, phoneE164: keys.phoneE164, prohibited: lists.prohibited, existingCustomer: lists.existingCustomer,
        assigneeId: o.assigneeId ?? null, assignedAt: o.assigneeId ? now : null, assignedById: o.assigneeId ? (o.createdById ?? null) : null, lastActivityAt: now,
      },
    })
  } catch (e) {
    // The same email arrived twice at the same moment: keep the first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && i.externalId) {
      const seen = await prisma.lead.findUnique({ where: { businessId_externalId: { businessId: business.id, externalId: i.externalId } } })
      if (seen) return { lead: seen, repeat: false, duplicate: true }
    }
    throw e
  }
  await prisma.leadEvent.create({ data: { leadId: lead.id, userId: o.createdById ?? null, kind: 'CREATED', text: `${sourceText(o.source)}${i.sourceDetail ? ` · ${i.sourceDetail}` : ''}` } })
  if (o.assigneeId) await prisma.leadEvent.create({ data: { leadId: lead.id, userId: o.createdById ?? null, kind: 'ASSIGNED', text: '', data: { to: o.assigneeId } } })
  if (notify) {
    const who = lead.name || lead.organization || lead.email || lead.phone || 'New lead'
    if (o.assigneeId) {
      if (o.assigneeId !== o.createdById) await tellAboutLead([o.assigneeId], { type: 'LEAD_ASSIGNED', title: `New lead for you: ${who}`, body: `${business.name} · ${sourceText(o.source)}`, leadId: lead.id, actorId: o.createdById })
    } else {
      await tellAboutLead(await leadManagers(business.id), { type: 'LEAD_NEW', title: `New lead: ${who}`, body: `${business.name} · ${sourceText(o.source)}${lead.message ? ` · ${lead.message.slice(0, 120)}` : ''}`, leadId: lead.id, actorId: o.createdById })
    }
  }
  return { lead, repeat: false, duplicate: false }
}
