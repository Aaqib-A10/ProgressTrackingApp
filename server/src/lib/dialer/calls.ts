import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import type { DialerIntegration, DialerLead, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { STATUSES, withDefaults } from './rules'

/** The Lead Dialer settings (same row the settings screen saves). */
const loadSettings = async () => withDefaults((await prisma.dialerSettings.findUnique({ where: { id: 'default' } }))?.data)

/**
 * Predictive dialer → Metriq (ITAD, Oct 2026). After each call the dialer calls a private link
 * with what happened. Metriq:
 *   1. reads the message (JSON, a web form, or a link with ?fields, whatever the dialer sends),
 *   2. finds the lead: Metriq lead ID, then CRM lead ID, then the phone number,
 *   3. finds the agent (the dialer's agent id, mapped once by a manager; or their email or name),
 *   4. logs the call on the lead (outcome, notes, agent, time, duration) and updates the lead:
 *      the status moves forward, a callback sets a call back (it shows in Follow-ups), DNC and
 *      wrong numbers leave dialing for good.
 * The same call sent twice is logged once. A call whose lead cannot be found waits in
 * "Calls to match" for a manager.
 */

export const OUTCOMES = {
  CONNECTED: 'Connected',
  INTERESTED: 'Interested',
  CALLBACK: 'Callback',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  VOICEMAIL: 'Voicemail',
  NOT_INTERESTED: 'Not interested',
  WRONG_NUMBER: 'Wrong number',
  DNC: 'Do not call',
} as const
export type Outcome = keyof typeof OUTCOMES
export const OUTCOME_KEYS = Object.keys(OUTCOMES) as Outcome[]

/** What each outcome does to the lead's status (only forward, except the final ones). */
const STATUS_OF: Partial<Record<Outcome, { status: string; always?: boolean }>> = {
  NO_ANSWER: { status: 'Contact Attempted' },
  BUSY: { status: 'Contact Attempted' },
  VOICEMAIL: { status: 'Voicemail Sent' },
  CONNECTED: { status: 'Connected' },
  CALLBACK: { status: 'Connected' },
  INTERESTED: { status: 'Interested' },
  NOT_INTERESTED: { status: 'Not Interested', always: true },
  DNC: { status: 'DNC', always: true },
}

/**
 * Common disposition codes and words → outcome. Matched without case, spaces or punctuation.
 * VICIdial-style codes included (A answering machine, B busy, N no answer, NI, DNC, DC, CALLBK, SALE).
 * A manager can add or change codes for their dialer in Lead Dialer settings.
 */
export const DEFAULT_DISPOSITIONS: Record<string, Outcome> = {
  connected: 'CONNECTED', contact: 'CONNECTED', contacted: 'CONNECTED', answered: 'CONNECTED', human: 'CONNECTED', spoke: 'CONNECTED', xfer: 'CONNECTED', transferred: 'CONNECTED', ans: 'CONNECTED',
  interested: 'INTERESTED', sale: 'INTERESTED', lead: 'INTERESTED', appointment: 'INTERESTED', appt: 'INTERESTED', hotlead: 'INTERESTED',
  callback: 'CALLBACK', callbk: 'CALLBACK', cb: 'CALLBACK', cbhold: 'CALLBACK', callmeback: 'CALLBACK', callbackscheduled: 'CALLBACK', recall: 'CALLBACK',
  noanswer: 'NO_ANSWER', na: 'NO_ANSWER', n: 'NO_ANSWER', nan: 'NO_ANSWER', noans: 'NO_ANSWER', ring: 'NO_ANSWER', ringnoanswer: 'NO_ANSWER', dropped: 'NO_ANSWER', drop: 'NO_ANSWER', abandoned: 'NO_ANSWER',
  busy: 'BUSY', b: 'BUSY', ab: 'BUSY',
  voicemail: 'VOICEMAIL', vm: 'VOICEMAIL', vmail: 'VOICEMAIL', leftvoicemail: 'VOICEMAIL', leftmessage: 'VOICEMAIL', lm: 'VOICEMAIL', answeringmachine: 'VOICEMAIL', machine: 'VOICEMAIL', a: 'VOICEMAIL', aa: 'VOICEMAIL', am: 'VOICEMAIL', al: 'VOICEMAIL', aml: 'VOICEMAIL',
  notinterested: 'NOT_INTERESTED', ni: 'NOT_INTERESTED', notint: 'NOT_INTERESTED', notqualified: 'NOT_INTERESTED', nq: 'NOT_INTERESTED',
  wrongnumber: 'WRONG_NUMBER', wn: 'WRONG_NUMBER', wrong: 'WRONG_NUMBER', badnumber: 'WRONG_NUMBER', disconnected: 'WRONG_NUMBER', dc: 'WRONG_NUMBER', invalid: 'WRONG_NUMBER', invalidnumber: 'WRONG_NUMBER', fax: 'WRONG_NUMBER',
  dnc: 'DNC', donotcall: 'DNC', dnccustomer: 'DNC', dncl: 'DNC', removeme: 'DNC', donotcontact: 'DNC',
}

/** The fields Metriq reads from the dialer's message, and the names dialers commonly use for each. */
export const FIELDS = {
  leadId: ['metriq_lead_id', 'metriqleadid', 'metriq_id', 'vendor_lead_code', 'vendor_id', 'source_id', 'external_id', 'lead_ref'],
  // Not "lead_id": in most dialers that is the dialer's own number for the lead, not the CRM's.
  crmId: ['crm_lead_id', 'crm_id', 'crmleadid', 'crm_record_id'],
  phone: ['phone_number', 'phone', 'phonenumber', 'number', 'to', 'to_number', 'dialed_number', 'customer_phone', 'destination', 'callee'],
  disposition: ['disposition', 'dispo', 'status', 'call_status', 'result', 'outcome', 'call_result', 'disposition_name', 'disposition_code'],
  notes: ['notes', 'note', 'comments', 'comment', 'call_notes', 'agent_notes', 'remarks', 'memo'],
  agent: ['agent', 'user', 'agent_id', 'agentid', 'agent_name', 'user_id', 'username', 'agent_email', 'rep', 'fullname'],
  duration: ['duration', 'talk_time', 'talktime', 'call_duration', 'length_in_sec', 'billsec', 'talk_sec', 'seconds', 'duration_sec'],
  callId: ['call_id', 'callid', 'uniqueid', 'unique_id', 'call_uuid', 'uuid', 'call_sid', 'sid', 'call_log_id'],
  calledAt: ['call_date', 'call_time', 'calldate', 'start_time', 'started_at', 'timestamp', 'date', 'time', 'end_time', 'ended_at'],
  callbackAt: ['callback_datetime', 'callback_time', 'callback_at', 'callback', 'callback_date', 'recall_time', 'appointment_time'],
} as const
export type Field = keyof typeof FIELDS
export const FIELD_KEYS = Object.keys(FIELDS) as Field[]

export const KEY_PREFIX = 'mdl_'
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
export const newToken = () => `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const digitsOf = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d }

// ------------------------------------------------------------------ reading the message

/** Everything the dialer sent, flattened: {"call":{"id":5}} → "call.id": 5. Keys compared without case. */
export function flatten(input: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (input == null) return out
  if (typeof input !== 'object') { if (prefix) out[prefix] = String(input); return out }
  if (Array.isArray(input)) { input.slice(0, 20).forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out)); return out }
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

export interface ReadCall {
  leadId: string | null; crmId: string | null; phone: string | null; disposition: string | null; notes: string | null
  agent: string | null; durationSec: number | null; callId: string | null; calledAt: Date | null; callbackAt: Date | null
}

/** Pick each field: the name a manager set for this dialer, else the first common name present. */
export function readCall(flat: Record<string, string>, fieldMap: Partial<Record<Field, string>>, timeZone: string): ReadCall {
  const byKey = new Map<string, string>()
  for (const [k, v] of Object.entries(flat)) {
    const t = v.trim()
    // VICIdial leaves unknown variables as --A--name--B--: treat them as empty.
    if (!t || /^--A--.*--B--$/.test(t)) continue
    byKey.set(k.toLowerCase(), t)
    const last = k.split('.').pop()!.toLowerCase()
    if (!byKey.has(last)) byKey.set(last, t)
  }
  const get = (f: Field): string | null => {
    const set = fieldMap[f]?.trim().toLowerCase()
    if (set) return byKey.get(set) ?? null
    for (const n of FIELDS[f]) { const v = byKey.get(n); if (v) return v }
    return null
  }
  return {
    leadId: get('leadId'), crmId: get('crmId'), phone: get('phone'), disposition: get('disposition'), notes: get('notes'),
    agent: get('agent'), durationSec: parseDuration(get('duration')), callId: get('callId'),
    calledAt: parseTime(get('calledAt'), timeZone), callbackAt: parseTime(get('callbackAt'), timeZone),
  }
}

/** 95, "95", "1:35", "00:01:35", "95.4" → seconds. */
export function parseDuration(v: string | null): number | null {
  if (!v) return null
  const t = v.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t))
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/)
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return null
}

/** An ISO time with its zone, a Unix time, or "YYYY-MM-DD HH:MM[:SS]" / "MM/DD/YYYY HH:MM" on the dialer's clock. */
export function parseTime(v: string | null, timeZone: string): Date | null {
  if (!v) return null
  const t = v.trim()
  if (/^\d{10}(\.\d+)?$/.test(t)) return new Date(Number(t) * 1000)
  if (/^\d{13}$/.test(t)) return new Date(Number(t))
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) { const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d }
  const iso = DateTime.fromISO(t.replace(' ', 'T'), { zone: timeZone })
  if (iso.isValid) return iso.toJSDate()
  for (const f of ['M/d/yyyy H:mm:ss', 'M/d/yyyy H:mm', 'M/d/yyyy h:mm a', 'M/d/yyyy h:mm:ss a', 'yyyy-MM-dd HH:mm:ss']) {
    const d = DateTime.fromFormat(t, f, { zone: timeZone })
    if (d.isValid) return d.toJSDate()
  }
  return null
}

/** The disposition as an outcome: this dialer's own codes first, then the common ones. */
export function outcomeOf(disposition: string, custom: Record<string, string>): Outcome | null {
  const k = squash(disposition)
  for (const [code, out] of Object.entries(custom)) if (squash(code) === k && OUTCOME_KEYS.includes(out as Outcome)) return out as Outcome
  return DEFAULT_DISPOSITIONS[k] ?? null
}

// ------------------------------------------------------------------ finding the lead and the agent

type LeadRow = Pick<DialerLead, 'id' | 'ownerId' | 'phone' | 'phone2' | 'externalId' | 'duplicate' | 'inLatestImport' | 'lastActionAt' | 'updatedAt'>
const leadSel = { id: true, ownerId: true, phone: true, phone2: true, externalId: true, duplicate: true, inLatestImport: true, lastActionAt: true, updatedAt: true } as const

/** The best of several leads: the agent's own, then one in a current import and not a duplicate, then the most recently worked. */
function best(rows: LeadRow[], agentId: string | null): LeadRow | null {
  if (!rows.length) return null
  const score = (l: LeadRow) => (agentId && l.ownerId === agentId ? 4 : 0) + (l.inLatestImport ? 2 : 0) + (l.duplicate ? 0 : 1)
  return [...rows].sort((a, b) => score(b) - score(a) || (b.lastActionAt?.getTime() ?? b.updatedAt.getTime()) - (a.lastActionAt?.getTime() ?? a.updatedAt.getTime()))[0]
}

export async function findLead(c: ReadCall, agentId: string | null): Promise<{ lead: LeadRow | null; matchedBy: string | null }> {
  if (c.leadId) {
    const l = await prisma.dialerLead.findUnique({ where: { id: c.leadId }, select: leadSel })
    if (l) return { lead: l, matchedBy: 'lead_id' }
  }
  if (c.crmId) {
    const rows = await prisma.dialerLead.findMany({ where: { externalId: { equals: c.crmId, mode: 'insensitive' } }, select: leadSel })
    const l = best(rows, agentId)
    if (l) return { lead: l, matchedBy: 'crm_id' }
  }
  const d = digitsOf(c.phone)
  if (d.length >= 7) {
    // The last 7 digits narrow it in the database; the full number decides.
    const tail = d.slice(-7)
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DialerLead"
      WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 7) = ${tail}
         OR right(regexp_replace(coalesce(phone2, ''), '\\D', '', 'g'), 7) = ${tail}
      LIMIT 200`
    const cands = rows.length ? await prisma.dialerLead.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: leadSel }) : []
    const same = cands.filter((l) => digitsOf(l.phone) === d || digitsOf(l.phone2) === d)
    const l = best(same, agentId)
    if (l) return { lead: l, matchedBy: 'phone' }
  }
  return { lead: null, matchedBy: null }
}

