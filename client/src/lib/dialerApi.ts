import { api } from './api'

/** Lead Dialer (ITAD): types and calls. The server tidies and stores; the screens count. */

export type RegionCode = 'ET' | 'CT' | 'MT' | 'PT'
export type StoredRegion = RegionCode | 'AZ'

export interface Slot { pktStart: string; pktEnd: string; localStart: string; localEnd: string }
export interface DialerSettings {
  stageMap: Record<string, number>
  closed: string[]
  followUp: Record<string, number>
  highlight: { amberPct: number; redPct: number; redCount: number }
  slots: Record<RegionCode, Slot>
  clockMode: 'FIXED_PKT' | 'FIXED_LOCAL'
  peak: Record<RegionCode, string>
  minSegment: number
  weekdaysOnly: boolean
}

export interface DialerLead {
  id: string
  ownerId: string
  ownerName: string
  company: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  stateOverride: string | null
  stateRaw: string | null
  region: StoredRegion | null
  verifyZone: boolean
  zoneOverride: RegionCode | null
  industry: string | null
  status: string
  stage: number
  maxStage: number
  source: string | null
  leadDate: string | null
  lastActivityAt: string | null
  statusChangedAt: string | null
  duplicate: boolean
  sentToLeadGen: boolean
  snoozeUntil: string | null
  callLaterAt: string | null
  lastActionAt: string | null
  createdAt: string
  actionCount: number
  suggestedState: string | null
}

export interface FunnelNumbers {
  total: number; attempted: number; connected: number; positive: number
  attemptRate: number | null; connectRate: number | null; winRate: number | null; positiveRate: number | null
}

export interface ImportSummary {
  rows: number; leads: number; added: number; changed: number; unchanged: number; skipped: number; repeatedInFile: number
  notInFile: number; duplicates: number; duplicateExamples: { company: string; heldBy: string }[]
  newIndustries: { name: string; count: number }[]
  movedForward: number; movedBack: number
  topChanges: { from: string; to: string; count: number }[]
  unknownStatuses: { status: string; count: number }[]
  missingState: number
  previousImportAt: string | null
  funnelBefore: FunnelNumbers | null
  funnelNow: FunnelNumbers
}

export interface DialerData {
  me: { id: string; name: string; isManager: boolean }
  scope: string
  settings: DialerSettings
  leads: DialerLead[]
  lastImport: { id: string; at: string; fileName: string; by: string; summary: ImportSummary } | null
  myMapping: { headerSignature: string; mapping: Record<string, string | null> } | null
  reps: { id: string; name: string; lastImportAt: string | null }[]
}

export interface ImportRecord { id: string; createdAt: string; fileName: string; rowCount: number; summary: ImportSummary; funnel: FunnelNumbers; user: { id: string; name: string } }

export interface LeadDetail {
  lead: DialerLead & { externalId: string | null }
  raw: Record<string, string | number | null> | null
  actions: { id: string; kind: string; note: string | null; at: string | null; createdAt: string; user: { name: string } }[]
  changes: { id: string; fromStatus: string | null; toStatus: string; createdAt: string }[]
}

export interface DuplicateGroup {
  matchKey: string
  company: string
  holders: { leadId: string; ownerId: string; ownerName: string; status: string; state: string | null; since: string; first: boolean }[]
}

export const IMPORT_FIELDS = [
  { key: 'leadId', label: 'Lead ID', hint: 'Best way to recognise a lead between imports' },
  { key: 'company', label: 'Company', required: true },
  { key: 'contactName', label: 'Contact name' },
  { key: 'email', label: 'Email', hint: 'Used to match leads when there is no lead ID' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'status', label: 'Lead status', required: true },
  { key: 'industry', label: 'Industry' },
  { key: 'source', label: 'Source' },
  { key: 'leadDate', label: 'Created / assigned date' },
  { key: 'lastActivity', label: 'Last activity / modified date', hint: 'Used for follow-up alerts' },
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]['key']

const q = (rep: string) => `rep=${encodeURIComponent(rep)}`
export const dialerApi = {
  data: (rep = 'me') => api.get<DialerData>(`/dialer/data?${q(rep)}`),
  importLeads: (body: { fileName: string; headers: string[]; mapping: Record<string, string | null>; rows: (string | number | null)[][] }) =>
    api.post<{ import: { id: string; createdAt: string; fileName: string; summary: ImportSummary } }>('/dialer/imports', body),
  imports: (rep = 'me') => api.get<{ imports: ImportRecord[] }>(`/dialer/imports?${q(rep)}`),
  lead: (id: string) => api.get<LeadDetail>(`/dialer/leads/${id}`),
  action: (id: string, body: { kind: 'CALL_NOW' | 'CALL_LATER' | 'SNOOZE' | 'NOTE' | 'CLEAR'; at?: string; note?: string }) => api.post<{ ok: true }>(`/dialer/leads/${id}/actions`, body),
  fix: (id: string, body: { state?: string | null; zone?: RegionCode | null; sentToLeadGen?: boolean }) => api.patch<{ ok: true }>(`/dialer/leads/${id}`, body),
  settings: () => api.get<{ settings: DialerSettings; defaults: DialerSettings }>('/dialer/settings'),
  saveSettings: (s: DialerSettings) => api.put<{ settings: DialerSettings; restaged: number }>('/dialer/settings', s),
  duplicates: () => api.get<{ duplicates: DuplicateGroup[] }>('/dialer/duplicates'),
  resolveDuplicate: (matchKey: string, keepOwnerId: string) => api.post<{ ok: true }>('/dialer/duplicates/resolve', { matchKey, keepOwnerId }),
}
