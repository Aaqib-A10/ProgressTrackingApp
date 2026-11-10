import { DateTime } from 'luxon'
import { HOME_COMPANY_ID } from '../company'
import type { LeadBusiness } from '@prisma/client'

/**
 * Lead Management: each business has a pipeline (its statuses) that comes with its kind, and the
 * CMR kind adds the five facts, the close-or-flag rules and the Jesse flow from the CMR Lead Flow
 * document. Data and small helpers only; the app copies the words (client/src/lib/leadsApi.ts).
 */

export type BusinessKind = 'GENERAL' | 'CMR'
export const KINDS: BusinessKind[] = ['GENERAL', 'CMR']
export interface PipelineStatus { key: string; label: string; color: string; open: boolean }

export const GENERAL_PIPELINE: PipelineStatus[] = [
  { key: 'NEW', label: 'New', color: '#4F46E5', open: true },
  { key: 'CONTACTED', label: 'Contacted', color: '#0EA5E9', open: true },
  { key: 'QUALIFIED', label: 'Qualified', color: '#22C55E', open: true },
  { key: 'WON', label: 'Won', color: '#059669', open: false },
  { key: 'LOST', label: 'Lost', color: '#EF4444', open: false },
  { key: 'SPAM', label: 'Spam', color: '#94A3B8', open: false },
]
export const CMR_PIPELINE: PipelineStatus[] = [
  { key: 'NEW', label: 'New', color: '#4F46E5', open: true },
  { key: 'INFO_SENT', label: 'Info Sent', color: '#0EA5E9', open: true },
  { key: 'FOLLOW_UP', label: 'Follow Up', color: '#F59E0B', open: true },
  { key: 'QUALIFIED', label: 'Qualified', color: '#22C55E', open: true },
  { key: 'EXISTING_CUSTOMER', label: 'Existing Customer', color: '#64748B', open: false },
  { key: 'REFERRAL_PARTNER', label: 'Referral Partner', color: '#8B5CF6', open: false },
  { key: 'NOT_A_FIT', label: 'Not a Fit', color: '#EF4444', open: false },
  { key: 'CLOSED_WON', label: 'Closed Won', color: '#059669', open: false },
  { key: 'CLOSED_LOST', label: 'Closed Lost', color: '#DC2626', open: false },
]
/** A ready-made sales pipeline with Proposal and Negotiation, offered in Lead Settings (the deal board reads any pipeline). */
export const SALES_PIPELINE: PipelineStatus[] = [
  { key: 'NEW', label: 'New', color: '#4F46E5', open: true },
  { key: 'CONTACTED', label: 'Contacted', color: '#0EA5E9', open: true },
  { key: 'QUALIFIED', label: 'Qualified', color: '#14B8A6', open: true },
  { key: 'PROPOSAL', label: 'Proposal', color: '#F59E0B', open: true },
  { key: 'NEGOTIATION', label: 'Negotiation', color: '#8B5CF6', open: true },
  { key: 'WON', label: 'Won', color: '#059669', open: false },
  { key: 'LOST', label: 'Lost', color: '#EF4444', open: false },
  { key: 'SPAM', label: 'Spam', color: '#94A3B8', open: false },
]
export const PIPELINES: Record<BusinessKind, PipelineStatus[]> = { GENERAL: GENERAL_PIPELINE, CMR: CMR_PIPELINE }

/** Every status key of every pipeline (for validation) and the open ones (for "open" filters across businesses). */
export const ALL_STATUSES = [...new Set([...GENERAL_PIPELINE, ...CMR_PIPELINE].map((s) => s.key))]
export const ALL_OPEN = [...new Set([...GENERAL_PIPELINE, ...CMR_PIPELINE].filter((s) => s.open).map((s) => s.key))]

