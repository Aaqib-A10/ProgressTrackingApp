import type { Request, Response } from 'express'
import { z } from 'zod'
import { DepartmentType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  hashPassword,
  verifyPassword,
  signToken,
  signResetToken,
  verifyResetToken,
} from '../lib/auth'
import type { AuthedRequest } from '../middleware/auth'
import { getClientIp } from '../lib/ip'
import { parseUserAgent } from '../lib/userAgent'

/** Record a sign-in for the Activity Log. Best-effort — never blocks auth. */
async function logSignIn(req: Request, userId: string, kind: 'LOGIN' | 'SIGNUP'): Promise<void> {
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

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS,
    path: '/',
  })
}

/** Shape returned to the client — never includes passwordHash. */
async function publicUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      department: { select: { type: true, name: true } },
      subDepartment: { select: { slug: true, name: true } },
      memberships: {
        include: { department: { select: { type: true } }, subDepartment: { select: { slug: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role, // the ACTIVE membership's role (mirrored onto User)
    department: user.department?.type ?? null,
    subDepartment: user.subDepartment?.slug ?? null,
    activeDepartmentId: user.departmentId ?? null,
    memberships: user.memberships.map((m) => ({
      departmentId: m.departmentId,
      department: m.department.type,
      subDepartment: m.subDepartment?.slug ?? null,
      role: m.role,
    })),
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

const loginSchema = z.object({
  email: emailField(),
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

  const DEPARTMENTS: DepartmentType[] = ['ITAD', 'LEAD_GEN', 'MARKETING', 'CSR', 'TALKLOOP']
  if (!DEPARTMENTS.includes(department as DepartmentType)) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: department as DepartmentType } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }

  // Department Team Lead self-registration: activated immediately and signed in.
  // The active department is also recorded as their first membership.
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'TEAM_LEAD',
      status: 'ACTIVE',
      departmentId: dept.id,
      memberships: { create: { departmentId: dept.id, role: 'TEAM_LEAD' } },
    },
  })

  setAuthCookie(res, signToken({ sub: user.id, role: user.role }))
  await logSignIn(req, user.id, 'SIGNUP')
  res.status(201).json({ user: await publicUser(user.id) })
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' })
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

  setAuthCookie(res, signToken({ sub: user.id, role: user.role }))
  await logSignIn(req, user.id, 'LOGIN')
  res.json({ user: await publicUser(user.id) })
}

export async function me(req: AuthedRequest, res: Response): Promise<void> {
  res.json({ user: await publicUser(req.user!.id) })
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

  // Always respond 200 so we don't leak which emails exist.
  // Email delivery is Phase 4; in dev we return the token so the flow is testable.
  const body: { ok: true; devResetToken?: string } = { ok: true }
  if (user) {
    const token = signResetToken(user.id)
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
  // Member set their own secret — clear the TL-visible temp credential and revoke
  // any other outstanding sessions, then re-issue this one so the user stays logged in.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), tempPassword: null, sessionsValidFrom: new Date() } })
  setAuthCookie(res, signToken({ sub: user.id, role: user.role }))
  res.json({ ok: true })
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  let userId: string
  try {
    userId = verifyResetToken(parsed.data.token)
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
