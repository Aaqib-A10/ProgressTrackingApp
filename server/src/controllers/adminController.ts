import type { Response } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { DepartmentType, TagType, Role, LeaveType, UserStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { hashPassword, signInviteToken } from '../lib/auth'
import { sendInviteEmail } from '../lib/mail'
import { dbDateFromString, dateStringFromDb } from '../lib/time'
import { isValidCidr } from '../lib/ip'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

// =================== Users (Super Admin) ===================

export async function listUsers(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const users = await prisma.user.findMany({
    include: { department: { select: { type: true } }, subDepartment: { select: { slug: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department?.type ?? null,
      subDepartment: u.subDepartment?.slug ?? null,
      status: u.status,
      isActive: u.isActive,
      tempPassword: u.tempPassword ?? null,
    })),
  })
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(Role),
  department: z.nativeEnum(DepartmentType).nullable().optional(),
  subDepartmentSlug: z.string().nullable().optional(),
  password: z.string().min(8).optional(),
})

export async function createUser(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  if (await prisma.user.findUnique({ where: { email: v.email } })) {
    res.status(409).json({ error: 'Email already in use' })
    return
  }
  const dept = v.department ? await prisma.department.findUnique({ where: { type: v.department } }) : null
  let subDepartmentId: string | undefined
  if (dept && v.department === 'MARKETING' && v.subDepartmentSlug) {
    const sub = await prisma.subDepartment.findUnique({ where: { departmentId_slug: { departmentId: dept.id, slug: v.subDepartmentSlug } } })
    subDepartmentId = sub?.id
  }
  const tempPassword = v.password ?? randomBytes(6).toString('base64url')
  const user = await prisma.user.create({
    data: { name: v.name, email: v.email, role: v.role, passwordHash: await hashPassword(tempPassword), departmentId: dept?.id ?? null, subDepartmentId },
  })
  // Email the invitee a "set password & join" link (best-effort).
  await sendInviteEmail({ to: user.email, name: user.name, token: signInviteToken(user.id), inviterName: me.name, tempPassword: v.password ? undefined : tempPassword })
  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: v.department ?? null, subDepartment: v.subDepartmentSlug ?? null, status: user.status, isActive: user.isActive },
    tempPassword: v.password ? undefined : tempPassword,
  })
}

const updateUserSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  department: z.nativeEnum(DepartmentType).nullable().optional(),
  subDepartmentSlug: z.string().nullable().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  isActive: z.boolean().optional(),
})

export async function updateUser(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const v = parsed.data
  const data: Record<string, unknown> = {}
  if (v.role !== undefined) data.role = v.role
  if (v.isActive !== undefined) data.isActive = v.isActive
  if (v.status !== undefined) data.status = v.status
  if (v.department !== undefined) {
    const dept = v.department ? await prisma.department.findUnique({ where: { type: v.department } }) : null
    data.departmentId = dept?.id ?? null
    data.subDepartmentId = null
    if (dept && v.department === 'MARKETING' && v.subDepartmentSlug) {
      const sub = await prisma.subDepartment.findUnique({ where: { departmentId_slug: { departmentId: dept.id, slug: v.subDepartmentSlug } } })
      data.subDepartmentId = sub?.id ?? null
    }
  }
  const u = await prisma.user.update({
    where: { id: req.params.id },
    data,
    include: { department: { select: { type: true } }, subDepartment: { select: { slug: true } } },
  })
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department?.type ?? null, subDepartment: u.subDepartment?.slug ?? null, status: u.status, isActive: u.isActive } })
}

/** DELETE /api/admin/users/:id — Super Admin permanently deletes a user.
 *  Their daily entries/leave/attachments/task-comments cascade away; if the user
 *  authored records that block deletion (feedback / QA evaluations), we tell the
 *  admin to disable them instead. */
