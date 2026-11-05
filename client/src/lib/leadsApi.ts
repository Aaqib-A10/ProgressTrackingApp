import { api } from './api'

/**
 * Lead Management (server: routes/leads.ts). One lead system for every business, built like
 * LeadWise; a CMR-kind business adds the five facts and the Jesse flow. The words here match
 * server lib/leads/pipeline.ts.
 */

export type Tone = 'primary' | 'accent' | 'warning' | 'success' | 'danger' | 'neutral'
export type YesNo = 'YES' | 'NO' | 'UNKNOWN'
export type Owner = 'REP' | 'MANAGER' | 'HEAD' | 'COPY'
export type LeadSource = 'FORM' | 'PHONE' | 'IMPORT' | 'EMAIL'
export type BusinessKind = 'GENERAL' | 'CMR'
export interface Person { id: string; name: string; email: string }
export interface PipelineStatus { key: string; label: string; color: string; open: boolean }

export const SOURCE_LABEL: Record<LeadSource, string> = { FORM: 'Website form', PHONE: 'Phone call', IMPORT: 'Import', EMAIL: 'Email' }
export const OWNER_LABEL: Record<Owner, string> = { REP: 'SDR / Rep', MANAGER: 'Team lead', HEAD: 'Jesse', COPY: 'Aaqib' }
export const YES_NO_LABEL: Record<YesNo, string> = { YES: 'Yes', NO: 'No', UNKNOWN: 'Unknown' }
export const MATERIALS = ['ALKALINE_SORTED', 'MIXED_DRY_CELL', 'LITHIUM', 'NIMH', 'NICD', 'LEAD_ACID'] as const
export const MATERIAL_LABEL: Record<(typeof MATERIALS)[number], string> = { ALKALINE_SORTED: 'Sorted alkaline', MIXED_DRY_CELL: 'Mixed dry cell', LITHIUM: 'Lithium', NIMH: 'NiMH', NICD: 'NiCd', LEAD_ACID: 'Lead acid' }
export const MATERIAL_FORMS = ['LOOSE', 'TAPED', 'BAGGED'] as const
export const PAYS_UNITS = ['LB', 'DRUM', 'NONE', 'UNKNOWN'] as const
export const PAYS_LABEL: Record<(typeof PAYS_UNITS)[number], string> = { LB: '$ per lb', DRUM: '$ per drum', NONE: 'Nothing', UNKNOWN: 'Unknown' }
export const FREIGHT = ['BOOKS', 'NEEDS_QUOTE', 'UNKNOWN'] as const
export const FREIGHT_LABEL: Record<(typeof FREIGHT)[number], string> = { BOOKS: 'They book freight', NEEDS_QUOTE: 'They need a quote', UNKNOWN: 'Unknown' }
export const DISPOSITIONS = ['CONNECTED', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'GATEKEEPER'] as const
export type Disposition = (typeof DISPOSITIONS)[number]
export const DISPOSITION_LABEL: Record<Disposition, string> = { CONNECTED: 'Connected', VOICEMAIL: 'Voicemail', NO_ANSWER: 'No answer', BUSY: 'Busy', WRONG_NUMBER: 'Wrong number', GATEKEEPER: 'Gatekeeper' }
export const MEETING_OUTCOMES = ['QUOTE_SENT', 'SHIPMENT_BOOKED', 'NURTURE', 'CLOSED_LOST'] as const
export const OUTCOME_LABEL: Record<(typeof MEETING_OUTCOMES)[number], string> = { QUOTE_SENT: 'Quote sent', SHIPMENT_BOOKED: 'Shipment booked', NURTURE: 'Nurture', CLOSED_LOST: 'Closed Lost' }
export const CLOSE_REASONS = ['OTHER_CHEMISTRY', 'BATTERY_NETWORK', 'RELATED_PARTY', 'PROHIBITED', 'NOT_COLLECTOR', 'EXISTING_CUSTOMER', 'REFERRAL_PARTNER', 'NO_VOLUME', 'PRICE', 'NO_RESPONSE', 'NOT_INTERESTED', 'OTHER'] as const
export const CLOSE_REASON_LABEL: Record<(typeof CLOSE_REASONS)[number], string> = {
  OTHER_CHEMISTRY: 'Only lithium / NiMH / NiCd / lead acid', BATTERY_NETWORK: 'Uses The Battery Network (Call2Recycle)', RELATED_PARTY: 'Vendor is a related party', PROHIBITED: 'On the Prohibited list',
  NOT_COLLECTOR: 'Not a battery collector', EXISTING_CUSTOMER: 'Already a customer', REFERRAL_PARTNER: 'Referral partner', NO_VOLUME: 'Not enough volume', PRICE: 'Price', NO_RESPONSE: 'No response', NOT_INTERESTED: 'Not interested', OTHER: 'Other',
}
export const TASK_KIND_LABEL: Record<string, string> = {
  FOLLOW_UP: 'Follow up', NEXT_STEP: 'Next step', APPROVE: 'Approve', HEAD_REVIEW: 'Jesse review', SEND_INVITE: 'Send invite', RELAY: 'Relay Jesse’s answer', RECONFIRM: 'Reconfirm + brief', OUTCOME: 'Log outcome', REPLY: 'Reply to Jesse', CALL: 'Call', CUSTOM: 'Task',
}

