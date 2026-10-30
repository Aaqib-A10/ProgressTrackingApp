import type { DialerLead, DialerSettings, DialerTask, FunnelNumbers, RegionCode } from './dialerApi'

/**
 * Lead Dialer logic for the screens: live clocks, which US region is open for calling from
 * Pakistan, each lead's region, what can be dialed, follow-up alerts, the funnel and the
 * state-by-status table. Plan: "Lead Dialer Dashboard, Final Plan" sections 4 to 7.
 */

export const PKT = 'Asia/Karachi'
export const REGIONS: RegionCode[] = ['ET', 'CT', 'MT', 'PT']
export const REGION_META: Record<RegionCode, { name: string; zone: string; tone: string; soft: string }> = {
  ET: { name: 'Eastern', zone: 'America/New_York', tone: 'bg-[#1E3A5F] text-white', soft: 'bg-[#1E3A5F]/10 text-[#1E3A5F]' },
  CT: { name: 'Central', zone: 'America/Chicago', tone: 'bg-[#0F766E] text-white', soft: 'bg-[#0F766E]/10 text-[#0F766E]' },
  MT: { name: 'Mountain', zone: 'America/Denver', tone: 'bg-[#92400E] text-white', soft: 'bg-[#92400E]/10 text-[#92400E]' },
  PT: { name: 'Pacific', zone: 'America/Los_Angeles', tone: 'bg-[#6D28D9] text-white', soft: 'bg-[#6D28D9]/10 text-[#6D28D9]' },
}

// ------------------------------------------------------------------ time

function parts(zone: string, d: Date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday as string }
}

/** UTC offset of a time zone at a moment, in minutes (e.g. -240 for New York in summer). */
export function offsetMinutes(zone: string, d: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT'
  const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

/** Is the US on daylight time right now? */
export function usDaylight(d = new Date()): boolean {
  const jan = offsetMinutes('America/New_York', new Date(Date.UTC(d.getUTCFullYear(), 0, 15)))
  return offsetMinutes('America/New_York', d) > jan
}

/** The next date the US changes its clocks (Pakistan does not). */
export function nextUsClockChange(d = new Date()): Date {
  const now = usDaylight(d)
  for (let i = 1; i < 370; i++) {
    const t = new Date(d.getTime() + i * 86400000)
    if (usDaylight(t) !== now) return t
  }
  return d
}

export const clock = (zone: string, d: Date) => d.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const fmtMin = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`
}
export const fmtSpan = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`)

export interface RegionWindow {
  region: RegionCode
  open: boolean
  minutesLeft: number
  minutesUntilOpen: number
  localTime: string
  /** Calling slot in Pakistan time, e.g. "7:00 PM – 12:00 AM". */
  pktSlot: string
  /** The same slot on the lead's clock. */
  localSlot: string
  weekend: boolean
  /** Inside the best hours to call (10 to 11 AM, 2 to 4 PM on the lead's clock). */
  prime: boolean
  /** Open, and closes within the hour. */
  closingSoon: boolean
  /** In prime time: minutes until it ends. Not in prime time: minutes until the next prime time today (null if none). */
  primeLeft: number | null
  primeIn: number | null
}

/**
 * Is a region open for calling now? FIXED_PKT keeps the rep's hours (the lead's local time
 * shifts when the US changes its clocks); FIXED_LOCAL keeps the lead's hours (the PKT slot
 * shifts by an hour).
 */
export function regionWindow(region: RegionCode, s: DialerSettings, now: Date): RegionWindow {
  const zone = REGION_META[region].zone
  const slot = s.slots[region]
  const diff = offsetMinutes(PKT, now) - offsetMinutes(zone, now) // PKT is this many minutes ahead
  let start: number, end: number, cur: number
  if (s.clockMode === 'FIXED_LOCAL') {
    start = toMin(slot.localStart); end = toMin(slot.localEnd); cur = parts(zone, now).minutes
  } else {
    start = toMin(slot.pktStart); end = toMin(slot.pktEnd); cur = parts(PKT, now).minutes
  }
  const len = ((end - start + 1440) % 1440) || 1440
  const since = (cur - start + 1440) % 1440
  let open = since < len
  const minutesLeft = open ? len - since : 0
  /** -1 = closed for the weekend. */
  let minutesUntilOpen = open ? 0 : (start - cur + 1440) % 1440
  const pktStart = s.clockMode === 'FIXED_LOCAL' ? start + diff : start
  const localStart = s.clockMode === 'FIXED_LOCAL' ? start : start - diff
  // US businesses are closed at weekends (the lead's local day).
  const wd = parts(zone, now).weekday
  const weekend = s.weekdaysOnly && (wd === 'Sat' || wd === 'Sun')
  if (weekend) { open = false; minutesUntilOpen = -1 } // shown as "Weekend, opens Monday"
  const local = parts(zone, now).minutes
  const spans = (s.primeTimes ?? []).map((p) => ({ a: toMin(p.start), b: toMin(p.end) }))
  const span = spans.find((p) => local >= p.a && local < p.b)
  const prime = open && !!span
  const nextPrime = weekend ? undefined : spans.filter((p) => p.a > local).sort((x, y) => x.a - y.a)[0]
  return {
    region, open, minutesLeft: open ? minutesLeft : 0, minutesUntilOpen, prime, closingSoon: open && minutesLeft <= 60,
    primeLeft: prime && span ? span.b - local : null,
    primeIn: !prime && nextPrime ? nextPrime.a - local : null,
    localTime: clock(zone, now),
    pktSlot: `${fmtMin(pktStart)} – ${fmtMin(pktStart + len)}`,
    localSlot: `${fmtMin(localStart)} – ${fmtMin(localStart + len)}`,
    weekend,
  }
}

