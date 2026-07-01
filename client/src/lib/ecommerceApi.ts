import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export type EcommerceStatus = 'SUBMITTED' | 'ON_LEAVE' | 'HOLIDAY' | 'OFF'

export interface TagOption {
  id: string
  name: string
}
export interface ListingLine {
  taskTypeId: string
  marketplaceId: string
  listings: number
}
export interface EcommerceEntry {
  id: string
  date: string
  status: EcommerceStatus
  notes: string
  lines: ListingLine[]
  totalListings: number
}
export interface WorkType {
  name: string
  fields: TagOption[]
}
export interface EcommerceEntryResponse {
  date: string
  entry: EcommerceEntry | null
  types: WorkType[]
  marketplaces: TagOption[]
  stats: { avgListings: number; daysLogged: number }
}
export interface UpsertEcommerceInput {
  date?: string
  status: EcommerceStatus
  notes?: string
  lines?: ListingLine[]
}

export interface EcommerceAgentRow {
  id: string
  name: string
  status: 'SUBMITTED' | 'PENDING' | 'ON_LEAVE'
  onLeaveToday: boolean
  daysLogged: number
  totalListings: number
  byMarketplace: Record<string, number>
}
export interface EcommerceTeamResponse {
  range: { startDate: string; endDate: string; key: RangeKey }
  team: {
    totalActions: number; totalListings: number; agents: number; openStockRequests: number; topMarketplace: string | null
    tasksTodo: number; tasksInProgress: number; tasksDone: number
  }
  byMarketplace: { name: string; listings: number }[]
  byType: { type: string; total: number; byMarketplace: { name: string; value: number }[] }[]
  agents: EcommerceAgentRow[]
  topAgents: { id: string; name: string; listings: number }[]
  tasks: EcomTask[]
}

export const getMyEcommerceEntry = (date?: string) =>
  api.get<EcommerceEntryResponse>(`/ecommerce/entries${date ? `?date=${date}` : ''}`)
export const upsertEcommerceEntry = (input: UpsertEcommerceInput) =>
  api.put<{ entry: EcommerceEntry }>('/ecommerce/entries', input)
export const getEcommerceTeam = (range: RangeKey, custom?: CustomRange | null) =>
  api.get<EcommerceTeamResponse>(`/ecommerce/team?${rangeQuery(range, custom)}`)

// ---------- Task board ----------
export type EcomTaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'
export interface EcomTask {
  id: string
  title: string
  description: string
  source: string
  status: EcomTaskStatus
  order: number
  assignee: { id: string; name: string } | null
  dueDate: string | null
  commentCount: number
}
export interface TaskComment {
  id: string
  body: string
  mentions: string[]
  createdAt: string
  author: { id: string; name: string }
}
export interface BoardColumn {
  status: EcomTaskStatus
  label: string
  tasks: EcomTask[]
}
export interface BoardResponse {
  columns: BoardColumn[]
  members: { id: string; name: string }[]
}
export interface CreateTaskInput {
  title: string
  description?: string
  source?: string
  assignedToId?: string | null
  dueDate?: string | null
}
export type UpdateTaskInput = Partial<{
  status: EcomTaskStatus
  order: number
  title: string
  description: string | null
  source: string | null
  assignedToId: string | null
  dueDate: string | null
}>

export const getEcommerceBoard = () => api.get<BoardResponse>('/ecommerce/board')
export const createEcommerceTask = (input: CreateTaskInput) => api.post<{ task: EcomTask }>('/ecommerce/tasks', input)
export const updateEcommerceTask = (id: string, patch: UpdateTaskInput) => api.patch<{ task: EcomTask }>(`/ecommerce/tasks/${id}`, patch)
export const deleteEcommerceTask = (id: string) => api.del<void>(`/ecommerce/tasks/${id}`)
export const getEcommerceTask = (id: string) => api.get<{ task: EcomTask; comments: TaskComment[] }>(`/ecommerce/tasks/${id}`)
export const addTaskComment = (id: string, body: string, mentions: string[]) =>
  api.post<{ comment: TaskComment }>(`/ecommerce/tasks/${id}/comments`, { body, mentions })

// ---------- Stock tracking ----------
export type StockStatus = 'REQUESTED' | 'ASSIGNED' | 'RESOLVED'
export type StockAction = 'STOCK_IN' | 'STOCK_OUT'
export interface StockRequest {
  id: string
  itemName: string
  requestedByName: string
  note: string
  requestedAt: string
  status: StockStatus
  action: StockAction | null
  assignee: { id: string; name: string } | null
  assignedAt: string | null
  resolvedAt: string | null
}
export interface StockListResponse {
  requests: StockRequest[]
  members: { id: string; name: string }[]
  canAssign: boolean
}

export const getEcommerceStock = () => api.get<StockListResponse>('/ecommerce/stock')
export const createStockRequest = (input: { itemName: string; action: StockAction; requestedByName: string; note?: string }) =>
  api.post<{ request: StockRequest }>('/ecommerce/stock', input)
export const assignStockRequest = (id: string, input: { action: StockAction; assignedToId: string }) =>
  api.patch<{ request: StockRequest }>(`/ecommerce/stock/${id}/assign`, input)
export const resolveStockRequest = (id: string) =>
  api.patch<{ request: StockRequest }>(`/ecommerce/stock/${id}/resolve`, {})