export const kindOf = (b: Pick<LeadBusiness, 'kind'>): BusinessKind => (b.kind === 'CMR' ? 'CMR' : 'GENERAL')
export function pipelineOf(b: Pick<LeadBusiness, 'kind' | 'pipeline'>): PipelineStatus[] {
  const own = Array.isArray(b.pipeline) ? (b.pipeline as unknown as PipelineStatus[]).filter((s) => s && typeof s.key === 'string' && typeof s.label === 'string') : []
  return own.length ? own : PIPELINES[kindOf(b)]
}
export const openStatusesOf = (b: Pick<LeadBusiness, 'kind' | 'pipeline'>): string[] => pipelineOf(b).filter((s) => s.open).map((s) => s.key)
export const statusLabel = (b: Pick<LeadBusiness, 'kind' | 'pipeline'>, key: string): string => pipelineOf(b).find((s) => s.key === key)?.label ?? key.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')
/** The sheet's words → status of the business ("Info Sent" → INFO_SENT). */
export function statusFromText(b: Pick<LeadBusiness, 'kind' | 'pipeline'>, s: string): string | null {
  const t = s.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  return pipelineOf(b).find((x) => x.label.toLowerCase() === t || x.key.toLowerCase().replace(/_/g, ' ') === t)?.key ?? null
}

// ------------------------------------------------------------------ CMR words and lists

export const OWNERS = ['REP', 'MANAGER', 'HEAD', 'COPY'] as const
export const YES_NO = ['YES', 'NO', 'UNKNOWN'] as const
export const yesNoFromText = (s: string): (typeof YES_NO)[number] => (/^y/i.test(s.trim()) ? 'YES' : /^n/i.test(s.trim()) ? 'NO' : 'UNKNOWN')

export const DEFAULT_SEGMENTS = ['E-waste recycler', 'Battery recycler', 'HHW program', 'Municipality', 'Waste hauler', 'Retailer', 'Transit', 'Non-profit', 'Other']
export const DEFAULT_STATES = ['AZ', 'CA', 'CO', 'GA', 'ID', 'NM', 'NV', 'OR', 'TX', 'UT', 'WA', 'Other']
/** Two-party consent states: both sides must agree before a call is recorded. */
export const DEFAULT_CONSENT_STATES = ['CA', 'WA']

export const MATERIALS = ['ALKALINE_SORTED', 'MIXED_DRY_CELL', 'LITHIUM', 'NIMH', 'NICD', 'LEAD_ACID'] as const
/** Only these materials = not what CMR buys. */
export const OTHER_CHEMISTRIES = ['LITHIUM', 'NIMH', 'NICD', 'LEAD_ACID']
export const MATERIAL_FORMS = ['LOOSE', 'TAPED', 'BAGGED'] as const
export const PAYS_UNITS = ['LB', 'DRUM', 'NONE', 'UNKNOWN'] as const
export const FREIGHT = ['BOOKS', 'NEEDS_QUOTE', 'UNKNOWN'] as const
export const DISPOSITIONS = ['CONNECTED', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'GATEKEEPER'] as const
export const MEETING_OUTCOMES = ['QUOTE_SENT', 'SHIPMENT_BOOKED', 'NURTURE', 'CLOSED_LOST'] as const
export const CLOSE_REASONS = ['OTHER_CHEMISTRY', 'BATTERY_NETWORK', 'RELATED_PARTY', 'PROHIBITED', 'NOT_COLLECTOR', 'EXISTING_CUSTOMER', 'REFERRAL_PARTNER', 'NO_VOLUME', 'PRICE', 'NO_RESPONSE', 'NOT_INTERESTED', 'OTHER'] as const
export const TASK_KINDS = ['FOLLOW_UP', 'NEXT_STEP', 'APPROVE', 'HEAD_REVIEW', 'SEND_INVITE', 'RELAY', 'RECONFIRM', 'OUTCOME', 'REPLY', 'CALL', 'CUSTOM'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

/** Standard rate needs at least this many pounds per load. */
export const MIN_LOAD_LBS = 2500
export const PUBLISHED_RATE = 0.25

/** CMR settings kept in LeadBusiness.settings. */
export interface CmrSettings {
  /** The money deal values are in (the board and the lead show it). */
  currency: string
  copyEmail: string
  copyName: string
  consentStates: string[]
  segments: string[]
  states: string[]
  infoSubject: string
  infoBody: string
  publishedRate: number
  minLoadLbs: number
  /** A call shorter than this is not "connected" in the daily report. */
  connectedSecs: number
}
export const DEFAULT_INFO_SUBJECT = 'CMR alkaline battery recycling – information for {{company}}'
export const DEFAULT_INFO_BODY = `Hi {{contact}},

Thank you for your time on the phone today. As promised, here is a short profile of CMR (Critical Materials Recovery) and how we work with battery collectors like {{company}}.

CMR buys sorted alkaline batteries from collectors across the West. Our published rate starts at {{rate}} for sorted alkaline, with the final rate confirmed by Jesse McCullough, our CEO, once we know your volume, material and shipping arrangements.

{{note}}

I will follow up in two business days. If you have questions before then, reply to this email.

Best regards,
{{sdr}}
CMR`
/** Currencies a business can count its deals in. */
export const CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'INR'] as const
export const DEFAULT_CMR_SETTINGS: CmrSettings = {
  currency: 'USD', copyEmail: '', copyName: 'Aaqib', consentStates: DEFAULT_CONSENT_STATES, segments: DEFAULT_SEGMENTS, states: DEFAULT_STATES,
  infoSubject: DEFAULT_INFO_SUBJECT, infoBody: DEFAULT_INFO_BODY, publishedRate: PUBLISHED_RATE, minLoadLbs: MIN_LOAD_LBS, connectedSecs: 30,
}
export function settingsOf(b: Pick<LeadBusiness, 'settings'>): CmrSettings {
  const raw = (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings) ? b.settings : {}) as Partial<CmrSettings>
  return { ...DEFAULT_CMR_SETTINGS, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null)) } as CmrSettings
}

