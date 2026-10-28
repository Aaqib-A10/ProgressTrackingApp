import type { Request, Response } from 'express'
import { z } from 'zod'
import { IANAZone } from 'luxon'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { hashPassword, signOAuthState, signToken, signVerifyToken, verifyOAuthState, verifyVerifyToken } from '../lib/auth'
import { createCompanyWithOwner } from '../lib/signup'
import { sendVerifyEmail } from '../lib/mail'
import { PROVIDERS, authorizeLink, exchangeCode, providerList, type ProviderKey } from '../lib/oauth'
import { getClientIp } from '../lib/ip'
import { isOn } from '../lib/flags'

const NOT_OPEN = 'Metriq is not open for new companies yet.'

/** GET /api/auth/open — can new companies sign up (the owner's "New companies can sign up" switch)? */
export async function signupOpen(_req: Request, res: Response): Promise<void> {
  res.json({ newCompanies: await isOn('new-companies') })
}

/**
 * Sign up (Phase 1, step 7): a company ("For my team") or one person ("Just me") starts a
 * 14-day free trial on its own, with an email and password or with Google / Microsoft. Email
 * sign-ups confirm their address by a link; until then they can look around but not invite
 * people. The old /signup page stays 99 Technologies' own.
 */

const COOKIE = 'token'
const STATE_COOKIE = 'pt_oauth'
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const setSession = (res: Response, user: { id: string; role: 'SUPER_ADMIN' | string }) =>
  res.cookie(COOKIE, signToken({ sub: user.id, role: user.role as 'SUPER_ADMIN' }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SEVEN_DAYS, path: '/' })

const startSchema = z.object({
  mode: z.enum(['team', 'solo']),
  name: z.string().trim().min(2, 'Your name, please').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(200),
  password: z.string().min(8, 'At least 8 characters').max(200).refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Use letters and numbers'),
  companyName: z.string().trim().max(80).optional(),
  timeZone: z.string().trim().max(60).optional(),
})

/** POST /api/auth/start — sign up with an email and password. */
export async function start(req: Request, res: Response): Promise<void> {
  if (!(await isOn('new-companies'))) { res.status(403).json({ error: NOT_OPEN }); return }
  const p = startSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = p.data
  if (v.mode === 'team' && (!v.companyName || v.companyName.length < 2)) { res.status(400).json({ error: "Your company's name, please" }); return }
  if (v.email.endsWith('@local.test') && process.env.NODE_ENV === 'production') { res.status(400).json({ error: 'Enter a valid email' }); return }
  // The same answer whether or not the email is taken would hide it, but a person signing up
  // needs to know: point them to sign in instead.
  if (await prisma.user.findUnique({ where: { email: v.email }, select: { id: true } })) { res.status(409).json({ error: 'This email already has a Metriq account. Sign in instead.' }); return }
  const tz = v.timeZone && IANAZone.isValidZone(v.timeZone) ? v.timeZone : null
  const { company, user } = await createCompanyWithOwner({ mode: v.mode, companyName: v.companyName, name: v.name, email: v.email, passwordHash: await hashPassword(v.password), verified: false, timeZone: tz })
  const token = signVerifyToken(user.id)
  await sendVerifyEmail({ to: user.email, name: user.name.split(' ')[0], token })
  await prisma.loginEvent.create({ data: { userId: user.id, kind: 'SIGNUP', ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 400) || null } }).catch(() => undefined)
  setSession(res, user)
  res.status(201).json({ company: { id: company.id, name: company.name, slug: company.slug, kind: company.kind }, next: '/app/setup', ...(process.env.NODE_ENV !== 'production' ? { devVerifyToken: token } : {}) })
}

/** POST /api/auth/verify-email { token } — the link from the email. */
export async function verifyEmail(req: Request, res: Response): Promise<void> {
  let userId: string
  try { userId = verifyVerifyToken(String(req.body?.token ?? '')) } catch { res.status(400).json({ error: 'This link does not work any more. Sign in and ask for a new one.' }); return }
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!u) { res.status(400).json({ error: 'This link does not work any more.' }); return }
  await prisma.user.update({ where: { id: u.id }, data: { emailCheckPending: false, emailVerifiedAt: new Date() } })
  res.json({ ok: true })
}

/** POST /api/auth/verify-email/resend — send the confirm link again. */
export async function resendVerify(req: AuthedRequest, res: Response): Promise<void> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, emailCheckPending: true } })
  if (!u.emailCheckPending) { res.json({ ok: true, already: true }); return }
  const token = signVerifyToken(u.id)
  await sendVerifyEmail({ to: u.email, name: u.name.split(' ')[0], token })
  res.json({ ok: true, ...(process.env.NODE_ENV !== 'production' ? { devVerifyToken: token } : {}) })
}

