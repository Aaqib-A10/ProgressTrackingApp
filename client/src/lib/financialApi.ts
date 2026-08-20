import { api } from './api'
import type { Department } from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export interface PersonCost {
  id: string
  name: string
  team: Department
  teamName: string
  monthlyCost: number
  startDate: string
  endDate: string | null
  activeMonths: number
  costInRange: number
}
export interface TeamFinancials {
  team: Department
  teamName: string
  staff: number
  cost: number
  revenue: number | null
  netReturn: number | null
  roi: number | null
  people: PersonCost[]
}
export interface FinancialReport {
  from: string
  to: string
  teams: TeamFinancials[]
  totals: { staff: number; cost: number; revenue: number; netReturn: number; roi: number | null }
  former: PersonCost[]
  formerCost: number
}
export interface SalaryRecord {
  id: string
  name: string
  userId: string | null
  department: Department
  monthlyCost: number
  startDate: string
  endDate: string | null
  note: string | null
  active: boolean
}
export interface SalaryInput {
  name: string
  userId?: string | null
  department: Department
  monthlyCost: number
  startDate: string
  endDate?: string | null
  note?: string | null
}

export const getFinancialReport = (from: string, to: string) =>
  api.get<FinancialReport>(`/financials?from=${from}&to=${to}`)

export const listSalaries = () => api.get<{ salaries: SalaryRecord[] }>('/financials/salaries')
export const createSalary = (input: SalaryInput) => api.post<{ salary: SalaryRecord }>('/financials/salaries', input)
export const updateSalary = (id: string, input: Partial<SalaryInput>) =>
  api.patch<{ salary: SalaryRecord }>(`/financials/salaries/${id}`, input)
export const deleteSalary = (id: string) => api.del<void>(`/financials/salaries/${id}`)

/** Fetches the financial report CSV (cookie-authed) and triggers a browser download. */
export async function downloadFinancialCsv(from: string, to: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/financials/report.csv?from=${from}&to=${to}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `financial-report-${from}_to_${to}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
