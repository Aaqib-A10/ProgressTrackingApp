import type { Department } from './types'

/** Single source of truth for department options + labels (used in pickers). */
const KIND_ORDER: Department[] = ['ITAD', 'LEAD_GEN', 'MARKETING', 'CSR', 'ECOMMERCE', 'INVENTORY', 'CMR']
/** A kind with its label read when it is shown, so it is always the signed-in company's own name for it. */
const kindOption = (value: Department): { value: Department; label: string } => ({ value, get label() { return deptName(value) } })
export const DEPARTMENTS: { value: Department; label: string }[] = KIND_ORDER.map(kindOption)

/**
 * The kinds of department to offer in a filter or a picker: every kind for 99 Technologies; for any other company
 * only the kinds it has (it never sees a department it did not make). Pass a list to narrow it further.
 */
export function shownDepartments(among: Department[] = KIND_ORDER): { value: Department; label: string }[] {
  return among.filter((k) => !companyNames || k in companyNames).map(kindOption)
}

/** The names 99 Technologies' people know their departments by. */
const HOME_LABEL: Record<Department, string> = {
  ITAD: 'ITAD',
  LEAD_GEN: 'Lead Generation',
  MARKETING: 'Marketing',
  CSR: 'CSR',
  ECOMMERCE: 'Ecommerce',
  TALKLOOP: 'Talkloop',
  INVENTORY: 'Inventory',
  CMR: 'CMR',
  GENERAL: 'General',
}
/** What a kind of department is called when a company has not named one of its own. */
const NEUTRAL_LABEL: Partial<Record<Department, string>> = { ITAD: 'Sales calling', CSR: 'Customer service', ECOMMERCE: 'E-commerce' }

// Every other company sees its OWN department names ("Sales", not "ITAD"). The signed-in person's company tells us
// what it calls each kind (lib/auth sets this the moment the person is known); null means 99 Technologies.
let companyNames: Record<string, string> | null = null
export function setCompanyDepartmentNames(names: Record<string, string> | null): void { companyNames = names }

/**
 * The name to show for a kind of department. 99 Technologies keeps the name its people know (`homeName`); any other
 * company sees what it called its own department of that kind, or a plain description when it has none.
 */
export function deptName(kind: Department | string, homeName: string = HOME_LABEL[kind as Department] ?? kind): string {
  if (!companyNames) return homeName
  return companyNames[kind] ?? NEUTRAL_LABEL[kind as Department] ?? homeName
}

/**
 * The CRM a calling team's leads come from. 99 Technologies' is Earth Zone (`homeName` keeps the spelling each screen
 * already used); any other company simply sees "CRM".
 */
export function crmName(homeName = 'Earth Zone'): string {
  return companyNames ? 'CRM' : homeName
}

/** Labels by kind, read through `deptName` so they are always the signed-in company's own. */
export const DEPARTMENT_LABEL: Record<Department, string> = new Proxy(HOME_LABEL, {
  get: (home, kind) => (typeof kind === 'string' && kind in home ? deptName(kind, home[kind as Department]) : undefined),
}) as Record<Department, string>

/** Team a self-registering lead can request — departments + the QA team. */
export const SIGNUP_TEAM_OPTIONS: { value: Department | 'QA'; label: string }[] = [
  ...DEPARTMENTS,
  { value: 'QA', label: 'Quality Assurance (QA Team Lead)' },
]
