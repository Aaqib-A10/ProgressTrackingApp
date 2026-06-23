/** Lightweight relative + absolute time formatting for feedback threads. */

/** ISO string → "just now" / "5m ago" / "3h ago" / "2d ago" / "Jun 17". */
export function fromNow(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** ISO string → "Jun 17, 2026, 2:30 PM". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
