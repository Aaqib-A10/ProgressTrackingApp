import type { DepartmentType, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { powersOf } from '../permissions'
import { companyAreasOff } from '../plans'
import { personBlocks } from '../personBlocks'
import { kindsOfBlocks } from '../acting'
import { menuOf } from '../blocks'
import { isOn } from '../flags'
import { SOURCES } from './sources'

/**
 * Who is asking, and what they may retrieve (docs/metra/DESIGN.md §1). Worked out LIVE from today's memberships
 * (kept 60 seconds), so a person taken out of a project, chat, department or business loses those chunks at once,
 * with nothing re-indexed. Each principal matches the label the sources put on records (lib/metra/sources.ts).
 */

export interface Asker {
  id: string
  name: string
  role: Role
  companyId: string
  departmentId: string | null
  departmentName: string | null
  /** The kinds of department screens this person works with: their own, and any borrowed into their menu. */
  kinds: DepartmentType[]
  principals: Set<string>
  /** Source types this person may retrieve (areas switched off for their plan or role are left out). */
  sources: Set<string>
}

const cache = new Map<string, { at: number; asker: Asker }>()
const TTL = 60_000
export function forgetAsker(userId?: string): void { if (userId) cache.delete(userId); else cache.clear() }

/** Area switches and feature switches that hide a whole source from a person. */
const FLAGGED: Record<string, string> = { LEAD: 'lead-management', LEAD_COMMENT: 'lead-management', LEAD_CALL: 'lead-management', LEAD_TASK: 'lead-management', REPORT_ENTRY: 'daily-report' }

export async function askerOf(userId: string): Promise<Asker> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL) return hit.asker
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, name: true, role: true, email: true, companyId: true, permissions: true, departmentId: true,
      department: { select: { id: true, name: true, type: true, layout: true } }, subDepartment: { select: { slug: true } },
      customRole: { select: { powers: true, areasOff: true } }, company: { select: { id: true, plan: true, modulesOff: true, modulesOn: true } },
    },
  })
  const p = new Set<string>(['all', `u:${u.id}`])
  const sa = u.role === 'SUPER_ADMIN'
  if (sa) p.add('sa')
  if (powersOf(u).includes('company.settings')) p.add('power:company.settings')
  if (u.role === 'QA' || u.role === 'QA_LEAD') p.add('qa')

  // Department kinds: their own, and kinds borrowed into their menu (Department Studio).
  const blocks = await personBlocks({ role: u.role, companyId: u.companyId, department: u.department ? { type: u.department.type, layout: u.department.layout } : null }).catch(() => null)
  const kinds = [...new Set([...(u.department ? [u.department.type] : []), ...(blocks ? kindsOfBlocks(blocks) : [])])] as DepartmentType[]
  for (const k of kinds) p.add(`dk:${k}`)
  if (u.departmentId) p.add(`dept:${u.departmentId}`)

  // A Team Lead reads their department's people (User.departmentId, as the app's team screens).
  if (u.role === 'TEAM_LEAD' && u.departmentId) {
    for (const m of await prisma.user.findMany({ where: { departmentId: u.departmentId }, select: { id: true } })) p.add(`t:${m.id}`)
  }
  // Daily Report managers: Team Lead of the form's department by department or by membership (as that module).
  const ledDepts = new Set<string>()
  if (u.role === 'TEAM_LEAD' && u.departmentId) ledDepts.add(u.departmentId)
  for (const m of await prisma.userDepartment.findMany({ where: { userId: u.id, role: 'TEAM_LEAD' }, select: { departmentId: true } })) ledDepts.add(m.departmentId)
  if (ledDepts.size) {
    const ids = [...ledDepts]
    const people = await prisma.user.findMany({ where: { OR: [{ departmentId: { in: ids } }, { memberships: { some: { departmentId: { in: ids } } } }] }, select: { id: true } })
    for (const m of people) p.add(`rt:${m.id}`)
  }

  // Chats and projects they are a member of.
  for (const m of await prisma.chatMember.findMany({ where: { userId: u.id }, select: { conversationId: true } })) p.add(`chat:${m.conversationId}`)
  for (const m of await prisma.pmProjectMember.findMany({ where: { userId: u.id }, select: { projectId: true } })) p.add(`proj:${m.projectId}`)

  // Lead Management: managers and the head of a business (active businesses), as leadScope.
  for (const m of await prisma.leadBusinessMember.findMany({ where: { userId: u.id, role: 'MANAGER', business: { isActive: true } }, select: { businessId: true } })) p.add(`lbm:${m.businessId}`)
  for (const b of await prisma.leadBusiness.findMany({ where: { headId: u.id, isActive: true }, select: { id: true } })) p.add(`lbm:${b.id}`)

  // Lead Dialer managers (Super Admin, or a Team Lead acting as ITAD) see the leads of the dialer's people, as itadUserIds.
  if (sa || (u.role === 'TEAM_LEAD' && kinds.includes('ITAD'))) {
    const borrowing = !sa && u.department && u.department.type !== 'ITAD' && u.departmentId
    const owners = await prisma.user.findMany({ where: borrowing ? { departmentId: u.departmentId! } : { department: { type: 'ITAD' } }, select: { id: true } })
    for (const o of owners) p.add(`dm:${o.id}`)
    p.add(`dm:${u.id}`)
  }

  // Marketing: leads see every task; a sub-department lead their discipline's.
  if (sa || kinds.includes('MARKETING')) {
    if (sa || u.role === 'TEAM_LEAD') p.add('mkt:lead')
    if (u.role === 'SUB_DEPT_LEAD' && u.subDepartment?.slug) p.add(`mkt:${u.subDepartment.slug.toLowerCase()}`)
  }

  // Custom blocks in their menu.
  if (blocks && u.departmentId) {
    const lead = menuOf(u.role) === 'lead'
    for (const k of blocks) if (k.startsWith('custom:')) {
      const id = k.slice(7)
      p.add(`cb:${id}:${u.departmentId}:all`)
      if (lead) p.add(`cb:${id}:${u.departmentId}:lead`)
    }
  }

  // Sources: areas off for the company's plan or the person's role, and feature switches.
  const off = new Set<string>([...companyAreasOff(u.company), ...(u.customRole?.areasOff ?? [])])
  const sources = new Set<string>()
  for (const s of SOURCES) {
    if (s.area && off.has(s.area)) continue
    const flag = FLAGGED[s.type]
    if (flag && !(await isOn(flag as never, u.companyId))) continue
    sources.add(s.type)
  }

  const asker: Asker = { id: u.id, name: u.name, role: u.role, companyId: u.companyId, departmentId: u.departmentId, departmentName: u.department?.name ?? null, kinds, principals: p, sources }
  cache.set(userId, { at: Date.now(), asker })
  return asker
}

/** Can a person with these principals read a chunk with these labels? */
export const canRead = (labels: readonly string[], principals: Set<string>): boolean => labels.some((l) => principals.has(l))
