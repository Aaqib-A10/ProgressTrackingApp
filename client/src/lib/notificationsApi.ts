import { api } from './api'

export interface AppNotification {
  id: string
  type: 'reminder' | 'alert' | 'info'
  title: string
  body: string
  date: string
  /** Explicit client route to open on click (e.g. an @mention deep-link). */
  link?: string
  /** True for stored, per-recipient notifications that can be marked read. */
  persistent?: boolean
}

export function getNotifications() {
  return api.get<{ notifications: AppNotification[]; unread: number }>('/notifications')
}

export function markNotificationRead(id: string) {
  return api.post<void>(`/notifications/${id}/read`)
}

export interface NotSubmittedMember {
  id: string
  name: string
  email: string
  subDepartment: string | null
}

export interface NotSubmittedGroup {
  department: string
  label: string
  members: NotSubmittedMember[]
}

export function getNotSubmitted() {
  return api.get<{ date: string; total: number; groups: NotSubmittedGroup[] }>('/notifications/not-submitted')
}

export interface StoredNotification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  actorName: string | null
  readAt: string | null
  createdAt: string
}

export function getNotificationHistory(cursor?: string) {
  return api.get<{ notifications: StoredNotification[]; nextCursor: string | null }>(`/notifications/history${cursor ? `?cursor=${cursor}` : ''}`)
}

export function markAllNotificationsRead() {
  return api.post<{ cleared: number }>('/notifications/read-all')
}