// ------------------------------------------------------------------ leads

export const leadState = (l: DialerLead) => l.stateOverride ?? l.state
/** Region a lead is called in right now: the rep's pick for a split state, else its state's region (Arizona by season). */
export function leadRegion(l: DialerLead, now: Date): RegionCode | null {
  if (!leadState(l)) return null
  if (l.zoneOverride) return l.zoneOverride
  if (l.region === 'AZ') return usDaylight(now) ? 'PT' : 'MT'
  return (l.region as RegionCode | null) ?? null
}

const isFuture = (iso: string | null, now: Date) => !!iso && new Date(iso).getTime() > now.getTime()
export const isSnoozed = (l: DialerLead, now: Date) => isFuture(l.snoozeUntil, now) || isFuture(l.callLaterAt, now)
export const isClosed = (l: DialerLead, s: DialerSettings) => s.closed.includes(l.status)

/** Never dial: the predictive dialer reported Do-Not-Call or a wrong number. */
export const isBlocked = (l: DialerLead) => !!l.doNotCall || !!l.wrongNumber

/** Can be dialed now: has a region, not finished / Do-Not-Call / wrong number, not snoozed, not waiting for a manager. */
export function isDialable(l: DialerLead, s: DialerSettings, now: Date): boolean {
  return !l.duplicate && !isBlocked(l) && !isClosed(l, s) && !isSnoozed(l, now) && leadRegion(l, now) != null
}

export const lastActivity = (l: DialerLead) => l.lastActivityAt ?? l.statusChangedAt ?? l.createdAt
export const daysSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000))

export interface FollowUp { lead: DialerLead; days: number; threshold: number; severity: 'due' | 'late'; callBackDue: boolean }
/** Follow-up days for one lead: the owner's own setting, else the company's. */
export type FollowUpDays = Record<string, Record<string, number>> | undefined
const thresholdOf = (l: DialerLead, s: DialerSettings, by: FollowUpDays) => by?.[l.ownerId]?.[l.status] ?? s.followUp[l.status]
/**
 * Leads reached or interested that went quiet (plan section 6). Finished statuses (Not
 * Interested, Not Qualified, DNC) and Working On never appear. A call-back whose time has
 * come is listed first.
 */
export function followUps(leads: DialerLead[], s: DialerSettings, now: Date, by?: FollowUpDays): FollowUp[] {
  const out: FollowUp[] = []
  for (const l of leads) {
    if (l.duplicate || isClosed(l, s) || l.followUpDropped) continue
    const callBackDue = !!l.callLaterAt && !isFuture(l.callLaterAt, now)
    const threshold = thresholdOf(l, s, by)
    if (!callBackDue && (threshold == null || isSnoozed(l, now))) continue
    const days = daysSince(lastActivity(l), now)
    if (!callBackDue && days < threshold) continue
    out.push({ lead: l, days, threshold: threshold ?? 0, severity: threshold && days >= threshold * 2 ? 'late' : 'due', callBackDue })
  }
  return out.sort((a, b) => Number(b.callBackDue) - Number(a.callBackDue) || b.days - a.days)
}

/** Order in the follow-up tracker: Pipeline, then Interested, then Connected, then the rest; oldest first in each. */
const FU_ORDER: Record<string, number> = { Pipeline: 0, Interested: 1, Connected: 2 }
export const byFollowUpOrder = (a: { lead: DialerLead; days: number }, b: { lead: DialerLead; days: number }) =>
  (FU_ORDER[a.lead.status] ?? 3) - (FU_ORDER[b.lead.status] ?? 3) || b.days - a.days

