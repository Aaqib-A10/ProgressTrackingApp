import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export type ClockState = 'NOT_IN' | 'IN' | 'ON_BREAK' | 'OUT'
export type OffLabel = 'ON_LEAVE' | 'OFF' | 'HOLIDAY'

export interface Shift {
  startTime: string
  endTime: string
  /** Optional per-weekday start/end overrides ("0".."6" → times); absent days use start/end above. */
  dayTimes?: Record<string, { startTime: string; endTime: string }> | null
  graceMin: number
  requiredMinutes: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null // IANA zone; null = company timezone
}

export type BreakType = 'BREAK' | 'BRB'

export interface TodayState {
  state: ClockState
  checkInAt: string | null
  checkInLabel: string | null
  checkOutAt: string | null
  checkOutLabel: string | null
  openBreakStartAt: string | null
  openBreakType: BreakType | null
  workedMin: number | null
  breakMin: number
  brbMin: number
  regularBreakMin: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  late: boolean
  earlyLeave: boolean
  requiredMin: number
  completed: boolean
  /** "Start overtime" was pressed: no automatic check-out at the end of the shift hours. */
  overtime: boolean
  overtimeMin: number
  /** When PulseTrack will check this session out by itself (null once checked out). */
  autoCheckoutAt: string | null
  autoCheckoutLabel: string | null
  shiftHoursMin: number | null
}

export interface MeResponse {
  date: string
  today: TodayState
  shift: Shift
  /** When set, clocking is blocked (leave/off/holiday). */
  offLabel: OffLabel | null
  offName: string | null
  /** 'WFH' on a day marked work from home, 'REMOTE' when the person always works from home.
   *  Clocking works from any network; shown as a badge. */
  workMode: WorkMode | null
  overtimeMaxMin: number
  /** The server's clock when this was sent (the widget counts from it, not the computer's clock). */
  serverNow: string
}

export type WorkMode = 'WFH' | 'REMOTE'

/** NOT_YET: today, a working day, no check-in yet (the day is still open). */
export type HistoryLabel = 'PRESENT' | 'ON_LEAVE' | 'OFF' | 'HOLIDAY' | 'WFH' | 'WEEKLY_OFF' | 'ABSENT' | 'NOT_YET'

export interface AttendanceDayRow {
  date: string
  label: HistoryLabel
  offName: string | null
  checkIn: string | null
  checkOut: string | null
  workedMin: number | null
  breakMin: number
  late: boolean
  earlyLeave: boolean
  requiredMin: number
  completed: boolean
  shortMin: number | null
  note: string | null
  overtimeMin: number
  /** Worked from home that day (marked WFH, or always works from home). */
  wfh?: boolean
}

export interface AttendanceSummary {
  presentDays: number
  leaveDays: number
  weeklyOffDays: number
  holidayDays: number
  lateDays: number
  completedShifts: number
  totalWorkedMin: number
  avgCheckIn: string | null
}

export interface HistoryResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  shift: Shift
  rows: AttendanceDayRow[]
  summary: AttendanceSummary
}

// ---------- Team board (TL / Admin) ----------
export interface TeamAttendanceRow {
  userId: string
  name: string
  department: string
  presentDays: number
  lateDays: number
  completedShifts: number
  leaveDays: number
  totalWorkedMin: number
  totalBreakMin: number
  totalOvertimeMin: number
  todayOvertime: boolean
  avgCheckIn: string | null
  shiftRequiredMin: number
  hasOverride: boolean
  todayState: ClockState
  todayCheckIn: string | null
  brbMinToday: number
  regBreakToday: number
  brbAllowanceMin: number
  breakAllowanceMin: number
  brbOverToday: boolean
  breakOverToday: boolean
  lateThisMonth: number
  graceLimitExceeded: boolean
  /** Always works from home: can check in from any network. */
  remote: boolean
  /** Working from home today (a WFH day, or always remote). */
  workModeToday: WorkMode | null
  /** Days marked work from home in the period. */
  wfhDays: number
}

export interface TeamBoardEntry {
  userId: string
  name: string
  department: string
  state: ClockState
  checkIn: string | null
  workMode: WorkMode | null
}

export interface TeamAttendanceResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  canEditShift: boolean
  scope: 'COMPANY' | 'DEPARTMENT'
  shift: Shift
  board: TeamBoardEntry[]
  rows: TeamAttendanceRow[]
  summary: { members: number; inNow: number; onBreakNow: number; outNow: number; notInNow: number }
}

export interface ShiftScopeResponse {
  scope: 'COMPANY' | 'DEPARTMENT'
  departmentId: string | null
  shift: Shift
}

export function getAttendanceTeam(range: RangeKey, custom?: CustomRange | null, department?: string) {
  const dep = department && department !== 'ALL' ? `&department=${department}` : ''
  return api.get<TeamAttendanceResponse>(`/attendance/team?${rangeQuery(range, custom)}${dep}`)
}
export const putAttendanceShift = (input: Shift) => api.put<{ shift: Shift }>('/attendance/shift', input)