export async function deleteUser(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const id = req.params.id
  if (id === me.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (target.role === 'SUPER_ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })
    if (admins <= 1) {
      res.status(400).json({ error: 'Cannot delete the last Super Admin.' })
      return
    }
  }
  try {
    await prisma.user.delete({ where: { id } })
    res.status(204).end()
  } catch (e) {
    // Prisma P2003 = FK constraint (user is referenced by feedback / QA / comments).
    if ((e as { code?: string }).code === 'P2003') {
      res.status(409).json({ error: 'This user has linked records (feedback or QA evaluations) and can’t be deleted. Disable them instead.' })
      return
    }
    throw e
  }
}

const adminResetPwSchema = z.object({ password: z.string().min(8).max(72).optional() })

/** POST /api/admin/users/:id/reset-password — Super Admin resets a user's password.
 *  Sets a new temporary password (random, or a supplied one) and returns it to relay. */
export async function resetUserPassword(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (req.params.id === me.id) {
    res.status(400).json({ error: 'Change your own password from Settings to avoid locking yourself out.' })
    return
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  const parsed = adminResetPwSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const tempPassword = parsed.data.password ?? randomBytes(6).toString('base64url')
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(tempPassword), tempPassword } })
  res.json({ tempPassword })
}

// =================== Team Members (Team Lead) ===================

/** GET /api/admin/team-members — roster of the Team Lead's own department. */
export async function listTeamMembers(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.departmentId) {
    res.status(400).json({ error: 'You are not assigned to a department' })
    return
  }
  const members = await prisma.user.findMany({
    where: { departmentId: me.departmentId, role: { in: ['MEMBER', 'SUB_DEPT_LEAD'] }, isActive: true },
    include: { subDepartment: { select: { slug: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({
    members: members.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      subDepartment: u.subDepartment?.slug ?? null,
      status: u.status,
      isActive: u.isActive,
      tempPassword: u.tempPassword,
    })),
  })
}

const inviteMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  subDepartmentSlug: z.string().nullable().optional(),
})

/** POST /api/admin/team-members — Team Lead invites an employee into their own department. */
export async function inviteTeamMember(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.departmentId || !me.department) {
    res.status(400).json({ error: 'You are not assigned to a department' })
    return
  }
  const parsed = inviteMemberSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const existing = await prisma.user.findUnique({ where: { email: v.email } })
  // Only a genuinely active account blocks re-use; a previously removed
  // (soft-deleted) account is reactivated below so the TL can re-add them.
  if (existing && existing.isActive) {
    res.status(409).json({ error: 'Email already in use' })
    return
  }

  // Marketing members can belong to a sub-department (SEO / Social / Content).
  let subDepartmentId: string | null = null
  if (me.department.type === 'MARKETING' && v.subDepartmentSlug) {
    const sub = await prisma.subDepartment.findUnique({
      where: { departmentId_slug: { departmentId: me.departmentId, slug: v.subDepartmentSlug } },
    })
    subDepartmentId = sub?.id ?? null
  }

  const tempPassword = randomBytes(6).toString('base64url')
  const passwordHash = await hashPassword(tempPassword)
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { name: v.name, role: 'MEMBER', status: 'ACTIVE', isActive: true, passwordHash, tempPassword, departmentId: me.departmentId, subDepartmentId },
        include: { subDepartment: { select: { slug: true } } },
      })
    : await prisma.user.create({
        data: { name: v.name, email: v.email, role: 'MEMBER', status: 'ACTIVE', passwordHash, tempPassword, departmentId: me.departmentId, subDepartmentId },
        include: { subDepartment: { select: { slug: true } } },
      })
  await prisma.teamMemberEvent.create({
    data: {
      departmentId: me.departmentId,
      actorId: me.id,
      actorName: me.name,
      memberId: user.id,
      memberName: user.name,
      memberEmail: user.email,
      type: existing ? 'REACTIVATED' : 'INVITED',
    },
  })
  // Email the member a "set password & join" link (best-effort).
  await sendInviteEmail({ to: user.email, name: user.name, token: signInviteToken(user.id), inviterName: me.name, tempPassword })
  res.status(201).json({
    member: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      subDepartment: user.subDepartment?.slug ?? null,
      status: user.status,
      isActive: user.isActive,
      tempPassword: user.tempPassword,
    },
    tempPassword,
  })
}

