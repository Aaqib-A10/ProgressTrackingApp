import { api } from './api'

export type BidType = 'RFQ' | 'RFP' | 'BID' | 'PO'
export type BidStatus = 'ACTIVE' | 'SUBMITTED' | 'WON' | 'LOST'
export type BidSubmissionType = 'PHYSICAL' | 'EMAIL' | 'PORTAL'

export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  ACTIVE: 'Active Opportunity',
  SUBMITTED: 'Submitted',
  WON: 'Won',
  LOST: 'Lost',
}

export const BID_TYPE_LABEL: Record<BidType, string> = { RFQ: 'RFQ', RFP: 'RFP', BID: 'Bid', PO: 'PO' }

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
  bidBond: boolean
  bidBondAmount: number | null
  closedDate: string | null // ISO date the deal was decided (Won/Lost)
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
  bidBond?: boolean
  bidBondAmount?: number | null
  closedDate?: string | null
}

export const listBids = () => api.get<BidListResponse>('/itad/bids')
export const createBid = (input: BidInput) => api.post<{ bid: Bid }>('/itad/bids', input)
export const updateBid = (id: string, input: Partial<BidInput>) => api.patch<{ bid: Bid }>(`/itad/bids/${id}`, input)
export const deleteBid = (id: string) => api.del<void>(`/itad/bids/${id}`)

// ---------- Team's active deals (everyone in ITAD sees who is working on what) ----------
export interface TeamDeal {
  id: string
  number: number
  title: string
  company: string
  district: string
  type: BidType
  status: BidStatus
  dueDate: string
  createdAt: string
  agentId: string
  agentName: string
  mine: boolean
}

export const listTeamActiveBids = () => api.get<{ deals: TeamDeal[] }>('/itad/bids/team-active')

const STOP = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'and', 'of', 'for', 'group', 'llp', 'plc'])
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
const norm = (s: string) => words(s).join(' ')

/** How alike two titles are: share of their words in common (0..1). */
function overlap(a: string, b: string): number {
  const A = new Set(words(a).filter((w) => w.length > 2))
  const B = new Set(words(b).filter((w) => w.length > 2))
  if (!A.size || !B.size) return 0
  let same = 0
  for (const w of A) if (B.has(w)) same++
  return same / Math.min(A.size, B.size)
}

/**
 * Open deals that look like the one being entered: same company (ignoring Inc/LLC/Corp and
 * punctuation), or a very similar title. Shown as a warning so two people don't chase one deal.
 */
export function findSimilarDeals(deals: TeamDeal[], input: { title: string; company: string; district?: string }, excludeId?: string): TeamDeal[] {
  const c = norm(input.company)
  const t = input.title.trim()
  if (c.length < 3 && t.length < 6) return []
  return deals
    .filter((d) => d.id !== excludeId)
    .filter((d) => {
      const dc = norm(d.company)
      const sameCompany = c.length >= 3 && dc.length >= 3 && (dc === c || (Math.min(dc.length, c.length) >= 5 && (dc.includes(c) || c.includes(dc))))
      const sameTitle = t.length >= 6 && overlap(t, d.title) >= 0.6
      return sameCompany || sameTitle
    })
    .slice(0, 4)
}
