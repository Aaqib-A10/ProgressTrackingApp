import { matchPath } from 'react-router-dom'
import type { CurrentUser, Department, Role } from './types'
import { areaBlocked } from './areas'

/**
 * Who may open which screen: ONE list used by both the side menu and the page guard, so a
 * screen that is hidden from someone's menu is also closed to them when they type its address.
 *
 * Each screen lists who it is for. Someone gets in when they match any one line:
 *   roles        their role is one of these
 *   departments  their current department is one of these
 *   subDepts     (Marketing) their sub-department is one of these; team leads see all of Marketing
 * The Super Admin opens every screen. Screens not listed (dashboard, chat, calendar, projects,
 * to-do, my tasks, attendance, feedback, settings) are for everyone.
 *
 * The server checks the same things again on every request; this only keeps the menus and
 * pages tidy so nobody is shown screens that are not for them.
 */

export interface AccessLine {
  roles?: Role[]
  departments?: Department[]
  subDepts?: string[]
}

/** People who work inside a department (not QA, not the Super Admin). */
const WORK: Role[] = ['MEMBER', 'TEAM_LEAD', 'SUB_DEPT_LEAD']
const LEAD: Role[] = ['TEAM_LEAD']
const QA_TEAM: Role[] = ['QA', 'QA_LEAD']
/** Departments QA scores. */
export const QA_SCORED: Department[] = ['ITAD', 'CSR']

const dept = (departments: Department[], roles: Role[] = WORK): AccessLine[] => [{ departments, roles }]
const lead = (departments: Department[]): AccessLine[] => [{ departments, roles: LEAD }]
/** Marketing screen for one discipline: its own people, plus every Marketing team lead. */
const mkt = (...subDepts: string[]): AccessLine[] => [
  { departments: ['MARKETING'], roles: ['MEMBER', 'SUB_DEPT_LEAD'], subDepts },
  { departments: ['MARKETING'], roles: LEAD },
]

