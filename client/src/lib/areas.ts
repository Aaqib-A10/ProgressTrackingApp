/**
 * Parts of Metriq a company role can have switched off (Phase 1, step 4). The same list as the
 * server's lib/permissions.ts AREAS (a test checks they match); here only where they live in the
 * app. The longest match wins (the Lead Dialer is inside ITAD).
 */
export const AREA_APP: Record<string, string[]> = {
  attendance: ['/app/attendance'],
  projects: ['/app/projects'],
  tasks: ['/app/tasks'],
  todos: ['/app/todo'],
  chat: ['/app/chat', '/app/calendar', '/app/meetings'],
  feedback: ['/app/feedback'],
  itad: ['/app/itad'],
  dialer: ['/app/itad/dialer'],
  leadgen: ['/app/leadgen'],
  marketing: ['/app/marketing'],
  ecommerce: ['/app/ecommerce'],
  inventory: ['/app/inventory'],
  qa: ['/app/qa'],
  reports: ['/app/reports', '/app/analytics'],
  'daily-report': ['/app/daily-report'],
}

export function areaOfPath(pathname: string): string | null {
  const p = pathname.split('?')[0].replace(/\/+$/, '')
  let best: { key: string; len: number } | null = null
  for (const [key, prefixes] of Object.entries(AREA_APP)) for (const prefix of prefixes) {
    if ((p === prefix || p.startsWith(prefix + '/')) && (!best || prefix.length > best.len)) best = { key, len: prefix.length }
  }
  return best?.key ?? null
}

/** Is this address switched off for the person's company role? */
export function areaBlocked(u: { areasOff?: string[] } | null | undefined, pathname: string): boolean {
  if (!u?.areasOff?.length) return false
  const a = areaOfPath(pathname)
  return !!a && u.areasOff.includes(a)
}
