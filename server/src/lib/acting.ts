import type { DepartmentType } from '@prisma/client'
import { prisma } from './prisma'
import { actingKinds, maybeCompanyId } from './tenancy'
import { isOn } from './flags'
import { BLOCKS, readLayout } from './blocks'

/**
 * Department Studio: a department can have team screens of another kind in its menu (a General
 * "Sales 2" with the Lead Dialer). For the request, such a person acts as that kind on those
 * screens: their entries are kept with their own department, and their team lead's team views
 * show their own department. 99 Technologies (Studio off) never borrows, so nothing changes there.
 */

/** Does this person work as this kind of department here (their own kind, or blocks borrowed into their menu)? */
export function actsAs(me: { department?: { type: string } | null } | null | undefined, kind: DepartmentType): boolean {
  return me?.department?.type === kind || actingKinds().includes(kind)
}

/** The department a kind's team screen is about for this person: their own when they act as the kind, else the company's department of that kind. */
export async function kindDept<D extends { id: string; type: string }>(me: { department?: D | null } | null | undefined, kind: DepartmentType) {
  if (me?.department && actsAs(me, kind)) return me.department
  return prisma.department.findFirst({ where: { type: kind } })
}

/** Team blocks of a kind (not the everyday ones). */
const TEAM_BLOCKS = (kind: DepartmentType) => BLOCKS.filter((b) => b.group !== 'main' && b.kinds.includes(kind)).map((b) => b.key)

/** Departments that borrow this kind's blocks into their menus (for lists of the kind's people). */
export async function borrowingDeptIds(kind: DepartmentType): Promise<string[]> {
  const companyId = maybeCompanyId()
  if (!companyId || !(await isOn('department-studio', companyId))) return []
  const keys = TEAM_BLOCKS(kind)
  const depts = await prisma.department.findMany({ where: { type: { not: kind } }, select: { id: true, layout: true } })
  return depts.filter((d) => { const l = readLayout(d.layout); return !!l && [...l.member, ...l.lead].some((k) => keys.includes(k)) }).map((d) => d.id)
}

/** The kinds a person's department borrows, from the blocks in their menu. */
export function kindsOfBlocks(blocks: string[]): DepartmentType[] {
  return [...new Set(BLOCKS.filter((b) => b.group !== 'main' && blocks.includes(b.key)).flatMap((b) => b.kinds))]
}