export const ACCESS: Record<string, AccessLine[]> = {
  // ---- personal
  '/app/reports': dept(['ITAD', 'LEAD_GEN']),
  '/app/analytics': dept(['ITAD', 'LEAD_GEN'], ['MEMBER']),
  '/app/qa/my': dept(QA_SCORED, ['MEMBER']),

  // ---- team lead tools
  '/app/team/members': [{ roles: LEAD }],
  '/app/team/not-submitted': lead(['ITAD', 'LEAD_GEN', 'ECOMMERCE', 'MARKETING']),
  '/app/members/:id': [{ roles: LEAD }],
  '/app/reports/monthly': lead(['ITAD', 'LEAD_GEN']),
  '/app/attendance/team': [{ roles: LEAD }],

  // ---- QA
  '/app/qa/evaluate': [{ roles: QA_TEAM }],
  '/app/qa/scorecards': [{ roles: QA_TEAM }],
  '/app/qa/evaluators': [{ roles: ['QA_LEAD'] }],
  '/app/qa/analytics': [{ roles: QA_TEAM }, ...lead(QA_SCORED)],
  '/app/qa/evaluations': [{ roles: QA_TEAM }, ...lead(QA_SCORED)],
  '/app/qa/evaluations/:id': [{ roles: QA_TEAM }, ...dept(QA_SCORED)],
  '/app/qa/evaluations/:id/edit': [{ roles: QA_TEAM }],

  // ---- ITAD
  '/app/itad/log': dept(['ITAD']),
  '/app/itad/bids': dept(['ITAD']),
  '/app/itad/docs': dept(['ITAD']),
  '/app/itad/dialer': dept(['ITAD']),
  '/app/itad/team': lead(['ITAD']),
  '/app/itad/analytics': lead(['ITAD']),

  // ---- Lead Generation
  '/app/leadgen/log': dept(['LEAD_GEN']),
  '/app/leadgen/team': lead(['LEAD_GEN']),
  '/app/leadgen/breakdown': lead(['LEAD_GEN']),
  '/app/leadgen/analytics': lead(['LEAD_GEN']),


  // ---- Ecommerce
  '/app/ecommerce/log': dept(['ECOMMERCE']),
  '/app/ecommerce/board': dept(['ECOMMERCE']),
  '/app/ecommerce/stock': dept(['ECOMMERCE']),
  '/app/ecommerce/notes': dept(['ECOMMERCE']),
  '/app/ecommerce/team': dept(['ECOMMERCE']),
  '/app/ecommerce/rdp': lead(['ECOMMERCE']),

  // ---- Inventory
  '/app/inventory': dept(['INVENTORY']),
  '/app/inventory/requests': dept(['INVENTORY']),
  '/app/inventory/team': lead(['INVENTORY']),

  // ---- Marketing (shared)
  '/app/marketing/board': dept(['MARKETING']),
  '/app/marketing/calendar': mkt('social'),
  '/app/marketing/team': [{ departments: ['MARKETING'], roles: ['TEAM_LEAD', 'SUB_DEPT_LEAD'] }],
  '/app/marketing/analytics': [{ departments: ['MARKETING'], roles: ['TEAM_LEAD', 'SUB_DEPT_LEAD'] }],
  '/app/marketing/brands': lead(['MARKETING']),
  '/app/marketing/profiles': lead(['MARKETING']),
  // ---- Marketing by discipline
  '/app/marketing/planner': mkt('social'),
  '/app/marketing/social/monthly': mkt('social'),
  '/app/marketing/social/analytics': mkt('social'),
  '/app/marketing/plan': mkt('content'),
  '/app/marketing/content/log': mkt('content'),
  '/app/marketing/blogs': mkt('content'),
  '/app/marketing/content': mkt('content'),
  '/app/marketing/seo': mkt('seo'),
  '/app/marketing/ads': mkt('ads'),
  '/app/marketing/email': mkt('email'),

  // ---- Daily Report (Phase 1, step 5): anyone fills it in; team leads see the team and build forms.
  '/app/daily-report/team': [{ roles: LEAD }],
  '/app/daily-report/forms': [{ roles: LEAD }],

  // ---- Admin
  '/app/admin/users': [],
  '/app/admin/networks': [],
  '/app/admin/targets': lead(['ITAD', 'LEAD_GEN', 'MARKETING']),
  '/app/admin/tags': lead(['ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE']),
  '/app/admin/leave': [{ roles: LEAD }],
  '/app/admin/activity': [{ roles: LEAD }],
}

type Who = Pick<CurrentUser, 'role' | 'department' | 'subDepartment' | 'areasOff'> & { company?: CurrentUser['company'] }

function lineAllows(line: AccessLine, u: Who): boolean {
  if (line.roles && !line.roles.includes(u.role)) return false
  if (line.departments && (!u.department || !line.departments.includes(u.department))) return false
  // A Marketing person with no sub-department set yet sees all of Marketing (nothing to go by).
  if (line.subDepts && u.subDepartment && !line.subDepts.includes(u.subDepartment)) return false
  return true
}

/** The rule for this address, if the address is one of the listed screens. */
export function accessRuleFor(pathname: string): AccessLine[] | undefined {
  const exact = ACCESS[pathname]
  if (exact) return exact
  for (const pattern of Object.keys(ACCESS)) {
    if (pattern.includes(':') && matchPath({ path: pattern, end: true }, pathname)) return ACCESS[pattern]
  }
  return undefined
}

/** May this person open this screen? */
export function canOpen(u: Who | null | undefined, pathname: string): boolean {
  if (!u) return false
  // A company role can have parts of Metriq switched off (Phase 1, step 4), Super Admin based ones too.
  if (areaBlocked(u, pathname)) return false
  if (u.role === 'SUPER_ADMIN') return true
  const rule = accessRuleFor(pathname.replace(/\/+$/, '') || '/')
  if (!rule) return true
  return rule.some((line) => lineAllows(line, u))
}