export interface UserShiftResponse {
  /** The person's own override, or null when they inherit dept/company hours. */
  override: Shift | null
  /** Hours actually in effect (override → department → company). */
  effective: Shift
  /** Department/company hours used when there's no override. */
  fallback: Shift
}
export const getUserShift = (userId: string) => api.get<UserShiftResponse>(`/attendance/shift/user/${userId}`)
export const putUserShift = (userId: string, input: Shift) => api.put<{ override: Shift }>(`/attendance/shift/user/${userId}`, input)
export const clearUserShift = (userId: string) => api.del<void>(`/attendance/shift/user/${userId}`)

export type LeaveMarkType = 'ON_LEAVE' | 'OFF' | 'WFH'
/** Mark one day, or a run of days with `until` (only the person's working days are marked). */
export const markLeave = (userId: string, date: string, input: { type: LeaveMarkType; note?: string; until?: string }) =>
  api.put<{ leave: { date: string; type: LeaveMarkType; note: string }; dates: string[] }>(`/attendance/${userId}/leave/${date}`, input)
/** Always works from home (true) or back to office rules (false). TL for their department, or Super Admin. */
export const setAttendanceRemote = (userId: string, remote: boolean) =>
  api.put<{ userId: string; remote: boolean }>(`/attendance/${userId}/remote`, { remote })
export const removeLeave = (userId: string, date: string) => api.del<void>(`/attendance/${userId}/leave/${date}`)
export const correctAttendanceDay = (userId: string, date: string, input: { checkIn?: string | null; checkOut?: string | null; note?: string | null }) =>
  api.patch<{ day: { date: string; checkIn: string | null; checkOut: string | null } }>(`/attendance/${userId}/${date}`, input)

export const getAttendanceMe = () => api.get<MeResponse>('/attendance/me')
export const clockCheckIn = () => api.post<MeResponse>('/attendance/check-in')
export const clockCheckOut = () => api.post<MeResponse>('/attendance/check-out')
export const clockStartBreak = (type: BreakType = 'BREAK') => api.post<MeResponse>('/attendance/break/start', { type })
export const clockEndBreak = () => api.post<MeResponse>('/attendance/break/end')
export const clockStartOvertime = () => api.post<MeResponse>('/attendance/overtime')

export function getAttendanceHistory(range: RangeKey, custom?: CustomRange | null, userId?: string) {
  const q = rangeQuery(range, custom)
  return api.get<HistoryResponse>(`/attendance/history?${q}${userId ? `&userId=${userId}` : ''}`)
}

/** History between two dates. `all` lists every day up to today (missed working days as Absent). */
export function getAttendanceHistoryBetween(start: string, end: string, opts: { all?: boolean; userId?: string } = {}) {
  return api.get<HistoryResponse>(`/attendance/history?range=custom&start=${start}&end=${end}${opts.all ? '&all=1' : ''}${opts.userId ? `&userId=${opts.userId}` : ''}`)
}

// ---------- Register (TL / Admin): every member x every day ----------
export interface RegisterMember {
  userId: string
  name: string
  department: string
  departmentType: string | null
  shift: { startTime: string; endTime: string; requiredMinutes: number }
  hasOverride: boolean
  /** One per date in `dates`; null = future or before the person joined. */
  cells: (AttendanceDayRow | null)[]
  totals: { present: number; absent: number; leave: number; late: number; leftEarly: number; fullShifts: number; workedMin: number; overtimeMin: number; avgCheckIn: string | null }
}
export interface RegisterResponse {
  start: string
  end: string
  dates: string[]
  scope: 'COMPANY' | 'DEPARTMENT'
  members: RegisterMember[]
}
export const getAttendanceRegister = (start: string, end: string, department?: string) =>
  api.get<RegisterResponse>(`/attendance/register?start=${start}&end=${end}${department ? `&department=${department}` : ''}`)

/** "2h 15m" from a minute count. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ---------- Work from home requests (employee asks, Team Lead decides) ----------
export type WfhRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export interface WfhRequest {
  id: string
  userId: string
  name: string
  startDate: string
  endDate: string
  /** The working days asked for (yyyy-MM-dd). */
  days: string[]
  reason: string
  status: WfhRequestStatus
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}
export const askWorkFromHome = (input: { startDate: string; endDate?: string; reason: string }) =>
  api.post<{ request: WfhRequest }>('/attendance/wfh-requests', input)
export const myWfhRequests = () => api.get<{ requests: WfhRequest[] }>('/attendance/wfh-requests/mine')
export const cancelWfhRequest = (id: string) => api.del<void>(`/attendance/wfh-requests/${id}`)
export const teamWfhRequests = (status: 'PENDING' | 'ALL' = 'PENDING') => api.get<{ requests: WfhRequest[] }>(`/attendance/wfh-requests/team?status=${status}`)
export const decideWfhRequest = (id: string, approve: boolean, note?: string) =>
  api.post<{ request: WfhRequest; marked: string[] }>(`/attendance/wfh-requests/${id}/decision`, { approve, note })

/** "Oct 16" or "Oct 16 to Oct 19 · 2 working days". */
export function wfhSpan(r: Pick<WfhRequest, 'startDate' | 'endDate' | 'days'>): string {
  const f = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (r.startDate === r.endDate) return f(r.startDate)
  return `${f(r.startDate)} to ${f(r.endDate)} · ${r.days.length} working ${r.days.length === 1 ? 'day' : 'days'}`
}
