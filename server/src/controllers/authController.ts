import type { Request, Response } from 'express'
import { z } from 'zod'
import { DepartmentType, Prisma, type Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { activeProvider } from '../lib/billing/providers'
import { leadsCmrOf, leadsHeadOnlyOf, leadsRoleOf } from '../lib/leads/access'
import { syncCmrMembers } from '../lib/leads/members'
import { companySectionsOff } from '../lib/sectionsOff'
import { personBlocks, personDashboard } from '../lib/personBlocks'
import { cleanPrefs } from '../lib/cards'
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  signToken,
  signResetToken,
  readResetToken,
  resetStamp,
  signTwoStepTicket,
} from '../lib/auth'
import type { AuthedRequest } from '../middleware/auth'
import { sendPasswordResetEmail } from '../lib/mail'
import { getClientIp } from '../lib/ip'
import { parseUserAgent } from '../lib/userAgent'
import { powersOf } from '../lib/permissions'
import { companyAreasOff } from '../lib/plans'
import { isThemeId } from '../lib/themes'
import { cleanNumber, whatsappReady } from '../lib/whatsapp'

/** Record a sign-in for the Activity Log. Best-effort — never blocks auth. */
export async function logSignIn(req: Request, userId: string, kind: 'LOGIN' | 'SIGNUP'): Promise<void> {
  try {
    const ua = (req.headers['user-agent'] || '').slice(0, 400) || null
    const { browser, os, device } = parseUserAgent(ua)
    await prisma.loginEvent.create({ data: { userId, kind, ip: getClientIp(req), userAgent: ua, browser, os, device } })
  } catch {
    /* logging must never break sign-in */
  }
}

const COOKIE = 'token'
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS,
    path: '/',
  })
}

/** The phone app (its own origin, no cookies) says X-PT-App: 1 and gets the session token in the body too. */
const fromApp = (req: Request) => req.headers['x-pt-app'] === '1'

/** Shape returned to the client — never includes passwordHash. */
async function publicUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      department: { select: { type: true, name: true, layout: true, dashboard: true } },
      subDepartment: { select: { slug: true, name: true } },
      memberships: {
        include: { department: { select: { type: true, name: true } }, subDepartment: { select: { slug: true } } },
        orderBy: { createdAt: 'asc' },
      },
      company: { select: { id: true, name: true, slug: true, kind: true, plan: true, status: true, timeZone: true, modulesOff: true, modulesOn: true, trialEndsAt: true, setupDoneAt: true, theme: true, brandColor: true, requireTwoStep: true } },
      customRole: { select: { id: true, name: true, areasOff: true, powers: true } },
    },
  })
  const companyDepartments = await prisma.department.findMany({ where: { companyId: user.companyId }, select: { type: true, name: true }, orderBy: { createdAt: 'asc' } })
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role, // the ACTIVE membership's role (mirrored onto User)
    isDeveloper: user.isDeveloper, // sees System Health
    department: user.department?.type ?? null,
    subDepartment: user.subDepartment?.slug ?? null,
    activeDepartmentId: user.departmentId ?? null,
    memberships: user.memberships.map((m) => ({
      departmentId: m.departmentId,
      department: m.department.type,
      departmentName: m.department.name,
      subDepartment: m.subDepartment?.slug ?? null,
      role: m.role,
    })),
    // Phase 1: the company (or personal workspace), the company's own role, extra powers and
    // the parts of Metriq switched off for the role.
    company: {
      id: user.company.id, name: user.company.name, slug: user.company.slug, kind: user.company.kind, plan: user.company.plan, status: user.company.status, timeZone: user.company.timeZone,
      // The company's colour theme and brand colour (null: Metriq's own); the person's own pick is uiTheme below.
      theme: user.company.theme, brandColor: user.company.brandColor,
      trialEndsAt: user.company.status === 'TRIAL' ? user.company.trialEndsAt : null, setupDone: !!user.company.setupDoneAt,
      // Online payment open (a payment provider is set up), or "coming soon".
      paymentsOpen: !!activeProvider(),
      // The kinds of department the company has: the menu leaves out sections for kinds it has none of.
      departmentKinds: [...new Set(companyDepartments.map((d) => d.type))],
      // What the company calls its department of each kind (the first one made), so its screens use its own names.
      departmentNames: Object.fromEntries([...companyDepartments].reverse().map((d) => [d.type, d.name])),
      // Sections the company turned off (Phase 2): their screens are left out of the menu.
      sectionsOff: await companySectionsOff(user.companyId),
    },
    // Department Studio: the blocks in this person's menu, in order (null: the menu of their department's kind).
    blocks: await personBlocks(user),
    // Part B: the cards on their dashboard (null: the dashboard of their department's kind), and how they arranged them.
    dashboard: await personDashboard(user),
    dashboardPrefs: cleanPrefs(user.dashboardPrefs),
    // Part C: the blocks the company made itself (name and icon, for menus and links).
    customBlocks: (await prisma.customBlock.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true, icon: true, color: true }, orderBy: { createdAt: 'asc' } })),
    emailCheckPending: user.emailCheckPending,
    // The colour theme this person picked (null: the company's).
    uiTheme: user.uiTheme,
    language: user.language,
    // "My menu": the sidebar items this person hid for themselves.
    navHidden: user.navHidden,
    whatsapp: { number: user.whatsappNumber ?? '', on: user.whatsappOn, ready: whatsappReady() },
    // Two-step sign-in: is theirs on, and does the company require it (then the app shows only the setup until it is).
    twoStep: { on: !!user.twoStepOn, required: user.company.requireTwoStep },
    customRole: user.customRole ? { id: user.customRole.id, name: user.customRole.name } : null,
    permissions: powersOf(user),
    // Switched off for the company's plan (or by the owner) and for the person's company role.
    areasOff: [...new Set([...companyAreasOff(user.company), ...(user.customRole?.areasOff ?? [])])],
    // Lead Management: MANAGER or REP when the person works the leads of at least one business
    // (someone in a CMR department joins the CMR business by themselves).
    leadsRole: await (user.department?.type === 'CMR' ? syncCmrMembers().catch(() => 0) : Promise.resolve(0)).then(() => leadsRoleOf(user.id)),
    // The CMR flow (Jesse Queue, Daily Report, Jesse Summary) when the person works a CMR business.
    leadsCmr: await leadsCmrOf(user.id, user.role === 'SUPER_ADMIN'),
    // The head of a business who works no leads (Jesse): the menu is just the queue and the summary.
    leadsHead: user.role !== 'SUPER_ADMIN' && (await leadsHeadOnlyOf(user.id)),
  }
}

