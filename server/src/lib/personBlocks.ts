import type { DepartmentType, Role } from '@prisma/client'
import { isOn } from './flags'
import { menuOf, readLayout } from './blocks'
import { readDashboard, type DashCard } from './cards'

type Person = { role: Role; companyId: string; department: { type: DepartmentType; layout: unknown; dashboard?: unknown } | null }

/**
 * The blocks in a person's menu (Department Studio), or null when their menu is the one that
 * comes with their department's kind: the Super Admin, a department with no layout of its own,
 * or a company with the Studio switched off (99 Technologies).
 */
export async function personBlocks(u: Person): Promise<string[] | null> {
  if (u.role === 'SUPER_ADMIN' || !u.department?.layout) return null
  const layout = readLayout(u.department.layout)
  if (!layout) return null
  if (!(await isOn('department-studio', u.companyId))) return null
  return layout[menuOf(u.role)]
}

/** The cards on a person's dashboard (part B), or null for the dashboard of their department's kind. */
export async function personDashboard(u: Person): Promise<DashCard[] | null> {
  if (u.role === 'SUPER_ADMIN' || !u.department?.dashboard) return null
  const d = readDashboard(u.department.dashboard)
  if (!d) return null
  if (!(await isOn('department-studio', u.companyId))) return null
  return d[menuOf(u.role)]
}