const resetPwSchema = z.object({ password: z.string().min(8, 'Password must be at least 8 characters').optional() })

/** POST /api/admin/team-members/:id/reset-password — TL sets/regenerates a member's password. */
export async function resetTeamMemberPassword(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.departmentId) {
    res.status(400).json({ error: 'You are not assigned to a department' })
    return
  }
  const parsed = resetPwSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  // A Team Lead may only reset members of their own department (not leads/self).
  if (target.departmentId !== me.departmentId || target.id === me.id || (target.role !== 'MEMBER' && target.role !== 'SUB_DEPT_LEAD')) {
    res.status(403).json({ error: 'You can only manage members of your own team' })
    return
  }

  const tempPassword = parsed.data.password ?? randomBytes(6).toString('base64url')
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(tempPassword), tempPassword },
  })
  res.json({ tempPassword })
}

/**
 * DELETE /api/admin/team-members/:id — Team Lead removes a member.
 * Soft-delete: the account is disabled (login blocked), not destroyed, and the
 * removal is recorded in Team History.
 */
export async function removeTeamMember(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.departmentId) {
    res.status(400).json({ error: 'You are not assigned to a department' })
    return
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  // A Team Lead may only remove members of their own department, and never
  // another lead or themselves.
  if (target.departmentId !== me.departmentId || target.id === me.id || (target.role !== 'MEMBER' && target.role !== 'SUB_DEPT_LEAD')) {
    res.status(403).json({ error: 'You can only remove members of your own team' })
    return
  }

  await prisma.user.update({ where: { id: target.id }, data: { isActive: false } })
  await prisma.teamMemberEvent.create({
    data: {
      departmentId: me.departmentId,
      actorId: me.id,
      actorName: me.name,
      memberId: target.id,
      memberName: target.name,
      memberEmail: target.email,
      type: 'REMOVED',
    },
  })
  res.status(204).end()
}

/** GET /api/admin/team-history — full roster-change log for the lead's department. */
export async function listTeamHistory(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'TEAM_LEAD' && me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!me.departmentId) {
    res.status(400).json({ error: 'You are not assigned to a department' })
    return
  }
  const events = await prisma.teamMemberEvent.findMany({
    where: { departmentId: me.departmentId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({
    events: events.map((e) => ({
      id: e.id,
      memberName: e.memberName,
      memberEmail: e.memberEmail,
      actorName: e.actorName,
      type: e.type,
      createdAt: e.createdAt.toISOString(),
    })),
  })
}

// =================== Targets (TL / Admin) ===================

async function scopedDepartmentId(me: Awaited<ReturnType<typeof loadUser>>, requested?: DepartmentType | null): Promise<string | null | undefined> {
  if (me.role === 'SUPER_ADMIN') {
    if (!requested) return undefined // all
    const d = await prisma.department.findUnique({ where: { type: requested } })
    return d?.id ?? null
  }
  return me.departmentId // TL scoped to own department
}

export async function listTargets(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const deptId = await scopedDepartmentId(me, req.query.department as DepartmentType)
  const targets = await prisma.target.findMany({
    where: { scope: { in: ['DEPARTMENT', 'BRAND'] }, ...(deptId === undefined ? {} : { departmentId: deptId }) },
    include: { department: { select: { type: true } }, brand: { select: { id: true, name: true } } },
    orderBy: [{ departmentId: 'asc' }, { metricKey: 'asc' }],
  })
  res.json({
    targets: targets.map((t) => ({
      id: t.id,
      department: t.department?.type ?? null,
      brand: t.brand ? { id: t.brand.id, name: t.brand.name } : null,
      metricKey: t.metricKey,
      period: t.period,
      value: t.value,
      minValue: t.minValue,
      maxValue: t.maxValue,
    })),
  })
}

const targetSchema = z
  .object({
    department: z.nativeEnum(DepartmentType),
    metricKey: z.string().min(1),
    period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    minValue: z.number().min(0),
    maxValue: z.number().min(0),
    brandId: z.string().optional(),
  })
  .refine((d) => d.maxValue >= d.minValue, { message: 'Max value must be greater than or equal to min value' })

export async function upsertTarget(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = targetSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: parsed.data.department } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Can only set targets for your department' })
    return
  }
  // Brand-scoped target (Marketing): validate the brand belongs to this department.
  let brandId: string | null = null
  if (parsed.data.brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: parsed.data.brandId } })
    if (!brand || brand.departmentId !== dept.id) {
      res.status(400).json({ error: 'Unknown brand for this department' })
      return
    }
    brandId = brand.id
  }
  const scope = brandId ? 'BRAND' : 'DEPARTMENT'
  const { minValue, maxValue } = parsed.data
  const fields = { minValue, maxValue, value: maxValue, setById: me.id } // value mirrors the goal (max) for existing references
  const existing = await prisma.target.findFirst({
    where: { scope, departmentId: dept.id, brandId, metricKey: parsed.data.metricKey, period: parsed.data.period },
  })
  const target = existing
    ? await prisma.target.update({ where: { id: existing.id }, data: fields })
    : await prisma.target.create({ data: { scope, departmentId: dept.id, brandId, metricKey: parsed.data.metricKey, period: parsed.data.period, ...fields } })
  res.json({
    target: { id: target.id, department: parsed.data.department, brandId, metricKey: target.metricKey, period: target.period, value: target.value, minValue: target.minValue, maxValue: target.maxValue },
  })
}

