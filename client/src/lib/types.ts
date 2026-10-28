// Shared client-side domain types. Mirrors the server Prisma enums.

export type Role = 'MEMBER' | 'TEAM_LEAD' | 'SUB_DEPT_LEAD' | 'QA' | 'QA_LEAD' | 'SUPER_ADMIN'
export type Department = 'ITAD' | 'LEAD_GEN' | 'MARKETING' | 'CSR' | 'ECOMMERCE' | 'TALKLOOP' | 'INVENTORY' | 'GENERAL'
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
  /** The department's own name (a company can have several General ones). */
  departmentName?: string
  subDepartment?: string | null
  role: Role
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
  /** Sees System Health (error log, self checks) and gets its alerts. */
  isDeveloper?: boolean
  department?: Department | null
  subDepartment?: string | null
  /** Id of the department currently being acted as (matches one membership). */
  activeDepartmentId?: string | null
  /** All departments the user belongs to (empty for admins/QA with no dept). */
  memberships?: Membership[]
  avatarUrl?: string | null
  /** The company (or personal workspace) they are in (Phase 1). */
  company?: { id: string; name: string; kind: 'TEAM' | 'PERSONAL'; plan: string; status: string; timeZone: string } | null
  /** A role the company made itself, on top of `role`. */
  customRole?: { id: string; name: string } | null
  /** Extra powers: 'finance', 'company.settings', 'holidays.manage'. */
  permissions?: string[]
  /** Parts of Metriq switched off for their company (plan) or company role (lib/areas.ts). */
  areasOff?: string[]
  /** Help sign-in: Metriq support is using Metriq as this person (a banner shows). */
  supportSession?: boolean
}

/** 99 Technologies, the company Metriq was built with. */
export const HOME_COMPANY_ID = 'company-1'
/** Is this person in 99 Technologies? (Older sign-ins without a company are.) */
export const inHomeCompany = (u: { company?: { id: string } | null } | null | undefined): boolean => !u?.company || u.company.id === HOME_COMPANY_ID
