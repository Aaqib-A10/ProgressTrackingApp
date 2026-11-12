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
  /** Imports: when more than this share of leads get the same new Updated At, it is a bulk update, not calls (default 20). */
  bulkUpdatePct?: number
  /** Follow-ups: the rows that show the one-tap outcome chips after Call now (default Pipeline and Interested). */
  outcomeChipStatuses?: string[]
  /** Lead Dialer task reminders, minutes before the due time (default 15 and at the due time). */
  taskReminders?: number[]
  /** ITAD update 12 Nov (section 4): Last touched and tries come from the agent's own notes; follow-ups close themselves. */
  touchesFromNotes?: boolean
  /** The agent's own logged calls (outcome chips, Add touch) count as contacts next to their notes. */
  manualTouchesCount?: boolean
  /** Statuses where a status change alone does not close a follow-up (the agent's note is needed). */
  noteOnlyStatuses?: string[]
  /** Earth Zone sync: how a row finds its lead, in this order. */
  ezMatchOrder?: EzMatchKey[]
}
export type EzMatchKey = 'ezId' | 'email' | 'phone' | 'companyLastName'

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
  /** From the predictive dialer: never dial again (DNC) / the number is wrong. Imports never change these. */
  doNotCall?: boolean
  wrongNumber?: boolean
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
  /** From the export: the contact's job title and the CRM's "Assigned To". */
  jobTitle?: string | null
  assignedTo?: string | null
  /** Touches (attempts): the latest one (import or added here), how many, and how many since the status last changed. */
  lastTouchedAt?: string | null
  /** When a follow-up closed by itself after the last touch (a status change...): the quiet clock restarts there. */
  quietFrom?: string | null
  attempts?: number
  tries?: number
  reAttempts?: number
  /** A touch added here (an outcome or Add touch): the lead was worked even if the CRM still says Assigned. */
  manualTouches?: number
  /** From the Earth Zone sync (or added by the agent or Claude): each its own copy button. */
  altPhones?: string[]
  /** Clickable links from Earth Zone's Hidden Description (LinkedIn, CFO...), and the rest of its text. */
  ezLinks?: { label: string; url: string }[] | null
  description?: string | null
  ezLeadId?: string | null
}

/** A Lead Dialer task: a My To-Do entry about one lead, owned by the lead's owner (ITAD spec, 30 Oct 2026). */
export interface DialerTask {
  id: string
  leadId: string
  ownerId: string
  kind: 'CALL' | 'EMAIL' | 'TODO'
  title: string
  note: string | null
  dueAt: string | null
  origin: 'MANUAL' | 'AUTO'
  reason: 'FOLLOW_UP_RULE' | 'CALL_LATER' | null
  status: 'OPEN' | 'DONE' | 'CANCELLED'
  doneAt: string | null
  outcome: string | null
  reminders: number[]
  /** Closed by itself: the contact that closed it ("Note on 3 Nov (Claude)"). */
  autoClosedBy?: string | null
}

export interface FunnelNumbers {
  total: number; attempted: number; connected: number; positive: number
  attemptRate: number | null; connectRate: number | null; winRate: number | null; positiveRate: number | null
}

export interface ImportSummary {
  listName?: string
  rows: number; leads: number; added: number; changed: number; unchanged: number; skipped: number; repeatedInFile: number
  notInFile: number; duplicates: number; duplicateExamples: { company: string; heldBy: string }[]
  /** Statuses changed in Metriq that Earthzone does not show yet (kept as set in Metriq). Older imports: missing. */
  keptChangedHere?: number
  newIndustries: { name: string; count: number }[]
  movedForward: number; movedBack: number
  topChanges: { from: string; to: string; count: number }[]
  unknownStatuses: { status: string; count: number }[]
  missingState: number
  /** Touches found against the previous import (older imports: missing). */
  touches?: number
  bulkUpdateDays?: string[]
  previousImportAt: string | null
  funnelBefore: FunnelNumbers | null
  funnelNow: FunnelNumbers
  // ---- since 4 Nov 2026 (older imports: missing)
  /** The skipped rows and why (row numbers as in the file). */
  skippedRows?: { row: number; reason: string }[]
  /** Which CRM fields drove the Changed count. */
  changedFields?: { field: string; count: number }[]
  /** Leads handed back from Lead Gen to Assigned (not counted as moved back). */
  reassignedFromLeadGen?: number
  /** Counted leads after the import and the duplicates left out: added + changed + unchanged = counted + heldAsDuplicate. */
  counted?: number
  heldAsDuplicate?: number
  activity?: ImportActivity
  activityBefore?: ImportActivity | null
}
export interface ImportActivity { touches: number; connects: number; voicemails: number; positives: number; toLeadGen: number; connectRateTouched: number | null }
export type ImportDrillKind = 'added' | 'changed' | 'forward' | 'back' | 'reassigned' | 'touches' | 'nostate' | 'connects' | 'voicemails' | 'positives' | 'toLeadGen' | 'change'
export interface ImportDrillRow { leadId: string; from: string | null; to: string | null; at: string | null; kind: string; company: string; contactName: string | null; phone: string | null; status: string; state: string | null }

