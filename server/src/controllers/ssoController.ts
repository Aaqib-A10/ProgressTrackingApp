import type { Request, Response } from 'express'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { runAsCompany, runAsSystem } from '../lib/tenancy'
import { hashPassword, signToken } from '../lib/auth'
import { hasPower } from '../lib/permissions'
import { checkPeopleRoom } from '../lib/plans'
import { recordActivity } from '../lib/audit'
import { appUrl } from '../lib/mail'
import { certExpiry, cleanCert, emailOf, nameOf, safeNext, samlFor, spUrls } from '../lib/sso'
import { logSignIn, setAuthCookie } from './authController'

/**
 * Single sign-on (SAML), the routes (lib/sso.ts has the checks):
 *   GET  /api/auth/sso/:slug/metadata   our details, for the company's identity provider
 *   GET  /api/auth/sso/:slug/start      off to the identity provider to sign in
 *   POST /api/auth/sso/:slug/acs        the identity provider sends the person back, signed
 *   POST /api/auth/sso/find { email }   which company's sign-in a work email belongs to (the sign-in page)
 *   GET/PUT /api/company/sso            the settings, for people with Company settings
 */

const SELECT = { id: true, slug: true, name: true, status: true, ssoOn: true, ssoEntryPoint: true, ssoIdpIssuer: true, ssoCert: true, ssoDomains: true, ssoRequired: true, ssoCreatePeople: true } as const
const bySlug = (slug: string) => runAsSystem(() => prisma.company.findUnique({ where: { slug }, select: SELECT }))
type Co = NonNullable<Awaited<ReturnType<typeof bySlug>>>
const ready = (c: Co | null): c is Co & { ssoEntryPoint: string; ssoCert: string } => !!c && c.ssoOn && !!c.ssoEntryPoint && !!c.ssoCert && c.status !== 'SUSPENDED'

/** Back to the sign-in page with a message (the page shows `sso_error`). */
const toLogin = (res: Response, message: string) => res.redirect(302, `${appUrl()}/login?sso_error=${encodeURIComponent(message)}`)

/** GET /api/auth/sso/:slug/metadata */
export async function metadata(req: Request, res: Response): Promise<void> {
  const c = await bySlug(req.params.slug)
  if (!c) { res.status(404).send('No such company.'); return }
  // Metadata is given before the settings are complete: the identity provider is set up with it first.
  const xml = samlFor(c.slug, { entryPoint: c.ssoEntryPoint || `${appUrl()}/login`, idpIssuer: null, cert: c.ssoCert || 'unset' }).generateServiceProviderMetadata(null)
  res.type('application/samlmetadata+xml').send(xml)
}

/** GET /api/auth/sso/:slug/start?next=/app/... */
export async function start(req: Request, res: Response): Promise<void> {
  const c = await bySlug(req.params.slug)
  if (!ready(c)) { toLogin(res, 'Single sign-on is not set up for this company.'); return }
  const url = await samlFor(c.slug, { entryPoint: c.ssoEntryPoint, idpIssuer: c.ssoIdpIssuer, cert: c.ssoCert }).getAuthorizeUrlAsync(safeNext(req.query.next), {})
  res.redirect(302, url)
}

/** POST /api/auth/sso/:slug/acs (form post from the identity provider) */
export async function acs(req: Request, res: Response): Promise<void> {
  const c = await bySlug(req.params.slug)
  if (!ready(c)) { toLogin(res, 'Single sign-on is not set up for this company.'); return }
  const body = (req.body ?? {}) as Record<string, string>
  if (typeof body.SAMLResponse !== 'string' || !body.SAMLResponse) { toLogin(res, 'The sign-in came back empty. Try again.'); return }
  let email: string | null = null
  let name = ''
  try {
    const { profile } = await samlFor(c.slug, { entryPoint: c.ssoEntryPoint, idpIssuer: c.ssoIdpIssuer, cert: c.ssoCert }).validatePostResponseAsync({ SAMLResponse: body.SAMLResponse })
    if (!profile) { toLogin(res, 'The sign-in could not be read. Try again.'); return }
    email = emailOf(profile)
    if (email) name = nameOf(profile, email)
  } catch (e) {
    // Never tell the browser why exactly (a forged answer learns nothing); the reason goes to the server log.
    console.warn(`[sso] ${c.slug}: sign-in refused: ${(e as Error).message.slice(0, 200)}`)
    toLogin(res, 'Your company’s sign-in could not be checked. Try again, or ask your admin to check the single sign-on settings.')
    return
  }
  if (!email) { toLogin(res, 'Your company’s sign-in did not send an email address. Ask your admin to send the email as the NameID.'); return }
  const domain = email.split('@')[1]
  if (c.ssoDomains.length && !c.ssoDomains.includes(domain)) { toLogin(res, `${domain} is not one of the email domains this company signs in with.`); return }

  const outcome = await runAsCompany(c.id, async (): Promise<{ user: { id: string; role: import('@prisma/client').Role } } | { error: string }> => {
    const found = await prisma.user.findFirst({ where: { email, companyId: c.id }, select: { id: true, role: true, isActive: true, status: true } })
    if (found) return found.isActive && found.status === 'ACTIVE' ? { user: found } : { error: 'Your Metriq account is not active. Ask your admin.' }
    // The same email in another company: never signed in here.
    if (await runAsSystem(() => prisma.user.findUnique({ where: { email: email! }, select: { id: true } }))) return { error: 'This email belongs to another Metriq company.' }
    if (!c.ssoCreatePeople) return { error: 'You are not in this company’s Metriq yet. Ask your admin to add you.' }
    try { await checkPeopleRoom(1, c.id) } catch (e) { return { error: (e as Error).message } }
    // A person added on their first sign-in: a member, with a password nobody knows (they sign in through the company).
    const made = await prisma.user.create({ data: { email: email!, name, role: 'MEMBER', status: 'ACTIVE', isActive: true, emailVerifiedAt: new Date(), passwordHash: await hashPassword(randomBytes(24).toString('base64url')) }, select: { id: true, role: true } })
    await recordActivity(made.id, 'CREATE', 'User', made.id, { after: { summary: `${name} (${email}) joined through single sign-on` } })
    return { user: made }
  })
  if ('error' in outcome) { toLogin(res, outcome.error); return }
  setAuthCookie(res, signToken({ sub: outcome.user.id, role: outcome.user.role, sso: true }))
  await runAsCompany(c.id, () => logSignIn(req, outcome.user.id, 'LOGIN'))
  res.redirect(302, `${appUrl()}${safeNext(body.RelayState)}`)
}

