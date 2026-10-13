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
  Globe,
  Shield,
  DollarSign,
  PhoneCall,
  History,
  FolderKanban,
  FolderOpen,
  MessagesSquare,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react'
import type { CurrentUser, Role } from '../../lib/types'
import { canOpen } from '../../lib/access'
import type { BadgeTone } from '../ui/Badge'
import { FINANCE_EMAILS } from '../../lib/finance'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Visible only to people who administer at least one project (and Super Admins). */
  projectAdminOnly?: boolean
  /** Hidden for these roles, even Super Admin (who otherwise sees everything). */
  hideFor?: Role[]
  /** Restricted to these exact emails (identity gate) — overrides even Super Admin. */
  requireEmail?: string[]
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
  /** Section-header icon (shown in a tinted square). */
  icon?: LucideIcon
  /** Accent hex color for the section-header icon + tint. */
  color?: string
}

// Member data-entry / per-department operational tabs the Super Admin doesn't use.
// The admin keeps oversight (dashboards, team views, analytics) + admin/config.
const HIDE_FROM_SA: Role[] = ['SUPER_ADMIN']

// Full nav. Filtered per user by filterNav() below.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard },
      { label: 'My Reports', to: '/app/reports', icon: FileBarChart, hideFor: HIDE_FROM_SA },
      { label: 'My Analytics', to: '/app/analytics', icon: LineChart, hideFor: HIDE_FROM_SA },
      { label: 'My Tasks', to: '/app/tasks', icon: ListChecks },
      { label: 'My To-Do', to: '/app/todo', icon: ListTodo },
      { label: 'My Team', to: '/app/team/members', icon: Users, hideFor: HIDE_FROM_SA },
      { label: 'Monthly Reports', to: '/app/reports/monthly', icon: FileBarChart },
      { label: 'My QA Scores', to: '/app/qa/my', icon: ClipboardCheck, hideFor: HIDE_FROM_SA },
      { label: 'Feedback', to: '/app/feedback', icon: MessageSquare },
    ],
  },
  {
    title: 'Projects',
    icon: FolderKanban,
    color: '#6366F1',
    items: [
      { label: 'Projects', to: '/app/projects', icon: KanbanSquare },
      { label: 'Chat', to: '/app/chat', icon: MessagesSquare },
      { label: 'Calendar', to: '/app/calendar', icon: CalendarDays },
      // Shown only to project admins (and Super Admins): the Sidebar checks that.
      { label: 'Projects Dashboard', to: '/app/projects/dashboard', icon: LayoutGrid, projectAdminOnly: true },
    ],
  },
  {
    title: 'Attendance',
    icon: Clock,
    color: '#0EA5E9',
    items: [
      { label: 'My Attendance', to: '/app/attendance/me', icon: Clock },
      { label: 'Team Attendance', to: '/app/attendance/team', icon: Users, badge: { text: 'TL', tone: 'accent' } },
    ],
  },
  {
    title: 'Quality Assurance',
    icon: ClipboardCheck,
    color: '#22C55E',
    items: [
      { label: 'Evaluate', to: '/app/qa/evaluate', icon: ClipboardCheck },
      { label: 'Scorecards', to: '/app/qa/scorecards', icon: ClipboardList },
      { label: 'QA Analytics', to: '/app/qa/analytics', icon: LineChart },
      { label: 'QA Team', to: '/app/qa/evaluators', icon: Users },
    ],
  },
  {
    title: 'ITAD',
    icon: Phone,
    color: '#4F46E5',
    items: [
      { label: 'Daily Log', to: '/app/itad/log', icon: Phone, hideFor: HIDE_FROM_SA },
      { label: 'Deal Tracker', to: '/app/itad/bids', icon: Briefcase, hideFor: HIDE_FROM_SA },
      { label: 'Docs & Links', to: '/app/itad/docs', icon: FolderOpen, hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/itad/team', icon: Users, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Analytics', to: '/app/itad/analytics', icon: LineChart },
    ],
  },
  {
    title: 'Lead Generation',
    icon: TargetIcon,
    color: '#14B8A6',
    items: [
      { label: 'Daily Log', to: '/app/leadgen/log', icon: Phone, hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/leadgen/team', icon: Users, badge: { text: 'TL', tone: 'accent' } },
      { label: 'Monthly Breakdown', to: '/app/leadgen/breakdown', icon: Building2 },
      { label: 'Analytics', to: '/app/leadgen/analytics', icon: LineChart },
    ],
  },
  {
    title: 'Talkloop',
    icon: PhoneCall,
    color: '#0EA5E9',
    items: [
      { label: 'Daily Log', to: '/app/talkloop/log', icon: PhoneCall, hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/talkloop/team', icon: Users, badge: { text: 'TL', tone: 'accent' } },
    ],
  },
  {
    title: 'Ecommerce',
    icon: ShoppingCart,
    color: '#F59E0B',
    items: [
      { label: 'Daily Log', to: '/app/ecommerce/log', icon: ShoppingCart, hideFor: HIDE_FROM_SA },
      { label: 'Task Board', to: '/app/ecommerce/board', icon: KanbanSquare, hideFor: HIDE_FROM_SA },
      { label: 'Stock Tracking', to: '/app/ecommerce/stock', icon: Boxes, hideFor: HIDE_FROM_SA },
      { label: 'Team View', to: '/app/ecommerce/team', icon: Users },
      { label: 'Meeting Notes', to: '/app/ecommerce/notes', icon: StickyNote, hideFor: HIDE_FROM_SA },
      { label: 'RDP Records', to: '/app/ecommerce/rdp', icon: Server, badge: { text: 'TL', tone: 'accent' } },
    ],
  },
  {
    title: 'Inventory',
    icon: Boxes,
    color: '#0891B2',
    items: [
      { label: 'Inventory', to: '/app/inventory', icon: Boxes },
      { label: 'Requests', to: '/app/inventory/requests', icon: ListChecks },
      { label: 'Team', to: '/app/inventory/team', icon: Users, badge: { text: 'TL', tone: 'accent' } },
    ],
  },
  {
    title: 'Marketing',
    icon: Megaphone,
    color: '#8B5CF6',
    items: [
      { label: 'Team', to: '/app/marketing/team', icon: Users },
      { label: 'Analytics', to: '/app/marketing/analytics', icon: LineChart },
      { label: 'Brands', to: '/app/marketing/brands', icon: Building2 },
      { label: 'Profiles & Platforms', to: '/app/marketing/profiles', icon: Globe },
    ],
    subgroups: [
      {
        title: 'Social Media',
        items: [
          { label: 'Social Planner', to: '/app/marketing/planner', icon: CalendarDays },
          { label: 'Social Reports', to: '/app/marketing/social/monthly', icon: BarChart3 },
          { label: 'Social Analytics', to: '/app/marketing/social/analytics', icon: LineChart },
        ],
      },
      {
        title: 'Content',
        items: [
          { label: 'Master Plan', to: '/app/marketing/plan', icon: ListChecks },
          { label: 'Daily Log', to: '/app/marketing/content/log', icon: PenTool },
          { label: 'Blogs', to: '/app/marketing/blogs', icon: PenTool },
          { label: 'Content', to: '/app/marketing/content', icon: KanbanSquare },
        ],
      },
      {
        title: 'SEO',
        items: [
          { label: 'Daily Log', to: '/app/marketing/seo', icon: Search },
        ],
      },
      {
        title: 'ADS Campaign',
        items: [
          { label: 'Campaigns', to: '/app/marketing/ads', icon: Megaphone },
        ],
      },
      {
        title: 'Email Marketing',
        items: [
          { label: 'Email', to: '/app/marketing/email', icon: Mail },
        ],
      },
    ],
  },
  {
    title: 'Admin',
    icon: Shield,
    color: '#EF4444',
    items: [
      { label: 'Financial Reports', to: '/app/admin/financials', icon: DollarSign, requireEmail: FINANCE_EMAILS },
      { label: 'Activity Log', to: '/app/admin/activity', icon: History },
      { label: 'Users', to: '/app/admin/users', icon: UserCog, badge: { text: 'ADMIN', tone: 'danger' } },
      { label: 'Targets', to: '/app/admin/targets', icon: TargetIcon },
      { label: 'Tags', to: '/app/admin/tags', icon: Tags },
      { label: 'Holidays & Leave', to: '/app/admin/leave', icon: CalendarOff },
      { label: 'Office Networks', to: '/app/admin/networks', icon: Wifi },
    ],
  },
]

type NavUser = Pick<CurrentUser, 'role' | 'department' | 'subDepartment' | 'email'>

/** Who sees a menu item comes from lib/access.ts (the same list that guards the pages). */
function itemVisible(item: NavItem, u: NavUser): boolean {
  // Identity gate wins over everything, including Super Admin: only the listed emails see it.
  if (item.requireEmail) {
    return !!u.email && item.requireEmail.map((e) => e.toLowerCase()).includes(u.email.toLowerCase())
  }
  // Super Admin sees every screen (management oversight), regardless of per-item opt-outs.
  if (u.role === 'SUPER_ADMIN') return true
  if (item.hideFor?.includes(u.role)) return false
  return canOpen(u, item.to)
}

/** Returns nav groups filtered for the given user, dropping empty groups + subgroups. */
export function filterNav(u: NavUser): NavGroup[] {
  // Inventory staff see only Inventory and the shared Projects tools (their lead also gets the dashboard).
  if (u.department === 'INVENTORY' && u.role !== 'SUPER_ADMIN') {
    return NAV_GROUPS
      .map((g, i) => (i === 0 ? { ...g, items: u.role === 'TEAM_LEAD' ? g.items.filter((it) => it.to === '/app/dashboard') : [] } : g))
      .filter((g, i) => i === 0 || g.title === 'Inventory' || g.title === 'Projects')
      .map((g) => ({ ...g, items: g.items.filter((i) => itemVisible(i, u)) }))
      .filter((g) => g.items.length > 0)
  }
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => itemVisible(i, u)),
    subgroups: g.subgroups
      ?.map((sg) => ({ ...sg, items: sg.items.filter((i) => itemVisible(i, u)) }))
      .filter((sg) => sg.items.length > 0),
  })).filter((g) => g.items.length > 0 || (g.subgroups?.length ?? 0) > 0)
}
