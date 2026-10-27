/* eslint-disable */
// GENERATED COPY of client/src/lib/dialer.ts (and the types it uses from client/src/lib/dialerApi.ts),
// so the AI connectors see exactly what the Lead Dialer screens show: who can be called now,
// follow-ups, regions, the funnel. Keep the two in step: test/dialerView.test.ts fails when they differ.

export type RegionCode = 'ET' | 'CT' | 'MT' | 'PT'
export type StoredRegion = RegionCode | 'AZ'
export interface Slot { pktStart: string; pktEnd: string; localStart: string; localEnd: string }
export interface TimeSpan { start: string; end: string }
export interface DialerSettings {
  version?: number
  stageMap: Record<string, number>
  closed: string[]
  followUp: Record<string, number>
  highlight: { amberPct: number; redPct: number; redCount: number }
  slots: Record<RegionCode, Slot>
  clockMode: 'FIXED_PKT' | 'FIXED_LOCAL'
  peak: Record<RegionCode, string>
  minSegment: number
  weekdaysOnly: boolean
  /** Best moments to call, on the lead's clock (10 to 11 AM and 2 to 4 PM). */
  primeTimes: TimeSpan[]
  /** Mark leads whose details were added here so the rep also updates Earthzone. */
  earthzoneTick: boolean
}
export interface DialerLead {
  id: string
  ownerId: string
  ownerName: string
  company: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  stateOverride: string | null
  stateRaw: string | null
  region: StoredRegion | null
  verifyZone: boolean
  zoneOverride: RegionCode | null
  industry: string | null
  status: string
  stage: number
  maxStage: number
  source: string | null
  leadDate: string | null
  lastActivityAt: string | null
  statusChangedAt: string | null
  duplicate: boolean
  sentToLeadGen: boolean
  /** From the predictive dialer: never dial again (DNC) / the number is wrong. Imports never change these. */
  doNotCall?: boolean
  wrongNumber?: boolean
  snoozeUntil: string | null
  callLaterAt: string | null
  lastActionAt: string | null
  createdAt: string
  actionCount: number
  noteCount: number
  pinnedNote: string | null
  suggestedState: string | null
  externalId: string | null
  website: string | null
  companySize: string | null
  listName: string
  // Added here: kept by the dialer, never touched by an import.
  phone2: string | null
  email2: string | null
  linkedin: string | null
  decisionMaker: string | null
  bestTime: string | null
  tags: string[]
  needsCrmUpdate: boolean
  crmUpdateWhat: string | null
  followUpDropped: boolean
  backlogKeptAt: string | null
  lastImportId: string | null
  firstImportId: string | null
}
export interface FunnelNumbers {
  total: number; attempted: number; connected: number; positive: number
  attemptRate: number | null; connectRate: number | null; winRate: number | null; positiveRate: number | null
}

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

export interface Filters { state: string; region: string; industry: string; status: string; rep: string; list: string; date: string }
export const NO_FILTERS: Filters = { state: '', region: '', industry: '', status: '', rep: '', list: '', date: '' }

export function applyFilters(leads: DialerLead[], f: Filters, now: Date): DialerLead[] {
  const cutoff = f.date ? now.getTime() - Number(f.date) * 86400000 : null
  return leads.filter((l) => {
    if (f.state && (leadState(l) ?? '(no state)') !== f.state) return false
    if (f.region && (leadRegion(l, now) ?? '') !== f.region) return false
    if (f.industry && (l.industry ?? '(no industry)') !== f.industry) return false
    if (f.status && l.status !== f.status) return false
    if (f.rep && l.ownerId !== f.rep) return false
    if (f.list && l.listName !== f.list) return false
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
    if (f.state && (leadState(l) ?? '(no state)') !== f.state) return false
    if (f.region && (leadRegion(l, now) ?? '') !== f.region) return false
    if (f.industry && (l.industry ?? '(no industry)') !== f.industry) return false
    if (f.status && l.status !== f.status) return false
    if (f.stage && String(l.stage) !== f.stage) return false
    if (f.inStatus && daysInStatus(l, now) < Number(f.inStatus)) return false
    if (f.updated && daysSince(lastActivity(l), now) > Number(f.updated)) return false
    if (f.notes === 'yes' && !l.noteCount) return false
    if (f.notes === 'no' && l.noteCount) return false
    if (f.list && l.listName !== f.list) return false
    if (f.tag && !l.tags.includes(f.tag)) return false
    if (f.rep && l.ownerId !== f.rep) return false
    return true
  })
}
