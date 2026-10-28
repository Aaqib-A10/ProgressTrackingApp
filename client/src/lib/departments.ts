import type { Department } from './types'

/** Single source of truth for department options + labels (used in pickers). */
export const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'ITAD', label: 'ITAD' },
  { value: 'LEAD_GEN', label: 'Lead Generation' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'CSR', label: 'CSR' },
  { value: 'ECOMMERCE', label: 'Ecommerce' },
  { value: 'INVENTORY', label: 'Inventory' },
]

export const DEPARTMENT_LABEL: Record<Department, string> = {
  ITAD: 'ITAD',
  LEAD_GEN: 'Lead Generation',
  MARKETING: 'Marketing',
  CSR: 'CSR',
  ECOMMERCE: 'Ecommerce',
  TALKLOOP: 'Talkloop',
  INVENTORY: 'Inventory',
}

/** Team a self-registering lead can request — departments + the QA team. */
export const SIGNUP_TEAM_OPTIONS: { value: Department | 'QA'; label: string }[] = [
  ...DEPARTMENTS,
  { value: 'QA', label: 'Quality Assurance (QA Team Lead)' },
]