/** Everyday industries for a usual pipeline (CMR's segments are CMR's own words). */
export const GENERAL_INDUSTRIES = ['Agriculture', 'Automotive', 'Construction', 'Education', 'Finance', 'Food & Beverage', 'Healthcare', 'Hospitality', 'Logistics', 'Manufacturing', 'Professional Services', 'Real Estate', 'Retail', 'Technology', 'Other']
/**
 * Settings as the screens show them. A usual pipeline outside 99 Technologies that never set its
 * own list offers everyday industries, not CMR's segments. Nothing is stored differently.
 */
export function shownSettings(b: Pick<LeadBusiness, 'settings' | 'kind'>, companyId: string | null | undefined): CmrSettings {
  const set = settingsOf(b)
  const untouched = set.segments.length === DEFAULT_SEGMENTS.length && set.segments.every((x, i) => x === DEFAULT_SEGMENTS[i])
  return b.kind !== 'CMR' && companyId !== HOME_COMPANY_ID && untouched ? { ...set, segments: GENERAL_INDUSTRIES } : set
}

// ------------------------------------------------------------------ time

/** Time zone of a prospect from its state (Arizona never changes its clocks). */
export function zoneOfState(state: string | null | undefined): string {
  switch ((state ?? '').toUpperCase()) {
    case 'CA': case 'WA': case 'OR': case 'NV': return 'America/Los_Angeles'
    case 'CO': case 'NM': case 'ID': case 'UT': case 'MT': case 'WY': return 'America/Denver'
    case 'TX': case 'OK': case 'KS': case 'NE': case 'MN': case 'IA': case 'MO': case 'IL': case 'WI': return 'America/Chicago'
    case 'GA': case 'FL': case 'NY': case 'NC': case 'VA': case 'PA': case 'OH': case 'MI': return 'America/New_York'
    default: return 'America/Phoenix'
  }
}
export const PHOENIX = 'America/Phoenix'
export const PACIFIC = 'America/Los_Angeles'

/** The same moment in the prospect's zone, Phoenix and Pacific, written out. */
export function threeTimes(at: Date, prospectZone: string): { prospect: string; phoenix: string; pacific: string; line: string } {
  const f = (z: string) => DateTime.fromJSDate(at, { zone: z }).toFormat('ccc d LLL, h:mm a ZZZZ')
  const prospect = f(prospectZone), phoenix = f(PHOENIX), pacific = f(PACIFIC)
  return { prospect, phoenix, pacific, line: `${prospect} (prospect) · ${phoenix} (Phoenix) · ${pacific} (Pacific)` }
}

