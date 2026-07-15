import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export type ClockState = 'NOT_IN' | 'IN' | 'ON_BREAK' | 'OUT'
export type OffLabel = 'ON_LEAVE' | 'OFF' | 'HOLIDAY'

export interface Shift {
  startTime: string
  endTime: string
  graceMin: number
  requiredMinutes: number
  workingDays: number[] // 0=Sun … 6=Sat
  timeZone: string | null // IANA zone; null = company timezone
}

export interface TodayState {
  state: ClockState
  checkInAt: string | null
  checkInLabel: string | null
  checkOutAt: string | null
  checkOutLabel: string | null
  openBreakStartAt: string | null
  workedMin: number | null
  breakMin: number
  late: boolean
  earlyLeave: boolean
  requiredMin: number
  completed: boolean
}

export interface MeResponse {
  date: string
  today: TodayState
  shift: Shift
  /** When set, clocking is blocked (leave/off/holiday). */
  offLabel: OffLabel | null
  offName: string | null
  /** 'WFH' on a work-from-home day — clocking stays enabled, shown as a badge. */
  workMode: 'WFH' | null
}

export type HistoryLabel = 'PRESENT' | 'ON_LEAVE' | 'OFF' | 'HOLIDAY' | 'WFH' | 'ABSENT'

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
}

export interface AttendanceSummary {
  presentDays: number
  leaveDays: number
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
  avgCheckIn: string | null
  shiftRequiredMin: number
  hasOverride: boolean
  todayState: ClockState
  todayCheckIn: string | null
}

export interface TeamBoardEntry {
  userId: string
  name: string
  department: string
  state: ClockState
  checkIn: string | null
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
export const getAttendanceShift = () => api.get<ShiftScopeResponse>('/attendance/shift')
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
export const markLeave = (userId: string, date: string, input: { type: LeaveMarkType; note?: string }) =>
  api.put<{ leave: { date: string; type: LeaveMarkType; note: string } }>(`/attendance/${userId}/leave/${date}`, input)
export const removeLeave = (userId: string, date: string) => api.del<void>(`/attendance/${userId}/leave/${date}`)
export const correctAttendanceDay = (userId: string, date: string, input: { checkIn?: string | null; checkOut?: string | null }) =>
  api.patch<{ day: { date: string; checkIn: string | null; checkOut: string | null } }>(`/attendance/${userId}/${date}`, input)

export const getAttendanceMe = () => api.get<MeResponse>('/attendance/me')
export const clockCheckIn = () => api.post<MeResponse>('/attendance/check-in')
export const clockCheckOut = () => api.post<MeResponse>('/attendance/check-out')
export const clockStartBreak = () => api.post<MeResponse>('/attendance/break/start')
export const clockEndBreak = () => api.post<MeResponse>('/attendance/break/end')

export function getAttendanceHistory(range: RangeKey, custom?: CustomRange | null, userId?: string) {
  const q = rangeQuery(range, custom)
  return api.get<HistoryResponse>(`/attendance/history?${q}${userId ? `&userId=${userId}` : ''}`)
}

/** "2h 15m" from a minute count. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}
