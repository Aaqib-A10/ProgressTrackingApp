/**
 * Tiny User-Agent parser (no dependency) — good enough to label sign-ins with a
 * readable browser / OS / device for the admin Activity Log. Not a full UA
 * database; covers the mainstream browsers/OSes seen on an internal B2B app.
 */
export interface ParsedUa {
  browser: string | null
  os: string | null
  device: 'Desktop' | 'Mobile' | 'Tablet' | null
}

export function parseUserAgent(ua?: string | null): ParsedUa {
  if (!ua) return { browser: null, os: null, device: null }
  const s = ua

  // OS
  let os: string | null = null
  if (/Windows NT/.test(s)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS'
  else if (/Android/.test(s)) os = 'Android'
  else if (/Mac OS X/.test(s)) os = 'macOS'
  else if (/CrOS/.test(s)) os = 'ChromeOS'
  else if (/Linux/.test(s)) os = 'Linux'

  // Browser — order matters (Edge/Chrome share "Chrome"; Safari must lose to Chrome).
  let browser: string | null = null
  if (/Edg[A-Z]?\//.test(s)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera'
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet'
  else if (/Firefox\/|FxiOS/.test(s)) browser = 'Firefox'
  else if (/Chrome\/|CriOS/.test(s)) browser = 'Chrome'
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari'

  // Device type
  let device: ParsedUa['device'] = null
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'Tablet'
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/.test(s)) device = 'Mobile'
  else device = 'Desktop'

  return { browser, os, device }
}
