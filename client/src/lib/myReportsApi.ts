import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export interface ReportCol {
  key: string
  label: string
}
export interface ReportRow {
  date: string
  status: string
  values: Record<string, number>
}
export interface MyReportsData {
  department: string | null
  subDepartment: string | null
  range: { startDate: string; endDate: string; key: RangeKey }
  columns: ReportCol[]
  rows: ReportRow[]
  totals: Record<string, number>
}

export function getMyReports(range: RangeKey, custom?: CustomRange | null) {
  return api.get<MyReportsData>(`/reports/me?${rangeQuery(range, custom)}`)
}
