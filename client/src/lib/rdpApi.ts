import { api } from './api'

export type RdpTeam = 'EC' | 'CSR' | 'SHIPPING'

export const TEAM_LABEL: Record<RdpTeam, string> = {
  EC: 'Ecommerce',
  CSR: 'CSR',
  SHIPPING: 'Shipping',
}

export interface RdpRow {
  id: string
  team: RdpTeam
  provider: string
  address: string
  label: string
  notes: string
  active: boolean
  currentAgents: string[]
  totalAgents: number
  assignmentCount: number
}

export interface RdpListResponse {
  rdps: RdpRow[]
  providers: string[]
  teams: RdpTeam[]
}

export interface RdpAssignmentRow {
  id: string
  agentName: string
  assignedAt: string
  unassignedAt: string | null
  note: string
  active: boolean
}

export interface RdpDetail {
  rdp: RdpRow
  assignments: RdpAssignmentRow[]
}

export interface RdpAgentRow {
  name: string
  active: number
  total: number
  teams: RdpTeam[]
}

export interface AgentHistoryRow {
  assignmentId: string
  rdpId: string
  team: RdpTeam
  provider: string
  address: string
  assignedAt: string
  unassignedAt: string | null
  active: boolean
}

export interface RdpInput {
  team: RdpTeam
  provider: string
  address: string
  label?: string
  notes?: string
}

export function listRdps(params: { team?: string; provider?: string; status?: string; search?: string } = {}) {
  const q = new URLSearchParams()
  if (params.team) q.set('team', params.team)
  if (params.provider) q.set('provider', params.provider)
  if (params.status) q.set('status', params.status)
  if (params.search) q.set('search', params.search)
  const s = q.toString()
  return api.get<RdpListResponse>(`/rdp${s ? `?${s}` : ''}`)
}
export const getRdp = (id: string) => api.get<RdpDetail>(`/rdp/${id}`)
export const createRdp = (input: RdpInput) => api.post<{ rdp: RdpRow }>('/rdp', input)
export const updateRdp = (id: string, patch: Partial<RdpInput & { active: boolean }>) => api.patch<{ rdp: RdpRow }>(`/rdp/${id}`, patch)
export const deleteRdp = (id: string) => api.del<void>(`/rdp/${id}`)
export const assignAgent = (id: string, input: { agentName: string; note?: string }) => api.post<{ rdp: RdpRow }>(`/rdp/${id}/assign`, input)
export const endAssignment = (assignmentId: string) => api.post<void>(`/rdp/assignments/${assignmentId}/end`)
export const deleteAssignment = (assignmentId: string) => api.del<void>(`/rdp/assignments/${assignmentId}`)
export const listRdpAgents = () => api.get<{ agents: RdpAgentRow[] }>('/rdp/agents')
export const getAgentHistory = (name: string) => api.get<{ name: string; history: AgentHistoryRow[] }>(`/rdp/agent-history?name=${encodeURIComponent(name)}`)