// --- Schemas ---
// Emails are case-insensitive: always trim + lowercase so login lookups match
// however the address was originally typed when the account was created.
const emailField = (message = 'Enter a valid work email') =>
  z.string().email(message).transform((v) => v.trim().toLowerCase())

// Self-registration is for Team Leads only. Members are invited by their Team Lead.
const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: emailField(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  companyName: z.string().optional(),
  // A real department (ITAD/LEAD_GEN/MARKETING/CSR) or 'QA' to request a QA Team Lead role.
  department: z.string().min(1),
})

// Email, or a username (short sign in names, e.g. the local test accounts).
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1),
})

const forgotSchema = z.object({ email: emailField() })
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// --- Handlers ---
export async function signup(req: Request, res: Response): Promise<void> {
  const parsed = signupSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const { name, email, password, department } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' })
    return
  }

  // QA Team Lead self-registration: created PENDING, awaiting Super Admin approval.
  if (department === 'QA') {
    await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password), role: 'QA_LEAD', status: 'PENDING' },
    })
    res.status(201).json({ pending: true, message: 'Your QA Team Lead request has been sent to the admin for approval.' })
    return
  }

  const DEPARTMENTS: DepartmentType[] = ['ITAD', 'LEAD_GEN', 'MARKETING', 'CSR']
  if (!DEPARTMENTS.includes(department as DepartmentType)) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }
  const dept = await prisma.department.findFirst({ where: { type: department as DepartmentType } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }

  // Department Team Lead self-registration: created PENDING, awaiting Super Admin
  // approval — NOT signed in. Self-signup must never mint an active, privileged
  // account (that would let anyone become a department Team Lead with access to
  // member PII, revenue, and roster management). The requested department + role
  // are recorded so the admin sees the request and Approve activates it directly;
  // requireAuth rejects any PENDING account, so this credential can't be used yet.
  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'TEAM_LEAD',
      status: 'PENDING',
      departmentId: dept.id,
      memberships: { create: { departmentId: dept.id, role: 'TEAM_LEAD' } },
    },
  })

  res.status(201).json({ pending: true, message: 'Your Team Lead request has been sent to the admin for approval.' })
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const { email, password } = parsed.data

  const found = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } })
  // Test accounts made on a PC (src/scripts/devOwner.ts) never sign in on the live server.
  const user = found && process.env.NODE_ENV === 'production' && found.email.endsWith('@local.test') ? null : found
  // Always run a bcrypt compare — against a dummy hash when the account/hash is
  // absent — so login response time doesn't reveal whether the email exists.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!user || !user.passwordHash || !passwordOk) {
    res.status(401).json({ error: 'Invalid email, username or password' })
    return
  }
  if (user.status === 'PENDING') {
    res.status(403).json({ error: 'Your account is awaiting admin approval.' })
    return
  }
  if (user.status === 'REJECTED') {
    res.status(403).json({ error: 'Your account request was declined. Contact your administrator.' })
    return
  }
  if (!user.isActive) {
    res.status(403).json({ error: 'This account is disabled' })
    return
  }
  const co = user.companyId ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { status: true, slug: true, ssoOn: true, ssoRequired: true } }) : null
  // The company signs in through its own identity provider: passwords are closed, except for its Super Admins (so a
  // broken identity provider never locks the company out of its own settings).
  if (co?.ssoOn && co.ssoRequired && user.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Your company signs in with single sign-on. Use "Sign in with your company".', code: 'SSO_REQUIRED', ssoUrl: `/api/auth/sso/${encodeURIComponent(co.slug)}/start` })
    return
  }
  if (co?.status === 'SUSPENDED') {
    res.status(403).json({ error: 'Your company\'s Metriq account is paused. Contact Metriq support.' })
    return
  }

  // Two-step sign-in: the password was right, now the code from their app (POST /login/two-step with this ticket).
  if (user.twoStepOn && user.totpSecret) {
    res.json({ twoStep: true, ticket: signTwoStepTicket(user.id) })
    return
  }
  await completeSignIn(req, res, user)
}

