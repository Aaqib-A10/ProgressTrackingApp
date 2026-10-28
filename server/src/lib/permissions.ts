import type { Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'
import { HOME_COMPANY_ID } from './company'
import type { AuthedRequest } from '../middleware/auth'

/**
 * Roles and powers as each company's own data (Phase 1, step 4).
 *
 * The six built-in roles (Member, Team Lead, Sub-department Lead, QA, QA Lead, Super Admin)
 * stay exactly as they are. A company can also make its own roles: a name, the built-in role it
 * starts from (what it can do everywhere), parts of Metriq switched off for it (AREAS), and
 * extra powers (POWERS). A person can also be given an extra power on their own.
 *
 * Kept in step with client/src/lib/areas.ts (a test checks the two lists match).
 */

export type AreaKey = (typeof AREAS)[number]['key']

/** Parts of Metriq a company role can have switched off. api/app = where that part lives. */
export const AREAS = [
  { key: 'attendance', label: 'Attendance', api: ['/api/attendance'], app: ['/app/attendance'] },
  { key: 'projects', label: 'Projects and boards', api: ['/api/projects'], app: ['/app/projects'] },
  { key: 'tasks', label: 'My tasks', api: ['/api/tasks'], app: ['/app/tasks'] },
  { key: 'todos', label: 'To-do list', api: ['/api/todos'], app: ['/app/todo'] },
  { key: 'chat', label: 'Chat, calls and meetings', api: ['/api/chat', '/api/meetings'], app: ['/app/chat', '/app/calendar', '/app/meetings'] },
  { key: 'feedback', label: 'Feedback', api: ['/api/feedback'], app: ['/app/feedback'] },
  { key: 'itad', label: 'ITAD (daily log, bids, documents)', api: ['/api/itad', '/api/docs'], app: ['/app/itad'] },
  { key: 'dialer', label: 'Lead Dialer', api: ['/api/dialer'], app: ['/app/itad/dialer'] },
  { key: 'leadgen', label: 'Lead Generation', api: ['/api/leadgen'], app: ['/app/leadgen'] },
  { key: 'marketing', label: 'Marketing', api: ['/api/marketing'], app: ['/app/marketing'] },
  { key: 'ecommerce', label: 'E-commerce', api: ['/api/ecommerce', '/api/rdp'], app: ['/app/ecommerce'] },
  { key: 'inventory', label: 'Inventory', api: ['/api/inventory'], app: ['/app/inventory'] },
  { key: 'qa', label: 'Quality Assurance', api: ['/api/qa'], app: ['/app/qa'] },
  { key: 'reports', label: 'Reports and analytics', api: ['/api/reports'], app: ['/app/reports', '/app/analytics'] },
  { key: 'daily-report', label: 'Daily Report', api: ['/api/daily-report'], app: ['/app/daily-report'] },
] as const

/** Extra powers a company role or a person can be given. */
export const POWERS = {
  finance: { label: 'Financial reports and salaries', description: 'Cost, revenue and salary figures. Only someone who has this power can give it.' },
  'company.settings': { label: 'Company settings', description: 'Company name, time zone, departments and roles.' },
  'holidays.manage': { label: 'Holidays', description: 'Add and remove company holidays.' },
} as const
export type PowerKey = keyof typeof POWERS
export const POWER_KEYS = Object.keys(POWERS) as PowerKey[]
export const AREA_KEYS = AREAS.map((a) => a.key) as AreaKey[]

/** What the built-in roles have always been able to do (unchanged by step 4). */
export const BUILTIN_POWERS: Record<Role, PowerKey[]> = {
  SUPER_ADMIN: ['company.settings', 'holidays.manage'],
  TEAM_LEAD: [],
  SUB_DEPT_LEAD: [],
  QA: [],
  QA_LEAD: [],
  MEMBER: [],
}

/**
 * 99 Technologies' finance people, as before step 4 (an email list on the server). They keep
 * the finance power without anyone setting it.
 */
export const FINANCE_EMAILS = (process.env.FINANCE_ALLOWED_EMAILS ?? 'aqibalishehzad3@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/** The part of Metriq an address belongs to (the longest match wins: the dialer is inside ITAD). */
export function areaOf(path: string, where: 'api' | 'app'): AreaKey | null {
  const p = path.split('?')[0].replace(/\/+$/, '')
  let best: { key: AreaKey; len: number } | null = null
  for (const a of AREAS) for (const prefix of a[where]) {
    if ((p === prefix || p.startsWith(prefix + '/')) && (!best || prefix.length > best.len)) best = { key: a.key, len: prefix.length }
  }
  return best?.key ?? null
}

type Who = { role: Role; email: string; companyId: string; permissions: string[]; customRole: { powers: string[] } | null }

export function powersOf(u: Who): PowerKey[] {
  const out = new Set<string>([...BUILTIN_POWERS[u.role], ...u.permissions, ...(u.customRole?.powers ?? [])])
  if (u.companyId === HOME_COMPANY_ID) {
    if (FINANCE_EMAILS.includes(u.email.toLowerCase())) out.add('finance')
  } else if (u.role === 'SUPER_ADMIN') {
    // In every other company the Super Admin runs the company, finance included (they can
    // give it to others). At 99 Technologies it stays with the finance people only.
    out.add('finance')
  }
  return POWER_KEYS.filter((k) => out.has(k))
}

export async function loadPowers(userId: string): Promise<PowerKey[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true, companyId: true, permissions: true, customRole: { select: { powers: true } } } })
  return u ? powersOf(u) : []
}

export async function hasPower(userId: string, key: PowerKey): Promise<boolean> {
  return (await loadPowers(userId)).includes(key)
}

/** Express guard: only people with this power. Use after requireAuth. */
export function requirePower(key: PowerKey, message = 'You do not have access to this.') {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.user && (await hasPower(req.user.id, key))) { next(); return }
    res.status(403).json({ error: message })
  }
}
