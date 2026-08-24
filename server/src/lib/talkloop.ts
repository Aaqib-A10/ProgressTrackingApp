import { rate } from './kpi'

export const TALKLOOP_METRIC_KEYS = [
  'callsMade',
  'connects',
  'demosScheduled',
  'demosConducted',
] as const

export type TalkloopMetricKey = (typeof TALKLOOP_METRIC_KEYS)[number]
export type TalkloopTotals = Record<TalkloopMetricKey, number>

/** Minimal shape we aggregate over (matches Prisma TalkloopDailyEntry). */
export type TalkloopEntryLike = { status: string } & Record<TalkloopMetricKey, number>

export function emptyTotals(): TalkloopTotals {
  return { callsMade: 0, connects: 0, demosScheduled: 0, demosConducted: 0 }
}

/** Sum metrics across entries. Non-SUBMITTED (leave) days contribute nothing. */
export function sumTalkloop(entries: TalkloopEntryLike[]): TalkloopTotals {
  const out = emptyTotals()
  for (const e of entries) {
    if (e.status !== 'SUBMITTED') continue
    for (const k of TALKLOOP_METRIC_KEYS) out[k] += e[k] ?? 0
  }
  return out
}

export interface TalkloopKpis {
  /** connects ÷ calls made */
  connectRate: number
  /** demos scheduled ÷ connects */
  bookRate: number
  /** demos conducted ÷ demos scheduled */
  showRate: number
}

export function talkloopKpis(t: TalkloopTotals): TalkloopKpis {
  return {
    connectRate: rate(t.connects, t.callsMade),
    bookRate: rate(t.demosScheduled, t.connects),
    showRate: rate(t.demosConducted, t.demosScheduled),
  }
}

export type PerfFlag = 'EXCEEDING' | 'OPTIMAL' | 'ATTENTION' | 'BELOW'

/**
 * Performance flag (mirrors ITAD §4.3): BELOW when calls fall under 60% of the
 * daily target; ATTENTION for high calls but weak connect rate; EXCEEDING when
 * calls hit target AND connects are healthy; OPTIMAL otherwise.
 */
export function perfFlag(args: { avgCalls: number; connectRate: number; dailyCallTarget: number }): PerfFlag {
  const { avgCalls, connectRate, dailyCallTarget } = args
  if (dailyCallTarget > 0 && avgCalls < dailyCallTarget * 0.6) return 'BELOW'
  if (avgCalls > 0 && connectRate < 0.2) return 'ATTENTION'
  if ((dailyCallTarget === 0 || avgCalls >= dailyCallTarget) && connectRate >= 0.3) return 'EXCEEDING'
  return 'OPTIMAL'
}

export interface AgentAggregate {
  totals: TalkloopTotals
  kpis: TalkloopKpis
  /** SUBMITTED days only — leave/holiday/off excluded (leave-aware averages). */
  workingDays: number
  avgCalls: number
  flag: PerfFlag
}

/** Aggregate one agent's entries for a period against the daily call target. */
export function aggregateAgent(entries: TalkloopEntryLike[], dailyCallTarget: number): AgentAggregate {
  const submitted = entries.filter((e) => e.status === 'SUBMITTED')
  const totals = sumTalkloop(submitted)
  const workingDays = submitted.length
  const kpis = talkloopKpis(totals)
  const avgCalls = workingDays ? totals.callsMade / workingDays : 0
  return { totals, kpis, workingDays, avgCalls, flag: perfFlag({ avgCalls, connectRate: kpis.connectRate, dailyCallTarget }) }
}
