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
    },
  })
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department?.type ?? null,
    subDepartment: user.subDepartment?.slug ?? null,
  }
}

// --- Schemas ---
// Self-registration is for Team Leads only. Members are invited by their Team Lead.
const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Enter a valid work email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  companyName: z.string().optional(),
  department: z.nativeEnum(DepartmentType),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const forgotSchema = z.object({ email: z.string().email() })
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

  const dept = await prisma.department.findUnique({ where: { type: department } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }

  // Team Lead self-registration: created PENDING and awaiting Super Admin approval.
  // No auth cookie is set — they cannot enter the app until approved.
  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'TEAM_LEAD',
      status: 'PENDING',
      departmentId: dept.id,
    },
  })

  res.status(201).json({
    pending: true,
    message: 'Your Team Lead account request has been sent to the admin for approval.',
  })
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
  res.json({ user: await publicUser(user.id) })
}

export async function me(req: AuthedRequest, res: Response): Promise<void> {
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
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword) } })
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
    data: { passwordHash: await hashPassword(parsed.data.password) },
  })
  res.json({ ok: true })
}
