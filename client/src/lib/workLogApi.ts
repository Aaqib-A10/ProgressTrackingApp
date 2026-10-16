import { api } from './api'

/** My To-Do: Day / Week / Month / Year entries. Dates are plain yyyy-MM-dd (no time zone). */

export type WorkPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'
export type WorkStatus = 'PLANNED' | 'DONE'
export interface WorkEntry {
  id: string
  userId: string
  period: WorkPeriod
  periodStart: string
  title: string
  details: string | null
  status: WorkStatus
  doneAt: string | null
  hours: number | null
  quantity: number | null
  tag: string | null
  private: boolean
  order: number
  createdAt: string
  updatedAt: string
}
export interface WorkEntryInput {
  title?: string
  details?: string | null
  status?: WorkStatus
  hours?: number | null
  quantity?: number | null
  tag?: string | null
  private?: boolean
  period?: WorkPeriod
  date?: string
}

export const workLogApi = {
  list: (from: string, to: string, userId?: string) => api.get<{ entries: WorkEntry[]; readOnly: boolean }>(`/worklog?from=${from}&to=${to}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),
  people: () => api.get<{ people: { id: string; name: string; department: string | null }[] }>('/worklog/people'),
  create: (body: WorkEntryInput & { period: WorkPeriod; date: string; title: string }) => api.post<{ entry: WorkEntry }>('/worklog', body),
  update: (id: string, body: WorkEntryInput) => api.patch<{ entry: WorkEntry }>(`/worklog/${id}`, body),
  carry: (id: string) => api.post<{ entry: WorkEntry }>(`/worklog/${id}/carry`),
  remove: (id: string) => api.del<void>(`/worklog/${id}`),
}

// ------------------------------------------------------------------ dates (local calendar, yyyy-MM-dd)

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const todayIso = () => iso(new Date())
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }

/** First day of the period containing `s` (weeks start on Monday, like the server). */
export function startOf(period: WorkPeriod, s: string): string {
  const d = parse(s)
  if (period === 'DAY') return s
  if (period === 'WEEK') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d) }
  if (period === 'MONTH') return iso(new Date(d.getFullYear(), d.getMonth(), 1))
  return iso(new Date(d.getFullYear(), 0, 1))
}
/** Last day of the period that starts on `start`. */
export function endOf(period: WorkPeriod, start: string): string {
  const d = parse(start)
  if (period === 'DAY') return start
  if (period === 'WEEK') return addDays(start, 6)
  if (period === 'MONTH') return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  return iso(new Date(d.getFullYear(), 11, 31))
}
/** The period before / after. */
export function shift(period: WorkPeriod, start: string, by: number): string {
  const d = parse(start)
  if (period === 'DAY') return addDays(start, by)
  if (period === 'WEEK') return addDays(start, 7 * by)
  if (period === 'MONTH') return iso(new Date(d.getFullYear(), d.getMonth() + by, 1))
  return iso(new Date(d.getFullYear() + by, 0, 1))
}

export function periodLabel(period: WorkPeriod, start: string): string {
  const d = parse(start)
  if (period === 'DAY') return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (period === 'WEEK') {
    const e = parse(endOf('WEEK', start))
    const same = d.getMonth() === e.getMonth()
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${e.toLocaleDateString('en-US', same ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`
  }
  if (period === 'MONTH') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return String(d.getFullYear())
}

/** Tag ideas per department (people can type any tag). */
export const TAG_IDEAS: Record<string, string[]> = {
  ECOMMERCE: ['Listings', 'Orders', 'Customer messages', 'Returns', 'Inventory', 'Pricing', 'Ads', 'Shipping', 'Reviews'],
  ITAD: ['Calls', 'Emails', 'Quotes', 'Bids', 'Pickups', 'Follow-ups'],
  LEAD_GEN: ['Research', 'Leads', 'Data cleanup', 'Outreach'],
  MARKETING: ['Content', 'SEO', 'Social', 'Design', 'Video', 'Website'],
  CSR: ['Calls', 'Tickets', 'Follow-ups'],
  INVENTORY: ['Receiving', 'Testing', 'Grading', 'Stock count', 'Shipping'],
  TALKLOOP: ['Calls', 'Sales', 'Follow-ups'],
  '': ['Meeting', 'Admin', 'Learning', 'Report'],
}
