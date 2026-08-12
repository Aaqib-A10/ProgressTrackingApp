import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { resolveMarketingActor } from '../lib/marketingAuth'

/**
 * GET /api/marketing/email — placeholder overview for the Email Marketing
 * sub-department. No data model yet; returns the brand list + empty shape so the
 * page has something to render until real requirements land.
 */
export async function emailOverview(req: AuthedRequest, res: Response): Promise<void> {
  const actor = await resolveMarketingActor(req, res)
  if (!actor) return
  const brands = actor.deptId
    ? await prisma.brand.findMany({
        where: { departmentId: actor.deptId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    : []
  res.json({ brands, campaigns: [], stats: null, canWrite: actor.canWriteEmail })
}
