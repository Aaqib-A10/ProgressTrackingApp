import type { Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { createApp } from '../app'
import { signToken, hashPassword } from '../lib/auth'

export { prisma }
export const app = createApp()

/** Bearer header for a seeded user (requireAuth accepts cookie OR Authorization). */
export function auth(user: { id: string; role: Role }): [string, string] {
  return ['Authorization', `Bearer ${signToken({ sub: user.id, role: user.role })}`]
}

export interface SeededWorld {
  superAdmin: { id: string; role: Role }
  itadLead: { id: string; role: Role }
  itadMember: { id: string; role: Role }
  leadgenLead: { id: string; role: Role }
  leadgenMember: { id: string; role: Role }
}

/**
 * Wipes the (isolated) test DB and seeds a two-department role matrix.
 * TRUNCATE ... CASCADE clears all dependent rows so each run starts clean.
 */
export async function seedWorld(): Promise<SeededWorld> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Department" RESTART IDENTITY CASCADE')

  const [itad, leadgen] = await Promise.all([
    prisma.department.create({ data: { type: 'ITAD', name: 'ITAD' } }),
    prisma.department.create({ data: { type: 'LEAD_GEN', name: 'Lead Generation' } }),
  ])
  const passwordHash = await hashPassword('Password123!')
  const mk = (name: string, role: Role, departmentId?: string) =>
    prisma.user.create({
      data: { name, email: `${name.replace(/\s+/g, '.').toLowerCase()}@test.local`, role, status: 'ACTIVE', isActive: true, passwordHash, departmentId },
    })

  const [superAdmin, itadLead, itadMember, leadgenLead, leadgenMember] = await Promise.all([
    mk('super admin', 'SUPER_ADMIN'),
    mk('itad lead', 'TEAM_LEAD', itad.id),
    mk('itad member', 'MEMBER', itad.id),
    mk('leadgen lead', 'TEAM_LEAD', leadgen.id),
    mk('leadgen member', 'MEMBER', leadgen.id),
  ])

  const pick = (u: { id: string; role: Role }) => ({ id: u.id, role: u.role })
  return {
    superAdmin: pick(superAdmin),
    itadLead: pick(itadLead),
    itadMember: pick(itadMember),
    leadgenLead: pick(leadgenLead),
    leadgenMember: pick(leadgenMember),
  }
}
