import { google } from 'googleapis'

// Use googleapis' own bundled GoogleAuth so the auth type matches the API clients
// (importing google-auth-library directly triggers a dual-package type clash).
type Auth = InstanceType<typeof google.auth.GoogleAuth>

/**
 * Thin read-only wrappers over Google Search Console + Google Analytics (GA4),
 * authenticated with a single service account. Provision the account's JSON key
 * (base64 or raw JSON) as env GOOGLE_SERVICE_ACCOUNT_JSON, then grant that
 * service-account email read access to each brand's GSC + GA4 property.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
]

let cachedAuth: Auth | null = null

/** True when a service account is configured (so callers can fail loudly but cleanly). */
export function isGoogleConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
}

function getAuth(): Auth {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('Google is not connected — set GOOGLE_SERVICE_ACCOUNT_JSON (service-account key) first.')
  if (!cachedAuth) {
    const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const credentials = JSON.parse(json)
    cachedAuth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
  }
  return cachedAuth
}

export interface GscDay {
  date: string // YYYY-MM-DD
  clicks: number
  impressions: number
  ctr: number // 0..1
  position: number // average position (lower is better)
}

/** Per-day Search Console metrics for a site over [startDate, endDate] (inclusive). */
export async function gscDaily(siteUrl: string, startDate: string, endDate: string): Promise<GscDay[]> {
  const sc = google.searchconsole({ version: 'v1', auth: getAuth() })
  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: { startDate, endDate, dimensions: ['date'], type: 'web', rowLimit: 1000 },
  })
  return (res.data.rows ?? []).map((r) => ({
    date: r.keys?.[0] ?? '',
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }))
}

export interface Ga4Day {
  date: string // YYYY-MM-DD
  sessions: number
  users: number
  newUsers: number
  engagedSessions: number
  bounceRate: number // 0..1
}

/** Per-day GA4 traffic metrics for a property over [startDate, endDate] (inclusive). */
export async function ga4Daily(propertyId: string, startDate: string, endDate: string): Promise<Ga4Day[]> {
  const property = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`
  const data = google.analyticsdata({ version: 'v1beta', auth: getAuth() })
  const res = await data.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'engagedSessions' },
        { name: 'bounceRate' },
      ],
    },
  })
  return (res.data.rows ?? []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value ?? '' // GA4 returns "YYYYMMDD"
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
    const m = r.metricValues ?? []
    const num = (i: number) => Number(m[i]?.value ?? 0) || 0
    return { date, sessions: num(0), users: num(1), newUsers: num(2), engagedSessions: num(3), bounceRate: num(4) }
  })
}