/** n business days after a date (weekends skipped), at the same time of day. */
export function addBusinessDays(from: Date, n: number): Date {
  let d = DateTime.fromJSDate(from, { zone: PHOENIX })
  let left = n
  while (left > 0) { d = d.plus({ days: 1 }); if (d.weekday < 6) left-- }
  return d.toJSDate()
}
/** Business days between two moments (0 when b is before a; weekends not counted). */
export function businessDaysBetween(a: Date, b: Date): number {
  if (b <= a) return 0
  let d = DateTime.fromJSDate(a, { zone: PHOENIX }).startOf('day'), n = 0
  const end = DateTime.fromJSDate(b, { zone: PHOENIX }).startOf('day')
  while (d < end) { d = d.plus({ days: 1 }); if (d.weekday < 6) n++ }
  return n
}

// ------------------------------------------------------------------ keys

/** "(602) 555-0100" → "602-555-0100" (the sheet's format) and "+16025550100" (for matching calls). */
export function normalizePhone(raw: string | null | undefined): { phone: string | null; e164: string | null } {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return { phone: raw?.trim() || null, e164: null }
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.length === 10 ? digits : null
  if (!ten) return { phone: raw!.trim(), e164: digits.length >= 8 ? `+${digits}` : null }
  return { phone: `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`, e164: `+1${ten}` }
}
/** A company name as a key for duplicate checks: lower case, no punctuation, no "inc", "llc"… */
export const orgKey = (name: string | null | undefined): string | null => {
  const k = (name ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|inc|llc|ltd|corp|corporation|co|company|group)\b/g, '').replace(/\s+/g, ' ').trim()
  return k || null
}
/** "https://www.acme.com/about" → "acme.com" */
export function websiteKey(site: string | null | undefined): string | null {
  const s = (site ?? '').trim().toLowerCase()
  if (!s) return null
  try { return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '') } catch { return s.replace(/^www\./, '').split('/')[0] || null }
}
export const emailKey = (e: string | null | undefined): string | null => (e ?? '').trim().toLowerCase() || null

// ------------------------------------------------------------------ the five facts and the rules

export type FactsInput = {
  material: string[]; lbsPerMonth: number | null; lbsPerShipment: number | null; currentVendor: string | null; paysUnit: string; paysToday: number | null
  decisionMakerName: string | null; dmAgreed: string; pickupCity: string | null; nextShipmentDate: Date | null; freight: string
}
export type Fact = { key: 'material' | 'volume' | 'outlet' | 'decisionMaker' | 'timing'; label: string; done: boolean; hint: string }

/** The five facts the document asks for; "Qualified" needs all five. */
export function fiveFacts(l: FactsInput): Fact[] {
  return [
    { key: 'material', label: 'Material', done: l.material.length > 0, hint: 'Sorted alkaline or mixed dry cell; loose, taped or bagged' },
    { key: 'volume', label: 'Volume', done: (l.lbsPerShipment ?? 0) > 0 || (l.lbsPerMonth ?? 0) > 0, hint: 'Pounds per shipment and per month' },
    { key: 'outlet', label: 'Current outlet', done: !!l.currentVendor?.trim() && (l.paysUnit === 'NONE' || (l.paysUnit !== 'UNKNOWN' && l.paysToday != null)), hint: 'Vendor, and what they pay per lb, per drum, or nothing' },
    { key: 'decisionMaker', label: 'Decision maker', done: !!l.decisionMakerName?.trim() && l.dmAgreed !== 'UNKNOWN', hint: 'Name, role, and whether they will talk to Jesse' },
    { key: 'timing', label: 'Timing and freight', done: !!l.pickupCity?.trim() && l.freight !== 'UNKNOWN' && !!l.nextShipmentDate, hint: 'Next shipment date, pickup city, who books freight' },
  ]
}

export type Warning = { key: string; level: 'stop' | 'warn' | 'info'; text: string }