/** The last step of every sign-in: the session cookie, a line in the sign-in log, and the person's own details. */
export async function completeSignIn(req: Request, res: Response, user: { id: string; role: Role }, extra: Record<string, unknown> = {}): Promise<void> {
  const token = signToken({ sub: user.id, role: user.role })
  setAuthCookie(res, token)
  await logSignIn(req, user.id, 'LOGIN')
  res.json({ user: await publicUser(user.id), ...(fromApp(req) ? { token } : {}), ...extra })
}

export async function me(req: AuthedRequest, res: Response): Promise<void> {
  // A help sign-in is shown as such (a banner with "End") on every page.
  res.json({ user: { ...(await publicUser(req.user!.id)), supportSession: !!req.user!.supportBy } })
}

const activeDeptSchema = z.object({ departmentId: z.string().min(1) })

/**
 * POST /api/auth/active-department — switch which department the user is currently
 * acting as. Mirrors the chosen membership's department/sub-department/role onto
 * the User row; since requireAuth reads role fresh from the DB each request, the
 * new role takes effect immediately with no token change.
 */
export async function setActiveDepartment(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = activeDeptSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const [membership, current] = await Promise.all([
    prisma.userDepartment.findUnique({
      where: { userId_departmentId: { userId: req.user!.id, departmentId: parsed.data.departmentId } },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { role: true } }),
  ])
  if (!membership) {
    res.status(400).json({ error: 'You are not a member of that department' })
    return
  }
  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      departmentId: membership.departmentId,
      subDepartmentId: membership.subDepartmentId,
      // A Super Admin keeps global access when switching context; everyone else
      // takes on that department's role.
      role: current.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : membership.role,
    },
  })
  res.json({ user: await publicUser(req.user!.id) })
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE, { path: '/' })
  res.status(204).end()
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email' })
    return
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })

  // Always respond 200 so we don't leak which emails exist. The email is sent without waiting, so the answer takes
  // the same time whether or not the address has an account. Outside production the link is also handed back, so the
  // flow can be tried with no mail key.
  const body: { ok: true; devResetToken?: string } = { ok: true }
  if (user && user.isActive) {
    const token = signResetToken(user.id, resetStamp(user.passwordHash))
    void sendPasswordResetEmail({ to: user.email, name: user.name.split(' ')[0], token })
    if (process.env.NODE_ENV !== 'production') body.devResetToken = token
  }
  res.json(body)
}

