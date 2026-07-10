import { api } from './api'
import type { Role, Department, UserStatus } from './types'

// ---------- Users ----------
export interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  department: Department | null
  subDepartment: string | null
  status: UserStatus
  isActive: boolean
  tempPassword: string | null
}
export interface CreateUserInput {
  name: string
  email: string
  role: Role
  department?: Department | null
  subDepartmentSlug?: string | null
  password?: string
}
export const listUsers = () => api.get<{ users: AdminUser[] }>('/admin/users')
export const createUser = (input: CreateUserInput) => api.post<{ user: AdminUser; tempPassword?: string }>('/admin/users', input)
export const updateUser = (id: string, patch: Partial<{ role: Role; department: Department | null; subDepartmentSlug: string | null; status: UserStatus; isActive: boolean }>) =>
  api.patch<{ user: AdminUser }>(`/admin/users/${id}`, patch)
export const deleteUser = (id: string) => api.del<void>(`/admin/users/${id}`)
export const resetUserPassword = (id: string, password?: string) =>
  api.post<{ tempPassword: string }>(`/admin/users/${id}/reset-password`, password ? { password } : {})

// ---------- Team Members (Team Lead) ----------
export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  subDepartment: string | null
  status: UserStatus
  isActive: boolean
  /** Last issued temp password — visible until the member sets their own (then null). */
  tempPassword: string | null
}
export const listTeamMembers = () => api.get<{ members: TeamMember[] }>('/admin/team-members')
export const inviteTeamMember = (input: { name: string; email: string; subDepartmentSlug?: string | null }) =>
  api.post<{ member: TeamMember; tempPassword: string }>('/admin/team-members', input)
export const removeTeamMember = (id: string) => api.del<void>(`/admin/team-members/${id}`)
/** Reset (or set) a member's password; returns the new value to show the TL. */
export const resetTeamMemberPassword = (id: string, password?: string) =>
  api.post<{ tempPassword: string }>(`/admin/team-members/${id}/reset-password`, password ? { password } : {})

export type TeamEventType = 'INVITED' | 'REMOVED' | 'REACTIVATED'
export interface TeamEvent {
  id: string
  memberName: string
  memberEmail: string
  actorName: string
  type: TeamEventType
  createdAt: string
}
export const listTeamHistory = () => api.get<{ events: TeamEvent[] }>('/admin/team-history')

// ---------- Targets ----------
export interface AdminTarget {
  id: string
  department: Department | null
  brand?: { id: string; name: string } | null
  metricKey: string
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  value: number
  minValue: number | null
  maxValue: number | null
}
export const listTargets = () => api.get<{ targets: AdminTarget[] }>('/admin/targets')
export const upsertTarget = (input: { department: Department; metricKey: string; period: 'DAILY' | 'WEEKLY' | 'MONTHLY'; minValue: number; maxValue: number; brandId?: string }) =>
  api.post<{ target: AdminTarget }>('/admin/targets', input)
export const deleteTarget = (id: string) => api.del<void>(`/admin/targets/${id}`)

// ---------- Tags ----------
export interface AdminTag {
  id: string
  name: string
  type: 'VERTICAL' | 'PLATFORM' | 'CAMPAIGN' | 'DATA_SOURCE'
  department: Department | null
  isActive: boolean
}
export const listTags = () => api.get<{ tags: AdminTag[] }>('/admin/tags')
export const createTag = (input: { name: string; type: AdminTag['type']; department: Department }) => api.post<{ tag: AdminTag }>('/admin/tags', input)
export const updateTag = (id: string, patch: Partial<{ name: string; isActive: boolean }>) => api.patch<{ tag: AdminTag }>(`/admin/tags/${id}`, patch)

// ---------- Holidays & Leave ----------
export interface Holiday {
  id: string
  date: string
  name: string
}
export interface LeaveRow {
  id: string
  userId: string
  userName: string
  date: string
  type: 'ON_LEAVE' | 'HOLIDAY' | 'OFF' | 'WFH'
  note: string
}
export const listHolidays = () => api.get<{ holidays: Holiday[] }>('/admin/holidays')
export const createHoliday = (input: { date: string; name: string }) => api.post<{ holiday: Holiday }>('/admin/holidays', input)
export const deleteHoliday = (id: string) => api.del(`/admin/holidays/${id}`)
export const listLeave = () => api.get<{ leave: LeaveRow[] }>('/admin/leave')
export const listLeaveMembers = () => api.get<{ members: { id: string; name: string }[] }>('/admin/leave/members')
export const createLeave = (input: { userId: string; date: string; type: LeaveRow['type']; note?: string }) => api.post<{ leave: LeaveRow }>('/admin/leave', input)
export const deleteLeave = (id: string) => api.del(`/admin/leave/${id}`)

// ---- Office networks (IP allowlist for attendance) ----
export interface OfficeNetwork {
  id: string
  label: string
  cidr: string
  isActive: boolean
}
export const listOfficeNetworks = () =>
  api.get<{ networks: OfficeNetwork[]; enforced: boolean }>('/admin/office-networks')
export const createOfficeNetwork = (input: { label: string; cidr: string }) =>
  api.post<{ network: OfficeNetwork }>('/admin/office-networks', input)
export const setOfficeNetworkActive = (id: string, isActive: boolean) =>
  api.patch<{ network: OfficeNetwork }>(`/admin/office-networks/${id}`, { isActive })
export const deleteOfficeNetwork = (id: string) => api.del(`/admin/office-networks/${id}`)