export interface SavedView { id: string; name: string; filters: Record<string, string> }
export interface DialerPrefs {
  views: SavedView[]; followUp: Record<string, number>
  /** All-leads list: the columns picked, in order (empty = the standard set). */
  columns?: string[]
  /** Follow-ups: saved views (filters and sort). */
  fuViews?: SavedView[]
  /** The filters pinned to the bar, per page; a page missing here uses the defaults. */
  filterPins?: Record<string, string[]>
  /** Follow-ups list: the columns picked, in order (empty = the standard set). */
  fuColumns?: string[]
}
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
  /** Lead Dialer tasks: open ones, and the ones done today. */
  tasks: DialerTask[]
  lastImport: { id: string; at: string; fileName: string; by: string; summary: ImportSummary } | null
  myMapping: { headerSignature: string; mapping: Record<string, string | null> } | null
  reps: { id: string; name: string; lastImportAt: string | null }[]
}

export interface ImportRecord { id: string; createdAt: string; fileName: string; rowCount: number; summary: ImportSummary; funnel: FunnelNumbers; user: { id: string; name: string } }

export type NoteSource = 'METRIQ' | 'EARTHZONE' | 'CLAUDE'
export interface DialerNote {
  id: string; leadId: string; text: string; pinned: boolean; nextActionAt: string | null; editedAt: string | null; createdAt: string
  /** A Metriq person, or the Earth Zone author as written (no Metriq account: authorId null). */
  author: string; authorId: string | null
  source?: NoteSource
  /** An Earth Zone note edited here: Earth Zone's own text (the "differs from Earth Zone" marker). */
  ezText?: string | null
}
/** A second person found in a note (an email, phone or LinkedIn next to a name), offered to the agent. */
export interface DialerContact { id: string; name: string | null; title: string | null; email: string | null; phone: string | null; linkedin: string | null; state: 'SUGGESTED' | 'ACCEPTED' | 'IGNORED'; noteId: string | null; createdAt: string }
export type ContactEdit = { state?: 'ACCEPTED' | 'IGNORED'; name?: string | null; title?: string | null; email?: string | null; phone?: string | null; linkedin?: string | null }

/** Earth Zone sync: one row of the agent's Earth Zone pull, as the browser read it. */
export interface EzRow { ezId?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; altPhones?: string | null; email?: string | null; email2?: string | null; jobTitle?: string | null; hiddenDescription?: string | null; notes?: string | null }
export interface EzSyncSummary {
  rows: number; matched: number; unmatchedCount: number; ambiguousCount: number; leadsToUpdate: number
  fields: { altPhones: number; email2: number; jobTitle: number; description: number; links: number; notes: number; ezLeadId: number }
  notesInFile: number; notesAlreadyHere: number; conflictCount: number; matchOrder: EzMatchKey[]
  authors: { name: string; matched: boolean; isMe: boolean; notes: number }[]
}
export interface EzSyncPreview extends EzSyncSummary {
  unmatched: { row: number; company: string | null; reason: string }[]
  ambiguous: { row: number; company: string | null; by: string; leads: string[] }[]
  conflicts: { leadId: string; company: string; field: string; current: string; incoming: string }[]
  sample: { leadId: string; company: string; altPhones: string[]; set: Record<string, string>; links: { label: string; url: string }[]; notes: number }[]
}
export interface EzSyncDone extends EzSyncSummary { applied: true; updated: number; notesAdded: number; contactsOffered: number }

