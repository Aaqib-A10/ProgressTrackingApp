import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'
import type { Role, Department } from './types'

export type MemberKind = 'ITAD' | 'LEAD_GEN' | 'NONE'
export type PerfFlag = 'EXCEEDING' | 'OPTIMAL' | 'ATTENTION' | 'BELOW'
export type SubmissionStatus = 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'

export interface MemberProfileUser {
  id: string
  name: string
  email: string
  role: Role
  department: Department | null
  subDepartment: string | null
  avatarUrl: string | null
}

/** A per-day entry row — metric keys depend on the member's department. */
export interface MemberEntryRow {
  date: string
  status: string
  notes: string
  [metric: string]: number | string
}

export interface MemberProfileResponse {
  user: MemberProfileUser
  kind: MemberKind
  range: { startDate: string; endDate: string; key: RangeKey }
  today: { status: SubmissionStatus }
  summary:
    | {
        totals: Record<string, number>
        kpis: Record<string, number>
        workingDays: number
        flag: PerfFlag
        funnel?: { stage: string; value: number }[]
        target?: Record<string, number>
      }
    | null
  deltas: Record<string, number>
  entries: MemberEntryRow[]
}

export function getMemberProfile(id: string, range: RangeKey, custom?: CustomRange | null) {
  return api.get<MemberProfileResponse>(`/members/${id}?${rangeQuery(range, custom)}`)
}
