import { api } from './api'

/** Lead Dialer (ITAD): types and calls. The server tidies and stores; the screens count. */

export type RegionCode = 'ET' | 'CT' | 'MT' | 'PT'
export type StoredRegion = RegionCode | 'AZ'

export interface Slot { pktStart: string; pktEnd: string; localStart: string; localEnd: string }
export interface TimeSpan { start: string; end: string }
export interface DialerSettings {
  version?: number
  stageMap: Record<string, number>
  closed: string[]
  followUp: Record<string, number>
  highlight: { amberPct: number; redPct: number; redCount: number }
  slots: Record<RegionCode, Slot>
  clockMode: 'FIXED_PKT' | 'FIXED_LOCAL'
  peak: Record<RegionCode, string>
  minSegment: number
  weekdaysOnly: boolean
  /** Best moments to call, on the lead's clock (10 to 11 AM and 2 to 4 PM). */
  primeTimes: TimeSpan[]
  /** Mark leads whose details were added here so the rep also updates Earthzone. */
  earthzoneTick: boolean
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
  noteCount: number
  pinnedNote: string | null
  suggestedState: string | null
  externalId: string | null
  website: string | null
  companySize: string | null
  listName: string
  // Added here: kept by the dialer, never touched by an import.
  phone2: string | null
  email2: string | null
  linkedin: string | null
  decisionMaker: string | null
  bestTime: string | null
  tags: string[]
  needsCrmUpdate: boolean
  crmUpdateWhat: string | null
  followUpDropped: boolean
  backlogKeptAt: string | null
  lastImportId: string | null
  firstImportId: string | null
}

export interface FunnelNumbers {
  total: number; attempted: number; connected: number; positive: number
  attemptRate: number | null; connectRate: number | null; winRate: number | null; positiveRate: number | null
}

export interface ImportSummary {
  listName?: string
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

export interface SavedView { id: string; name: string; filters: Record<string, string> }
export interface DialerPrefs { views: SavedView[]; followUp: Record<string, number> }
export interface ActedToday { leadId: string; userId: string; kind: string; at: string }

export interface DialerData {
  /** One count everywhere: duplicates waiting for a manager are not counted. */
  counts: { counted: number; duplicates: number; byList: Record<string, number> }
  prefs: DialerPrefs
  /** Follow-up days in force for each rep (company defaults with the rep's own changes). */
  followUpByOwner: Record<string, Record<string, number>>
  /** What was done today (since noon Pakistan time). */
  actedToday: ActedToday[]
  dayStart: string
  me: { id: string; name: string; isManager: boolean }
  scope: string
  settings: DialerSettings
  leads: DialerLead[]
  lastImport: { id: string; at: string; fileName: string; by: string; summary: ImportSummary } | null
  myMapping: { headerSignature: string; mapping: Record<string, string | null> } | null
  reps: { id: string; name: string; lastImportAt: string | null }[]
}

export interface ImportRecord { id: string; createdAt: string; fileName: string; rowCount: number; summary: ImportSummary; funnel: FunnelNumbers; user: { id: string; name: string } }

export interface DialerNote { id: string; leadId: string; text: string; pinned: boolean; nextActionAt: string | null; editedAt: string | null; createdAt: string; author: string; authorId: string }
export interface LeadDetail {
  lead: Omit<DialerLead, 'ownerName' | 'actionCount' | 'noteCount' | 'pinnedNote'> & { ownerName?: string }
  raw: Record<string, string | number | null> | null
  actions: { id: string; kind: string; note: string | null; at: string | null; createdAt: string; user: { name: string } }[]
  changes: { id: string; fromStatus: string | null; toStatus: string; createdAt: string; importId: string | null }[]
  notes: DialerNote[]
}
export interface NoteExportRow extends DialerNote { company: string; contactName: string | null; phone: string | null; crmId: string | null; status: string; rep: string }
export interface FillRow { matchKey?: string | null; crmId?: string | null; email?: string | null; company?: string | null; contactName?: string | null; phone?: string | null; phone2?: string | null; email2?: string | null; linkedin?: string | null; decisionMaker?: string | null; bestTime?: string | null; note?: string | null }
export interface FillPreview { matched: number; willUpdate: number; notes: number; unmatched: { row: number; company: string | null; reason: string }[]; unmatchedCount: number; conflicts: { leadId: string; company: string; field: string; current: string; incoming: string }[]; conflictCount: number }
export interface LeadEdit { state?: string | null; zone?: RegionCode | null; sentToLeadGen?: boolean; phone2?: string | null; email2?: string | null; linkedin?: string | null; decisionMaker?: string | null; bestTime?: string | null; tags?: string[]; needsCrm?: boolean; crmDone?: boolean }

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
  { key: 'website', label: 'Website' },
  { key: 'companySize', label: 'Company size / employees' },
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]['key']

