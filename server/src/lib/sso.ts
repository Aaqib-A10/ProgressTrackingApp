import { SAML, InMemoryCacheProvider, ValidateInResponseTo, type Profile } from '@node-saml/node-saml'
import { X509Certificate } from 'crypto'
import { appUrl } from './mail'

/**
 * Single sign-on with SAML 2.0 (plan 2026-11, stage 4): a company signs its people in through its own identity
 * provider (Okta, Microsoft Entra ID, Google Workspace, OneLogin, JumpCloud...). Metriq is the service provider.
 *
 * What is checked on every sign-in (by @node-saml/node-saml): the assertion is signed with the certificate the
 * company gave us, it is for us (audience), it is not too old or from the future, and it is used once only (an
 * assertion seen before is refused, and an answer to a sign-in we started must answer that request).
 */

export interface SsoConfig { entryPoint: string; idpIssuer: string | null; cert: string }

/** Our side's addresses for a company, which its identity provider is set up with. */
export function spUrls(slug: string) {
  const base = `${appUrl().replace(/\/+$/, '')}/api/auth/sso/${encodeURIComponent(slug)}`
  return { entityId: `${base}/metadata`, acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata`, startUrl: `${base}/start` }
}

/** The certificate as PEM, from what an admin pasted (PEM, or the base64 body alone). Null when it is not a certificate. */
export function cleanCert(raw: string): string | null {
  const body = raw.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/=]{100,}$/.test(body)) return null
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  try { new X509Certificate(pem); return pem } catch { return null }
}

/** When the certificate stops being valid (shown in Company settings, so an expiring one is noticed). */
export function certExpiry(pem: string): string | null {
  try { return new Date(new X509Certificate(pem).validTo).toISOString() } catch { return null }
}

// One cache for the whole process: the requests we sent (to check the answers) and the assertions already used.
const cache = new InMemoryCacheProvider({ keyExpirationPeriodMs: 10 * 60_000 })

export function samlFor(slug: string, c: SsoConfig): SAML {
  const u = spUrls(slug)
  return new SAML({
    callbackUrl: u.acsUrl,
    issuer: u.entityId,
    audience: u.entityId,
    entryPoint: c.entryPoint,
    idpCert: c.cert,
    ...(c.idpIssuer ? { idpIssuer: c.idpIssuer } : {}),
    // Identity providers sign the assertion; some sign only the response around it. The assertion must be signed.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: 2 * 60_000,
    maxAssertionAgeMs: 10 * 60_000,
    // A sign-in started from the identity provider's own app list has no request of ours to answer: allowed, and
    // every assertion is still used once only.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    rejectReplayedAssertions: true,
    cacheProvider: cache,
  })
}

/** The email the identity provider says this person has, lower case; null when it gives none. */
export function emailOf(p: Profile): string | null {
  const x = p as unknown as Record<string, unknown>
  const candidates = [
    p.email, p.mail, p['urn:oid:0.9.2342.19200300.100.1.3'],
    x['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    x['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'],
    x.Email, x.emailAddress, p.nameID,
  ]
  for (const v of candidates) {
    const s = (Array.isArray(v) ? v[0] : v) as unknown
    if (typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())) return s.trim().toLowerCase()
  }
  return null
}

/** The person's name as the identity provider gives it, for a person Metriq adds on their first sign-in. */
export function nameOf(p: Profile, email: string): string {
  const x = p as unknown as Record<string, unknown>
  const pick = (...keys: string[]) => { for (const k of keys) { const v = x[k]; const s = Array.isArray(v) ? v[0] : v; if (typeof s === 'string' && s.trim()) return s.trim() } return '' }
  const full = pick('displayName', 'name', 'http://schemas.microsoft.com/identity/claims/displayname', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name')
  if (full && !full.includes('@')) return full.slice(0, 120)
  const first = pick('firstName', 'givenName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname')
  const last = pick('lastName', 'surname', 'sn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname')
  return `${first} ${last}`.trim().slice(0, 120) || email.split('@')[0]
}

/** Where to go after signing in: only an address inside the app. */
export const safeNext = (v: unknown): string => (typeof v === 'string' && /^\/app(\/[\w\-./?=&%]*)?$/.test(v) && !v.includes('//') ? v : '/app/dashboard')
