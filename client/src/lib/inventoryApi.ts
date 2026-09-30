import { api } from './api'

export type InventoryStatus = 'IN' | 'LOW' | 'OUT'
export type MovementType = 'STOCK_IN' | 'STOCK_OUT'
export type InventoryReqStatus = 'REQUESTED' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED'

export interface InventoryItem {
  id: string
  name: string
  category: string
  active: boolean
  quantity: number
  price: number | null
  lowStockAt: number
  sku: string
  unit: string
  location: string
  notes: string
  status: InventoryStatus
  createdBy: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface InventoryMovement {
  id: string
  item: { id: string; name: string; category: string } | null
  type: MovementType
  quantity: number
  status: InventoryReqStatus
  requestedBy: { id: string; name: string } | null
  requestedByName: string
  note: string
  assignee: { id: string; name: string } | null
  requestedAt: string
  assignedAt: string | null
  resolvedAt: string | null
}

export interface AuditEntry {
  id: string
  action: string
  before: unknown
  after: unknown
  actor: { id: string; name: string } | null
  createdAt: string
}

export interface ItemsResponse {
  items: InventoryItem[]
  members: { id: string; name: string }[]
  canManage: boolean
  categories: string[]
}
export interface ActivityResponse {
  item: InventoryItem
  movements: InventoryMovement[]
  audits: AuditEntry[]
}
export interface RequestsResponse {
  requests: InventoryMovement[]
  members: { id: string; name: string }[]
  canManage: boolean
}
export interface TeamResponse {
  agents: { id: string; name: string; completed: number; open: number }[]
  totals: { itemCount: number; outOfStock: number; openRequests: number }
}

export interface CreateItemInput {
  name: string
  category: string
  quantity?: number
  price?: number | null
  lowStockAt?: number
  active?: boolean
  sku?: string
  unit?: string
  location?: string
  notes?: string
}
export type UpdateItemInput = Partial<CreateItemInput>

// Items
export const getInventoryItems = (category?: string) =>
  api.get<ItemsResponse>(`/inventory/items${category ? `?category=${encodeURIComponent(category)}` : ''}`)
export const createInventoryItem = (input: CreateItemInput) =>
  api.post<{ item: InventoryItem }>('/inventory/items', input)
export const updateInventoryItem = (id: string, patch: UpdateItemInput) =>
  api.patch<{ item: InventoryItem }>(`/inventory/items/${id}`, patch)
export const deleteInventoryItem = (id: string) =>
  api.del<void>(`/inventory/items/${id}`)
export const getItemActivity = (id: string) =>
  api.get<ActivityResponse>(`/inventory/items/${id}/activity`)

// Movements (stock-in / stock-out requests)
export const createMovement = (input: { itemId: string; type: MovementType; quantity: number; requestedByName?: string; note?: string }) =>
  api.post<{ movement: InventoryMovement }>('/inventory/movements', input)
export const assignMovement = (id: string, assignedToId: string) =>
  api.patch<{ movement: InventoryMovement }>(`/inventory/movements/${id}/assign`, { assignedToId })
export const resolveMovement = (id: string) =>
  api.patch<{ movement: InventoryMovement }>(`/inventory/movements/${id}/resolve`, {})
export const cancelMovement = (id: string) =>
  api.patch<{ movement: InventoryMovement }>(`/inventory/movements/${id}/cancel`, {})
export const getInventoryRequests = (type?: MovementType | 'ALL', status?: InventoryReqStatus | 'ALL') => {
  const p = new URLSearchParams()
  if (type && type !== 'ALL') p.set('type', type)
  if (status && status !== 'ALL') p.set('status', status)
  const qs = p.toString()
  return api.get<RequestsResponse>(`/inventory/requests${qs ? `?${qs}` : ''}`)
}
export const getInventoryTeam = () => api.get<TeamResponse>('/inventory/team')
