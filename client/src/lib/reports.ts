import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import type { Department } from './types'
import { rangeQuery } from './range'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

/** Fetches the team report CSV (cookie-authed) and triggers a browser download. */
export async function downloadTeamCsv(range: RangeKey, department?: Department, custom?: CustomRange | null): Promise<void> {
  const qs = new URLSearchParams(rangeQuery(range, custom))
  if (department) qs.set('department', department)

  const res = await fetch(`${BASE_URL}/reports/team.csv?${qs.toString()}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Export failed')

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'team-report.csv'
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
