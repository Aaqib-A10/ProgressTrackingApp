import {
  LayoutDashboard,
  FileBarChart,
  MessageSquare,
  ClipboardCheck,
  ClipboardList,
  Phone,
  Users,
  LineChart,
  Target as TargetIcon,
  KanbanSquare,
  CalendarDays,
  Search,
  Share2,
  PenTool,
  UserCog,
  Tags,
  CalendarOff,
  Building2,
  ShoppingCart,
  Boxes,
  type LucideIcon,
} from 'lucide-react'
import type { Role, Department } from '../../lib/types'
import type { BadgeTone } from '../ui/Badge'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Visible only to these roles (omit = all roles). */
  roles?: Role[]
  /** Visible only for these departments (omit = all departments). */
  departments?: Department[]
  /** Hidden for these roles, even Super Admin (who otherwise sees everything). */
  hideFor?: Role[]
  badge?: { text: string; tone: BadgeTone }
}

export interface NavGroup {
  /** Optional small section heading. */
  title?: string
  items: NavItem[]
}

const TL_ROLES: Role[] = ['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']
const ADMIN_ROLES: Role[] = ['TEAM_LEAD', 'SUPER_ADMIN']

// Full nav. Filtered per user by filterNav() below.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard },
      { label: 'My Reports', to: '/app/reports', icon: FileBarChart, hideFor: ['SUPER_ADMIN'] },
      { label: 'My Analytics', to: '/app/analytics', icon: LineChart, roles: ['MEMBER'], hideFor: ['SUPER_ADMIN'] },
      { label: 'My Team', to: '/app/team/members', icon: Users, roles: ['TEAM_LEAD'], hideFor: ['SUPER_ADMIN'] },
      { label: 'Monthly Reports', to: '/app/reports/monthly', icon: FileBarChart, roles: ['TEAM_LEAD', 'SUPER_ADMIN'], departments: ['ITAD', 'LEAD_GEN'] },
      { label: 'My QA Scores', to: '/app/qa/my', icon: ClipboardCheck, roles: ['MEMBER'], hideFor: ['SUPER_ADMIN'] },
      { label: 'Feedback', to: '/app/feedback', icon: MessageSquare },
    ],
  },
  {
    title: 'Quality Assurance',
    items: [
      { label: 'Evaluate', to: '/app/qa/evaluate', icon: ClipboardCheck, roles: ['QA', 'QA_LEAD'] },
      { label: 'Scorecards', to: '/app/qa/scorecards', icon: ClipboardList, roles: ['QA', 'QA_LEAD'] },
      { label: 'QA Analytics', to: '/app/qa/analytics', icon: LineChart, roles: ['QA', 'QA_LEAD', 'TEAM_LEAD'] },
      { label: 'QA Team', to: '/app/qa/evaluators', icon: Users, roles: ['QA_LEAD'] },
    ],
  },
  {
    title: 'ITAD',
    items: [
      { label: 'Daily Log', to: '/app/itad/log', icon: Phone, departments: ['ITAD'], hideFor: ['SUPER_ADMIN'] },
      { label: 'Team View', to: '/app/itad/team', icon: Users, departments: ['ITAD'], roles: TL_ROLES, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Analytics', to: '/app/itad/analytics', icon: LineChart, departments: ['ITAD'], roles: TL_ROLES },
    ],
  },
  {
    title: 'Lead Generation',
    items: [
      { label: 'Daily Log', to: '/app/leadgen/log', icon: Phone, departments: ['LEAD_GEN'], hideFor: ['SUPER_ADMIN'] },
      { label: 'Team View', to: '/app/leadgen/team', icon: Users, departments: ['LEAD_GEN'], roles: TL_ROLES, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Monthly Breakdown', to: '/app/leadgen/breakdown', icon: Building2, departments: ['LEAD_GEN'], roles: ADMIN_ROLES },
      { label: 'Analytics', to: '/app/leadgen/analytics', icon: LineChart, departments: ['LEAD_GEN'], roles: TL_ROLES },
    ],
  },
  {
    title: 'Ecommerce',
    items: [
      { label: 'Daily Log', to: '/app/ecommerce/log', icon: ShoppingCart, departments: ['ECOMMERCE'], hideFor: ['SUPER_ADMIN'] },
      { label: 'Task Board', to: '/app/ecommerce/board', icon: KanbanSquare, departments: ['ECOMMERCE'] },
      { label: 'Stock Tracking', to: '/app/ecommerce/stock', icon: Boxes, departments: ['ECOMMERCE'] },
      { label: 'Team View', to: '/app/ecommerce/team', icon: Users, departments: ['ECOMMERCE'], roles: TL_ROLES, badge: { text: 'HOD', tone: 'accent' } },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Board', to: '/app/marketing/board', icon: KanbanSquare, departments: ['MARKETING'] },
      { label: 'Calendar', to: '/app/marketing/calendar', icon: CalendarDays, departments: ['MARKETING'] },
      { label: 'SEO', to: '/app/marketing/seo', icon: Search, departments: ['MARKETING'] },
      { label: 'Social', to: '/app/marketing/social', icon: Share2, departments: ['MARKETING'] },
      { label: 'Content', to: '/app/marketing/content', icon: PenTool, departments: ['MARKETING'] },
      { label: 'Analytics', to: '/app/marketing/analytics', icon: LineChart, departments: ['MARKETING'], roles: TL_ROLES },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users', to: '/app/admin/users', icon: UserCog, roles: ['SUPER_ADMIN'], badge: { text: 'ADMIN', tone: 'danger' } },
      { label: 'Targets', to: '/app/admin/targets', icon: TargetIcon, roles: ADMIN_ROLES },
      { label: 'Tags', to: '/app/admin/tags', icon: Tags, roles: ADMIN_ROLES },
      { label: 'Holidays & Leave', to: '/app/admin/leave', icon: CalendarOff, roles: ADMIN_ROLES },
    ],
  },
]

function itemVisible(item: NavItem, role: Role, department?: Department | null): boolean {
  // Explicit per-item opt-out, applies even to Super Admin.
  if (item.hideFor?.includes(role)) return false
  // Super Admin sees everything regardless of department.
  if (role === 'SUPER_ADMIN') return true
  if (item.roles && !item.roles.includes(role)) return false
  if (item.departments && (!department || !item.departments.includes(department))) return false
  return true
}

/** Returns nav groups filtered for the given user, dropping empty groups. */
export function filterNav(role: Role, department?: Department | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => itemVisible(i, role, department)),
  })).filter((g) => g.items.length > 0)
}