/** DELETE /api/admin/targets/:id — remove a target (TL: own department only). */
export async function deleteTarget(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const target = await prisma.target.findUnique({ where: { id: req.params.id } })
  if (!target) {
    res.status(404).json({ error: 'Target not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Can only delete targets for your department' })
    return
  }
  await prisma.target.delete({ where: { id: target.id } })
  res.status(204).end()
}

// =================== Tags (TL / Admin) ===================

export async function listTags(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const deptId = await scopedDepartmentId(me, req.query.department as DepartmentType)
  const tags = await prisma.tag.findMany({
    where: deptId === undefined ? {} : { departmentId: deptId },
    include: { department: { select: { type: true } } },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  res.json({ tags: tags.map((t) => ({ id: t.id, name: t.name, type: t.type, department: t.department?.type ?? null, isActive: t.isActive })) })
}

const tagSchema = z.object({ name: z.string().min(1), type: z.nativeEnum(TagType), department: z.nativeEnum(DepartmentType) })

export async function createTag(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = tagSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: parsed.data.department } })
  if (!dept) {
    res.status(400).json({ error: 'Unknown department' })
    return
  }
  if (me.role === 'TEAM_LEAD' && me.departmentId !== dept.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const tag = await prisma.tag.upsert({
    where: { departmentId_type_name: { departmentId: dept.id, type: parsed.data.type, name: parsed.data.name } },
    update: { isActive: true },
    create: { departmentId: dept.id, type: parsed.data.type, name: parsed.data.name },
  })
  res.status(201).json({ tag: { id: tag.id, name: tag.name, type: tag.type, department: parsed.data.department, isActive: tag.isActive } })
}

export async function updateTag(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const schema = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const tag = await prisma.tag.update({ where: { id: req.params.id }, data: parsed.data, include: { department: { select: { type: true } } } })
  res.json({ tag: { id: tag.id, name: tag.name, type: tag.type, department: tag.department?.type ?? null, isActive: tag.isActive } })
}

// =================== Holidays & Leave (TL / Admin) ===================

export async function listHolidays(_req: AuthedRequest, res: Response): Promise<void> {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: 'asc' } })
  res.json({ holidays: holidays.map((h) => ({ id: h.id, date: dateStringFromDb(h.date), name: h.name })) })
}