export interface Fact { key: 'material' | 'volume' | 'outlet' | 'decisionMaker' | 'timing'; label: string; done: boolean; hint: string }
export interface Warning { key: string; level: 'stop' | 'warn' | 'info'; text: string }
export interface BizRef { id: string; name: string; color: string; kind: BusinessKind }

export interface LeadRow {
  id: string; businessId: string; business: BizRef
  name: string; email: string | null; phone: string | null; phoneE164: string | null; organization: string | null; message: string | null; location: string | null
  source: LeadSource; sourceDetail: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmTerm: string | null; utmContent: string | null; gclid: string | null
  status: string; statusLabel: string; open: boolean; lostReason: string | null; lostNote: string | null; value: number | null
  jobTitle: string | null; employees: string | null; industry: string | null; website: string | null; mobile: string | null; ext: string | null; secondaryEmail: string | null; secondaryContact: string | null
  recipientName: string | null; recipientEmail: string | null; tags: string[]; street: string | null; city: string | null; state: string | null; zip: string | null; country: string | null; productInfo: string | null
  nextStep: string | null; nextStepDate: string | null; owner: Owner; callsCount: number; firstCallAt: string | null; lastCallAt: string | null; prohibited: boolean; existingCustomer: boolean
  assigneeId: string | null; assignee: Person | null; assignedAt: string | null; firstContactAt: string | null; lastActivityAt: string; repeats: number; createdAt: string; updatedAt: string
  late: 'assign' | 'contact' | null; overdue: boolean; facts: Fact[]; factsDone: number; warnings: Warning[]; belowMin: boolean; zone: string; waitingDays: number | null; openTasks: number
  // CMR part (present on CMR-kind businesses)
  contactRole?: string | null; decisionMaker?: YesNo; decisionMakerName?: string | null; dmAgreed?: YesNo; handlesAlkaline?: YesNo; material?: string[]; materialForm?: string[]
  lbsPerMonth?: number | null; lbsPerShipment?: number | null; currentVendor?: string | null; paysToday?: number | null; paysUnit?: string; vendorRelatedParty?: boolean; usesBatteryNetwork?: boolean
  sortsAlkaline?: YesNo; shipsLtl?: YesNo; nextShipmentDate?: string | null; pickupCity?: string | null; freight?: string
  jesseInputNeeded?: boolean; jesseAsk?: string | null; jesseComment?: string | null; flaggedAt?: string | null; qualifyRequestedAt?: string | null; qualifiedAt?: string | null; jesseDecision?: string | null; jesseDecidedAt?: string | null
  meetingSlots?: string[] | null; meetingAt?: string | null; meetingTz?: string | null; meetingLink?: string | null; inviteSentAt?: string | null; reconfirmedAt?: string | null; meetingBrief?: string | null; meetingOutcome?: string | null; meetingOutcomeAt?: string | null; infoSentAt?: string | null
}
/** What the AI heard on the call, for the SDR to confirm (keys match the lead's fields; jesseAsk and outcome stay on the call). */
export interface CallDraftFacts { contactName?: string; contactRole?: string; email?: string; decisionMaker?: YesNo; decisionMakerName?: string; material?: string[]; materialForm?: string[]; lbsPerMonth?: number; lbsPerShipment?: number; currentVendor?: string; paysToday?: number; paysUnit?: string; nextShipmentDate?: string; pickupCity?: string; freight?: string; nextStep?: string; nextStepDate?: string; jesseAsk?: string; outcome?: string; error?: string }
export interface LeadCall { id: string; leadId: string; userId: string | null; user: Person | null; at: string; direction: 'OUT' | 'IN'; durationSec: number; disposition: Disposition; summary: string; outcome: string | null; consentGiven: boolean | null; recordingUrl: string | null; hasRecording: boolean; recordingKept: boolean; provider?: string | null; phone?: string | null; transcript?: string | null; externalId?: string | null; aiSummary?: string | null; aiFacts?: CallDraftFacts | null; aiAt?: string | null; aiAppliedAt?: string | null; pending?: boolean }
export interface TalkLoopInfo {
  dial?: DialSetting; pbxDomain?: string | null
  configured: boolean
  status: { lastRunAt: string | null; lastCallAt: string | null; synced: number; unmatched: number; lastError: string | null; lastRunSynced: number; lastRunUnmatched: number; lastRunRead?: number; lastRunFrom?: string | null; waiting?: number }
  people: { id: string; name: string; email: string; talkloopUserId: number | null; talkloopExt: string | null }[]
  talkloopUsers: { id: number; name: string; email: string | null; extension: string | null; status: string | null }[]
  error: string | null
}
export interface LeadComment { id: string; userId: string; user: Person; body: string; mentions: string[]; mentionNames: string[]; callId: string | null; atSec: number | null; createdAt: string }
export interface LeadTask { id: string; leadId: string; kind: string; title: string; notes: string; dueAt: string; doneAt: string | null; outcome: string | null; assigneeId: string | null; assignee: Person | null; overdue?: boolean; today?: boolean; lead?: { id: string; name: string; organization: string | null; phone: string | null; state: string | null; status: string; statusLabel: string; industry: string | null; assigneeId: string | null; business: { id: string; name: string } } }
export interface LeadEvent { id: string; kind: string; text: string; data: Record<string, unknown> | null; createdAt: string; user: Person | null; toName?: string | null }
export interface UnmatchedCall { id: string; at: string; direction: 'OUT' | 'IN'; durationSec: number; disposition: Disposition; user: { id: string; name: string }; recordingUrl: string | null }
/** A phone number TalkLoop reached that no lead has yet, with its calls. */
export interface UnmatchedNumber { phone: string; calls: number; connected: number; lastAt: string; firstAt: string; people: { id: string; name: string }[]; items: UnmatchedCall[] }
export interface LeadFull extends LeadRow { calls: LeadCall[]; comments: LeadComment[]; tasks: LeadTask[]; events: LeadEvent[]; assignedBy: Person | null; createdBy: Person | null; raw: Record<string, unknown> | null }
export interface LeadDetail { lead: LeadFull; listHits: { kind: string; name: string; on: string }[]; can: { manage: boolean; decide: boolean; approve: boolean; edit: boolean; cmr: boolean; headOnly?: boolean }; head: Person | null; mentionable: (Person & { role: string })[]; pipeline: PipelineStatus[]; settings: CmrSettings | null }

