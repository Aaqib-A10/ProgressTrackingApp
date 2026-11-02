import type { Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { HttpError } from '../pm/access'

/**
 * Lead Management: who sees and does what.
 *  - Super Admin: every business and every lead; sets up businesses, their people, forms and inboxes.
 *  - MANAGER of a business: every lead of that business; assigns them; imports and adds leads.
 *  - REP of a business: the leads given to them; adds leads they took on the phone.
 */

export type LeadRole = 'MANAGER' | 'REP'
export interface LeadViewer { id: string; role: Role; companyId: string }

export interface LeadScope {
  admin: boolean
  /** businessId → this person's role there. */
  roles: Map<string, LeadRole>
  managerOf: string[]
  repOf: string[]
}

export async function leadScope(me: LeadViewer): Promise<LeadScope> {
  const rows = await prisma.leadBusinessMember.findMany({ where: { userId: me.id, business: { isActive: true } }, select: { businessId: true, role: true } })
  const roles = new Map<string, LeadRole>(rows.map((r) => [r.businessId, r.role === 'MANAGER' ? 'MANAGER' : 'REP']))
  return {
    admin: me.role === 'SUPER_ADMIN',
    roles,
    managerOf: rows.filter((r) => r.role === 'MANAGER').map((r) => r.businessId),
    repOf: rows.filter((r) => r.role !== 'MANAGER').map((r) => r.businessId),
  }
}

/** MANAGER, REP or null: shown in /auth/me so the menu shows Leads only to people who work leads. */
export async function leadsRoleOf(userId: string): Promise<LeadRole | null> {
  const rows = await prisma.leadBusinessMember.findMany({ where: { userId, business: { isActive: true } }, select: { role: true } })
  if (!rows.length) return null
  return rows.some((r) => r.role === 'MANAGER') ? 'MANAGER' : 'REP'
}

/** The leads this person may see. */
export function leadWhere(me: LeadViewer, s: LeadScope): Prisma.LeadWhereInput {
  if (s.admin) return {}
  const or: Prisma.LeadWhereInput[] = [{ assigneeId: me.id }]
  if (s.managerOf.length) or.push({ businessId: { in: s.managerOf } })
  return { OR: or }
}

export const canManage = (s: LeadScope, businessId: string) => s.admin || s.roles.get(businessId) === 'MANAGER'
export const isMemberOf = (s: LeadScope, businessId: string) => s.admin || s.roles.has(businessId)

/** A lead this person may open (404 otherwise, so leads of other businesses stay invisible). */
export async function leadFor(me: LeadViewer, s: LeadScope, id: string) {
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id }, leadWhere(me, s)] } })
  if (!lead) throw new HttpError(404, 'Lead not found')
  return lead
}

/** Company settings for leads: Super Admin only. */
export function requireLeadAdmin(s: LeadScope): void {
  if (!s.admin) throw new HttpError(403, 'Only the Super Admin can set up businesses for leads.')
}