export interface FollowUpTabs { overdue: FollowUp[]; dueToday: FollowUp[]; scheduled: FollowUp[]; snoozed: FollowUp[]; done: FollowUp[]; backlog: FollowUp[]; dropped: DialerLead[] }
/** What a rep did to each lead today: the latest action kind per lead (CALL_NOW, CALL_LATER, SNOOZE, NOTE...). */
export function latestActedToday(acted: { leadId: string; kind: string; at: string }[]): Map<string, string> {
  const m = new Map<string, { kind: string; at: string }>()
  for (const a of acted) { const cur = m.get(a.leadId); if (!cur || a.at > cur.at) m.set(a.leadId, a) }
  return new Map([...m].map(([id, a]) => [id, a.kind]))
}
/**
 * The follow-up tracker's tabs. "Today" is the rep's working day (from noon Pakistan time).
 *  - Scheduled: a call back after today (Call later, or a note's next-action date).
 *  - Due today: a call back set for today. Overdue: a call back from before today, or the
 *    follow-up days have passed. Backlog: 90+ days quiet (its own bucket), unless kept recently.
 *  - Snoozed: hidden until a date (Snooze). A lead the rep just called (Call now) is not
 *    "snoozed": it is done for today and comes back tomorrow if the CRM shows no update.
 *  - Done today: every lead worked on today, whatever happened to it (a log; a snoozed or
 *    scheduled lead also shows in its own tab).
 */
export function followUpTabs(leads: DialerLead[], s: DialerSettings, now: Date, dayStart: Date, acted: Map<string, string>, by?: FollowUpDays): FollowUpTabs {
  const dayEnd = dayStart.getTime() + 86400000
  const t: FollowUpTabs = { overdue: [], dueToday: [], scheduled: [], snoozed: [], done: [], backlog: [], dropped: [] }
  for (const l of leads) {
    if (l.duplicate) continue
    const threshold = thresholdOf(l, s, by)
    const days = daysSince(lastActivity(l), now)
    const item = (callBackDue = false): FollowUp => ({ lead: l, days, threshold: threshold ?? 0, severity: threshold && days >= threshold * 2 ? 'late' : 'due', callBackDue })
    const kind = acted.get(l.id)
    if (kind) t.done.push(item())
    if (isClosed(l, s) || isBlocked(l)) continue
    if (l.followUpDropped) { t.dropped.push(l); continue }
    const cb = l.callLaterAt ? new Date(l.callLaterAt).getTime() : null
    if (cb != null) {
      if (cb >= dayEnd) { t.scheduled.push(item()); continue }
      if (cb >= dayStart.getTime()) { t.dueToday.push(item(cb <= now.getTime())); continue }
      t.overdue.push(item(true)); continue
    }
    if (isFuture(l.snoozeUntil, now)) {
      // Call now holds the lead until tomorrow; that is "done", not a snooze the rep chose.
      if (kind !== 'CALL_NOW') t.snoozed.push(item())
      continue
    }
    if (kind) continue // worked on today: cleared from Overdue
    if (threshold == null || days < threshold) continue
    const kept = l.backlogKeptAt && now.getTime() - new Date(l.backlogKeptAt).getTime() < 30 * 86400000
    if (days >= 90 && !kept) t.backlog.push(item())
    else t.overdue.push(item())
  }
  for (const k of ['overdue', 'done', 'backlog'] as const) t[k].sort(byFollowUpOrder)
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
  t.dueToday.sort((a, b) => at(a.lead.callLaterAt) - at(b.lead.callLaterAt))
  t.scheduled.sort((a, b) => at(a.lead.callLaterAt) - at(b.lead.callLaterAt))
  t.snoozed.sort((a, b) => at(a.lead.snoozeUntil) - at(b.lead.snoozeUntil))
  return t
}

// ------------------------------------------------------------------ numbers

export function funnelOf(leads: DialerLead[], ever = false): FunnelNumbers {
  const st = leads.map((l) => (ever ? Math.max(l.maxStage, l.stage) : l.stage))
  const total = st.length
  const attempted = st.filter((x) => x >= 2).length
  const connected = st.filter((x) => x >= 3).length
  const positive = st.filter((x) => x >= 4).length
  const r = (a: number, b: number) => (b > 0 ? a / b : null)
  return { total, attempted, connected, positive, attemptRate: r(attempted, total), connectRate: r(connected, attempted), winRate: r(positive, connected), positiveRate: r(positive, total) }
}

export const pct = (v: number | null | undefined, digits = 1) => (v == null ? 'n/a' : `${(v * 100).toFixed(digits)}%`)
export const num = (n: number) => n.toLocaleString('en-US')

/**
 * A filter can hold several values (any of them matches): "Real Estate" or "Real Estate" and
 * "Healthcare". They are kept as one string, so saved views and single values keep working.
 */
