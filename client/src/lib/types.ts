// Shared client-side domain types. Mirrors the server Prisma enums.

export type Role = 'MEMBER' | 'TEAM_LEAD' | 'SUB_DEPT_LEAD' | 'QA' | 'QA_LEAD' | 'SUPER_ADMIN'
export type Department = 'ITAD' | 'LEAD_GEN' | 'MARKETING' | 'CSR'
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

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
  department?: Department | null
  subDepartment?: string | null
  avatarUrl?: string | null
}
