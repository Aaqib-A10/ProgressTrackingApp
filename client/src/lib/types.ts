// Shared client-side domain types. Mirrors the server Prisma enums.

export type Role = 'MEMBER' | 'TEAM_LEAD' | 'SUB_DEPT_LEAD' | 'QA' | 'QA_LEAD' | 'SUPER_ADMIN'
export type Department = 'ITAD' | 'LEAD_GEN' | 'MARKETING' | 'CSR' | 'ECOMMERCE' | 'TALKLOOP'
export type UserStatus = 'PENDING' | 'ACTIVE' | 'REJECTED'

/** Canonical role labels (normalization checklist — no "Agent"/"TL" drift). */
export const ROLE_LABEL: Record<Role, string> = {
  MEMBER: 'Member',
  TEAM_LEAD: 'Team Lead',
  SUB_DEPT_LEAD: 'Sub-Dept Lead',
  QA: 'QA',
  QA_LEAD: 'QA Team Lead',
  SUPER_ADMIN: 'Super Admin',
}

/** One department a user belongs to, with the role they hold there. */
export interface Membership {
  departmentId: string
  department: Department
  subDepartment?: string | null
  role: Role
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
  department?: Department | null
  subDepartment?: string | null
  /** Id of the department currently being acted as (matches one membership). */
  activeDepartmentId?: string | null
  /** All departments the user belongs to (empty for admins/QA with no dept). */
  memberships?: Membership[]
  avatarUrl?: string | null
}
