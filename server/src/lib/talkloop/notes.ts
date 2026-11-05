import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { askModelJson, notesProvider } from '../pm/notes'
import { FREIGHT, MATERIALS, MATERIAL_FORMS, PAYS_UNITS, YES_NO, settingsOf } from '../leads/pipeline'

/**
 * Call notes drafted from the TalkLoop transcript, for the SDR to confirm. Nothing here changes
 * the lead by itself: the draft sits on the call (aiSummary, aiFacts) until the SDR presses
 * "Use this" (apply) or dismisses it. Facts only, no promises on price, freight or pickup.
 */

export const DRAFT_FACT_KEYS = ['contactName', 'contactRole', 'email', 'decisionMaker', 'decisionMakerName', 'material', 'materialForm', 'lbsPerMonth', 'lbsPerShipment', 'currentVendor', 'paysToday', 'paysUnit', 'nextShipmentDate', 'pickupCity', 'freight', 'nextStep', 'nextStepDate', 'jesseAsk'] as const
export type DraftFactKey = (typeof DRAFT_FACT_KEYS)[number]

const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional()
const draftSchema = z.object({
  summary: z.string().max(2000),
  contactName: nullable(z.string().max(120)), contactRole: nullable(z.string().max(120)), email: nullable(z.string().max(254)),
  decisionMaker: nullable(z.enum(YES_NO)), decisionMakerName: nullable(z.string().max(120)),
  material: nullable(z.array(z.enum(MATERIALS)).max(6)), materialForm: nullable(z.array(z.enum(MATERIAL_FORMS)).max(3)),
  lbsPerMonth: nullable(z.number().min(0).max(1e9)), lbsPerShipment: nullable(z.number().min(0).max(1e9)),
  currentVendor: nullable(z.string().max(200)), paysToday: nullable(z.number().min(0).max(1e6)), paysUnit: nullable(z.enum(PAYS_UNITS)),
  nextShipmentDate: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), pickupCity: nullable(z.string().max(120)), freight: nullable(z.enum(FREIGHT)),
  nextStep: nullable(z.string().max(300)), nextStepDate: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), jesseAsk: nullable(z.string().max(300)),
  outcome: nullable(z.enum(['INTERESTED', 'NOT_INTERESTED', 'CALL_BACK', 'WRONG_NUMBER', 'VOICEMAIL', 'GATEKEEPER'])),
})
export type CallDraft = z.infer<typeof draftSchema>

const SYSTEM = (cmr: boolean) =>
  'You turn the transcript of a sales development call into notes for a CRM. Be strict: write only what was actually said on this call, never guess, never add. ' +
  'The transcript comes from speech recognition: misheard words, hold music, voicemail prompts and side talk appear; leave them out. ' +
  (cmr
    ? 'The caller works for CMR, a battery recycler that buys spent alkaline and other dry-cell batteries from recyclers, municipalities and companies. The five facts the team collects are: material (what batteries, sorted or mixed), volume (pounds per shipment and per month), current outlet (who takes their batteries today and what that outlet pays per pound, or nothing), decision maker (name, role, will they talk to Jesse), timing and freight (next shipment date, pickup city, whether they book freight or need a quote). '
    : 'The caller is a sales rep qualifying a lead. ') +
  'Never put a price, a freight cost or a pickup promise into the summary or the facts unless the prospect themselves stated a number they are paid today. ' +
  'Answer with one JSON object and nothing else, keys exactly as specified, null for anything not said.'

