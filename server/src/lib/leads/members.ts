import { prisma } from '../prisma'

/**
 * People in a CMR department belong to the CMR lead business by themselves: a Member as Rep, a
 * Team Lead as Manager (the head is set in Lead Settings and is not made a member). Runs inside
 * the company's walls, so it only sees that company. Removing someone stays a manual step.
 */
export async function syncCmrMembers(): Promise<number> {
  const bizs = await prisma.leadBusiness.findMany({ where: { kind: 'CMR', isActive: true }, select: { id: true, headId: true, members: { select: { userId: true } } } })
  if (!bizs.length) return 0
  const people = await prisma.user.findMany({ where: { isActive: true, department: { type: 'CMR' } }, select: { id: true, role: true } })
  if (!people.length) return 0
  let added = 0
  for (const b of bizs) {
    // The head decides from the queue and works no leads: a membership row (from before they were made head) goes.
    if (b.headId && b.members.some((m) => m.userId === b.headId)) await prisma.leadBusinessMember.deleteMany({ where: { businessId: b.id, userId: b.headId } })
    const have = new Set(b.members.map((m) => m.userId))
    for (const p of people) {
      if (have.has(p.id) || p.id === b.headId) continue
      await prisma.leadBusinessMember.create({ data: { businessId: b.id, userId: p.id, role: p.role === 'TEAM_LEAD' || p.role === 'SUB_DEPT_LEAD' ? 'MANAGER' : 'REP' } })
      added++
    }
  }
  return added
}
