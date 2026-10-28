// The owner console's API (erp, step 0). Its own small fetch: a 401 here means "sign in to the
// owner console", never the company sign in, so it does not use the app's api wrapper.
export class OwnerApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/owner${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* not JSON */ }
    throw new OwnerApiError(msg || `Request failed (${res.status})`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const ownerErr = (e: unknown, fallback = 'Something went wrong') => (e instanceof OwnerApiError ? e.message : fallback)

export type CompanyStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED'
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_COMPANY' | 'RESOLVED'
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface OwnerCompany {
  id: string; name: string; slug: string; kind: 'TEAM' | 'PERSONAL'; timeZone: string; status: CompanyStatus; plan: string; helpEnabled: boolean
  createdAt: string; home: boolean; people: number; peopleTotal: number; inToday: number; lastActiveAt: string | null; openTickets: number
}
export interface TicketRow {
  id: string; number: number; subject: string; status: TicketStatus; priority: TicketPriority; userName: string; userEmail: string
  company: { id: string; name: string }; replies: number; createdAt: string; updatedAt: string
}
export interface TicketDetail extends TicketRow {
  body: string; pageUrl: string | null; userAgent: string | null; resolvedAt: string | null
  messages: { id: string; fromOwner: boolean; authorName: string; body: string; createdAt: string }[]
  errors: { id: string; message: string; route: string | null; source: string; count: number; lastSeenAt: string; state: string }[]
}
export interface OwnerHome {
  counts: { companies: number; trials: number; people: number; inToday: number; openTickets: number; urgentTickets: number; errors24h: number }
  tickets: { id: string; number: number; subject: string; company: string; status: TicketStatus; priority: TicketPriority; updatedAt: string }[]
  signInAlerts: { at: string; action: string; ip: string | null }[]
}
export interface OwnerFlag { key: string; label: string; description: string; enabled: boolean; isDefault: boolean; updatedAt: string | null; updatedBy: string | null }
export interface ActivityRow { id: string; at: string; action: string; by: string; company: string | null; target: string | null; detail: unknown; ip: string | null }

export const ownerApi = {
  login: (email: string, password: string) => call<{ needCode: boolean; ticket?: string; owner?: { name: string; email: string } }>('POST', '/login', { email, password }),
  code: (ticket: string, code: string) => call<{ owner: { name: string; email: string } }>('POST', '/login/code', { ticket, code }),
  logout: () => call<void>('POST', '/logout'),
  me: () => call<{ owner: { id: string; name: string; email: string } }>('GET', '/me'),
  home: () => call<OwnerHome>('GET', '/home'),
  companies: () => call<{ companies: OwnerCompany[] }>('GET', '/companies'),
  company: (id: string) => call<{ company: OwnerCompany; tickets: TicketRow[]; activity: { at: string; action: string; by: string; detail: unknown }[] }>('GET', `/companies/${id}`),
  updateCompany: (id: string, input: { name?: string; status?: CompanyStatus; helpEnabled?: boolean }) => call<{ company: OwnerCompany }>('PATCH', `/companies/${id}`, input),
  tickets: (status = 'open') => call<{ tickets: TicketRow[] }>('GET', `/support?status=${encodeURIComponent(status)}`),
  ticket: (id: string) => call<{ ticket: TicketDetail }>('GET', `/support/${id}`),
  reply: (id: string, body: string, status?: TicketStatus) => call<{ ticket: TicketDetail }>('POST', `/support/${id}/reply`, { body, status }),
  updateTicket: (id: string, input: { status?: TicketStatus; priority?: TicketPriority }) => call<{ ticket: TicketDetail }>('PATCH', `/support/${id}`, input),
  flags: () => call<{ flags: OwnerFlag[] }>('GET', '/flags'),
  setFlag: (key: string, enabled: boolean) => call<{ flags: OwnerFlag[] }>('PATCH', `/flags/${key}`, { enabled }),
  activity: (q = '') => call<{ activity: ActivityRow[] }>('GET', `/activity?q=${encodeURIComponent(q)}`),
}

export const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'New', IN_PROGRESS: 'Working on it', WAITING_ON_COMPANY: 'Waiting for them', RESOLVED: 'Solved' }
export const PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }
