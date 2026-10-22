/**
 * Pinned projects: the person's favourites, shown first on Projects and in the sidebar.
 * Kept on this device (per person), so pinning needs no server and works instantly.
 */
export interface Pin { key: string; name: string; color: string | null }

const store = (userId: string) => `pt-pins:${userId}`
const EVENT = 'pt:pins'

export function getPins(userId: string | undefined): Pin[] {
  if (!userId) return []
  try { return JSON.parse(localStorage.getItem(store(userId)) || '[]') as Pin[] } catch { return [] }
}

export function togglePin(userId: string | undefined, p: Pin): boolean {
  if (!userId) return false
  const pins = getPins(userId)
  const on = pins.some((x) => x.key === p.key)
  const next = on ? pins.filter((x) => x.key !== p.key) : [...pins, p]
  try { localStorage.setItem(store(userId), JSON.stringify(next)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT))
  return !on
}

/** Keep pinned names and colours current when the project list loads. */
export function refreshPins(userId: string | undefined, projects: Pin[]): void {
  if (!userId) return
  const pins = getPins(userId)
  if (!pins.length) return
  const next = pins.map((p) => projects.find((x) => x.key === p.key) ?? p)
  if (JSON.stringify(next) === JSON.stringify(pins)) return
  try { localStorage.setItem(store(userId), JSON.stringify(next)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT))
}

export function onPinsChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', fn)
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn) }
}