const KEYS = `Keys:
summary: 3 to 5 plain sentences, past tense, facts only: who was reached, what they have, what they do today, what was agreed next. Empty string if nobody was reached.
contactName, contactRole, email: the person spoken to, as said.
decisionMaker: "YES" | "NO" | "UNKNOWN" (is this person the decision maker). decisionMakerName: the decision maker's name if someone else was named.
material: array from ${JSON.stringify(MATERIALS)}. materialForm: array from ${JSON.stringify(MATERIAL_FORMS)}.
lbsPerMonth, lbsPerShipment: numbers in pounds (convert tons ×2000, drums ≈ 500 lb only if they said drums and gave no weight: then leave lbs null and mention drums in the summary).
currentVendor: who takes the material today. paysToday: number they are paid today; paysUnit: "LB" | "DRUM" | "NONE" | "UNKNOWN" ("NONE" when they pay to dispose or get nothing).
nextShipmentDate, nextStepDate: YYYY-MM-DD only when a date or a clear day was said (today's date is given). pickupCity: city/state of the material. freight: "BOOKS" | "NEEDS_QUOTE" | "UNKNOWN".
nextStep: the agreed next action in up to 12 words. jesseAsk: one line if the prospect asked something only the CEO can answer (price, freight, contract), else null.
outcome: "INTERESTED" | "NOT_INTERESTED" | "CALL_BACK" | "WRONG_NUMBER" | "VOICEMAIL" | "GATEKEEPER" | null.`

/** Only keys that carry something, so the SDR sees a short list. */
export function compactFacts(d: CallDraft): Partial<CallDraft> {
  const out: Record<string, unknown> = {}
  for (const k of DRAFT_FACT_KEYS) { const v = d[k]; if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue; out[k] = v }
  if (d.outcome) out.outcome = d.outcome
  return out as Partial<CallDraft>
}

/** Draft the notes for one TalkLoop call (idempotent: skips calls that already have a draft unless `force`). */
export async function draftCallNotes(callId: string, opts: { force?: boolean } = {}): Promise<CallDraft | null> {
  if (!notesProvider()) return null
  const c = await prisma.leadCall.findUnique({ where: { id: callId }, include: { lead: { include: { cmr: true, business: { select: { kind: true, pipeline: true, settings: true } } } }, user: { select: { name: true } } } })
  if (!c || !c.transcript || (c.aiAt && !opts.force)) return null
  const set = settingsOf(c.lead.business)
  if (c.disposition !== 'CONNECTED' && c.durationSec < set.connectedSecs) return null
  const cmr = c.lead.business.kind === 'CMR'
  const l = c.lead
  const known = [
    `Company: ${l.organization || l.name}`, l.name && l.organization ? `Contact on file: ${l.name}${l.cmr?.contactRole ? `, ${l.cmr.contactRole}` : ''}` : null,
    l.state ? `State: ${l.state}` : null, l.industry ? `Segment: ${l.industry}` : null, l.cmr?.currentVendor ? `Current outlet on file: ${l.cmr.currentVendor}` : null,
  ].filter(Boolean).join('\n')
  const user = `Call on ${c.at.toISOString().slice(0, 10)} (${c.direction === 'IN' ? 'incoming' : 'outgoing'}, ${c.durationSec}s) by ${c.user?.name ?? 'the SDR'}.
${known}
Transcript:
${c.transcript.slice(0, 60_000)}

${KEYS}`
  const text = await askModelJson(SYSTEM(cmr), user, 1800)
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI answer had no notes in it')
  const parsed = draftSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
  if (!parsed.success) throw new Error(`The AI answer did not fit: ${parsed.error.issues[0]?.path.join('.')}`)
  const draft = parsed.data
  await prisma.leadCall.update({ where: { id: c.id }, data: { aiSummary: draft.summary.trim() || null, aiFacts: compactFacts(draft) as Prisma.InputJsonValue, aiAt: new Date(), aiAppliedAt: null } })
  return draft
}

/** Calls whose transcript arrived but no draft yet (a handful per run). */
export async function draftPendingCallNotes(limit = 10): Promise<number> {
  if (!notesProvider()) return 0
  const want = await prisma.leadCall.findMany({ where: { provider: 'TALKLOOP', transcript: { not: null }, aiAt: null, disposition: 'CONNECTED' }, select: { id: true, companyId: true }, orderBy: { at: 'desc' }, take: limit })
  let n = 0
  for (const c of want) {
    try { if (await draftCallNotes(c.id)) n++ } catch (e) {
      // Mark it so a broken transcript is not retried every 3 minutes; "Draft again" on the call forces it.
      await prisma.leadCall.update({ where: { id: c.id }, data: { aiAt: new Date(), aiSummary: null, aiFacts: { error: (e as Error).message.slice(0, 200) } as Prisma.InputJsonValue } })
    }
  }
  return n
}
