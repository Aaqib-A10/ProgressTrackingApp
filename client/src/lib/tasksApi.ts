import { api } from './api'

export type TaskSource = 'ecommerce' | 'marketing'

export interface PendingTask {
  id: string
  source: TaskSource
  title: string
  status: string
  dueDate: string | null
  overdue: boolean
  link: string
}

export interface MyTasksStats {
  openCount: number
  dueTodayCount: number
  overdueCount: number
  completedToday: number
  completedThisWeek: number
  completedThisMonth: number
}

export interface MyTasksResponse {
  pending: PendingTask[]
  stats: MyTasksStats
}

export const getMyTasks = () => api.get<MyTasksResponse>('/tasks/mine')
