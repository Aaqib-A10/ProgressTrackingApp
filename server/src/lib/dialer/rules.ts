/**
 * Lead Dialer rules: the statuses, which funnel stage each one counts as, and the settings an
 * admin can change (follow-up days, highlight thresholds, calling slots, clock mode).
 *
 * Stages (plan section 7):
 *   1 New or assigned      Assigned, New Data, Unknown (blank)
 *   2 Attempted            Contact Attempted, Voicemail Sent, Email Sent, Report to Lead Gen
 *   3 Connected            Connected, Not Interested, Not Qualified, DNC, Working On
 *   4 Positive             Interested, Pipeline
 */

export const STATUSES = [
  'Assigned', 'New Data', 'Unknown',
  'Contact Attempted', 'Voicemail Sent', 'Email Sent', 'Report to Lead Gen',
  'Connected', 'Not Interested', 'Not Qualified', 'DNC', 'Working On',
  'Interested', 'Pipeline',
] as const

export const DEFAULT_STAGE_MAP: Record<string, number> = {
  Assigned: 1, 'New Data': 1, Unknown: 1,
  'Contact Attempted': 2, 'Voicemail Sent': 2, 'Email Sent': 2, 'Report to Lead Gen': 2,
  Connected: 3, 'Not Interested': 3, 'Not Qualified': 3, DNC: 3, 'Working On': 3,
  Interested: 4, Pipeline: 4,
}

export interface Slot { pktStart: string; pktEnd: string; localStart: string; localEnd: string }
export interface TimeSpan { start: string; end: string }
export interface DialerSettingsData {
  /** 2 = calling hours 9 to 5 local with prime time (ITAD request, Oct 2026). Older stored settings are upgraded. */
  version: number
  stageMap: Record<string, number>
  /** Statuses never counted as dialable and never followed up (finished, or already being handled). */
  closed: string[]
  /** Days without activity before a lead in this status is flagged for follow-up. */
  followUp: Record<string, number>
  /** State table highlight: amber / red when Contact Attempted + Voicemail Sent reach this share, or one cell passes redCount. */
  highlight: { amberPct: number; redPct: number; redCount: number }
  /** Calling slots per region, in Pakistan time and in the lead's local time. */
  slots: Record<'ET' | 'CT' | 'MT' | 'PT', Slot>
  /** FIXED_PKT: the rep's hours stay the same. FIXED_LOCAL: the lead's local hours stay the same. */
  clockMode: 'FIXED_PKT' | 'FIXED_LOCAL'
  /** Best hours per region, as given by management (shown on the cards). */
  peak: Record<'ET' | 'CT' | 'MT' | 'PT', string>
  /** Rates are hidden (n/a) for groups with fewer leads than this. */
  minSegment: number
  /** US businesses are closed at weekends: regions show closed on Saturday and Sunday (lead's local day). */
  weekdaysOnly: boolean
  /** Best moments to call, on the lead's local clock (mid morning and after lunch). */
  primeTimes: TimeSpan[]
  /** Mark leads whose details were added here so the rep also updates Earthzone (the CRM). */
  earthzoneTick: boolean
  /**
   * Touches at import (ITAD spec, 30 Oct 2026): when more than this share (%) of the leads in an
   * import get the same new Updated At, it was a bulk update (or a batch of new leads), not calls.
   */
  bulkUpdatePct: number
  /** Follow-up rows that show the one-tap outcome chips after Call now. */
  outcomeChipStatuses: string[]
  /** Reminders for Lead Dialer tasks, in minutes before the due time (0 = at the due time). */
  taskReminders: number[]
}

/** Each rep may set their own follow-up days within these limits. */
export const FOLLOW_UP_MIN = 3
export const FOLLOW_UP_MAX = 60

// Calling hours: 9 AM to 5 PM on the lead's own clock for every region (the PKT times are only
// shown for reference in fixed-local mode). Prime time 10 to 11 AM and 2 to 4 PM local.
const LOCAL_9_TO_5: Record<'ET' | 'CT' | 'MT' | 'PT', Slot> = {
  ET: { pktStart: '18:00', pktEnd: '02:00', localStart: '09:00', localEnd: '17:00' },
  CT: { pktStart: '19:00', pktEnd: '03:00', localStart: '09:00', localEnd: '17:00' },
  MT: { pktStart: '20:00', pktEnd: '04:00', localStart: '09:00', localEnd: '17:00' },
  PT: { pktStart: '21:00', pktEnd: '05:00', localStart: '09:00', localEnd: '17:00' },
}
const PRIME = '10 to 11 AM and 2 to 4 PM'

