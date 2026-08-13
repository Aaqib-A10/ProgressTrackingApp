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

  await triggerDownload(res, 'team-report.csv')
}

/** Fetches the per-day team attendance timesheet CSV and triggers a download. */
export async function downloadAttendanceCsv(range: RangeKey, custom?: CustomRange | null, department?: Department): Promise<void> {
  const qs = new URLSearchParams(rangeQuery(range, custom))
  if (department) qs.set('department', department)

  const res = await fetch(`${BASE_URL}/attendance/team.csv?${qs.toString()}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Export failed')
  await triggerDownload(res, 'attendance-report.csv')
}

/** Reads a CSV response body and triggers a browser download, honoring Content-Disposition. */
async function triggerDownload(res: Response, fallbackName: string): Promise<void> {
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
