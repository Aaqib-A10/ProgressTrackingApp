import type { PmColumnCategory, PmProject, PmProjectRole, Role } from '@prisma/client'
import { prisma } from '../prisma'

/**
 * Access rules for the Projects module.
 *
 * Visibility is membership based: a user sees a project only if they are in
 * PmProjectMember for it, or they are a Super Admin. Anything else is answered
 * with 404 (not 403) so a non member can't even learn that a project exists.
 */

/** Global roles allowed to create projects. */
export const PROJECT_CREATOR_ROLES: Role[] = ['SUPER_ADMIN', 'TEAM_LEAD']

export interface PmViewer {
  id: string
  role: Role
}

export interface ProjectCtx {
  project: PmProject
  me: PmViewer
  /** Role inside this project, null when the viewer is a Super Admin with no membership row. */
  pmRole: PmProjectRole | null
  isSuperAdmin: boolean
  canView: boolean
  /** Manage members, columns, labels, settings; edit or delete any task. */
  canManage: boolean
  /** Create tasks, move tasks, assign within the project. */
  canContribute: boolean
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function buildCtx(project: PmProject, me: PmViewer, pmRole: PmProjectRole | null): ProjectCtx {
  const isSuperAdmin = me.role === 'SUPER_ADMIN'
  const canView = isSuperAdmin || pmRole != null
  const canManage = isSuperAdmin || pmRole === 'ADMIN'
  const canContribute = canManage || pmRole === 'MEMBER'
  return { project, me, pmRole, isSuperAdmin, canView, canManage, canContribute }
}

/** Load a project by key (case insensitive) or id, enforcing visibility. Throws 404 when hidden. */
export async function loadProjectCtx(keyOrId: string, me: PmViewer): Promise<ProjectCtx> {
  const key = String(keyOrId || '').trim()
  const project = await prisma.pmProject.findFirst({
    where: { OR: [{ key: key.toUpperCase() }, { id: key }] },
  })
  if (!project) throw new HttpError(404, 'Project not found')
  const membership = await prisma.pmProjectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: me.id } },
    select: { role: true },
  })
  const ctx = buildCtx(project, me, membership?.role ?? null)
  if (!ctx.canView) throw new HttpError(404, 'Project not found')
  return ctx
}

/** Ids of every project the viewer may see (all of them for a Super Admin). */
export async function visibleProjectIds(me: PmViewer, includeArchived = false): Promise<string[]> {
  if (me.role === 'SUPER_ADMIN') {
    const rows = await prisma.pmProject.findMany({ where: includeArchived ? {} : { status: 'ACTIVE' }, select: { id: true } })
    return rows.map((r) => r.id)
  }
  const rows = await prisma.pmProjectMember.findMany({
    where: { userId: me.id, ...(includeArchived ? {} : { project: { status: 'ACTIVE' } }) },
    select: { projectId: true },
  })
  return rows.map((r) => r.projectId)
}

export interface TaskForPerm {
  createdById: string
  assignees: { userId: string }[]
  column?: { category: PmColumnCategory } | null
}

/** Edit title, description, priority, labels, checklist, assignees. */
export function canEditTask(ctx: ProjectCtx, task: TaskForPerm): boolean {
  if (ctx.canManage) return true
  if (ctx.pmRole !== 'MEMBER') return false
  return task.createdById === ctx.me.id || task.assignees.some((a) => a.userId === ctx.me.id)
}

/** Only the creator (the assigner) or a project admin may move the deadline. */
export function canChangeDue(ctx: ProjectCtx, task: TaskForPerm): boolean {
  if (ctx.canManage) return true
  return ctx.pmRole === 'MEMBER' && task.createdById === ctx.me.id
}

/** Only the person who created a task can delete it (in any project, at any stage). */
export function canDeleteTask(ctx: ProjectCtx, task: TaskForPerm): boolean {
  return task.createdById === ctx.me.id
}

/** Approve/reject a due date extension: creator or project admin. */
export function canDecideExtension(ctx: ProjectCtx, task: TaskForPerm): boolean {
  return ctx.canManage || task.createdById === ctx.me.id
}

/** All user ids that are members of the project (used to validate assignees + mentions). */
export async function projectMemberIds(projectId: string): Promise<Set<string>> {
  const rows = await prisma.pmProjectMember.findMany({ where: { projectId }, select: { userId: true } })
  return new Set(rows.map((r) => r.userId))
}

/** Project admins (role ADMIN) for overdue + completion alerts. */
export async function projectAdminIds(projectId: string): Promise<string[]> {
  const rows = await prisma.pmProjectMember.findMany({ where: { projectId, role: 'ADMIN', user: { isActive: true } }, select: { userId: true } })
  return rows.map((r) => r.userId)
}

export async function superAdminIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' }, select: { id: true } })
  return rows.map((r) => r.id)
}

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/
export const TASK_CODE_RE = /\b([A-Z][A-Z0-9]{1,5})-(\d{1,7})\b/
