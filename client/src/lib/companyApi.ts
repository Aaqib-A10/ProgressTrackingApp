import { useEffect, useState } from 'react'
import { api } from './api'
import type { Department, Role } from './types'
import { inHomeCompany } from './types'
import { DEPARTMENTS } from './departments'
import { useAuth } from './auth'

// Company settings (Phase 1, step 4): the company, its departments and its own roles.

export interface CompanyInfo { id: string; name: string; kind: 'TEAM' | 'PERSONAL'; timeZone: string; plan: string; status: string; createdAt: string; home: boolean; supportAccessUntil: string | null }
export interface CompanyUsage { plan: string; people: { used: number; limit: number | null }; storage: { usedBytes: number; limitBytes: number | null }; aiHours: { used: number; limit: number | null } }
export interface CompanyDepartment { id: string; name: string; type: Department; kind: string; people: number; createdAt: string }
export interface DepartmentKind { type: Department; label: string; description: string }
export interface CompanyRoleRow { id: string; name: string; baseRole: Role; baseLabel: string; areasOff: string[]; powers: string[]; people: number }
export interface RolesData {
  builtIn: { role: Role; label: string; powers: string[] }[]
  roles: CompanyRoleRow[]
  areas: { key: string; label: string }[]
  powers: { key: string; label: string; description: string }[]
}
export interface CompanyPerson { id: string; name: string; email: string; role: Role; roleLabel: string; customRoleId: string | null; permissions: string[]; department: string | null }

export const companyApi = {
  get: () => api.get<{ company: CompanyInfo; canEdit: boolean; timeZoneLocked: boolean; usage: CompanyUsage | null }>('/company'),
  supportAccess: (hours: 0 | 24 | 72 | 168) => api.post<{ supportAccessUntil: string | null }>('/company/support-access', { hours }),
  update: (input: { name?: string; timeZone?: string }) => api.patch<{ company: CompanyInfo }>('/company', input),
  departments: () => api.get<{ departments: CompanyDepartment[]; kinds: DepartmentKind[] }>('/company/departments'),
  addDepartment: (input: { name: string; type: Department }) => api.post<{ departments: CompanyDepartment[] }>('/company/departments', input),
  renameDepartment: (id: string, name: string) => api.patch<{ departments: CompanyDepartment[] }>(`/company/departments/${id}`, { name }),
  removeDepartment: (id: string) => api.del<{ departments: CompanyDepartment[] }>(`/company/departments/${id}`),
  roles: () => api.get<RolesData>('/company/roles'),
  addRole: (input: { name: string; baseRole: Role; areasOff: string[]; powers: string[] }) => api.post<{ roles: CompanyRoleRow[] }>('/company/roles', input),
  updateRole: (id: string, input: { name?: string; areasOff?: string[]; powers?: string[] }) => api.patch<{ roles: CompanyRoleRow[] }>(`/company/roles/${id}`, input),
  removeRole: (id: string) => api.del<{ roles: CompanyRoleRow[] }>(`/company/roles/${id}`),
  people: () => api.get<{ people: CompanyPerson[] }>('/company/people'),
  updatePerson: (id: string, input: { customRoleId?: string | null; permissions?: string[] }) => api.patch<{ ok: true }>(`/company/people/${id}`, input),
}

/**
 * Department choices for pickers. 99 Technologies keeps the choices it always had (by kind:
 * ITAD, Lead Generation…); another company picks from its own departments (by id), since it can
 * have several General ones.
 */
export interface DeptOption { value: string; label: string; type: Department }
export function useDeptOptions(): { options: DeptOption[]; byId: boolean } {
  const { user } = useAuth()
  const home = inHomeCompany(user)
  const [own, setOwn] = useState<DeptOption[]>([])
  useEffect(() => {
    if (home) return
    companyApi.departments().then((r) => setOwn(r.departments.map((d) => ({ value: d.id, label: d.name, type: d.type })))).catch(() => undefined)
  }, [home])
  return home ? { options: DEPARTMENTS.map((d) => ({ value: d.value, label: d.label, type: d.value })), byId: false } : { options: own, byId: true }
}
