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
  Activity,
  Plug,
  ClipboardPen,
  SlidersHorizontal,
  CreditCard,
  type LucideIcon,
} from 'lucide-react'
import type { CurrentUser, Role } from '../../lib/types'
import { canOpen } from '../../lib/access'
import type { BadgeTone } from '../ui/Badge'
import { canViewFinance } from '../../lib/finance'
import { areaBlocked } from '../../lib/areas'
import { flagOn } from '../../lib/flags'
import { inHomeCompany, type Department } from '../../lib/types'
import { blockByKey, blocksOfPath, type BlockGroup } from '../../lib/blocks'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Visible only to people who administer at least one project (and Super Admins). */
  projectAdminOnly?: boolean
  /** Hidden for these roles, even Super Admin (who otherwise sees everything). */
  hideFor?: Role[]
  /** Only for people with the finance power — overrides even Super Admin. */
  financeOnly?: boolean
  /** Only for people with this power (e.g. Company settings), when the switch of the same name is on. */
  power?: string
  /** Hidden while this owner switch (company-wise) is off. */
  flag?: string
  /** Not for 99 Technologies (e.g. Billing: they are never billed). */
  notHome?: boolean
  /** System Health: Super Admins and developers (User.isDeveloper) only. */
  healthOnly?: boolean
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
      { label: 'Connectors', to: '/app/connectors', icon: Plug },
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
    // Phase 1, step 5: a company's own daily form (company-wise switch "daily-report").
    title: 'Daily Report',
    icon: ClipboardList,
    color: '#14B8A6',
    items: [
      { label: 'My Daily Report', to: '/app/daily-report', icon: ClipboardPen, flag: 'daily-report' },
      { label: 'Team Reports', to: '/app/daily-report/team', icon: BarChart3, flag: 'daily-report' },
      { label: 'Report Forms', to: '/app/daily-report/forms', icon: SlidersHorizontal, flag: 'daily-report' },
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
      { label: 'Lead Dialer', to: '/app/itad/dialer', icon: PhoneCall },
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
      { label: 'Financial Reports', to: '/app/admin/financials', icon: DollarSign, financeOnly: true },
      { label: 'Activity Log', to: '/app/admin/activity', icon: History },
      { label: 'Users', to: '/app/admin/users', icon: UserCog, badge: { text: 'ADMIN', tone: 'danger' } },
      { label: 'Targets', to: '/app/admin/targets', icon: TargetIcon },
      { label: 'Tags', to: '/app/admin/tags', icon: Tags },
      { label: 'Holidays & Leave', to: '/app/admin/leave', icon: CalendarOff },
      { label: 'Office Networks', to: '/app/admin/networks', icon: Wifi },
      { label: 'Company Settings', to: '/app/admin/company', icon: Building2, power: 'company.settings', flag: 'company-settings' },
      { label: 'Billing', to: '/app/billing', icon: CreditCard, power: 'company.settings', notHome: true },
      { label: 'System Health', to: '/app/admin/health', icon: Activity, healthOnly: true },
    ],
  },
]

type NavUser = Pick<CurrentUser, 'role' | 'department' | 'subDepartment' | 'email' | 'isDeveloper' | 'permissions' | 'areasOff' | 'company'> & { blocks?: string[] | null }

/** Who sees a menu item comes from lib/access.ts (the same list that guards the pages). */
function itemVisible(item: NavItem, u: NavUser): boolean {
  // System Health is Metriq's own engineering view: 99 Technologies only.
  if (item.healthOnly) return inHomeCompany(u) && (u.role === 'SUPER_ADMIN' || !!u.isDeveloper)
  if (item.flag && !flagOn(item.flag)) return false
  if (item.notHome && inHomeCompany(u)) return false
  // The finance power wins over everything, including Super Admin.
  if (item.financeOnly) return canViewFinance(u)
  if (item.power) return !!u.permissions?.includes(item.power)
  if (areaBlocked(u, item.to)) return false
  // Super Admin sees every screen (management oversight), regardless of per-item opt-outs.
  if (u.role === 'SUPER_ADMIN') return true
  if (item.hideFor?.includes(u.role)) return false
  return canOpen(u, item.to)
}

/** Screens about other people: left out of a personal workspace ("Just me", Phase 1 step 7). */
const TEAM_ONLY = new Set(['/app/team/members', '/app/attendance/team', '/app/admin/users', '/app/admin/targets', '/app/admin/tags', '/app/admin/leave', '/app/admin/activity', '/app/admin/networks', '/app/daily-report/team', '/app/reports/monthly', '/app/projects/dashboard', '/app/feedback'])

/** Returns nav groups filtered for the given user, dropping empty groups + subgroups. */
export function filterNav(u: NavUser): NavGroup[] {
  // Department Studio: the department has its own menu for this person's role.
  if (u.blocks && u.role !== 'SUPER_ADMIN') return blockNav(u, u.blocks)
  if (u.company?.kind === 'PERSONAL') {
    return filterTeamNav(u).map((g) => ({ ...g, items: g.items.filter((i) => !TEAM_ONLY.has(i.to)), subgroups: g.subgroups?.map((sg) => ({ ...sg, items: sg.items.filter((i) => !TEAM_ONLY.has(i.to)) })).filter((sg) => sg.items.length) })).filter((g) => g.items.length || g.subgroups?.length)
  }
  return filterTeamNav(u)
}

