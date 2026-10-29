import type { Response, NextFunction } from 'express'
import type { DepartmentType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from './auth'
import { personBlocks } from '../lib/personBlocks'
import { kindsOfBlocks } from '../lib/acting'
import { setActingKinds } from '../lib/tenancy'

const LABEL: Record<DepartmentType, string> = {
  ITAD: 'ITAD',
  LEAD_GEN: 'Lead Generation',
  MARKETING: 'Marketing',
  CSR: 'CSR',
  ECOMMERCE: 'Ecommerce',
  TALKLOOP: 'Talkloop',
  INVENTORY: 'Inventory',
  GENERAL: 'General',
}

/**
 * Department wall for a whole router: only people whose current department is one of
 * these (and the Super Admin) get through. The handlers still do their own finer checks
 * (team lead only, own rows only); this is the outer wall, so a handler that forgets its
 * check can never open one department's data to another. Use after requireAuth.
 */
export function requireDepartment(...types: DepartmentType[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (req.user.role === 'SUPER_ADMIN') return next()
    try {
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, companyId: true, department: { select: { type: true, layout: true } } } })
      const type = me?.department?.type
      if (!type || !types.includes(type)) {
        // Department Studio: the person's department menu has this kind's team screens.
        const blocks = me ? await personBlocks(me) : null
        const borrowed = blocks ? types.filter((t) => kindsOfBlocks(blocks).includes(t)) : []
        if (!borrowed.length) {
          res.status(403).json({ error: `This is only for the ${types.map((t) => LABEL[t]).join(' / ')} team` })
          return
        }
        setActingKinds(borrowed)
      }
      next()
    } catch (e) {
      next(e)
    }
  }
}