export const MULTI_SEP = '\u001f'
export const multiOf = (v?: string | null): string[] => (v ? v.split(MULTI_SEP).filter(Boolean) : [])
export const joinMulti = (vs: string[]): string => [...new Set(vs)].join(MULTI_SEP)
export const multiLabel = (v?: string | null): string => multiOf(v).join(', ')
/** No filter, or the value is one of the picked ones. */
export const anyOf = (v: string | undefined | null, x: string): boolean => !v || multiOf(v).includes(x)
/** Add or take away one value. */
export const toggleMulti = (v: string | undefined | null, x: string): string => { const vs = multiOf(v); return joinMulti(vs.includes(x) ? vs.filter((y) => y !== x) : [...vs, x]) }

export interface Filters { state: string; region: string; industry: string; status: string; rep: string; list: string; date: string }
export const NO_FILTERS: Filters = { state: '', region: '', industry: '', status: '', rep: '', list: '', date: '' }

export function applyFilters(leads: DialerLead[], f: Filters, now: Date): DialerLead[] {
  const cutoff = f.date ? now.getTime() - Number(f.date) * 86400000 : null
  return leads.filter((l) => {
    if (!anyOf(f.state, leadState(l) ?? '(no state)')) return false
    if (!anyOf(f.region, leadRegion(l, now) ?? '')) return false
    if (!anyOf(f.industry, l.industry ?? '(no industry)')) return false
    if (!anyOf(f.status, l.status)) return false
    if (!anyOf(f.rep, l.ownerId)) return false
    if (!anyOf(f.list, l.listName)) return false
    if (cutoff != null && new Date(l.leadDate ?? l.createdAt).getTime() < cutoff) return false
    return true
  })
}

/** State table columns (plan 4b). */
export const STATUS_COLUMNS = [
  { key: 'assigned', label: 'Assigned / New' },
  { key: 'attempted', label: 'Contact Attempted' },
  { key: 'voicemail', label: 'Voicemail Sent' },
  { key: 'email', label: 'Email / Lead Gen' },
  { key: 'connected', label: 'Connected' },
  { key: 'working', label: 'Working On' },
  { key: 'positive', label: 'Interested / Pipeline' },
  { key: 'closed', label: 'Closed (NI / NQ / DNC)' },
] as const
export type StatusColumn = (typeof STATUS_COLUMNS)[number]['key']

export function columnOf(l: DialerLead, s: DialerSettings): StatusColumn {
  if (l.stage <= 1) return 'assigned'
  if (l.stage === 2) return l.status === 'Contact Attempted' ? 'attempted' : l.status === 'Voicemail Sent' ? 'voicemail' : 'email'
  if (l.stage >= 4) return 'positive'
  if (l.status === 'Working On') return 'working'
  return s.closed.includes(l.status) ? 'closed' : 'connected'
}

export interface StateRow { state: string; region: RegionCode | null; cells: Record<StatusColumn, number>; total: number; stuck: number; stuckShare: number; flag: 'red' | 'amber' | null }
/** Where leads are sitting, by state and status, with the stuck flag (tried, not converted). */
export function stateTable(leads: DialerLead[], s: DialerSettings, now: Date): StateRow[] {
  const m = new Map<string, StateRow>()
  for (const l of leads) {
    const st = leadState(l)
    if (!st || l.duplicate) continue
    let row = m.get(st)
    if (!row) {
      row = { state: st, region: leadRegion(l, now), cells: { assigned: 0, attempted: 0, voicemail: 0, email: 0, connected: 0, working: 0, positive: 0, closed: 0 }, total: 0, stuck: 0, stuckShare: 0, flag: null }
      m.set(st, row)
    }
    row.cells[columnOf(l, s)]++
    row.total++
  }
  for (const r of m.values()) {
    r.stuck = r.cells.attempted + r.cells.voicemail
    r.stuckShare = r.total ? r.stuck / r.total : 0
    const h = s.highlight
    r.flag = r.stuckShare * 100 >= h.redPct || r.cells.attempted > h.redCount || r.cells.voicemail > h.redCount ? 'red' : r.stuckShare * 100 >= h.amberPct ? 'amber' : null
  }
  return [...m.values()].sort((a, b) => b.total - a.total)
}

export interface Segment { key: string; leads: DialerLead[]; funnel: FunnelNumbers; stuckShare: number }
/** Group leads by any field, with the funnel for each group. */
export function segments(leads: DialerLead[], keyOf: (l: DialerLead) => string, ever = false): Segment[] {
  const m = new Map<string, DialerLead[]>()
  for (const l of leads) { const k = keyOf(l); const a = m.get(k); if (a) a.push(l); else m.set(k, [l]) }
  return [...m.entries()].map(([key, ls]) => ({
    key, leads: ls, funnel: funnelOf(ls, ever),
    stuckShare: ls.length ? ls.filter((l) => l.status === 'Contact Attempted' || l.status === 'Voicemail Sent').length / ls.length : 0,
  })).sort((a, b) => b.leads.length - a.leads.length)
}

