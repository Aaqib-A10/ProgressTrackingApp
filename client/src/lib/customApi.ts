import {
  Briefcase, Building2, CalendarDays, ClipboardList, DollarSign, FileText, Flag, GraduationCap, Heart, KanbanSquare, LayoutGrid, Lightbulb,
  ListChecks, Mail, Megaphone, Package, Phone, Receipt, Shield, ShoppingCart, Star, Truck, Users, Wrench, type LucideIcon,
} from 'lucide-react'
import { api } from './api'

/**
 * Department Studio, part C: blocks a company makes itself (rules: server lib/customBlocks.ts).
 */

export type FieldType = 'text' | 'longtext' | 'number' | 'date' | 'select' | 'checkbox' | 'person' | 'url'
export interface CustomField { key: string; label: string; type: FieldType; options?: string[]; required?: boolean }
export interface CustomSettings { membersSee: 'own' | 'all'; membersAdd: boolean; boardField: string | null; dateField: string | null }
export interface CustomBlock { id: string; name: string; description: string | null; icon: string; color: string; fields: CustomField[]; settings: CustomSettings; records?: number; updatedAt: string }
export type CustomBlockInput = Omit<CustomBlock, 'id' | 'records' | 'updatedAt'>
export interface CustomRecord { id: string; data: Record<string, unknown>; createdBy: { id: string; name: string } | null; department: string | null; createdAt: string; updatedAt: string; canChange: boolean }
export interface CustomSummary { block: { id: string; name: string; icon: string; color: string }; total: number; thisWeek: number; by: { label: string; counts: { label: string; count: number }[] } | null; latest: { id: string; title: string; createdAt: string }[] }

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short text', longtext: 'Long text', number: 'Number', date: 'Date', select: 'Choice', checkbox: 'Tick box', person: 'Person', url: 'Link',
}

/** The icons the builder offers (the server has the same list). */
export const BLOCK_ICON: Record<string, LucideIcon> = {
  LayoutGrid, ClipboardList, ListChecks, KanbanSquare, CalendarDays, FileText, Users, Truck, Package, Wrench, Receipt,
  DollarSign, Phone, Mail, Star, Flag, Heart, Briefcase, Building2, GraduationCap, ShoppingCart, Megaphone, Lightbulb, Shield,
}
export const iconOf = (name: string | undefined): LucideIcon => (name && BLOCK_ICON[name]) || LayoutGrid
export const BLOCK_COLORS = ['#6366F1', '#0EA5E9', '#14B8A6', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#64748B']

export const customApi = {
  // Building (Super Admin)
  list: () => api.get<{ blocks: CustomBlock[] }>('/company/blocks'),
  create: (b: CustomBlockInput) => api.post<{ block: CustomBlock }>('/company/blocks', b),
  update: (id: string, b: CustomBlockInput) => api.patch<{ block: CustomBlock }>(`/company/blocks/${id}`, b),
  remove: (id: string, withRecords = false) => api.del<void>(`/company/blocks/${id}${withRecords ? '?withRecords=yes' : ''}`),
  // Using
  get: (id: string) => api.get<{ block: CustomBlock; canAdd: boolean; lead: boolean; people: { id: string; name: string }[] }>(`/custom/${id}`),
  records: (id: string) => api.get<{ records: CustomRecord[]; more: boolean }>(`/custom/${id}/records`),
  add: (id: string, data: Record<string, unknown>) => api.post<{ record: CustomRecord }>(`/custom/${id}/records`, { data }),
  change: (id: string, rid: string, data: Record<string, unknown>) => api.patch<{ record: CustomRecord }>(`/custom/${id}/records/${rid}`, { data }),
  drop: (id: string, rid: string) => api.del<void>(`/custom/${id}/records/${rid}`),
  summary: (id: string) => api.get<CustomSummary>(`/custom/${id}/summary`),
}