/** GET /api/auth/company/:slug — a company's own sign-in page shows its name. */
export async function companyBySlug(req: Request, res: Response): Promise<void> {
  const c = await prisma.company.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, select: { name: true, slug: true, kind: true, status: true } })
  if (!c || c.status === 'SUSPENDED') { res.status(404).json({ error: 'No company with this address' }); return }
  res.json({ company: { name: c.name, slug: c.slug, kind: c.kind } })
}

// ------------------------------------------------------------------ Google / Microsoft

/** GET /api/auth/oauth/providers — which buttons to show. */
export async function oauthProviders(_req: Request, res: Response): Promise<void> {
  res.json({ providers: providerList() })
}

const isProvider = (p: string): p is ProviderKey => p === 'google' || p === 'microsoft'

/** GET /api/auth/oauth/:provider/start?intent=signin|signup&mode=team|solo&company=… — off to Google / Microsoft. */
export async function oauthStart(req: Request, res: Response): Promise<void> {
  const provider = String(req.params.provider)
  if (!isProvider(provider) || !PROVIDERS[provider].configured()) { res.status(404).json({ error: 'Not available' }); return }
  const intent = req.query.intent === 'signup' ? 'signup' : 'signin'
  const mode = req.query.mode === 'solo' ? 'solo' : 'team'
  const company = String(req.query.company ?? '').trim().slice(0, 80)
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const state = signOAuthState({ provider, intent, mode, company, nonce })
  // The same note in a cookie: the answer must come back to the browser that asked.
  res.cookie(STATE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60_000, path: '/api/auth/oauth' })
  res.redirect(authorizeLink(provider, state))
}

/** GET /api/auth/oauth/:provider/callback?code&state — back from Google / Microsoft. */
export async function oauthCallback(req: Request, res: Response): Promise<void> {
  const provider = String(req.params.provider)
  const fail = (why: string) => res.redirect(`/login?error=${encodeURIComponent(why)}`)
  if (!isProvider(provider) || !PROVIDERS[provider].configured()) { fail('That sign-in is not available.'); return }
  let st: Record<string, string>
  try { st = verifyOAuthState(String(req.query.state ?? '')) } catch { fail('The sign-in took too long. Try again.'); return }
  const cookieNonce = (req as Request & { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE]
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' })
  if (st.provider !== provider || !cookieNonce || cookieNonce !== st.nonce) { fail('The sign-in did not come from this browser. Try again.'); return }
  const who = typeof req.query.code === 'string' ? await exchangeCode(provider, req.query.code).catch(() => null) : null
  if (!who) { fail(`${PROVIDERS[provider].label} did not let us in. Try again.`); return }

  // Google says when an address is confirmed, so it opens the account with that email.
  // Microsoft does not always, so it only opens accounts made with Microsoft.
  const existing = provider === 'google'
    ? await prisma.user.findUnique({ where: { email: who.email } })
    : await prisma.user.findUnique({ where: { microsoftId: who.subject } })
  if (existing) {
    const c = await prisma.company.findUnique({ where: { id: existing.companyId }, select: { status: true } })
    if (!existing.isActive || existing.status !== 'ACTIVE' || c?.status === 'SUSPENDED') { fail('This account cannot sign in. Ask your Super Admin.'); return }
    if (provider === 'google' && !existing.googleId) await prisma.user.update({ where: { id: existing.id }, data: { googleId: who.subject, emailCheckPending: false, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } })
    setSession(res, existing)
    res.redirect('/app/dashboard')
    return
  }
  if (provider === 'microsoft' && (await prisma.user.findUnique({ where: { email: who.email }, select: { id: true } }))) {
    fail('This email already has a Metriq account. Sign in with your password.')
    return
  }
  if (!(await isOn('new-companies'))) { fail(`There is no Metriq account for ${who.email}.`); return }
  if (st.intent !== 'signup') { fail(`There is no Metriq account for ${who.email} yet. Start a free trial instead.`); return }
  const { user } = await createCompanyWithOwner({
    mode: st.mode === 'solo' ? 'solo' : 'team', companyName: st.company || null, name: who.name, email: who.email, passwordHash: null,
    googleId: provider === 'google' ? who.subject : null, verified: true,
  })
  if (provider === 'microsoft') await prisma.user.update({ where: { id: user.id }, data: { microsoftId: who.subject } })
  setSession(res, user)
  res.redirect('/app/setup')
}