export interface CmrSettings { copyEmail: string; copyName: string; consentStates: string[]; segments: string[]; states: string[]; infoSubject: string; infoBody: string; publishedRate: number; minLoadLbs: number; connectedSecs: number }
export interface MetaBusiness {
  id: string; name: string; color: string; kind: BusinessKind; pipeline: PipelineStatus[]; headId: string | null; head: Person | null; isActive: boolean; slaAssignMins: number; slaContactMins: number
  myRole: 'MANAGER' | 'REP' | null; isHead: boolean
  members: (Person & { role: 'MANAGER' | 'REP' })[]
  settings: Pick<CmrSettings, 'segments' | 'states' | 'consentStates' | 'minLoadLbs' | 'publishedRate' | 'copyName' | 'connectedSecs'>
}
export type DialScheme = 'tel' | 'sip' | 'callto' | 'custom'
/** How the Call buttons dial on this company's PCs (Lead Settings → TalkLoop). */
export interface DialSetting { scheme: DialScheme; domain: string | null; template: string | null }
export interface LeadsMeta { me: { id: string; name: string; admin: boolean; headOf: string[]; managerOf: string[]; headOnly?: boolean }; dial?: DialSetting; talkloopDial?: boolean; businesses: MetaBusiness[]; cmrOn: boolean }
/** The href a Call button opens for this number, in the form the PC's phone app expects. */
export function dialHref(phone: string | null | undefined, dial?: DialSetting | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const number = phone.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phone.trim()
  const d = dial ?? { scheme: 'tel', domain: null, template: null }
  if (d.scheme === 'sip' && d.domain) return `sip:${number}@${d.domain}`
  if (d.scheme === 'callto') return `callto:${number}`
  if (d.scheme === 'custom' && d.template) return d.template.replace(/\{number\}/g, encodeURIComponent(number)).replace(/\{digits\}/g, number.replace(/\D/g, ''))
  return `tel:${number}`
}