/** POST /api/auth/sso/find { email }: the sign-in address of the company this work email signs in with. */
export async function find(req: Request, res: Response): Promise<void> {
  const p = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Type your work email.' }); return }
  const domain = p.data.email.split('@')[1]
  const c = await runAsSystem(() => prisma.company.findFirst({ where: { ssoOn: true, ssoDomains: { has: domain }, status: { not: 'SUSPENDED' } }, select: { slug: true, name: true } }))
  if (!c) { res.status(404).json({ error: 'No company signs in with single sign-on for that email. Use your password.' }); return }
  res.json({ url: spUrls(c.slug).startUrl, company: c.name })
}

// ------------------------------------------------------------------ settings

async function admin(req: AuthedRequest, res: Response): Promise<string | null> {
  if (req.user!.supportBy) { res.status(403).json({ error: 'Metriq support cannot change sign-in settings.' }); return null }
  if (!(await hasPower(req.user!.id, 'company.settings'))) { res.status(403).json({ error: 'Only someone with Company settings sets up single sign-on.' }); return null }
  return req.user!.companyId
}

function view(c: Co, signedInWithSso: boolean) {
  return {
    on: c.ssoOn, entryPoint: c.ssoEntryPoint ?? '', idpIssuer: c.ssoIdpIssuer ?? '', domains: c.ssoDomains, required: c.ssoRequired, createPeople: c.ssoCreatePeople,
    cert: c.ssoCert ? { set: true, expires: certExpiry(c.ssoCert) } : { set: false, expires: null },
    sp: spUrls(c.slug),
    signedInWithSso,
  }
}

/** GET /api/company/sso */
export async function getSettings(req: AuthedRequest, res: Response): Promise<void> {
  const id = await admin(req, res)
  if (!id) return
  const c = await prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT })
  res.json({ sso: view(c, !!req.user!.sso) })
}

const settingsSchema = z.object({
  on: z.boolean(),
  entryPoint: z.string().trim().max(500).refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'The sign-in address must be a full address starting with https://'),
  idpIssuer: z.string().trim().max(500).optional(),
  cert: z.string().max(20_000).optional(),
  domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Write each domain like company.com')).max(20),
  required: z.boolean(),
  createPeople: z.boolean(),
})

/** PUT /api/company/sso */
export async function saveSettings(req: AuthedRequest, res: Response): Promise<void> {
  const id = await admin(req, res)
  if (!id) return
  const p = settingsSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the settings.' }); return }
  const d = p.data
  const before = await prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT })
  const cert = d.cert?.trim() ? cleanCert(d.cert) : before.ssoCert
  if (d.cert?.trim() && !cert) { res.status(400).json({ error: 'That is not a certificate. Paste the identity provider’s signing certificate (X.509, PEM or base64).' }); return }
  const domains = [...new Set(d.domains)]
  if (d.on && (!d.entryPoint || !cert || !domains.length)) { res.status(400).json({ error: 'To turn it on, give the sign-in address, the certificate and at least one email domain.' }); return }
  // A domain is one company's: two companies cannot both send people with @acme.com to their sign-in.
  const taken = domains.length ? await runAsSystem(() => prisma.company.findFirst({ where: { id: { not: id }, ssoDomains: { hasSome: domains } }, select: { id: true } })) : null
  if (taken) { res.status(409).json({ error: 'One of these email domains is already used by another company’s single sign-on.' }); return }
  // Requiring it shuts password sign-in for everyone but admins: wrong settings would lock people out. So it is only
  // allowed to someone who is signed in through single sign-on right now, which proves the settings work.
  if (d.on && d.required && !before.ssoRequired && !req.user!.sso) { res.status(409).json({ error: 'Sign out and sign in with single sign-on once, then require it. That proves the settings work before passwords are turned off.' }); return }
  const c = await prisma.company.update({
    where: { id },
    data: { ssoOn: d.on, ssoEntryPoint: d.entryPoint || null, ssoIdpIssuer: d.idpIssuer?.trim() || null, ssoCert: cert, ssoDomains: domains, ssoRequired: d.on && d.required, ssoCreatePeople: d.createPeople },
    select: SELECT,
  })
  await recordActivity(req.user!.id, 'UPDATE', 'Company', id, { after: { summary: `Single sign-on ${c.ssoOn ? 'on' : 'off'}${c.ssoRequired ? ', required' : ''} (${domains.join(', ') || 'no domains'})` } })
  res.json({ sso: view(c, !!req.user!.sso) })
}
