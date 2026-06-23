import { api } from './api'

export interface AppNotification {
  id: string
  type: 'reminder' | 'alert' | 'info'
  title: string
  body: string
  date: string
}

export function getNotifications() {
  return api.get<{ notifications: AppNotification[]; unread: number }>('/notifications')
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
