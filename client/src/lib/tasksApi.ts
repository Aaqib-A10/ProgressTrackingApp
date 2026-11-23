import { api } from './api'

export type TaskSource = 'ecommerce' | 'marketing' | 'project'

export interface PendingTask {
  id: string
  source: TaskSource
  title: string
  /** Project tasks: code (RTI-12) + project name. */
  code?: string
  projectName?: string
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
/** Delete a Marketing task that is assigned to me (the Marketing Board was retired; My Tasks is where a leftover one is cleared). */
export const deleteMyMarketingTask = (id: string) => api.del<void>(`/tasks/mine/marketing/${id}`)
