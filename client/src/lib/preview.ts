import { useSyncExternalStore } from 'react'
import type { CurrentUser, Department } from './types'

/**
 * Department Studio "Preview in the app": the Super Admin walks through Metriq with the menu and
 * screens a department's member or team lead gets. Only the menu and which screens open change;
 * the pages still load with the Super Admin's own access (nothing is saved as anyone else).
 * Kept for this browser tab only.
 */
export interface Preview {
  departmentId: string
  departmentName: string
  kind: Department
  role: 'MEMBER' | 'TEAM_LEAD'
  blocks: string[]
  /** Part B: the dashboard cards of that role (none: the dashboard of its kind). */
  dashboard?: { key: string; size: 1 | 2 | 3 }[] | null
}

const KEY = 'studio.preview'
const listeners = new Set<() => void>()
let current: Preview | null = read()

function read(): Preview | null {
  try { const v = sessionStorage.getItem(KEY); return v ? (JSON.parse(v) as Preview) : null } catch { return null }
}
export function startPreview(p: Preview): void {
  current = p
  try { sessionStorage.setItem(KEY, JSON.stringify(p)) } catch { /* this tab only anyway */ }
  listeners.forEach((l) => l())
}
export function endPreview(): void {
  current = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
export function usePreview(): Preview | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => current, () => null)
}

/** The person as the preview shows them: that role, that department, its menu. Super Admins only. */
export function asPreviewed(user: CurrentUser, p: Preview | null): CurrentUser {
  if (!p || user.role !== 'SUPER_ADMIN') return user
  return { ...user, role: p.role, department: p.kind, subDepartment: null, blocks: p.blocks, dashboard: p.dashboard ?? null, dashboardPrefs: null, permissions: [], isDeveloper: false }
}
