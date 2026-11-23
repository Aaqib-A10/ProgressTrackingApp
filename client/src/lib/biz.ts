/**
 * Small helpers shared by the business pages (Requests, People, Quotes and invoices, Report builder, Import):
 * the server's error text, the standard field look, and how money and dates are written.
 */

export const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
export const areaCls = 'w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
export const labelCls = 'mb-1 block text-body-sm font-medium text-ink'

/** The message the server sent with an error, or the fallback. */
export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

export const money = (n: number, currency = 'USD') => `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2026-12-31" → "Dec 31, 2026" (a plain date: no clock, no time zone). */
export function dayLabel(d: string | null | undefined): string {
  if (!d) return ''
  const t = new Date(`${d.slice(0, 10)}T00:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const whenLabel = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

/** 95 → "1 h 35 min". */
export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`
}

/** Every day from `from` to `to` (YYYY-MM-DD), at most `max`. */
export function daysBetween(from: string, to: string, max = 60): string[] {
  const out: string[] = []
  const end = new Date(`${to || from}T00:00:00Z`).getTime()
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end && out.length < max; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Save text as a file from the browser (a CSV export). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