export interface BusinessRow {
  id: string; name: string; website: string | null; color: string; isActive: boolean; formKey: string; formUrl: string; kind: BusinessKind; headId: string | null; head: Person | null
  pipeline: PipelineStatus[]; ownPipeline: boolean; settings: CmrSettings
  slaAssignMins: number; slaContactMins: number
  inboxOn: boolean; inboxHost: string | null; inboxPort: number; inboxSecure: boolean; inboxUser: string | null; inboxFolder: string; inboxHasPassword: boolean
  inboxCheckedAt: string | null; inboxError: string | null
  members: (Person & { role: 'MANAGER' | 'REP'; isActive: boolean })[]
  openLeads: number
  /** Every lead of the business, open or closed (the setup checklist's "leads are in"). */
  leadCount: number
}
export interface InboxInput { inboxOn: boolean; inboxHost: string | null; inboxPort: number; inboxSecure: boolean; inboxUser: string | null; password?: string; inboxFolder: string }

export type ListParams = Partial<Record<'business' | 'status' | 'assignee' | 'source' | 'q' | 'industry' | 'state' | 'owner' | 'tag' | 'flag' | 'overdue' | 'belowMin' | 'late' | 'prohibited' | 'active' | 'from' | 'to' | 'updatedSince' | 'sort', string>> & { page?: number; pageSize?: number }
const qs = (p: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== false && v !== null) u.set(k, v === true ? '1' : String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}
export interface LeadList { leads: LeadRow[]; total: number; page: number; pageSize: number; counts: { byStatus: Record<string, number>; unassigned: number; mine: number; late: number; waiting: number; overdue: number } }

export type LeadInput = Partial<Pick<LeadRow, 'name' | 'email' | 'phone' | 'organization' | 'message' | 'location' | 'jobTitle' | 'employees' | 'industry' | 'website' | 'mobile' | 'ext' | 'secondaryEmail' | 'secondaryContact' | 'recipientName' | 'recipientEmail' | 'tags' | 'street' | 'city' | 'state' | 'zip' | 'country' | 'productInfo' | 'nextStep' | 'nextStepDate' | 'owner' | 'value' | 'lostReason' | 'lostNote'
  | 'contactRole' | 'decisionMaker' | 'decisionMakerName' | 'dmAgreed' | 'handlesAlkaline' | 'material' | 'materialForm' | 'lbsPerMonth' | 'lbsPerShipment' | 'currentVendor' | 'paysToday' | 'paysUnit' | 'vendorRelatedParty' | 'usesBatteryNetwork' | 'sortsAlkaline' | 'shipsLtl' | 'nextShipmentDate' | 'pickupCity' | 'freight'>>