/** The Metriq person for the dialer's agent: mapped by a manager, else the same email, else the same name. */
export async function findAgent(raw: string | null, agentMap: Record<string, string>): Promise<string | null> {
  if (!raw) return null
  const mapped = Object.entries(agentMap).find(([k]) => k.trim().toLowerCase() === raw.trim().toLowerCase())?.[1]
  if (mapped) return (await prisma.user.findFirst({ where: { id: mapped, isActive: true }, select: { id: true } }))?.id ?? null
  const u = await prisma.user.findFirst({
    where: { isActive: true, status: 'ACTIVE', OR: [{ email: { equals: raw.trim(), mode: 'insensitive' } }, { name: { equals: raw.trim(), mode: 'insensitive' } }] },
    select: { id: true },
  })
  return u?.id ?? null
}

// ------------------------------------------------------------------ the call on the lead

const fmtDur = (s: number | null) => (s == null ? null : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`)

/**
 * Log a matched call on its lead and update the lead. Runs in one transaction.
 * Returns what changed, in words, for the call log.
 */
export async function applyToLead(callId: string, leadId: string, outcome: Outcome | null, c: { disposition: string; notes: string | null; agentId: string | null; agentRaw: string | null; durationSec: number | null; calledAt: Date; callbackAt: Date | null }): Promise<string> {
  const settings = await loadSettings()
  const lead = await prisma.dialerLead.findUniqueOrThrow({ where: { id: leadId } })
  const by = c.agentId ?? lead.ownerId
  const now = new Date()
  const changes: string[] = []
  const data: Prisma.DialerLeadUpdateInput = { lastActionAt: c.calledAt > now ? now : c.calledAt }
  // The call is activity: the follow-up clock starts again from it.
  if (!lead.lastActivityAt || lead.lastActivityAt < c.calledAt) data.lastActivityAt = c.calledAt

  const target = outcome ? STATUS_OF[outcome] : undefined
  let statusChange: Prisma.DialerStatusChangeCreateManyInput | null = null
  if (target && target.status !== lead.status) {
    const stage = settings.stageMap[target.status] ?? lead.stage
    // Same stage: the later status in the list is the more telling one (Voicemail Sent after Contact Attempted).
    const order = (st: string) => (STATUSES as readonly string[]).indexOf(st)
    const sameStageForward = stage === lead.stage && order(lead.status) >= 0 && order(target.status) > order(lead.status)
    if (target.always || stage > lead.stage || sameStageForward) {
      data.status = target.status
      data.stage = stage
      data.maxStage = Math.max(lead.maxStage, stage)
      data.statusChangedAt = now
      // A new status means the lead moved on: an old snooze or drop no longer applies.
      data.followUpDropped = false
      statusChange = { leadId, fromStatus: lead.status, toStatus: target.status, fromStage: lead.stage, toStage: stage }
      changes.push(`${lead.status} → ${target.status}`)
    }
  }
  if (outcome === 'CALLBACK') {
    const at = c.callbackAt && c.callbackAt > now ? c.callbackAt : new Date(now.getTime() + 24 * 3600_000)
    data.callLaterAt = at
    data.snoozeUntil = null
    changes.push(`call back ${DateTime.fromJSDate(at).setZone('Asia/Karachi').toFormat('ccc d LLL, h:mm a')} PKT${c.callbackAt && c.callbackAt > now ? '' : ' (no time sent: tomorrow)'}`)
  }
  if (outcome === 'DNC' && !lead.doNotCall) {
    Object.assign(data, { doNotCall: true, doNotCallAt: now, callLaterAt: null, snoozeUntil: null })
    changes.push('Do not call: removed from dialing')
  }
  if (outcome === 'WRONG_NUMBER' && !lead.wrongNumber) {
    Object.assign(data, { wrongNumber: true, callLaterAt: null })
    changes.push('wrong number: removed from dialing until the phone changes')
  }
  if (outcome === 'NOT_INTERESTED') data.callLaterAt = null
  if (changes.length && settings.earthzoneTick) {
    data.needsCrmUpdate = true
    const what = `Dialer ${DateTime.fromJSDate(c.calledAt).setZone('Asia/Karachi').toFormat('d LLL')}: ${changes.join(', ')}`
    data.crmUpdateWhat = lead.crmUpdateWhat ? `${lead.crmUpdateWhat}; ${what}`.slice(-500) : what
  }

  const summary = [OUTCOMES[outcome as Outcome] ?? `"${c.disposition}" (not mapped)`, fmtDur(c.durationSec), c.agentId ? null : c.agentRaw ? `agent ${c.agentRaw}` : null].filter(Boolean).join(' · ')
  const effect = changes.join('; ') || 'logged'
  await prisma.$transaction([
    prisma.dialerLead.update({ where: { id: leadId }, data }),
    ...(statusChange ? [prisma.dialerStatusChange.create({ data: statusChange })] : []),
    // In the lead's timeline and "worked on today" (it leaves Overdue).
    prisma.dialerAction.create({ data: { leadId, userId: by, kind: 'DIALER_CALL', note: summary, at: c.calledAt } }),
    ...(c.notes ? [prisma.dialerNote.create({ data: { leadId, userId: by, text: `From the dialer (${summary}): ${c.notes}`.slice(0, 4000), nextActionAt: outcome === 'CALLBACK' ? (data.callLaterAt as Date) : null } })] : []),
    prisma.dialerCall.update({ where: { id: callId }, data: { leadId, effect } }),
  ])
  return effect
}

export interface Received { ok: boolean; status: number; message: string; callId?: string; leadId?: string | null; outcome?: Outcome | null; duplicate?: boolean }

/** Everything for one message from the dialer. */
export async function receiveCall(integration: DialerIntegration, payload: Record<string, unknown>): Promise<Received> {
  const fieldMap = (integration.fieldMap ?? {}) as Partial<Record<Field | 'timeZone', string>>
  const flat = flatten(payload)
  const c = readCall(flat, fieldMap, fieldMap.timeZone || 'UTC')
  if (!c.disposition) return { ok: false, status: 400, message: 'No disposition in the message. Send it as "disposition" (or set its field name in Metriq).' }
  if (!c.phone && !c.leadId && !c.crmId) return { ok: false, status: 400, message: 'No phone number or lead ID in the message.' }
  const now = new Date()
  // A time far from now is a clock mix-up (or a test): the time Metriq received it is used.
  const calledAt = c.calledAt && Math.abs(c.calledAt.getTime() - now.getTime()) < 36 * 3600_000 ? c.calledAt : now
  const externalCallId = (c.callId ?? `auto:${crypto.createHash('sha1').update([digitsOf(c.phone), c.leadId, c.crmId, c.disposition, c.agent, Math.floor(calledAt.getTime() / 60000)].join('|')).digest('hex')}`).slice(0, 200)
  const dup = await prisma.dialerCall.findUnique({ where: { integrationId_externalCallId: { integrationId: integration.id, externalCallId } }, select: { id: true, leadId: true, outcome: true } })
  if (dup) return { ok: true, status: 200, message: 'Already logged.', callId: dup.id, leadId: dup.leadId, outcome: dup.outcome as Outcome | null, duplicate: true }

  const agentId = await findAgent(c.agent, (integration.agentMap ?? {}) as Record<string, string>)
  const outcome = outcomeOf(c.disposition, (integration.dispositionMap ?? {}) as Record<string, string>)
  const { lead, matchedBy } = await findLead(c, agentId)
  const shortPayload = JSON.parse(JSON.stringify(flat, (_k, v) => (typeof v === 'string' ? v.slice(0, 500) : v))) as Prisma.InputJsonValue
  let call
  try {
    call = await prisma.dialerCall.create({
      data: {
        integrationId: integration.id, externalCallId, leadId: null, matchedBy, agentId, agentRaw: c.agent, phone: c.phone,
        disposition: c.disposition.slice(0, 120), outcome, notes: c.notes?.slice(0, 4000) ?? null, durationSec: c.durationSec,
        calledAt, callbackAt: c.callbackAt, payload: shortPayload,
      },
    })
  } catch (e) {
    // The same call arriving twice at once: the second insert loses the race.
    if ((e as { code?: string }).code === 'P2002') return { ok: true, status: 200, message: 'Already logged.', duplicate: true }
    throw e
  }
  await prisma.dialerIntegration.update({ where: { id: integration.id }, data: { lastReceivedAt: now } })
  if (!lead) return { ok: true, status: 202, message: 'Logged, but no lead in Metriq has this number or ID. A manager can match it in Lead Dialer settings.', callId: call.id, leadId: null, outcome }
  const effect = await applyToLead(call.id, lead.id, outcome, { disposition: c.disposition, notes: c.notes, agentId, agentRaw: c.agent, durationSec: c.durationSec, calledAt, callbackAt: c.callbackAt })
  return { ok: true, status: 200, message: `Logged on the lead: ${effect}.`, callId: call.id, leadId: lead.id, outcome }
}
