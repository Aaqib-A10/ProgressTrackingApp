import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'
import type { PerfFlag } from './itadApi'

export type TalkloopStatus = 'SUBMITTED' | 'ON_LEAVE' | 'HOLIDAY' | 'OFF'

export const TALKLOOP_METRICS = [
  { key: 'callsMade', label: 'Calls Made' },
  { key: 'connects', label: 'Connects' },
  { key: 'demosScheduled', label: 'Demos Scheduled' },
  { key: 'demosConducted', label: 'Demos Conducted' },
] as const

export type TalkloopMetricKey = (typeof TALKLOOP_METRICS)[number]['key']
export type TalkloopTotals = Record<TalkloopMetricKey, number>

export interface CountryTag {
  id: string
  name: string
}
export interface CountryCount {
  tagId: string
  calls: number
  demos: number
}

export interface TalkloopEntry extends TalkloopTotals {
  id: string
  date: string
  status: TalkloopStatus
  notes: string
  countryCounts: CountryCount[]
}

export interface TalkloopEntryResponse {
  date: string
  entry: TalkloopEntry | null
  countries: CountryTag[]
  stats: { dailyCallTarget: number; avgCalls: number; connectRate: number; showRate: number }
}

export interface TalkloopKpis {
  connectRate: number
  bookRate: number
  showRate: number
}

export interface TalkloopAgentRow {
  id: string
  name: string
  status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
  onLeaveToday: boolean
  leaveDays: number
  leaveStatus: 'ON_LEAVE' | 'HOLIDAY' | 'OFF' | null
  flag: PerfFlag
  totals: TalkloopTotals
  kpis: TalkloopKpis
}

export interface TalkloopCountryRow {
  country: string
  calls: number
  demos: number
}

export interface TalkloopTeamResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  target: { dailyCalls: number }
  team: { totals: TalkloopTotals; kpis: TalkloopKpis }
  deltas: { callsMade: number; connects: number; demosConducted: number; showRate: number }
  byCountry: TalkloopCountryRow[]
  agents: TalkloopAgentRow[]
  topAgents: { id: string; name: string; calls: number }[]
}

export interface UpsertTalkloopInput extends Partial<TalkloopTotals> {
  status: TalkloopStatus
  notes?: string
  countryCounts?: CountryCount[]
  date?: string
}

export function getMyTalkloopEntry(date?: string) {
  return api.get<TalkloopEntryResponse>(`/talkloop/entries${date ? `?date=${date}` : ''}`)
}

export function upsertTalkloopEntry(input: UpsertTalkloopInput) {
  return api.put<{ entry: TalkloopEntry }>('/talkloop/entries', input)
}

/** Add a target country inline from the daily form. */
export function createTalkloopCountry(name: string) {
  return api.post<{ country: CountryTag }>('/talkloop/countries', { name })
}

export function getTalkloopTeam(range: RangeKey, custom?: CustomRange | null) {
  return api.get<TalkloopTeamResponse>(`/talkloop/team?${rangeQuery(range, custom)}`)
}