export const DEFAULT_SETTINGS: DialerSettingsData = {
  version: 2,
  stageMap: DEFAULT_STAGE_MAP,
  closed: ['Not Interested', 'Not Qualified', 'DNC', 'Working On'],
  followUp: { Connected: 30, Interested: 14, Pipeline: 7 },
  highlight: { amberPct: 30, redPct: 50, redCount: 50 },
  slots: LOCAL_9_TO_5,
  clockMode: 'FIXED_LOCAL',
  peak: { ET: PRIME, CT: PRIME, MT: PRIME, PT: PRIME },
  minSegment: 20,
  weekdaysOnly: true,
  primeTimes: [{ start: '10:00', end: '11:00' }, { start: '14:00', end: '16:00' }],
  earthzoneTick: true,
  bulkUpdatePct: 20,
  outcomeChipStatuses: ['Pipeline', 'Interested'],
  taskReminders: [15, 0],
}

const CANON = new Map<string, string>(STATUSES.map((s) => [s.toLowerCase(), s]))
// Common spellings seen in CRM exports.
for (const [k, v] of Object.entries({
  'new': 'New Data', 'newdata': 'New Data', 'contacted attempted': 'Contact Attempted', 'attempted': 'Contact Attempted',
  'voicemail': 'Voicemail Sent', 'voice mail sent': 'Voicemail Sent', 'vm sent': 'Voicemail Sent', 'left voicemail': 'Voicemail Sent',
  'email': 'Email Sent', 'emailed': 'Email Sent', 'report to leadgen': 'Report to Lead Gen', 'reported to lead gen': 'Report to Lead Gen',
  'not intrested': 'Not Interested', 'notinterested': 'Not Interested', 'not qualify': 'Not Qualified', 'unqualified': 'Not Qualified',
  'do not call': 'DNC', 'do-not-call': 'DNC', 'd.n.c': 'DNC', 'working': 'Working On', 'working on it': 'Working On',
  'intrested': 'Interested', 'in pipeline': 'Pipeline',
})) CANON.set(k, v)

/** Tidy a status: extra spaces removed, known spellings unified, blank = Unknown. Unknown spellings are kept as written. */
export function normalizeStatus(raw: string | null | undefined): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Unknown'
  return CANON.get(t.toLowerCase()) ?? t
}

/** Stage of a status under the admin's stage map; a status the map does not know counts as stage 1. */
export function stageOf(status: string, settings: DialerSettingsData): number {
  return settings.stageMap[status] ?? 1
}

export interface FunnelNumbers {
  total: number; attempted: number; connected: number; positive: number
  attemptRate: number | null; connectRate: number | null; winRate: number | null; positiveRate: number | null
}
const rate = (a: number, b: number) => (b > 0 ? a / b : null)
/** Funnel numbers from a list of stages (plan section 7). */
export function funnel(stages: number[]): FunnelNumbers {
  const total = stages.length
  const attempted = stages.filter((s) => s >= 2).length
  const connected = stages.filter((s) => s >= 3).length
  const positive = stages.filter((s) => s >= 4).length
  return {
    total, attempted, connected, positive,
    attemptRate: rate(attempted, total), connectRate: rate(connected, attempted),
    winRate: rate(positive, connected), positiveRate: rate(positive, total),
  }
}

/** Merge stored settings over the defaults (so new settings get a default value). */
export function withDefaults(stored: unknown): DialerSettingsData {
  const s = { ...((stored && typeof stored === 'object' ? stored : {}) as Partial<DialerSettingsData>) }
  // Settings saved before version 2 used the old PKT rotation: move them to 9 to 5 local.
  if ((s.version ?? 1) < 2) { delete s.slots; delete s.clockMode; delete s.peak; s.version = 2 }
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    stageMap: { ...DEFAULT_STAGE_MAP, ...(s.stageMap ?? {}) },
    followUp: s.followUp ?? DEFAULT_SETTINGS.followUp,
    highlight: { ...DEFAULT_SETTINGS.highlight, ...(s.highlight ?? {}) },
    slots: { ...DEFAULT_SETTINGS.slots, ...(s.slots ?? {}) },
    peak: { ...DEFAULT_SETTINGS.peak, ...(s.peak ?? {}) },
  }
}
