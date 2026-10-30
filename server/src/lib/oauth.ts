/**
 * Sign in or sign up with Google or Microsoft (Phase 1, step 7), the standard OAuth "code" way.
 * A provider is offered only when its keys are set on the server (never in code):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET (and MICROSOFT_TENANT, default "common")
 * The address to give them as the redirect: <APP_URL>/api/auth/oauth/<google|microsoft>/callback
 */

export type ProviderKey = 'google' | 'microsoft'
export type OAuthProfile = { email: string; name: string; subject: string; emailVerified: boolean }

/** Microsoft's tenant for personal accounts (Outlook.com, Hotmail): Microsoft owns and checks those addresses. */
export const MS_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

interface Provider {
  label: string
  configured: () => boolean
  authorizeUrl: () => string
  tokenUrl: () => string
  clientId: () => string
  clientSecret: () => string
  scope: string
  /**
   * Turn the token answer into the person's email, name and account id, or null. emailVerified
   * says the provider itself confirmed that the person owns the email address.
   */
  profile: (tokens: { access_token?: string; id_token?: string }) => Promise<OAuthProfile | null>
}

const env = (k: string) => process.env[k] ?? ''
const tenant = () => env('MICROSOFT_TENANT') || 'common'

function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown> } catch { return null }
}

export const PROVIDERS: Record<ProviderKey, Provider> = {
  google: {
    label: 'Google',
    configured: () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    clientId: () => env('GOOGLE_CLIENT_ID'),
    clientSecret: () => env('GOOGLE_CLIENT_SECRET'),
    scope: 'openid email profile',
    async profile(tokens) {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      if (!res.ok) return null
      const u = (await res.json()) as { email?: string; email_verified?: boolean; name?: string; sub?: string }
      if (!u.email || u.email_verified !== true || !u.sub) return null
      return { email: u.email.toLowerCase(), name: u.name || u.email.split('@')[0], subject: u.sub, emailVerified: true }
    },
  },
  microsoft: {
    label: 'Microsoft',
    configured: () => !!(env('MICROSOFT_CLIENT_ID') && env('MICROSOFT_CLIENT_SECRET')),
    authorizeUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`,
    tokenUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    clientId: () => env('MICROSOFT_CLIENT_ID'),
    clientSecret: () => env('MICROSOFT_CLIENT_SECRET'),
    scope: 'openid email profile User.Read',
    async profile(tokens) {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      if (!res.ok) return null
      const u = (await res.json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string; id?: string }
      const claims = decodeJwtPayload(tokens.id_token)
      const email = (u.mail || (claims?.email as string | undefined) || '').toLowerCase()
      if (!email || !u.id) return null
      // A work or school account's email is typed in by that organisation's own admin, so it is
      // only trusted when Microsoft says the organisation owns the email's domain (the "xms_edov"
      // claim, turned on in the app registration). A personal account's address is Microsoft's own.
      // The token comes straight from Microsoft over HTTPS in exchange for the code, so it is read as is.
      const personal = claims?.tid === MS_PERSONAL_TENANT
      const domainOwned = claims?.xms_edov === true || claims?.xms_edov === 'true' || claims?.xms_edov === 1
      const sameEmail = typeof claims?.email === 'string' && claims.email.toLowerCase() === email
      return { email, name: u.displayName || email.split('@')[0], subject: u.id, emailVerified: sameEmail && (personal || domainOwned) }
    },
  },
}

export const providerList = () => (Object.keys(PROVIDERS) as ProviderKey[]).filter((k) => PROVIDERS[k].configured()).map((k) => ({ key: k, label: PROVIDERS[k].label }))

export function redirectUri(provider: ProviderKey): string {
  return `${process.env.APP_URL || 'http://localhost:5173'}/api/auth/oauth/${provider}/callback`
}

export function authorizeLink(provider: ProviderKey, state: string): string {
  const p = PROVIDERS[provider]
  const q = new URLSearchParams({ client_id: p.clientId(), redirect_uri: redirectUri(provider), response_type: 'code', scope: p.scope, state, prompt: 'select_account' })
  return `${p.authorizeUrl()}?${q}`
}

export async function exchangeCode(provider: ProviderKey, code: string): Promise<OAuthProfile | null> {
  const p = PROVIDERS[provider]
  const res = await fetch(p.tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId(), client_secret: p.clientSecret(), code, grant_type: 'authorization_code', redirect_uri: redirectUri(provider) }),
  })
  if (!res.ok) return null
  return p.profile((await res.json()) as { access_token?: string; id_token?: string })
}