/** "Sep 12" */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** State names for the Fix data picker (the server checks them against its states-by-region table). */
export const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming']

// ------------------------------------------------------------------ All leads: search, filters, saved views

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
/** One box: name, company, phone (formatting ignored, so 5551234567 finds (555) 123-4567), email or city. */
export function matchesSearch(l: DialerLead, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  const d = onlyDigits(t)
  if (d.length >= 3 && (onlyDigits(l.phone).includes(d) || onlyDigits(l.phone2).includes(d))) return true
  return [l.company, l.contactName, l.email, l.email2, l.city, l.decisionMaker, l.externalId].some((v) => v && v.toLowerCase().includes(t))
}

/**
 * Days in the current status. When Metriq saw the status change (a later import), count from
 * then; when the status is the same as the first time the lead was imported, Metriq cannot know
 * when it started, so use the CRM's last activity (or the lead date).
 */
export function daysInStatus(l: DialerLead, now: Date): number {
  const seenChange = l.statusChangedAt && new Date(l.statusChangedAt).getTime() - new Date(l.createdAt).getTime() > 60000
  return daysSince(seenChange ? l.statusChangedAt! : l.lastActivityAt ?? l.leadDate ?? l.createdAt, now)
}

/** Ready-made views. Each agent sees only their own leads, so none of them needs per-agent setup. */
export const PRESET_VIEWS: { id: string; name: string; hint: string }[] = [
  { id: 'all', name: 'All leads', hint: 'Every lead in your latest import.' },
  { id: 'pipeline', name: 'My pipeline', hint: 'Interested and Pipeline leads.' },
  { id: 'never', name: 'Never attempted', hint: 'Assigned and New Data: the freshest, easiest first dials.' },
  { id: 'stuck', name: 'Stuck', hint: 'Voicemail Sent or Contact Attempted with no change for 7 days or more.' },
  { id: 'nostate', name: 'No state', hint: 'Leads that need fixing before they count in a region.' },
  { id: 'changed', name: 'Changed since last import', hint: 'The status changed in your latest import.' },
  { id: 'earthzone', name: 'Needs Earthzone update', hint: 'Something added here should also go into Earthzone.' },
]

export interface LeadFilters { preset?: string; q?: string; state?: string; region?: string; industry?: string; status?: string; stage?: string; inStatus?: string; updated?: string; notes?: string; list?: string; tag?: string; rep?: string
  /** Who can be called: 'now', 'prime' (in prime time now), or a Pakistan time 'HH:MM' (the next time the clock shows it). */
  callAt?: string
}

/** The next moment (from now, within 24 hours) the Pakistan clock shows HH:MM. */
export function nextPktTime(hhmm: string, now: Date): Date {
  const delta = (toMin(hhmm) - parts(PKT, now).minutes + 1440) % 1440
  const d = new Date(now.getTime() + delta * 60_000)
  d.setSeconds(0, 0)
  return d
}

/** "11:30 PM" for a Pakistan 'HH:MM'. */
export const fmtPkt = (hhmm: string) => fmtMin(toMin(hhmm))

/** Can this lead be called at that moment: dialable then, and its region inside calling hours (and prime time if asked). */
export function callableAt(l: DialerLead, s: DialerSettings, at: Date, primeOnly = false): boolean {
  if (!isDialable(l, s, at)) return false
  const r = leadRegion(l, at)
  if (!r) return false
  const w = regionWindow(r, s, at)
  return primeOnly ? w.prime : w.open
}

export function presetMatch(l: DialerLead, preset: string | undefined, now: Date, lastImport: { id: string; at: Date } | null): boolean {
  switch (preset) {
    case 'pipeline': return l.status === 'Interested' || l.status === 'Pipeline'
    case 'never': return l.status === 'Assigned' || l.status === 'New Data'
    case 'stuck': return (l.status === 'Voicemail Sent' || l.status === 'Contact Attempted') && daysInStatus(l, now) >= 7
    case 'nostate': return !leadState(l)
    case 'changed':
      // In the latest import, not new in it, and its status changed at that import.
      return !!lastImport && !!l.statusChangedAt && l.lastImportId === lastImport.id && l.firstImportId !== lastImport.id && new Date(l.statusChangedAt).getTime() >= lastImport.at.getTime() - 5000
    case 'earthzone': return l.needsCrmUpdate
    default: return true
  }
}