export interface Dashboard {
  range: string
  cards: Record<'total' | 'newThisWeek' | 'recentlyUpdated' | 'noStatus' | 'assigned' | 'unassigned' | 'waiting' | 'overdue' | 'prohibited' | 'belowMin' | 'calls' | 'late', number> & { connected?: number; kept?: number }
  tasks: { today: number; overdue: number; total: number }
  byStatus: Record<string, number>
}
export interface Summary {
  business: { id: string; name: string }
  keyNumbers: { total: number; waiting: number; qualified: number; overdue: number; callsWeek: number; calls30: number; avgWaitDays: number; avgDecideDays: number; meetingsMonth: number }
  pipeline: { status: string; label: string; color: string; count: number }[]
  callsBySdr: { userId: string | null; name: string; calls: number }[]
  bySegment: { segment: string; count: number }[]
  qualifyRate: { userId: string | null; name: string; leads: number; qualified: number; rate: number }[]
}
export interface DayCounts { dials: number; connected: number; voicemails: number; emails: number; interested: number; shortConnected: number }
export interface DailyReport { id: string; userId: string; date: string; dials: number; connected: number; voicemails: number; emails: number; interested: number; note: string; submittedAt: string }

export const LEAD_IMPORT_FIELDS: { key: string; label: string; synonyms: string[] }[] = [
  { key: 'name', label: 'Full name', synonyms: ['name', 'full name', 'contact name', 'contact', 'lead name', 'customer'] },
  { key: 'firstName', label: 'First name', synonyms: ['first name', 'firstname', 'first', 'given name'] },
  { key: 'lastName', label: 'Last name', synonyms: ['last name', 'lastname', 'last', 'surname'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'email address', 'mail', 'work email'] },
  { key: 'phone', label: 'Phone', synonyms: ['phone', 'phone number', 'tel', 'telephone', 'mobile', 'cell', 'contact number'] },
  { key: 'organization', label: 'Company', synonyms: ['company', 'company name', 'organization', 'organisation', 'business', 'account'] },
  { key: 'location', label: 'Location', synonyms: ['location', 'city', 'state', 'zip', 'zip code', 'postcode', 'address'] },
  { key: 'message', label: 'Notes / message', synonyms: ['message', 'notes', 'note', 'comments', 'description', 'details', 'enquiry', 'inquiry'] },
  { key: 'utmSource', label: 'UTM source', synonyms: ['utm source', 'utm_source', 'source'] },
  { key: 'utmMedium', label: 'UTM medium', synonyms: ['utm medium', 'utm_medium', 'medium'] },
  { key: 'utmCampaign', label: 'Campaign', synonyms: ['utm campaign', 'utm_campaign', 'campaign'] },
  { key: 'utmTerm', label: 'Keyword', synonyms: ['utm term', 'utm_term', 'keyword', 'term'] },
]

