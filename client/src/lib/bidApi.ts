import { api } from './api'

export type BidType = 'RFQ' | 'RFP' | 'BID'
export type BidStatus = 'ACTIVE' | 'SUBMITTED' | 'WON' | 'LOST'
export type BidSubmissionType = 'PHYSICAL' | 'EMAIL' | 'PORTAL'

export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  ACTIVE: 'Active Opportunity',
  SUBMITTED: 'Submitted',
  WON: 'Won',
  LOST: 'Lost',
}

export const BID_TYPE_LABEL: Record<BidType, string> = { RFQ: 'RFQ', RFP: 'RFP', BID: 'Bid' }

export const SUBMISSION_LABEL: Record<BidSubmissionType, string> = {
  PHYSICAL: 'Physical',
  EMAIL: 'Email',
  PORTAL: 'Portal',
}

export interface Bid {
  id: string
  number: number
  title: string
  company: string
  type: BidType
  district: string
  agentId: string
  agentName: string
  status: BidStatus
  dueDate: string // ISO datetime
  reminderSet: boolean
  submissionType: BidSubmissionType | null
  priceQuoted: number | null
  awardedPrice: number | null
  createdAt: string
}

export interface BidSummary {
  active: number
  submitted: number
  won: number
  lost: number
  wonValue: number
}

export interface BidListResponse {
  bids: Bid[]
  summary: BidSummary
  canManageTeam: boolean
}

export interface BidInput {
  title: string
  company: string
  type: BidType
  district?: string | null
  status?: BidStatus
  dueDate: string
  reminderSet?: boolean
  submissionType?: BidSubmissionType | null
  priceQuoted?: number | null
  awardedPrice?: number | null
}

export const listBids = () => api.get<BidListResponse>('/itad/bids')
export const createBid = (input: BidInput) => api.post<{ bid: Bid }>('/itad/bids', input)
export const updateBid = (id: string, input: Partial<BidInput>) => api.patch<{ bid: Bid }>(`/itad/bids/${id}`, input)
export const deleteBid = (id: string) => api.del<void>(`/itad/bids/${id}`)