/** Sections that belong to one kind of department: shown only when the company has one (Phase 1). */
const GROUP_KINDS: Record<string, string[]> = {
  'Quality Assurance': ['ITAD', 'CSR'], ITAD: ['ITAD'], 'Lead Generation': ['LEAD_GEN'], Ecommerce: ['ECOMMERCE'], Inventory: ['INVENTORY'], Marketing: ['MARKETING'],
}
const hasKindFor = (u: NavUser, title: string | undefined) => !title || !u.company?.departmentKinds || !GROUP_KINDS[title] || GROUP_KINDS[title].some((k) => u.company!.departmentKinds!.includes(k))

/** Screens that belong to some kinds of department (reports of the built-in daily logs, targets, tags). */
const ITEM_KINDS: Record<string, string[]> = {
  '/app/reports': ['ITAD', 'LEAD_GEN'], '/app/analytics': ['ITAD', 'LEAD_GEN'], '/app/reports/monthly': ['ITAD', 'LEAD_GEN'],
  '/app/qa/my': ['ITAD', 'CSR'], '/app/admin/targets': ['ITAD', 'LEAD_GEN', 'MARKETING'], '/app/admin/tags': ['ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE'],
}
const itemHasKind = (u: NavUser, to: string) => !u.company?.departmentKinds || !ITEM_KINDS[to] || ITEM_KINDS[to].some((k) => u.company!.departmentKinds!.includes(k))

function filterTeamNav(u: NavUser): NavGroup[] {
  return filterKinds(u)
    .filter((g) => hasKindFor(u, g.title))
    .map((g) => ({ ...g, items: g.items.filter((i) => itemHasKind(u, i.to)) }))
    .filter((g) => g.items.length || g.subgroups?.length)
}

function filterKinds(u: NavUser): NavGroup[] {
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

// ------------------------------------------------------------------ Department Studio menus

/** Where each block group sits in the classic menu (its heading, icon and color come from there). */
const GROUP_TITLE: Record<BlockGroup, string | undefined> = {
  main: undefined, projects: 'Projects', 'daily-report': 'Daily Report', attendance: 'Attendance', itad: 'ITAD', leadgen: 'Lead Generation', ecommerce: 'Ecommerce', inventory: 'Inventory', marketing: 'Marketing',
}
/** Groups that stay as they were: they follow the person's role, not the department. */
const ROLE_GROUPS = ['Quality Assurance', 'Admin']

const allItems = (g: NavGroup) => [...g.items, ...(g.subgroups ?? []).flatMap((sg) => sg.items)]
/** The menu item a block shows as (same name and icon as the classic menu). */
export function navItemOfBlock(key: string): NavItem | null {
  const b = blockByKey(key)
  if (!b) return null
  const to = b.app[0].replace(/\$$/, '')
  for (const g of NAV_GROUPS) {
    const i = g.items.find((x) => x.to === to)
    if (i) return i
    // Inside a sub-heading (Marketing → SEO → Daily Log): the block's own name says which one.
    for (const sg of g.subgroups ?? []) { const j = sg.items.find((x) => x.to === to); if (j) return { ...j, label: b.label } }
  }
  return null
}
/** The heading, icon and color of a block group, from the classic menu. */
export function navGroupOf(group: BlockGroup): Pick<NavGroup, 'title' | 'icon' | 'color'> {
  const title = GROUP_TITLE[group]
  const g = NAV_GROUPS.find((x) => x.title === title) ?? NAV_GROUPS[0]
  return { title: g.title, icon: g.icon, color: g.color }
}

/** A menu made of the department's blocks, in the order the Super Admin put them, plus the role-based groups. */
export function blockNav(u: NavUser, blocks: string[]): NavGroup[] {
  const out: (NavGroup & { key: BlockGroup })[] = []
  for (const key of blocks) {
    const b = blockByKey(key)
    const item = navItemOfBlock(key)
    if (!b || !item) continue
    if (item.flag && !flagOn(item.flag)) continue
    if (areaBlocked(u, item.to)) continue
    let g = out.find((x) => x.key === b.group)
    if (!g) { g = { key: b.group, ...navGroupOf(b.group), items: [] }; out.push(g) }
    g.items.push({ ...item, hideFor: undefined })
  }
  // The project dashboard stays with Projects for project admins (the Sidebar checks that).
  const pd = NAV_GROUPS.find((g) => g.title === 'Projects')?.items.find((i) => i.projectAdminOnly)
  const proj = out.find((g) => g.key === 'projects')
  if (pd && proj && blocks.includes('projects')) proj.items.push(pd)
  const roleGroups = filterTeamNav(u).filter((g) => g.title && ROLE_GROUPS.includes(g.title))
  return [...out.map(({ key: _k, ...g }) => g), ...roleGroups]
}

/** The classic menu of a kind of department for a role, as blocks (the Studio's starting point). */
export function templateBlocks(kind: Department, role: 'MEMBER' | 'TEAM_LEAD'): string[] {
  const u: NavUser = { role, department: kind, subDepartment: null, email: '', isDeveloper: false, permissions: [], areasOff: [], company: { id: 'template', name: '', kind: 'TEAM', plan: 'business', status: 'ACTIVE', timeZone: 'UTC', departmentKinds: [kind] } }
  const keys: string[] = []
  for (const g of filterTeamNav(u)) for (const i of allItems(g)) {
    const b = blocksOfPath(i.to, 'app').find((x) => x.app.some((a) => a.replace(/\$$/, '') === i.to))
    if (b && !keys.includes(b.key) && (!b.kinds.length || b.kinds.includes(kind)) && !(b.leadOnly && role === 'MEMBER')) keys.push(b.key)
  }
  if (!keys.includes('dashboard')) keys.unshift('dashboard')
  return keys
}
