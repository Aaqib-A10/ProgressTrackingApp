import { connectRate, voicemailRate, interestRate, rfqConversion, closeRate } from './kpi'

export const ITAD_METRIC_KEYS = [
  'callsDialed',
  'connected',
  'voicemail',
  'emailsSent',
  'interested',
  'workingOn',
  'closed',
  'rfqs',
] as const

export type ItadMetricKey = (typeof ITAD_METRIC_KEYS)[number]
export type ItadTotals = Record<ItadMetricKey, number>

/** Minimal shape we aggregate over (matches Prisma ItadDailyEntry). */
export type ItadEntryLike = { status: string } & Record<ItadMetricKey, number>

export function emptyTotals(): ItadTotals {
  return {
    callsDialed: 0,
    connected: 0,
    voicemail: 0,
    emailsSent: 0,
    interested: 0,
    workingOn: 0,
    closed: 0,
    rfqs: 0,
  }
}

/** Sum metrics across entries. Non-SUBMITTED (leave) days contribute nothing. */
export function sumItad(entries: ItadEntryLike[]): ItadTotals {
  const out = emptyTotals()
  for (const e of entries) {
    if (e.status !== 'SUBMITTED') continue
    for (const k of ITAD_METRIC_KEYS) out[k] += e[k] ?? 0
  }
  return out
}

export interface ItadKpis {
  connectRate: number
  voicemailRate: number
  interestRate: number
  rfqConversion: number
  closeRate: number
}

export function itadKpis(t: ItadTotals): ItadKpis {
  return {
    connectRate: connectRate(t.connected, t.callsDialed),
    voicemailRate: voicemailRate(t.voicemail, t.callsDialed),
    interestRate: interestRate(t.interested, t.connected),
    rfqConversion: rfqConversion(t.rfqs, t.interested),
    closeRate: closeRate(t.closed, t.workingOn),
  }
}

export type PerfFlag = 'EXCEEDING' | 'OPTIMAL' | 'ATTENTION' | 'BELOW'

/**
 * Performance flag from the plan's §4.3 integrity matrix:
 * - BELOW     — activity dropped below the minimum daily threshold.
 * - ATTENTION — high dials but low connections (bad list / weak script).
 * - EXCEEDING — high activity AND healthy connect rate.
 * - OPTIMAL   — everything else (on track).
 */
export function perfFlag(args: {
  avgDials: number
  connectRate: number
  dailyDialTarget: number
}): PerfFlag {
  const { avgDials, connectRate, dailyDialTarget } = args
  if (dailyDialTarget > 0 && avgDials < dailyDialTarget * 0.6) return 'BELOW'
  if (avgDials > 0 && connectRate < 0.2) return 'ATTENTION'
  if ((dailyDialTarget === 0 || avgDials >= dailyDialTarget) && connectRate >= 0.3) return 'EXCEEDING'
  return 'OPTIMAL'
}

export interface AgentAggregate {
  totals: ItadTotals
  kpis: ItadKpis
  /** SUBMITTED days only — leave/holiday/off excluded (leave-aware averages). */
  workingDays: number
  avgDials: number
  flag: PerfFlag
}

/** Aggregate one agent's entries for a period against the daily dial target. */
export function aggregateAgent(entries: ItadEntryLike[], dailyDialTarget: number): AgentAggregate {
  const submitted = entries.filter((e) => e.status === 'SUBMITTED')
  const totals = sumItad(submitted)
  const workingDays = submitted.length
  const kpis = itadKpis(totals)
  const avgDials = workingDays ? totals.callsDialed / workingDays : 0
  return { totals, kpis, workingDays, avgDials, flag: perfFlag({ avgDials, connectRate: kpis.connectRate, dailyDialTarget }) }
}