const q = (rep: string) => `rep=${encodeURIComponent(rep)}`
export const dialerApi = {
  data: (rep = 'me') => api.get<DialerData>(`/dialer/data?${q(rep)}`),
  importLeads: (body: { fileName: string; headers: string[]; mapping: Record<string, string | null>; rows: (string | number | null)[][]; listName?: string }) =>
    api.post<{ import: { id: string; createdAt: string; fileName: string; summary: ImportSummary } }>('/dialer/imports', body),
  imports: (rep = 'me') => api.get<{ imports: ImportRecord[] }>(`/dialer/imports?${q(rep)}`),
  lead: (id: string) => api.get<LeadDetail>(`/dialer/leads/${id}`),
  action: (id: string, body: { kind: 'CALL_NOW' | 'CALL_LATER' | 'SNOOZE' | 'NOTE' | 'CLEAR'; at?: string; note?: string }) => api.post<{ ok: true }>(`/dialer/leads/${id}/actions`, body),
  fix: (id: string, body: LeadEdit) => api.patch<{ ok: true }>(`/dialer/leads/${id}`, body),
  addNote: (id: string, body: { text: string; pinned?: boolean; nextActionAt?: string | null; needsCrm?: boolean }) => api.post<{ note: DialerNote }>(`/dialer/leads/${id}/notes`, body),
  updateNote: (id: string, body: { text?: string; pinned?: boolean }) => api.patch<{ note: DialerNote }>(`/dialer/notes/${id}`, body),
  notes: (q: { rep?: string; leadId?: string; from?: string; to?: string }) => api.get<{ notes: NoteExportRow[] }>(`/dialer/notes?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  followUpBulk: (leadIds: string[], action: 'KEEP' | 'SNOOZE30' | 'DROP' | 'UNDROP') => api.post<{ updated: number }>('/dialer/followups/bulk', { leadIds, action }),
  prefs: () => api.get<{ prefs: DialerPrefs; limits: { min: number; max: number } }>('/dialer/prefs'),
  savePrefs: (body: Partial<DialerPrefs>) => api.put<{ prefs: DialerPrefs }>('/dialer/prefs', body),
  importChanges: (id: string, from: string, to: string) => api.get<{ leads: { leadId: string; from: string | null; to: string; company: string; contactName: string | null; phone: string | null; status: string; state: string | null }[] }>(`/dialer/imports/${id}/changes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  bulkFill: (body: { rows: FillRow[]; apply: boolean; overwrite?: boolean; needsCrm?: boolean }) => api.post<FillPreview & { updated?: number }>('/dialer/bulk-fill', body),
  settings: () => api.get<{ settings: DialerSettings; defaults: DialerSettings }>('/dialer/settings'),
  saveSettings: (s: DialerSettings) => api.put<{ settings: DialerSettings; restaged: number }>('/dialer/settings', s),
  duplicates: () => api.get<{ duplicates: DuplicateGroup[] }>('/dialer/duplicates'),
  resolveDuplicate: (matchKey: string, keepOwnerId: string) => api.post<{ ok: true }>('/dialer/duplicates/resolve', { matchKey, keepOwnerId }),
}
