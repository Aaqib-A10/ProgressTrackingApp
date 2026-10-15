import type { DialerLead, DialerSettings, FunnelNumbers, RegionCode } from './dialerApi'

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
  return {
    region, open, minutesLeft, minutesUntilOpen,
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

/** Can be dialed now: has a region, not finished / Do-Not-Call, not snoozed, not waiting for a manager. */
export function isDialable(l: DialerLead, s: DialerSettings, now: Date): boolean {
  return !l.duplicate && !isClosed(l, s) && !isSnoozed(l, now) && leadRegion(l, now) != null
}

export const lastActivity = (l: DialerLead) => l.lastActivityAt ?? l.statusChangedAt ?? l.createdAt
export const daysSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000))

export interface FollowUp { lead: DialerLead; days: number; threshold: number; severity: 'due' | 'late'; callBackDue: boolean }
/**
 * Leads reached or interested that went quiet (plan section 6). Finished statuses (Not
 * Interested, Not Qualified, DNC) and Working On never appear. A call-back whose time has
 * come is listed first.
 */
export function followUps(leads: DialerLead[], s: DialerSettings, now: Date): FollowUp[] {
  const out: FollowUp[] = []
  for (const l of leads) {
    if (l.duplicate || isClosed(l, s)) continue
    const callBackDue = !!l.callLaterAt && !isFuture(l.callLaterAt, now)
    const threshold = s.followUp[l.status]
    if (!callBackDue && (threshold == null || isSnoozed(l, now))) continue
    const days = daysSince(lastActivity(l), now)
    if (!callBackDue && days < threshold) continue
    out.push({ lead: l, days, threshold: threshold ?? 0, severity: threshold && days >= threshold * 2 ? 'late' : 'due', callBackDue })
  }
  return out.sort((a, b) => Number(b.callBackDue) - Number(a.callBackDue) || b.days - a.days)
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

export interface Filters { state: string; region: string; industry: string; status: string; rep: string; source: string; date: string }
export const NO_FILTERS: Filters = { state: '', region: '', industry: '', status: '', rep: '', source: '', date: '' }

export function applyFilters(leads: DialerLead[], f: Filters, now: Date): DialerLead[] {
  const cutoff = f.date ? now.getTime() - Number(f.date) * 86400000 : null
  return leads.filter((l) => {
    if (f.state && (leadState(l) ?? '(no state)') !== f.state) return false
    if (f.region && (leadRegion(l, now) ?? '') !== f.region) return false
    if (f.industry && (l.industry ?? '(no industry)') !== f.industry) return false
    if (f.status && l.status !== f.status) return false
    if (f.rep && l.ownerId !== f.rep) return false
    if (f.source && (l.source ?? '(no source)') !== f.source) return false
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