export const leadsApi = {
  meta: () => api.get<LeadsMeta>('/leads/meta'),
  dashboard: (p: { business?: string; range?: string; from?: string; to?: string }) => api.get<Dashboard>(`/leads/dashboard${qs(p)}`),
  summary: (business?: string) => api.get<Summary>(`/leads/summary${qs({ business })}`),
  list: (p: ListParams) => api.get<LeadList>(`/leads${qs(p)}`),
  exportUrl: (p: ListParams) => `/api/leads/export.csv${qs(p)}`,
  check: (p: { business: string; organization?: string; phone?: string; email?: string; website?: string; except?: string }) => api.get<{ duplicates: { id: string; name: string; organization: string | null; status: string; statusLabel: string; assignee: Person | null; lastActivityAt: string }[]; prohibited: boolean; existingCustomer: boolean; hits: { kind: string; name: string; on: string }[] }>(`/leads/check${qs(p)}`),
  get: (id: string) => api.get<LeadDetail>(`/leads/${id}`),
  add: (b: LeadInput & { businessId: string; assignTo?: string | null; force?: boolean }) => api.post<{ lead: LeadRow; listHits: { kind: string; name: string; on: string }[] }>('/leads', b),
  update: (id: string, b: LeadInput & { status?: string }) => api.patch<{ lead: LeadRow }>(`/leads/${id}`, b),
  assign: (id: string, assigneeId: string | null) => api.post<{ lead: LeadRow }>(`/leads/${id}/assign`, { assigneeId }),
  talkloop: () => api.get<TalkLoopInfo>('/leads/talkloop'),
  talkloopLink: (b: { userId?: string; talkloopUserId?: number | null; auto?: boolean }) => api.patch<{ ok?: boolean; linked?: number }>('/leads/talkloop/link', b),
  talkloopSync: () => api.post<{ status: TalkLoopInfo['status'] }>('/leads/talkloop/sync', {}),
  setDial: (b: DialSetting) => api.patch<{ dial: DialSetting }>('/leads/talkloop/dial', b),
  dial: (leadId: string) => api.post<{ call: { id: string; pending: boolean; externalId: string | null } }>(`/leads/${leadId}/dial`, {}),
  draftCall: (callId: string) => api.post<{ call: Pick<LeadCall, 'id' | 'aiSummary' | 'aiFacts' | 'aiAt' | 'aiAppliedAt'> }>(`/leads/calls/${callId}/draft`, {}),
  applyCallDraft: (callId: string, b: { useSummary?: boolean; summary?: string; facts?: string[]; dismiss?: boolean }) => api.post<{ call: Pick<LeadCall, 'id' | 'aiAppliedAt'>; lead: LeadRow }>(`/leads/calls/${callId}/draft/apply`, b),
  unmatched: () => api.get<{ numbers: UnmatchedNumber[]; total: number }>('/leads/unmatched'),
  attachUnmatched: (phone: string, leadId: string) => api.post<{ moved: number; leadId: string }>('/leads/unmatched/attach', { phone, leadId }),
  callConsent: (id: string, consentGiven: boolean) => api.patch<{ call: Pick<LeadCall, 'id' | 'consentGiven' | 'recordingKept' | 'hasRecording' | 'recordingUrl'> }>(`/leads/calls/${id}`, { consentGiven }),
  bulkAssign: (ids: string[], assigneeId: string | null) => api.post<{ assigned: number }>('/leads/bulk-assign', { ids, assigneeId }),
  addEvent: (id: string, kind: 'NOTE' | 'EMAIL', text: string) => api.post<{ event: LeadEvent }>(`/leads/${id}/events`, { kind, text }),
  addCall: (id: string, b: { at?: string; direction?: 'OUT' | 'IN'; durationSec?: number; disposition: Disposition; outcome?: string; summary?: string; consentGiven?: boolean | null; recordingUrl?: string | null; nextStep?: string | null; nextStepDate?: string | null; owner?: Owner; facts?: LeadInput }) => api.post<{ call: LeadCall; lead: LeadRow }>(`/leads/${id}/calls`, b),
  comment: (id: string, b: { body: string; mentions?: string[]; callId?: string | null; atSec?: number | null }) => api.post<{ comment: LeadComment }>(`/leads/${id}/comments`, b),
  sendInfo: (id: string, note?: string) => api.post<{ lead: LeadRow; sentTo: string }>(`/leads/${id}/send-info`, { note }),
  qualify: (id: string, ask: string) => api.post<{ lead: LeadRow; flagged: boolean }>(`/leads/${id}/qualify`, { ask }),
  approve: (id: string, ask?: string) => api.post<{ lead: LeadRow }>(`/leads/${id}/approve`, { ask }),
  decide: (id: string, b: { action: 'MEETING'; slot: string; text?: string } | { action: 'DIRECTION'; text: string } | { action: 'CLOSE'; status: string; reason: string; text?: string }) => api.post<{ lead: LeadRow }>(`/leads/${id}/decide`, b),
  slots: (id: string, slots: string[]) => api.post<{ lead: LeadRow }>(`/leads/${id}/slots`, { slots }),
  invite: (id: string, b: { link?: string | null; minutes?: number; at?: string }) => api.post<{ lead: LeadRow; sentTo: string[]; times: { line: string } }>(`/leads/${id}/invite`, b),
  reconfirm: (id: string, brief: string) => api.post<{ lead: LeadRow }>(`/leads/${id}/reconfirm`, { brief }),
  outcome: (id: string, b: { outcome: string; note?: string; nextStepDate?: string | null }) => api.post<{ lead: LeadRow }>(`/leads/${id}/outcome`, b),
  close: (id: string, b: { status: string; reason?: string; note?: string }) => api.post<{ lead: LeadRow }>(`/leads/${id}/close`, b),
  reopen: (id: string) => api.post<{ lead: LeadRow }>(`/leads/${id}/reopen`),
  queue: (business?: string) => api.get<{ queue: (LeadRow & { lastCall: LeadCall | null; comments: LeadComment[]; flaggedBy: Person | null })[]; decided: LeadRow[]; canDecide: boolean }>(`/leads/queue${qs({ business })}`),
  tasks: (p: { tab?: string; assignee?: string; business?: string; lead?: string }) => api.get<{ tasks: LeadTask[]; counts: { today: number; overdue: number; upcoming: number } }>(`/leads/tasks${qs(p)}`),
  addTask: (b: { leadId: string; title: string; notes?: string; dueAt: string; assigneeId?: string | null; kind?: 'CALL' | 'CUSTOM' }) => api.post<{ task: LeadTask }>('/leads/tasks', b),
  updateTask: (id: string, b: { dueAt?: string; notes?: string; title?: string; assigneeId?: string | null }) => api.patch<{ task: LeadTask }>(`/leads/tasks/${id}`, b),
  completeTask: (id: string, b: { outcome?: string; nextStep?: string | null; nextStepDate?: string | null }) => api.post<{ ok: true; lead: LeadRow }>(`/leads/tasks/${id}/complete`, b),
  calls: (p: { business?: string; user?: string; from?: string; to?: string; disposition?: string; minSecs?: number; lead?: string; recorded?: string; page?: number }) => api.get<{ calls: (LeadCall & { lead: { id: string; name: string; organization: string | null; state: string | null; status: string; statusLabel: string; industry: string | null; business: { id: string; name: string } } })[]; total: number; page: number; pageSize: number }>(`/leads/calls${qs(p)}`),
  report: (p: { business?: string; date?: string }) => api.get<{ business: { id: string; name: string }; date: string; counted: DayCounts; report: DailyReport | null; connectedSecs: number }>(`/leads/report${qs(p)}`),
  submitReport: (b: { business?: string; date: string; dials: number; connected: number; voicemails: number; emails: number; interested: number; note?: string }) => api.post<{ report: DailyReport }>('/leads/report', b),
  teamReport: (p: { business?: string; date?: string }) => api.get<{ business: { id: string; name: string }; date: string; rows: { sdr: { id: string; name: string }; counted: DayCounts; report: DailyReport | null }[]; review: { toApprove: LeadRow[]; overdue: LeadRow[]; noSummary: (LeadCall & { lead: { id: string; name: string; organization: string | null } })[]; shortConnected: (LeadCall & { lead: { id: string; name: string; organization: string | null } })[]; outcomeDue: LeadRow[] } }>(`/leads/report/team${qs(p)}`),
  import: (b: { businessId: string; fileName: string; headers: string[]; mapping: Record<string, string | null>; rows: (string | number | null)[][]; assigneeId: string | null }) => api.post<{ added: number; skipped: number; already: number }>('/leads/import', b),
  sheetColumns: () => api.get<{ columns: { field: string; label: string }[] }>('/leads/import-sheet/columns'),
  importSheet: (b: { businessId: string; fileName?: string; headers: string[]; mapping?: Record<string, string | null>; rows: (string | number | null)[][]; source?: 'SHEET' | 'LEADWISE' }) => api.post<{ companies: number; calls: number; skipped: number; alreadyThere?: number; problems: string[]; totalCompanies: number }>('/leads/import-sheet', b),
  businesses: () => api.get<{ businesses: BusinessRow[]; people: (Person & { role: string; department: string | null; departmentType: string | null })[]; cmrOn: boolean }>('/leads/businesses'),
  createBusiness: (b: { name: string; website?: string | null; color?: string; kind?: BusinessKind; headId?: string | null }) => api.post<{ business: BusinessRow }>('/leads/businesses', b),
  updateBusiness: (id: string, b: Partial<{ name: string; website: string | null; color: string; isActive: boolean; slaAssignMins: number; slaContactMins: number; kind: BusinessKind; headId: string | null; pipeline: PipelineStatus[] | null; settings: Partial<CmrSettings> }>) => api.patch<{ business: BusinessRow }>(`/leads/businesses/${id}`, b),
  deleteBusiness: (id: string) => api.del(`/leads/businesses/${id}`),
  setMember: (id: string, userId: string, role: 'MANAGER' | 'REP') => api.post<{ business: BusinessRow }>(`/leads/businesses/${id}/members`, { userId, role }),
  removeMember: (id: string, userId: string) => api.del<{ business: BusinessRow; returned: number }>(`/leads/businesses/${id}/members/${userId}`),
  newFormKey: (id: string) => api.post<{ business: BusinessRow }>(`/leads/businesses/${id}/form-key`),
  saveInbox: (id: string, b: InboxInput) => api.put<{ business: BusinessRow }>(`/leads/businesses/${id}/inbox`, b),
  testInbox: (id: string, b: Partial<InboxInput>) => api.post<{ ok: boolean; messages?: number; error?: string }>(`/leads/businesses/${id}/inbox/test`, b),
  testLead: (id: string) => api.post<{ lead: { id: string } }>(`/leads/businesses/${id}/test-lead`),
  listEntries: (id: string, kind: 'PROHIBITED' | 'CUSTOMER') => api.get<{ entries: { id: string; name: string; phone: string | null; email: string | null; website: string | null; note: string | null }[] }>(`/leads/businesses/${id}/lists?kind=${kind}`),
  addEntries: (id: string, kind: 'PROHIBITED' | 'CUSTOMER', entries: { name: string; phone?: string | null; email?: string | null; website?: string | null; note?: string | null }[]) => api.post<{ added: number; already: number; flagged: number }>(`/leads/businesses/${id}/lists`, { kind, entries }),
  removeEntry: (id: string, entryId: string) => api.del(`/leads/businesses/${id}/lists/${entryId}`),
}

/** n business days from a date (weekends skipped) as YYYY-MM-DD, for default next-step dates. */
export function plusBusinessDays(n: number, from = new Date()): string {
  const d = new Date(from)
  let left = n
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left-- }
  return toYmd(d)
}
export const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '')
export const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
export const inZone = (iso: string, zone: string) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) } catch { return new Date(iso).toLocaleString() } }
export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return fmtDate(iso)
}
/** The lead's display name: the company, then the person. */
export const leadTitle = (l: { name: string; organization: string | null; email?: string | null; phone?: string | null }) => l.organization || l.name || l.email || l.phone || 'Lead'
export const toneOf = (hex: string): Tone => (hex === '#4F46E5' ? 'primary' : hex === '#0EA5E9' ? 'accent' : hex === '#F59E0B' ? 'warning' : ['#22C55E', '#059669'].includes(hex) ? 'success' : ['#EF4444', '#DC2626'].includes(hex) ? 'danger' : 'neutral')
