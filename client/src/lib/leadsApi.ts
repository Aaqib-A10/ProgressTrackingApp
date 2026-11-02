import { api } from './api'

/** Lead Management (server: routes/leads.ts). */

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'WON' | 'LOST' | 'SPAM'
export type LeadSource = 'FORM' | 'PHONE' | 'IMPORT' | 'EMAIL'
export interface Person { id: string; name: string; email: string }

export const STATUS_LABEL: Record<LeadStatus, string> = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', WON: 'Won', LOST: 'Lost', SPAM: 'Spam' }
export const STATUS_TONE: Record<LeadStatus, 'primary' | 'accent' | 'warning' | 'success' | 'danger' | 'neutral'> = { NEW: 'primary', CONTACTED: 'accent', QUALIFIED: 'warning', WON: 'success', LOST: 'danger', SPAM: 'neutral' }
export const SOURCE_LABEL: Record<LeadSource, string> = { FORM: 'Website form', PHONE: 'Phone call', IMPORT: 'Import', EMAIL: 'Email' }

export interface MetaBusiness {
  id: string; name: string; color: string; isActive: boolean; slaAssignMins: number; slaContactMins: number
  myRole: 'MANAGER' | 'REP' | null
  members: (Person & { role: 'MANAGER' | 'REP' })[]
}
export interface LeadsMeta { me: { id: string; admin: boolean }; businesses: MetaBusiness[]; statuses: LeadStatus[] }

export interface LeadRow {
  id: string; businessId: string; name: string; email: string | null; phone: string | null; organization: string | null; location: string | null
  source: LeadSource; sourceDetail: string | null; status: LeadStatus; utmCampaign: string | null; utmSource: string | null; repeats: number
  createdAt: string; assignedAt: string | null; firstContactAt: string | null; lastActivityAt: string; assigneeId: string | null; assignee: Person | null
  message: string | null; late: 'assign' | 'contact' | null
}
export interface LeadList {
  leads: LeadRow[]; total: number; page: number; pageSize: number
  counts: { byStatus: Partial<Record<LeadStatus, number>>; unassigned: number; mine: number; late: number }
}
export interface LeadEvent { id: string; kind: 'CREATED' | 'REPEAT' | 'ASSIGNED' | 'STATUS' | 'NOTE' | 'CALL' | 'EMAIL' | 'EDIT'; text: string; data: { from?: string; to?: string } | null; createdAt: string; user: Person | null; toName?: string | null }
export interface LeadFull extends Omit<LeadRow, 'late'> {
  message: string | null; utmMedium: string | null; utmTerm: string | null; utmContent: string | null; gclid: string | null
  lostReason: string | null; value: number | null; raw: Record<string, unknown> | null
  business: { id: string; name: string; color: string; slaAssignMins: number; slaContactMins: number }
  assignedBy: Person | null; createdBy: Person | null; events: LeadEvent[]; late: 'assign' | 'contact' | null
}

export interface BusinessRow {
  id: string; name: string; website: string | null; color: string; isActive: boolean; formKey: string; formUrl: string
  slaAssignMins: number; slaContactMins: number
  inboxOn: boolean; inboxHost: string | null; inboxPort: number; inboxSecure: boolean; inboxUser: string | null; inboxFolder: string; inboxHasPassword: boolean
  inboxCheckedAt: string | null; inboxError: string | null
  members: (Person & { role: 'MANAGER' | 'REP'; isActive: boolean })[]
  openLeads: number
}
export interface InboxInput { inboxOn: boolean; inboxHost: string | null; inboxPort: number; inboxSecure: boolean; inboxUser: string | null; password?: string; inboxFolder: string }

export interface ListParams { business?: string; status?: string; assignee?: string; source?: string; q?: string; late?: boolean; page?: number; sort?: 'newest' | 'oldest' | 'activity' }
const qs = (p: ListParams) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== false) u.set(k, v === true ? '1' : String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

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
  list: (p: ListParams) => api.get<LeadList>(`/leads${qs(p)}`),
  exportUrl: (p: ListParams) => `/api/leads/export.csv${qs(p)}`,
  get: (id: string) => api.get<{ lead: LeadFull; canManage: boolean }>(`/leads/${id}`),
  update: (id: string, b: Partial<{ name: string; email: string | null; phone: string | null; organization: string | null; location: string | null; message: string | null; status: LeadStatus; lostReason: string | null; value: number | null }>) => api.patch(`/leads/${id}`, b),
  assign: (id: string, assigneeId: string | null) => api.post(`/leads/${id}/assign`, { assigneeId }),
  addEvent: (id: string, kind: 'NOTE' | 'CALL' | 'EMAIL', text: string) => api.post(`/leads/${id}/events`, { kind, text }),
  add: (b: { businessId: string; name?: string; email?: string; phone?: string; organization?: string; location?: string; message?: string; assignTo?: string | null }) => api.post<{ lead: { id: string } }>('/leads', b),
  import: (b: { businessId: string; fileName: string; headers: string[]; mapping: Record<string, string | null>; rows: (string | number | null)[][]; assigneeId: string | null }) => api.post<{ added: number; skipped: number; already: number }>('/leads/import', b),
  businesses: () => api.get<{ businesses: BusinessRow[]; people: (Person & { department: string | null })[] }>('/leads/businesses'),
  createBusiness: (b: { name: string; website?: string | null; color?: string }) => api.post<{ business: BusinessRow }>('/leads/businesses', b),
  updateBusiness: (id: string, b: Partial<{ name: string; website: string | null; color: string; isActive: boolean; slaAssignMins: number; slaContactMins: number }>) => api.patch<{ business: BusinessRow }>(`/leads/businesses/${id}`, b),
  deleteBusiness: (id: string) => api.del(`/leads/businesses/${id}`),
  setMember: (id: string, userId: string, role: 'MANAGER' | 'REP') => api.post<{ business: BusinessRow }>(`/leads/businesses/${id}/members`, { userId, role }),
  removeMember: (id: string, userId: string) => api.del<{ business: BusinessRow; returned: number }>(`/leads/businesses/${id}/members/${userId}`),
  newFormKey: (id: string) => api.post<{ business: BusinessRow }>(`/leads/businesses/${id}/form-key`),
  saveInbox: (id: string, b: InboxInput) => api.put<{ business: BusinessRow }>(`/leads/businesses/${id}/inbox`, b),
  testInbox: (id: string, b: Partial<InboxInput>) => api.post<{ ok: boolean; messages?: number; error?: string }>(`/leads/businesses/${id}/inbox/test`, b),
  testLead: (id: string) => api.post<{ lead: { id: string } }>(`/leads/businesses/${id}/test-lead`),
}