export async function updateProfile(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid name' })
    return
  }
  await prisma.user.update({ where: { id: req.user!.id }, data: { name: parsed.data.name } })
  res.json({ user: await publicUser(req.user!.id) })
}

export async function changePassword(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'New password must be at least 8 characters') }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
  if (!user.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    res.status(400).json({ error: 'Current password is incorrect' })
    return
  }
  // Member set their own secret — revoke any other outstanding sessions, then
  // re-issue this one so the user stays logged in.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), sessionsValidFrom: new Date() } })
  const token = signToken({ sub: user.id, role: user.role })
  setAuthCookie(res, token)
  res.json({ ok: true, ...(fromApp(req) ? { token } : {}) })
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  let userId: string
  try {
    const link = readResetToken(parsed.data.token)
    userId = link.userId
    // A link made by "Forgot password" works once: it carries the fingerprint of the password it was made for.
    if (link.stamp) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
      if (!u || resetStamp(u.passwordHash) !== link.stamp) throw new Error('used')
    }
  } catch {
    res.status(400).json({ error: 'This reset link is invalid or has expired' })
    return
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(parsed.data.password), sessionsValidFrom: new Date() },
  })
  res.json({ ok: true })
}

/** PUT /api/auth/me/theme { theme: id | null } — the colour theme this person picked (null: the company's). */
export async function saveTheme(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ theme: z.string().refine(isThemeId, 'Pick a theme from the list').nullable() }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  await prisma.user.update({ where: { id: req.user!.id }, data: { uiTheme: parsed.data.theme } })
  res.json({ uiTheme: parsed.data.theme })
}

/**
 * PUT /api/auth/me/nav { hidden: string[] } — "My menu": the sidebar items this person hid for themselves (a screen's
 * path, "g:<section>" or "s:<section> › <sub>"). An empty list shows everything again. Only the sidebar changes: the
 * screens stay reachable through search and links, and what the person may open is decided elsewhere, as before.
 */
export async function saveNav(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ hidden: z.array(z.string().trim().min(1).max(160)).max(400) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Send the list of menu items to hide.' })
    return
  }
  const navHidden = [...new Set(parsed.data.hidden)]
  await prisma.user.update({ where: { id: req.user!.id }, data: { navHidden } })
  res.json({ navHidden })
}

/** PUT /api/auth/me/language { language }: the language of the person's menus (en, ur or ar). */
export async function saveLanguage(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ language: z.enum(['en', 'ur', 'ar']) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Pick English, Urdu or Arabic.' }); return }
  await prisma.user.update({ where: { id: req.user!.id }, data: { language: parsed.data.language === 'en' ? null : parsed.data.language } })
  res.json({ language: parsed.data.language })
}

/** PUT /api/auth/me/whatsapp { number, on }: my WhatsApp number, and whether my notifications go there too. */
export async function saveWhatsapp(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = z.object({ number: z.string().trim().max(30), on: z.boolean() }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Send your number and whether it is on.' }); return }
  const number = parsed.data.number ? cleanNumber(parsed.data.number) : null
  if (parsed.data.number && !number) { res.status(400).json({ error: 'Write the number with its country code, like +92 300 1234567.' }); return }
  if (parsed.data.on && !number) { res.status(400).json({ error: 'Add your WhatsApp number first.' }); return }
  await prisma.user.update({ where: { id: req.user!.id }, data: { whatsappNumber: number, whatsappOn: parsed.data.on } })
  res.json({ whatsapp: { number: number ?? '', on: parsed.data.on, ready: whatsappReady() } })
}

/** PUT /api/auth/me/dashboard { order, hidden } | { reset: true } — how this person arranged their own dashboard. */
export async function saveDashboardPrefs(req: AuthedRequest, res: Response): Promise<void> {
  if (req.body?.reset === true) {
    await prisma.user.update({ where: { id: req.user!.id }, data: { dashboardPrefs: Prisma.DbNull } })
    res.json({ dashboardPrefs: null })
    return
  }
  const prefs = cleanPrefs(req.body)
  if (!prefs) { res.status(400).json({ error: 'Send the order of the cards and the ones hidden.' }); return }
  await prisma.user.update({ where: { id: req.user!.id }, data: { dashboardPrefs: prefs as unknown as Prisma.InputJsonValue } })
  res.json({ dashboardPrefs: prefs })
}