export function filterLeads(leads: DialerLead[], f: LeadFilters, now: Date, lastImport: { id: string; at: Date } | null, s?: DialerSettings): DialerLead[] {
  const callAt = s && f.callAt ? (f.callAt === 'now' || f.callAt === 'prime' ? now : /^\d{2}:\d{2}$/.test(f.callAt) ? nextPktTime(f.callAt, now) : null) : null
  return leads.filter((l) => {
    if (callAt && s && !callableAt(l, s, callAt, f.callAt === 'prime')) return false
    if (l.duplicate) return false
    if (!presetMatch(l, f.preset, now, lastImport)) return false
    if (f.q && !matchesSearch(l, f.q)) return false
    if (!anyOf(f.state, leadState(l) ?? '(no state)')) return false
    if (!anyOf(f.region, leadRegion(l, now) ?? '')) return false
    if (!anyOf(f.industry, l.industry ?? '(no industry)')) return false
    if (!anyOf(f.status, l.status)) return false
    if (!anyOf(f.stage, String(l.stage))) return false
    if (f.inStatus && daysInStatus(l, now) < Number(f.inStatus)) return false
    if (f.updated && daysSince(lastActivity(l), now) > Number(f.updated)) return false
    if (f.notes === 'yes' && !l.noteCount) return false
    if (f.notes === 'no' && l.noteCount) return false
    if (!anyOf(f.list, l.listName)) return false
    if (f.tag && !multiOf(f.tag).some((t) => l.tags.includes(t))) return false
    if (!anyOf(f.rep, l.ownerId)) return false
    return true
  })
}

// ------------------------------------------------------------------ Follow-ups (ITAD revised spec, 30 Oct 2026)

/**
 * Touches, days quiet and the follow-up list. The stages and statuses stay as Metriq has them;
 * the three follow-up stage cards are the statuses that have follow-up days (Pipeline 7,
 * Interested 14, Connected 30 by default).
 */

/** The latest touch: the CRM's Updated At, or a touch added here if that is later. */
export const lastTouched = (l: DialerLead) => l.lastTouchedAt ?? l.lastActivityAt ?? l.leadDate ?? l.createdAt
/** Still Assigned and never worked: no touch was ever added here. */
export const neverWorked = (l: DialerLead) => l.status === 'Assigned' && !l.manualTouches
/** Days quiet: from the assignment (Created At) for a lead never worked, else from the last touch. */
export function daysQuiet(l: DialerLead, now: Date): number {
  return daysSince(neverWorked(l) ? l.leadDate ?? l.createdAt : lastTouched(l), now)
}
/** The follow-up rule for a lead (days), or null when its status has none. */
export const ruleDays = (l: DialerLead, s: DialerSettings, by?: FollowUpDays): number | null => thresholdOf(l, s, by) ?? null

/** Quiet longer than its rule, and nothing else is holding it (closed, dropped, snoozed, a call back set). */
export function isRuleDue(l: DialerLead, s: DialerSettings, now: Date, by?: FollowUpDays): boolean {
  if (l.duplicate || isClosed(l, s) || isBlocked(l) || l.followUpDropped || l.callLaterAt || isFuture(l.snoozeUntil, now)) return false
  const rule = ruleDays(l, s, by)
  return rule != null && daysQuiet(l, now) >= rule
}

/**
 * How far past its rule a lead is, 0 (not due) to 4 (severe). Measured against the rule, so
 * 125 days on a 7-day rule is severe and 105 days on a 30-day rule is moderate.
 */
export function overdueLevel(days: number, rule: number | null): 0 | 1 | 2 | 3 | 4 {
  if (!rule || days < rule) return 0
  const r = days / rule
  return r < 2 ? 1 : r < 4 ? 2 : r < 8 ? 3 : 4
}

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'done'
/** Where a task sits on the strip. Today runs from the rep's day start (noon Pakistan time). Cancelled and older done tasks: null. */
export function taskBucket(t: DialerTask, now: Date, dayStart: Date): TaskBucket | null {
  const end = dayStart.getTime() + 86400000
  if (t.status === 'CANCELLED') return null
  if (t.status === 'DONE') return t.doneAt && new Date(t.doneAt).getTime() >= dayStart.getTime() ? 'done' : null
  const due = t.dueAt ? new Date(t.dueAt).getTime() : null
  if (due == null) return 'upcoming'
  if (due < now.getTime()) return 'overdue'
  return due < end ? 'today' : 'upcoming'
}

