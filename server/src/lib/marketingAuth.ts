import type { Response } from 'express'
import type { Department, SubDepartment, User } from '@prisma/client'
import { prisma } from './prisma'
import type { AuthedRequest } from '../middleware/auth'

export type MarketingActor = {
  me: User & { department: Department | null; subDepartment: SubDepartment | null }
  /** The MARKETING department id (resolved even for a Super Admin with no dept). */
  deptId: string | null
  /** The actor's sub-department slug (seo | social | content) or null. */
  subDeptSlug: string | null
  /** Team Lead or Super Admin — sees & writes everything in Marketing. */
  isLead: boolean
  canWriteSocial: boolean
  canWriteContent: boolean
  canWriteSeo: boolean
}

/**
 * Resolve the Marketing actor + their capabilities, or send a 403 and return null.
 * Leads/Admins see all; Sub-Dept Leads and Members are scoped to their sub-dept
 * (social writes need `social`; blog/plan writes need `content`).
 */
export async function resolveMarketingActor(req: AuthedRequest, res: Response): Promise<MarketingActor | null> {
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    include: { department: true, subDepartment: true },
  })
  const isAdmin = me.role === 'SUPER_ADMIN'
  const isMarketing = me.department?.type === 'MARKETING'
  if (!isMarketing && !isAdmin) {
    res.status(403).json({ error: 'Marketing access only' })
    return null
  }
  const marketingDept =
    me.department?.type === 'MARKETING' ? me.department : await prisma.department.findUnique({ where: { type: 'MARKETING' } })
  const isLead = isAdmin || me.role === 'TEAM_LEAD'
  const subDeptSlug = me.subDepartment?.slug ?? null
  return {
    me,
    deptId: marketingDept?.id ?? null,
    subDeptSlug,
    isLead,
    canWriteSocial: isLead || subDeptSlug === 'social',
    canWriteContent: isLead || subDeptSlug === 'content',
    canWriteSeo: isLead || subDeptSlug === 'seo',
  }
}