/** The Claude log: what a source (default Claude) wrote to leads. */
export type LogSource = 'CLAUDE' | 'EARTHZONE' | 'METRIQ' | 'ALL'
export interface ClaudeLogItem { id: string; kind: 'NOTE' | 'VALUE'; leadId: string; company: string; contactName: string | null; label: string; text: string; source: NoteSource; at: string; editedAt: string | null; author: string; canEdit: boolean }
export interface LeadDetail {
  lead: Omit<DialerLead, 'ownerName' | 'actionCount' | 'noteCount' | 'pinnedNote'> & { ownerName?: string
    /** Changed in Metriq and not yet in Earthzone: Metriq keeps statusHere while imports still bring statusHereFrom. */
    statusHere?: string | null; statusHereFrom?: string | null; statusHereAt?: string | null }
  raw: Record<string, string | number | null> | null
  actions: { id: string; kind: string; note: string | null; at: string | null; createdAt: string; user: { name: string } }[]
  changes: { id: string; fromStatus: string | null; toStatus: string; createdAt: string; importId: string | null; byName?: string | null }[]
  notes: DialerNote[]
  /** Second contacts found in notes: offered (SUGGESTED) and accepted. */
  contacts?: DialerContact[]
  /** Earth Zone notes deleted here (kept deleted after any sync). */
  deletedEzNotes?: number
  /** Calls the predictive dialer reported for this lead, newest first. */
  calls?: DialerCallRow[]
  /** Touches as dates: "20 Aug touched", "3 Sep status changed". */
  touches?: { id: string; at: string; statusChange: boolean; outcome: string | null }[]
  tasks?: DialerTask[]
  /** The rep owns this lead (touches and tasks are theirs to change). */
  canEdit?: boolean
}
export interface TaskHistoryRow extends DialerTask { company: string; contactName: string | null; leadStatus: string | null; owner: string; createdAt: string; onTime: boolean | null }
export interface TaskHistory { tasks: TaskHistoryRow[]; summary: { completedThisWeek: number; onTimePct: number | null; avgDaysLate: number | null }; range: { from: string; to: string } }
export type Outcome = 'NO_ANSWER' | 'VOICEMAIL' | 'GATEKEEPER' | 'CONNECTED' | 'WRONG_NUMBER'
export type BulkAction = 'SNOOZE' | 'ADD_TASK' | 'LOG_TOUCH' | 'RESCHEDULE'
export interface DialerCallRow { id: string; calledAt: string; disposition: string; outcome: string | null; outcomeLabel: string | null; notes: string | null; durationSec: number | null; agent: string | null; effect: string | null }
export interface NoteExportRow extends DialerNote { company: string; contactName: string | null; phone: string | null; crmId: string | null; status: string; rep: string }
export interface FillRow { matchKey?: string | null; crmId?: string | null; email?: string | null; company?: string | null; contactName?: string | null; phone?: string | null; phone2?: string | null; email2?: string | null; linkedin?: string | null; decisionMaker?: string | null; bestTime?: string | null; note?: string | null }
export interface FillPreview { matched: number; willUpdate: number; notes: number; unmatched: { row: number; company: string | null; reason: string }[]; unmatchedCount: number; conflicts: { leadId: string; company: string; field: string; current: string; incoming: string }[]; conflictCount: number }
export interface LeadEdit { state?: string | null; zone?: RegionCode | null; sentToLeadGen?: boolean; phone2?: string | null; email2?: string | null; linkedin?: string | null; decisionMaker?: string | null; bestTime?: string | null; tags?: string[]; altPhones?: string[]; needsCrm?: boolean; crmDone?: boolean }

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
  { key: 'title', label: 'Job title' },
  { key: 'assignedTo', label: 'Assigned to (CRM)' },
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
  setStatus: (id: string, status: string, note?: string) => api.post<{ ok: true; unchanged?: boolean }>(`/dialer/leads/${id}/status`, { status, note }),
  addNote: (id: string, body: { text: string; pinned?: boolean; nextActionAt?: string | null; needsCrm?: boolean }) => api.post<{ note: DialerNote }>(`/dialer/leads/${id}/notes`, body),
  updateNote: (id: string, body: { text?: string; pinned?: boolean }) => api.patch<{ note: DialerNote }>(`/dialer/notes/${id}`, body),
  notes: (q: { rep?: string; leadId?: string; from?: string; to?: string }) => api.get<{ notes: NoteExportRow[] }>(`/dialer/notes?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  followUpBulk: (leadIds: string[], action: 'KEEP' | 'SNOOZE30' | 'DROP' | 'UNDROP') => api.post<{ updated: number }>('/dialer/followups/bulk', { leadIds, action }),
  prefs: () => api.get<{ prefs: DialerPrefs; limits: { min: number; max: number } }>('/dialer/prefs'),
  savePrefs: (body: Partial<DialerPrefs>) => api.put<{ prefs: DialerPrefs }>('/dialer/prefs', body),
  importChanges: (id: string, q: { kind?: ImportDrillKind; from?: string; to?: string }) => api.get<{ leads: ImportDrillRow[] }>(`/dialer/imports/${id}/changes?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>).toString()}`),
  bulkFill: (body: { rows: FillRow[]; apply: boolean; overwrite?: boolean; needsCrm?: boolean }) => api.post<FillPreview & { updated?: number }>('/dialer/bulk-fill', body),
  settings: () => api.get<{ settings: DialerSettings; defaults: DialerSettings }>('/dialer/settings'),
  saveSettings: (s: DialerSettings) => api.put<{ settings: DialerSettings; restaged: number }>('/dialer/settings', s),
  duplicates: () => api.get<{ duplicates: DuplicateGroup[] }>('/dialer/duplicates'),
  integration: () => api.get<IntegrationData>('/dialer/integration'),
  makeIntegration: (name: string) => api.post<{ id: string; hookUrl: string }>('/dialer/integration', { name }),
  saveIntegration: (body: { enabled?: boolean; fieldMap?: Record<string, string>; dispositionMap?: Record<string, string>; agentMap?: Record<string, string> }) => api.put<{ ok: true; enabled: boolean }>('/dialer/integration', body),
  revokeIntegration: () => api.del('/dialer/integration'),
  testIntegration: (message: string) => api.post<IntegrationTest>('/dialer/integration/test', { message }),
  linkCall: (callId: string, leadId: string) => api.post<{ ok: true; effect: string }>(`/dialer/calls/${callId}/link`, { leadId }),
  searchLeads: (q: string) => api.get<{ leads: { id: string; company: string; contactName: string | null; phone: string | null; status: string; owner: string }[] }>(`/dialer/leads-search?q=${encodeURIComponent(q)}`),
  addTouch: (leadId: string, body: { at?: string; outcome?: Outcome | null }) => api.post<{ ok: true }>(`/dialer/leads/${leadId}/touches`, body),
  dismissTouch: (id: string) => api.del(`/dialer/touches/${id}`),
  addTask: (body: { leadId: string; kind: DialerTask['kind']; dueAt: string; note?: string; reminders?: number[] }) => api.post<{ task: DialerTask }>('/dialer/tasks', body),
  updateTask: (id: string, body: { done?: boolean; outcome?: string | null; dueAt?: string; note?: string | null; reminders?: number[] }) => api.patch<{ task: DialerTask }>(`/dialer/tasks/${id}`, body),
  taskHistory: (q: { from?: string; to?: string; kind?: string; rep?: string }) => api.get<TaskHistory>(`/dialer/tasks/history?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  bulk: (body: { leadIds: string[]; action: BulkAction; at?: string; kind?: DialerTask['kind']; outcome?: Outcome | null; note?: string }) => api.post<{ updated: number; skipped: number }>('/dialer/bulk', body),
  ezSync: (body: { rows: EzRow[]; apply: boolean; replace?: boolean; fileName?: string }) => api.post<EzSyncPreview | EzSyncDone>('/dialer/ez-sync', body),
  deleteNote: (id: string) => api.del(`/dialer/notes/${id}`),
  updateContact: (id: string, body: ContactEdit) => api.patch<{ contact: DialerContact }>(`/dialer/contacts/${id}`, body),
  claudeLog: (q: { rep?: string; leadId?: string; from?: string; to?: string; source?: LogSource; kind?: 'all' | 'notes' | 'values' }) => api.get<{ items: ClaudeLogItem[]; source: LogSource; kind: string }>(`/dialer/claude-log?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  editClaudeValue: (id: string, value: string) => api.patch<{ ok: true }>(`/dialer/claude-log/values/${id}`, { value }),
  deleteClaudeValue: (id: string) => api.del(`/dialer/claude-log/values/${id}`),
  resolveDuplicate: (matchKey: string, keepOwnerId: string) => api.post<{ ok: true }>('/dialer/duplicates/resolve', { matchKey, keepOwnerId }),
}

// Predictive dialer integration (ITAD managers)
export interface IntegrationCall { id: string; calledAt: string; phone: string | null; disposition: string; outcome: string | null; outcomeLabel: string | null; notes: string | null; durationSec: number | null; agent: string | null; agentRaw: string | null; matchedBy: string | null; effect: string | null; lead: { id: string; company: string; owner: string } | null }
export interface IntegrationData {
  integration: { id: string; name: string; prefix: string; enabled: boolean; createdAt: string; lastReceivedAt: string | null; fieldMap: Record<string, string>; dispositionMap: Record<string, string>; agentMap: Record<string, string> } | null
  outcomes: { key: string; label: string }[]
  defaultDispositions: Record<string, string>
  fields: { key: string; names: string[] }[]
  agents: { id: string; name: string; email: string }[]
  recent: IntegrationCall[]
  unmatched: IntegrationCall[]
}
export interface IntegrationTest {
  read: { leadId: string | null; crmId: string | null; phone: string | null; disposition: string | null; notes: string | null; agent: string | null; durationSec: number | null; callId: string | null; calledAt: string | null; callbackAt: string | null }
  outcome: string | null; outcomeLabel: string | null; agent: string | null
  lead: { id: string; company: string; status: string; owner: string; matchedBy: string | null } | null
  problems: string[]
}
