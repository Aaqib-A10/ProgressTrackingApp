import type { DepartmentType, Role } from '@prisma/client'
import { isOn } from './flags'
import { menuOf, readLayout } from './blocks'

/**
 * The blocks in a person's menu (Department Studio), or null when their menu is the one that
 * comes with their department's kind: the Super Admin, a department with no layout of its own,
 * or a company with the Studio switched off (99 Technologies).
 */
export async function personBlocks(u: { role: Role; companyId: string; department: { type: DepartmentType; layout: unknown } | null }): Promise<string[] | null> {
  if (u.role === 'SUPER_ADMIN' || !u.department?.layout) return null
  const layout = readLayout(u.department.layout)
  if (!layout) return null
  if (!(await isOn('department-studio', u.companyId))) return null
  return layout[menuOf(u.role)]
}