/** The close-or-flag rules and the pre-call checks, as pop-ups on the lead. */
export function leadWarnings(l: FactsInput & { prohibited: boolean; existingCustomer: boolean; usesBatteryNetwork: boolean; vendorRelatedParty: boolean; sortsAlkaline: string; shipsLtl: string; state: string | null }, set: CmrSettings): Warning[] {
  const out: Warning[] = []
  if (l.prohibited) out.push({ key: 'prohibited', level: 'stop', text: 'On the Prohibited Leads list: do not call. Mark Not a Fit or ask the team lead.' })
  if (l.existingCustomer) out.push({ key: 'customer', level: 'stop', text: 'Already a customer: mark Existing Customer and let Jesse confirm.' })
  if (l.material.length && l.material.every((m) => OTHER_CHEMISTRIES.includes(m))) out.push({ key: 'chemistry', level: 'warn', text: 'Only lithium / NiMH / NiCd / lead acid: CMR buys alkaline. Suggest Not a Fit.' })
  if (l.usesBatteryNetwork || /battery network|call2recycle|c2r|onedrum/i.test(l.currentVendor ?? '')) {
    const ok = l.sortsAlkaline === 'YES' && l.shipsLtl === 'YES'
    out.push({ key: 'battery-network', level: ok ? 'info' : 'warn', text: ok ? 'Uses The Battery Network: praise it, never pitch against it. They sort alkaline and ship LTL/FTL, so carry on.' : 'Uses The Battery Network (Call2Recycle): praise it, never pitch against it. Carry on only if they sort alkaline and ship LTL/FTL.' })
  }
  if (l.vendorRelatedParty || /integritrade/i.test(l.currentVendor ?? '')) out.push({ key: 'related-party', level: 'warn', text: 'The downstream vendor is a related party (Integritrade): flag for Jesse.' })
  const perLoad = l.lbsPerShipment ?? null
  if (perLoad != null && perLoad > 0 && perLoad < set.minLoadLbs) out.push({ key: 'below-min', level: 'info', text: `Below minimum: ${perLoad.toLocaleString()} lb per load (standard rate needs ${set.minLoadLbs.toLocaleString()} lb). Flag it as below minimum; Jesse can still take it.` })
  if (l.state && set.consentStates.map((s) => s.toUpperCase()).includes(l.state.toUpperCase())) out.push({ key: 'consent', level: 'info', text: `${l.state} needs both sides to agree to recording: say "This call may be recorded for quality purposes" and tick Consent given after the call.` })
  return out
}

/** The Call Summary from the template fields (facts only, 3–5 sentences). */
export function composeSummary(l: { company: string; contact: string | null; handlesAlkaline: string; lbsPerMonth: number | null; lbsPerShipment: number | null; currentVendor: string | null; paysToday: number | null; paysUnit: string; nextStep: string | null; nextStepDate: Date | null; owner: string; jesseInputNeeded: boolean }, outcome: string): string {
  const parts: string[] = []
  parts.push(`${l.company}${l.contact ? ` (${l.contact})` : ''}: ${outcome.trim().replace(/\.$/, '')}.`)
  parts.push(`Handles alkaline: ${l.handlesAlkaline === 'YES' ? 'yes' : l.handlesAlkaline === 'NO' ? 'no' : 'unknown'}.`)
  if (l.lbsPerShipment || l.lbsPerMonth) parts.push(`Volume: ${[l.lbsPerShipment ? `${l.lbsPerShipment.toLocaleString()} lb per shipment` : '', l.lbsPerMonth ? `${l.lbsPerMonth.toLocaleString()} lb per month` : ''].filter(Boolean).join(', ')}.`)
  if (l.currentVendor) parts.push(`Current vendor: ${l.currentVendor}${l.paysUnit === 'NONE' ? ', pays nothing' : l.paysToday != null ? `, pays $${l.paysToday}${l.paysUnit === 'DRUM' ? ' per drum' : '/lb'}` : ''}.`)
  if (l.nextStep) parts.push(`Next step: ${l.nextStep}${l.nextStepDate ? ` by ${DateTime.fromJSDate(l.nextStepDate, { zone: PHOENIX }).toFormat('d LLL')}` : ''} (${l.owner === 'HEAD' ? 'Jesse' : l.owner === 'COPY' ? 'Aaqib' : l.owner === 'MANAGER' ? 'team lead' : 'SDR'}).`)
  if (l.jesseInputNeeded) parts.push('Jesse input needed.')
  return parts.join(' ')
}

/** Words an SDR may not put in the Send-info email (price, freight and pickup are Jesse's). */
export const PROMISE_WORDS = /\$\s?\d|\d+\s?(c|¢|cents?)\b|per\s?(lb|pound)|\/lb|freight|pick-?up|we (will|can) (pay|cover|arrange|book)|guarantee/i