export const OUTCOMES = [
  { key: 'NO_ANSWER', label: 'No answer' },
  { key: 'VOICEMAIL', label: 'Voicemail' },
  { key: 'GATEKEEPER', label: 'Gatekeeper' },
  { key: 'CONNECTED', label: 'Connected' },
  { key: 'WRONG_NUMBER', label: 'Wrong number' },
] as const
export const outcomeLabel = (k: string | null | undefined) => OUTCOMES.find((o) => o.key === k)?.label ?? k ?? ''
export const TASK_KINDS = [{ key: 'CALL', label: 'Call' }, { key: 'EMAIL', label: 'Email' }, { key: 'TODO', label: 'To-do' }] as const

export interface FollowUpRow {
  lead: DialerLead
  days: number
  rule: number | null
  level: 0 | 1 | 2 | 3 | 4
  ruleDue: boolean
  /** Open tasks on the lead, the earliest due first. */
  tasks: DialerTask[]
  /** Tasks ticked today. */
  done: DialerTask[]
  /** Why it is here, in a few words: "call back due 22 Oct", "quiet 85 days, rule 7". */
  why: string
  callNow: boolean
}

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const KIND_DUE: Record<string, string> = { CALL: 'call', EMAIL: 'email', TODO: 'to-do' }

/** One row per lead that needs following up (quiet past its rule) or has a task. */
export function followUpRows(leads: DialerLead[], tasks: DialerTask[], s: DialerSettings, now: Date, by?: FollowUpDays, includeAll = false): FollowUpRow[] {
  const open = new Map<string, DialerTask[]>()
  const done = new Map<string, DialerTask[]>()
  for (const t of tasks) {
    const m = t.status === 'OPEN' ? open : t.status === 'DONE' ? done : null
    if (m) { const a = m.get(t.leadId) ?? []; a.push(t); m.set(t.leadId, a) }
  }
  const out: FollowUpRow[] = []
  for (const l of leads) {
    if (l.duplicate) continue
    const ts = (open.get(l.id) ?? []).sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'))
    const rule = ruleDays(l, s, by)
    const ruleDue = isRuleDue(l, s, now, by)
    const inStage = rule != null && !isClosed(l, s) && !l.followUpDropped
    const dn = done.get(l.id) ?? []
    if (!ruleDue && !ts.length && !dn.length && !(includeAll && inStage)) continue
    const days = daysQuiet(l, now)
    const first = ts.find((t) => t.reason !== 'FOLLOW_UP_RULE') ?? null
    const why = neverWorked(l) ? `Assigned ${days}d ago, never worked`
      : first?.dueAt ? `${first.reason === 'CALL_LATER' ? 'call back' : KIND_DUE[first.kind] ?? 'task'} due ${dayMonth(first.dueAt)}`
        : ruleDue && rule != null ? `quiet ${days} days, rule ${rule}`
          : rule != null ? `rule ${rule} days` : ''
    const r = leadRegion(l, now)
    out.push({ lead: l, days, rule, level: ruleDue ? overdueLevel(days, rule) : 0, ruleDue, tasks: ts, done: dn, why, callNow: isDialable(l, s, now) && !!r && regionWindow(r, s, now).open })
  }
  return out
}

export const FU_SORT_FIELDS = [
  { key: 'stage', label: 'Stage' },
  { key: 'overdue', label: 'Days overdue' },
  { key: 'callNow', label: 'Can call now' },
  { key: 'region', label: 'Region' },
  { key: 'industry', label: 'Industry' },
  { key: 'state', label: 'State' },
  { key: 'company', label: 'Company' },
  { key: 'quiet', label: 'Days quiet' },
  { key: 'touched', label: 'Last touched' },
  { key: 'tries', label: 'Tries, same status' },
  { key: 'due', label: 'Task due' },
] as const
export type FuSortKey = (typeof FU_SORT_FIELDS)[number]['key']
export interface FuSort { key: FuSortKey; dir: 'asc' | 'desc' }
/** Default order: stage (Pipeline, Interested, Connected), most overdue, can call now, region, industry. */
export const DEFAULT_FU_SORT: FuSort[] = [{ key: 'stage', dir: 'asc' }, { key: 'overdue', dir: 'desc' }, { key: 'callNow', dir: 'desc' }, { key: 'region', dir: 'asc' }, { key: 'industry', dir: 'asc' }]
export const sortToParam = (s: FuSort[]) => s.map((x) => `${x.key}:${x.dir}`).join(',')
export function sortFromParam(v: string | null | undefined): FuSort[] {
  if (!v) return DEFAULT_FU_SORT
  const keys = FU_SORT_FIELDS.map((f) => f.key as string)
  const out = v.split(',').map((x) => x.split(':')).filter(([k, d]) => keys.includes(k) && (d === 'asc' || d === 'desc')).map(([k, d]) => ({ key: k as FuSortKey, dir: d as 'asc' | 'desc' }))
  return out.length ? out : DEFAULT_FU_SORT
}

