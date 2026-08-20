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
  BarChart3,
  PenTool,
  UserCog,
  Tags,
  CalendarOff,
  Building2,
  ShoppingCart,
  Boxes,
  Clock,
  Server,
  ListChecks,
  ListTodo,
  StickyNote,
  Briefcase,
  Wifi,
  Megaphone,
  Mail,
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

export interface NavSubGroup {
  /** Nested section heading (e.g. a Marketing sub-department). */
  title: string
  items: NavItem[]
}

export interface NavGroup {
  /** Optional small section heading. */
  title?: string
  items: NavItem[]
  /** Nested collapsible sub-sections (e.g. Marketing → Social Media / Content / …). */
  subgroups?: NavSubGroup[]
}

const TL_ROLES: Role[] = ['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']
const ADMIN_ROLES: Role[] = ['TEAM_LEAD', 'SUPER_ADMIN']
// Member data-entry / per-department operational tabs the Super Admin doesn't use.
// The admin keeps oversight (dashboards, team views, analytics) + admin/config.
const HIDE_FROM_SA: Role[] = ['SUPER_ADMIN']

// Full nav. Filtered per user by filterNav() below.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard },
      { label: 'My Reports', to: '/app/reports', icon: FileBarChart, hideFor: HIDE_FROM_SA },
      { label: 'My Analytics', to: '/app/analytics', icon: LineChart, roles: ['MEMBER'], hideFor: HIDE_FROM_SA },
      { label: 'My Tasks', to: '/app/tasks', icon: ListChecks },
      { label: 'My To-Do', to: '/app/todo', icon: ListTodo },
      { label: 'My Team', to: '/app/team/members', icon: Users, roles: ['TEAM_LEAD'], hideFor: HIDE_FROM_SA },
      { label: 'Monthly Reports', to: '/app/reports/monthly', icon: FileBarChart, roles: ['TEAM_LEAD', 'SUPER_ADMIN'], departments: ['ITAD', 'LEAD_GEN'] },
      { label: 'My QA Scores', to: '/app/qa/my', icon: ClipboardCheck, roles: ['MEMBER'], hideFor: HIDE_FROM_SA },
      { label: 'Feedback', to: '/app/feedback', icon: MessageSquare },
    ],
  },
  {
    title: 'Attendance',
    items: [
      { label: 'My Attendance', to: '/app/attendance/me', icon: Clock },
      { label: 'Team Attendance', to: '/app/attendance/team', icon: Users, roles: ADMIN_ROLES, badge: { text: 'TL', tone: 'accent' } },
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
      { label: 'Daily Log', to: '/app/itad/log', icon: Phone, departments: ['ITAD'], hideFor: HIDE_FROM_SA },
      { label: 'Bid Tracker', to: '/app/itad/bids', icon: Briefcase, departments: ['ITAD'], hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/itad/team', icon: Users, departments: ['ITAD'], roles: TL_ROLES, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Analytics', to: '/app/itad/analytics', icon: LineChart, departments: ['ITAD'], roles: TL_ROLES },
    ],
  },
  {
    title: 'Lead Generation',
    items: [
      { label: 'Daily Log', to: '/app/leadgen/log', icon: Phone, departments: ['LEAD_GEN'], hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/leadgen/team', icon: Users, departments: ['LEAD_GEN'], roles: TL_ROLES, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Monthly Breakdown', to: '/app/leadgen/breakdown', icon: Building2, departments: ['LEAD_GEN'], roles: ADMIN_ROLES },
      { label: 'Analytics', to: '/app/leadgen/analytics', icon: LineChart, departments: ['LEAD_GEN'], roles: TL_ROLES },
    ],
  },
  {
    title: 'Ecommerce',
    items: [
      { label: 'Daily Log', to: '/app/ecommerce/log', icon: ShoppingCart, departments: ['ECOMMERCE'], hideFor: HIDE_FROM_SA },
      { label: 'Task Board', to: '/app/ecommerce/board', icon: KanbanSquare, departments: ['ECOMMERCE'], hideFor: HIDE_FROM_SA },
      { label: 'Stock Tracking', to: '/app/ecommerce/stock', icon: Boxes, departments: ['ECOMMERCE'], hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/ecommerce/team', icon: Users, departments: ['ECOMMERCE'] },
      { label: 'Meeting Notes', to: '/app/ecommerce/notes', icon: StickyNote, departments: ['ECOMMERCE'], hideFor: HIDE_FROM_SA },
      { label: 'RDP Records', to: '/app/ecommerce/rdp', icon: Server, departments: ['ECOMMERCE'], roles: ADMIN_ROLES, badge: { text: 'TL', tone: 'accent' } },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Board', to: '/app/marketing/board', icon: KanbanSquare, departments: ['MARKETING'] },
      { label: 'Analytics', to: '/app/marketing/analytics', icon: LineChart, departments: ['MARKETING'], roles: TL_ROLES },
      { label: 'Brands', to: '/app/marketing/brands', icon: Building2, departments: ['MARKETING'], roles: ADMIN_ROLES },
    ],
    subgroups: [
      {
        title: 'Social Media',
        items: [
          { label: 'Social Planner', to: '/app/marketing/planner', icon: CalendarDays, departments: ['MARKETING'] },
          { label: 'Daily Log', to: '/app/marketing/social', icon: Share2, departments: ['MARKETING'] },
          { label: 'Social Reports', to: '/app/marketing/social/monthly', icon: BarChart3, departments: ['MARKETING'] },
          { label: 'Social Analytics', to: '/app/marketing/social/analytics', icon: LineChart, departments: ['MARKETING'] },
        ],
      },
      {
        title: 'Content',
        items: [
          { label: 'Master Plan', to: '/app/marketing/plan', icon: ListChecks, departments: ['MARKETING'] },
          { label: 'Daily Log', to: '/app/marketing/content/log', icon: PenTool, departments: ['MARKETING'] },
          { label: 'Blogs', to: '/app/marketing/blogs', icon: PenTool, departments: ['MARKETING'] },
          { label: 'Content', to: '/app/marketing/content', icon: KanbanSquare, departments: ['MARKETING'] },
        ],
      },
      {
        title: 'SEO',
        items: [
          { label: 'Daily Log', to: '/app/marketing/seo', icon: Search, departments: ['MARKETING'] },
          { label: 'Analytics', to: '/app/marketing/seo/analytics', icon: LineChart, departments: ['MARKETING'] },
        ],
      },
      {
        title: 'ADS Campaign',
        items: [
          { label: 'Campaigns', to: '/app/marketing/ads', icon: Megaphone, departments: ['MARKETING'] },
        ],
      },
      {
        title: 'Email Marketing',
        items: [
          { label: 'Email', to: '/app/marketing/email', icon: Mail, departments: ['MARKETING'] },
        ],
      },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users', to: '/app/admin/users', icon: UserCog, roles: ['SUPER_ADMIN'], badge: { text: 'ADMIN', tone: 'danger' } },
      { label: 'Targets', to: '/app/admin/targets', icon: TargetIcon, roles: ADMIN_ROLES },
      { label: 'Tags', to: '/app/admin/tags', icon: Tags, roles: ADMIN_ROLES },
      { label: 'Holidays & Leave', to: '/app/admin/leave', icon: CalendarOff, roles: ADMIN_ROLES },
      { label: 'Office Networks', to: '/app/admin/networks', icon: Wifi, roles: ['SUPER_ADMIN'] },
    ],
  },
]

function itemVisible(item: NavItem, role: Role, department?: Department | null): boolean {
  // Super Admin sees every screen (needed for management demos / full oversight),
  // regardless of department or per-item hideFor opt-outs.
  if (role === 'SUPER_ADMIN') return true
  // Explicit per-item opt-out for non-admin roles.
  if (item.hideFor?.includes(role)) return false
  if (item.roles && !item.roles.includes(role)) return false
  if (item.departments && (!department || !item.departments.includes(department))) return false
  return true
}

/** Returns nav groups filtered for the given user, dropping empty groups + subgroups. */
export function filterNav(role: Role, department?: Department | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => itemVisible(i, role, department)),
    subgroups: g.subgroups
      ?.map((sg) => ({ ...sg, items: sg.items.filter((i) => itemVisible(i, role, department)) }))
      .filter((sg) => sg.items.length > 0),
  })).filter((g) => g.items.length > 0 || (g.subgroups?.length ?? 0) > 0)
}
