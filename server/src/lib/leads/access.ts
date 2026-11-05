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
  /** businessId → this person's role there (the head of a business counts as its MANAGER). */
  roles: Map<string, LeadRole>
  managerOf: string[]
  repOf: string[]
  /** Businesses this person heads (CMR: Jesse): decides on flagged leads, hears every call. */
  headOf: string[]
}

export async function leadScope(me: LeadViewer): Promise<LeadScope> {
  const [rows, headed] = await Promise.all([
    prisma.leadBusinessMember.findMany({ where: { userId: me.id, business: { isActive: true } }, select: { businessId: true, role: true } }),
    prisma.leadBusiness.findMany({ where: { headId: me.id, isActive: true }, select: { id: true } }),
  ])
  const roles = new Map<string, LeadRole>(rows.map((r) => [r.businessId, r.role === 'MANAGER' ? 'MANAGER' : 'REP']))
  for (const b of headed) roles.set(b.id, 'MANAGER')
  return {
    admin: me.role === 'SUPER_ADMIN',
    roles,
    managerOf: [...roles.entries()].filter(([, r]) => r === 'MANAGER').map(([id]) => id),
    repOf: [...roles.entries()].filter(([, r]) => r === 'REP').map(([id]) => id),
    headOf: headed.map((b) => b.id),
  }
}

/** MANAGER, REP or null: shown in /auth/me so the menu shows Leads only to people who work leads. */
export async function leadsRoleOf(userId: string): Promise<LeadRole | null> {
  const [rows, headed] = await Promise.all([
    prisma.leadBusinessMember.findMany({ where: { userId, business: { isActive: true } }, select: { role: true } }),
    prisma.leadBusiness.count({ where: { headId: userId, isActive: true } }),
  ])
  if (!rows.length && !headed) return null
  return headed || rows.some((r) => r.role === 'MANAGER') ? 'MANAGER' : 'REP'
}

/** Head only: this person heads a business (Jesse) and works no leads themselves. Their Metriq is the queue and the summary. */
export async function leadsHeadOnlyOf(userId: string): Promise<boolean> {
  const [headed, rows] = await Promise.all([
    prisma.leadBusiness.count({ where: { headId: userId, isActive: true } }),
    prisma.leadBusinessMember.count({ where: { userId, business: { isActive: true } } }),
  ])
  return headed > 0 && rows === 0
}

/** Does this person work (or head, or administer) a CMR-kind business? Shows the CMR menu items. */
export async function leadsCmrOf(userId: string, admin: boolean): Promise<boolean> {
  if (admin) return (await prisma.leadBusiness.count({ where: { kind: 'CMR', isActive: true } })) > 0
  const n = await prisma.leadBusiness.count({ where: { kind: 'CMR', isActive: true, OR: [{ headId: userId }, { members: { some: { userId } } }] } })
  return n > 0
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
/** The head decides (CMR: Jesse); the Super Admin can stand in. */
export const canDecide = (s: LeadScope, businessId: string) => s.admin || s.headOf.includes(businessId)
export function requireManager(s: LeadScope, businessId: string, what = 'do this'): void {
  if (!canManage(s, businessId)) throw new HttpError(403, `Only a manager of this business can ${what}.`)
}

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