const STAGE_RANK: Record<string, number> = { Pipeline: 0, Interested: 1, Connected: 2 }
function sortValue(r: FollowUpRow, k: FuSortKey, now: Date): number | string {
  switch (k) {
    case 'stage': return STAGE_RANK[r.lead.status] ?? 3
    case 'overdue': return r.rule != null && r.ruleDue ? r.days - r.rule : -1
    case 'callNow': return r.callNow ? 1 : 0
    case 'region': return leadRegion(r.lead, now) ?? 'ZZ'
    case 'industry': return (r.lead.industry ?? '~').toLowerCase()
    case 'state': return (leadState(r.lead) ?? '~').toLowerCase()
    case 'company': return r.lead.company.toLowerCase()
    case 'quiet': return r.days
    case 'touched': return new Date(lastTouched(r.lead)).getTime()
    case 'tries': return r.lead.tries ?? 0
    case 'due': return r.tasks[0]?.dueAt ? new Date(r.tasks[0].dueAt).getTime() : Number.MAX_SAFE_INTEGER
  }
}
export function sortFollowUps(rows: FollowUpRow[], sort: FuSort[], now: Date): FollowUpRow[] {
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const x = sortValue(a, s.key, now), y = sortValue(b, s.key, now)
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
      if (c) return s.dir === 'asc' ? c : -c
    }
    return a.lead.company.localeCompare(b.lead.company)
  })
}

/**
 * Follow-up filters, all kept in the address bar. Quiet for: more than / less than / between
 * (days). Last activity: a date range. Task due within the next N days. Attempts: 0, 1, 2, 3+.
 */
export interface FuFilters {
  q?: string; stage?: string; task?: string; state?: string; region?: string; industry?: string
  attempts?: string; reattempt?: string; tries?: string; callNow?: string
  quietOp?: string; quietA?: string; quietB?: string
  actFrom?: string; actTo?: string; dueIn?: string; touchedAgo?: string; all?: string
}
export const FU_FILTER_KEYS: (keyof FuFilters)[] = ['q', 'stage', 'task', 'state', 'region', 'industry', 'attempts', 'reattempt', 'tries', 'callNow', 'quietOp', 'quietA', 'quietB', 'actFrom', 'actTo', 'dueIn', 'touchedAgo', 'all']

/** Every filter but the task strip's (the strip counts what the other filters leave). */
export function filterFollowUps(rows: FollowUpRow[], f: FuFilters, now: Date, dayStart: Date, skipTask = false): FollowUpRow[] {
  const n = (v?: string) => (v == null || v === '' ? null : Number(v))
  const qa = n(f.quietA), qb = n(f.quietB), tries = n(f.tries), dueIn = n(f.dueIn), ago = n(f.touchedAgo)
  const from = f.actFrom ? new Date(`${f.actFrom}T00:00:00`).getTime() : null
  const to = f.actTo ? new Date(`${f.actTo}T23:59:59`).getTime() : null
  return rows.filter((r) => {
    const l = r.lead
    if (f.q && !matchesSearch(l, f.q)) return false
    if (!anyOf(f.stage, l.status)) return false
    if (!anyOf(f.state, leadState(l) ?? '(no state)')) return false
    if (!anyOf(f.region, leadRegion(l, now) ?? '')) return false
    if (!anyOf(f.industry, l.industry ?? '(no industry)')) return false
    if (f.attempts) { const a = l.attempts ?? 0; if (!multiOf(f.attempts).some((x) => (x === '3+' ? a >= 3 : a === Number(x)))) return false }
    if (f.reattempt === 'yes' && !(l.reAttempts ?? 0)) return false
    if (tries != null && (l.tries ?? 0) < tries) return false
    if (f.callNow === '1' && !r.callNow) return false
    if (qa != null && f.quietOp === 'gt' && !(r.days > qa)) return false
    if (qa != null && f.quietOp === 'lt' && !(r.days < qa)) return false
    if (qa != null && qb != null && f.quietOp === 'between' && !(r.days >= Math.min(qa, qb) && r.days <= Math.max(qa, qb))) return false
    if (from != null || to != null) {
      const t = new Date(lastTouched(l)).getTime()
      if ((from != null && t < from) || (to != null && t > to)) return false
    }
    if (ago != null && daysSince(lastTouched(l), now) <= ago) return false
    if (dueIn != null) {
      const limit = now.getTime() + dueIn * 86400000
      if (!r.tasks.some((t) => t.dueAt && new Date(t.dueAt).getTime() <= limit)) return false
    }
    if (!skipTask && f.task) {
      const want = multiOf(f.task)
      if (![...r.tasks, ...r.done].some((t) => want.includes(taskBucket(t, now, dayStart) ?? ''))) return false
    }
    return true
  })
}