export async function createHoliday(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = z.object({ date: z.string(), name: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const holiday = await prisma.holiday.upsert({
    where: { date: dbDateFromString(parsed.data.date) },
    update: { name: parsed.data.name },
    create: { date: dbDateFromString(parsed.data.date), name: parsed.data.name },
  })
  res.status(201).json({ holiday: { id: holiday.id, date: dateStringFromDb(holiday.date), name: holiday.name } })
}

export async function deleteHoliday(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.holiday.delete({ where: { id: req.params.id } }).catch(() => undefined)
  res.status(204).end()
}

export async function listLeave(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const where = me.role === 'TEAM_LEAD' && me.departmentId ? { user: { departmentId: me.departmentId } } : {}
  const leave = await prisma.leaveDay.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 200 })
  res.json({ leave: leave.map((l) => ({ id: l.id, userId: l.userId, userName: l.user.name, date: dateStringFromDb(l.date), type: l.type, note: l.note ?? '' })) })
}

export async function listLeaveMembers(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const where = me.role === 'TEAM_LEAD' && me.departmentId ? { departmentId: me.departmentId } : {}
  const members = await prisma.user.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  res.json({ members })
}

export async function createLeave(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = z.object({ userId: z.string(), date: z.string(), type: z.nativeEnum(LeaveType).default('ON_LEAVE'), note: z.string().optional() }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } })
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (me.role === 'TEAM_LEAD' && target.departmentId !== me.departmentId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const leave = await prisma.leaveDay.upsert({
    where: { userId_date: { userId: parsed.data.userId, date: dbDateFromString(parsed.data.date) } },
    update: { type: parsed.data.type, note: parsed.data.note ?? null },
    create: { userId: parsed.data.userId, date: dbDateFromString(parsed.data.date), type: parsed.data.type, note: parsed.data.note ?? null },
    include: { user: { select: { name: true } } },
  })
  res.status(201).json({ leave: { id: leave.id, userId: leave.userId, userName: leave.user.name, date: dateStringFromDb(leave.date), type: leave.type, note: leave.note ?? '' } })
}

export async function deleteLeave(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN' && me.role !== 'TEAM_LEAD') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.leaveDay.delete({ where: { id: req.params.id } }).catch(() => undefined)
  res.status(204).end()
}

// ---- Office networks (IP allowlist for attendance) — Super Admin ----

async function requireSuperAdmin(req: AuthedRequest, res: Response): Promise<boolean> {
  const me = await loadUser(req.user!.id)
  if (me.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden' })
    return false
  }
  return true
}

export async function listOfficeNetworks(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await requireSuperAdmin(req, res))) return
  const networks = await prisma.officeNetwork.findMany({ orderBy: { createdAt: 'asc' } })
  res.json({
    networks: networks.map((n) => ({ id: n.id, label: n.label, cidr: n.cidr, isActive: n.isActive })),
    // When empty, enforcement is off (everyone can check in) — surfaced in the UI.
    enforced: networks.some((n) => n.isActive),
  })
}

const officeNetworkSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(100),
  cidr: z.string().trim().min(1, 'IP or CIDR is required').max(64),
})

export async function createOfficeNetwork(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await requireSuperAdmin(req, res))) return
  const parsed = officeNetworkSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  if (!isValidCidr(parsed.data.cidr)) {
    res.status(400).json({ error: 'Enter a valid IPv4 address or CIDR (e.g. 203.0.113.7 or 203.0.113.0/24)' })
    return
  }
  const n = await prisma.officeNetwork.create({ data: { label: parsed.data.label, cidr: parsed.data.cidr } })
  res.status(201).json({ network: { id: n.id, label: n.label, cidr: n.cidr, isActive: n.isActive } })
}

export async function updateOfficeNetwork(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await requireSuperAdmin(req, res))) return
  const isActive = req.body?.isActive
  if (typeof isActive !== 'boolean') {
    res.status(400).json({ error: 'isActive (boolean) required' })
    return
  }
  const existing = await prisma.officeNetwork.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Network not found' })
    return
  }
  const n = await prisma.officeNetwork.update({ where: { id: existing.id }, data: { isActive } })
  res.json({ network: { id: n.id, label: n.label, cidr: n.cidr, isActive: n.isActive } })
}

export async function deleteOfficeNetwork(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await requireSuperAdmin(req, res))) return
  await prisma.officeNetwork.deleteMany({ where: { id: req.params.id } })
  res.status(204).end()
}
