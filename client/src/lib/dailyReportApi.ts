import { api } from './api'

// The Daily Report builder (Phase 1, step 5).

export type FieldType = 'NUMBER' | 'TEXT' | 'LONG_TEXT' | 'CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'RATING' | 'LINK'
export type Answer = number | string | string[] | boolean
export type Values = Record<string, Answer>
export type Tone = 'success' | 'warning' | 'danger' | 'neutral'

export interface ReportField { id: string; label: string; help: string | null; type: FieldType; options: string[]; required: boolean; target: number | null; targetDir: 'MIN' | 'MAX'; unit: string | null }
export interface ReportForm {
  id: string; name: string; description: string | null; active: boolean; departmentId: string | null; department: string | null
  fields: ReportField[]; canManage: boolean; canSeeTeam: boolean; fills: boolean
}
export interface FieldInput { id?: string; label: string; help?: string | null; type: FieldType; options: string[]; required: boolean; target?: number | null; targetDir: 'MIN' | 'MAX'; unit?: string | null }
export interface FormInput { name: string; description?: string | null; departmentId: string | null; active?: boolean; fields: FieldInput[] }

export interface MyEntry {
  form: ReportForm; date: string; today: string; editable: boolean
  entry: { values: Values; submittedAt: string; updatedAt: string } | null
  onLeave: boolean; holiday: string | null; recent: { date: string; updatedAt: string }[]
}
export interface TeamDay {
  form: ReportForm; date: string; holiday: string | null
  counts: { people: number; sent: number; missing: number; onLeave: number }
  totals: { fieldId: string; total: number; average: number; answers: number; target: number | null; tone: Tone }[]
  rows: { userId: string; name: string; status: 'SENT' | 'MISSING' | 'ON_LEAVE' | 'HOLIDAY'; values: Values | null; updatedAt: string | null; tones: Record<string, Tone> }[]
}
export interface Trend { from: string; to: string; people: number; fields: { id: string; label: string; type: FieldType; target: number | null; targetDir: string }[]; days: { date: string; sent: number; totals: Record<string, number>; averages: Record<string, number> }[] }
export interface Monthly {
  form: ReportForm; month: string; workDays: number; fields: Trend['fields']
  rows: { userId: string; name: string; sent: number; due: number; onLeave: number; fields: Record<string, { total: number; average: number; tone: Tone }> }[]
}

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  NUMBER: 'Number', TEXT: 'Short text', LONG_TEXT: 'Long text', CHOICE: 'One choice', MULTI_CHOICE: 'Several choices', YES_NO: 'Yes or no', RATING: 'Rating (1 to 5)', LINK: 'Link',
}

export const dailyReportApi = {
  forms: () => api.get<{ forms: ReportForm[]; canCreate: boolean }>('/daily-report/forms'),
  create: (input: FormInput) => api.post<{ form: ReportForm }>('/daily-report/forms', input),
  update: (id: string, input: FormInput) => api.put<{ form: ReportForm }>(`/daily-report/forms/${id}`, input),
  remove: (id: string) => api.del<void>(`/daily-report/forms/${id}`),
  entry: (id: string, date?: string) => api.get<MyEntry>(`/daily-report/forms/${id}/entry${date ? `?date=${date}` : ''}`),
  save: (id: string, date: string, values: Values) => api.put<{ entry: MyEntry['entry']; date: string }>(`/daily-report/forms/${id}/entry`, { date, values }),
  team: (id: string, date?: string) => api.get<TeamDay>(`/daily-report/forms/${id}/team${date ? `?date=${date}` : ''}`),
  trend: (id: string, from?: string, to?: string) => api.get<Trend>(`/daily-report/forms/${id}/trend?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
  monthly: (id: string, month: string) => api.get<Monthly>(`/daily-report/forms/${id}/monthly?month=${month}`),
  monthlyCsvUrl: (id: string, month: string) => `${import.meta.env.VITE_API_URL ?? '/api'}/daily-report/forms/${id}/monthly.csv?month=${month}`,
}
