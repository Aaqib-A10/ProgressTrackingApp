import { api } from './api'
import type { NotifyCategory } from './notifyCategories'

export type { NotifyCategory }

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
  /** The tab it belongs to (lib/notifyCategories). */
  category: NotifyCategory
  /** A Lead Dialer follow-up: the lead's status (Pipeline, Interested, Connected, …). */
  leadStatus?: string | null
}

export function getNotifications() {
  /** `unread` leaves out muted categories; `muted` = my muted categories. */
  return api.get<{ notifications: AppNotification[]; unread: number; muted: NotifyCategory[] }>('/notifications')
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
  category: NotifyCategory
  leadStatus?: string | null
}

export function getNotificationHistory(cursor?: string, category?: NotifyCategory) {
  const q = new URLSearchParams()
  if (cursor) q.set('cursor', cursor)
  if (category) q.set('category', category)
  const qs = q.toString()
  return api.get<{ notifications: StoredNotification[]; nextCursor: string | null }>(`/notifications/history${qs ? `?${qs}` : ''}`)
}

/** Mark my stored notifications read: all of them, or one tab's. */
export function markAllNotificationsRead(category?: NotifyCategory) {
  return api.post<{ cleared: number }>('/notifications/read-all', category ? { category } : undefined)
}

export interface MutedCategories {
  muted: NotifyCategory[]
  categories: { key: NotifyCategory; label: string; collapsed: boolean }[]
}

export function getMutedCategories() {
  return api.get<MutedCategories>('/notifications/muted')
}

/** Muted: no pop-up or phone push and not counted in the badge; still listed. */
export function saveMutedCategories(muted: NotifyCategory[]) {
  return api.put<MutedCategories>('/notifications/muted', { muted })
}
