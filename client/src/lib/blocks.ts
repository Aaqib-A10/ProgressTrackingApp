import type { Department as DepartmentType, Role } from './types'

/**
 * THE APP'S COPY of server/src/lib/blocks.ts (a test checks the blocks match): keep both the same.
 *
 * Department Studio (Phase 2, part A): a department's menu is made of blocks. The Super Admin
 * picks the blocks each department's members and team leads get, in their order, by drag and
 * drop (Company Settings, Departments, Open studio). A department with no layout of its own keeps
 * the menu that comes with its kind, exactly as before (99 Technologies has the Studio switched
 * off, so nothing changes for them).
 *
 * Rules (the same in the app and on the server; the app's copy is client/src/lib/blocks.ts and a
 * test checks they match):
 * - Every block goes in any department: a General "Sales 2" can have the Lead Dialer and the
 *   daily calls log. Its people then work as that kind on those screens; their entries are kept
 *   with their own department and their team lead's team views show their own department.
 *   (The reports of a daily log, My Reports and the like, need a department of that kind.)
 * - "Team lead" blocks (team views, analytics) go only in the team lead menu.
 * - The Dashboard is always there.
 * - Taking a block out hides it and stops new entries in it; nothing is deleted, and putting it
 *   back brings everything back. Reading stays open, so dashboards keep their history.
 * - The Super Admin is not affected (they see every screen), and Admin and QA screens follow
 *   the person's role as before.
 */

export interface Block {
  key: string
  label: string
  /** The menu heading it sits under. */
  group: BlockGroup
  /** Kinds of department it belongs to; empty = an everyday block for any department. */
  kinds: DepartmentType[]
  /** Only in the team lead menu. */
  leadOnly?: boolean
  /** Always in the menu. */
  fixed?: boolean
  description: string
  /** Screens (longest prefix wins; "$" = that one screen). */
  app: string[]
  /** API addresses that save to it: refused (writes only) while it is out of the person's menu. */
  api?: string[]
}

export type BlockGroup = 'main' | 'projects' | 'daily-report' | 'attendance' | 'itad' | 'leadgen' | 'ecommerce' | 'inventory' | 'marketing'

export const BLOCK_GROUPS: { key: BlockGroup; label: string }[] = [
  { key: 'main', label: 'Everyday' },
  { key: 'projects', label: 'Projects' },
  { key: 'daily-report', label: 'Daily Report' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'itad', label: 'Sales calling' },
  { key: 'leadgen', label: 'Lead Generation' },
  { key: 'ecommerce', label: 'E-commerce' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'marketing', label: 'Marketing' },
]

/** How the kinds of department are called in the Studio. */
export const KIND_LABEL: Record<DepartmentType, string> = {
  GENERAL: 'General', ITAD: 'Sales calling', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing', ECOMMERCE: 'E-commerce', INVENTORY: 'Inventory', CSR: 'Customer service', TALKLOOP: 'Talkloop',
}

export const BLOCKS: Block[] = [
  // Everyday
  { key: 'dashboard', label: 'Dashboard', group: 'main', kinds: [], fixed: true, description: 'Their home page.', app: ['/app/dashboard'] },
  { key: 'my-reports', label: 'My Reports', group: 'main', kinds: ['ITAD', 'LEAD_GEN'], description: 'Their daily log numbers by day, week and month.', app: ['/app/reports'] },
  { key: 'my-analytics', label: 'My Analytics', group: 'main', kinds: ['ITAD', 'LEAD_GEN'], description: 'Charts of their own daily log numbers.', app: ['/app/analytics'] },
  { key: 'my-tasks', label: 'My Tasks', group: 'main', kinds: [], description: 'Every project task given to them.', app: ['/app/tasks'] },
  { key: 'my-todo', label: 'My To-Do', group: 'main', kinds: [], description: 'Their plan and done list for each day, week, month and year.', app: ['/app/todo'] },
  { key: 'my-team', label: 'My Team', group: 'main', kinds: [], leadOnly: true, description: 'The people in the team, and inviting new ones.', app: ['/app/team/members', '/app/members'] },
  { key: 'monthly-reports', label: 'Monthly Reports', group: 'main', kinds: ['ITAD', 'LEAD_GEN'], leadOnly: true, description: "The team's month in one report.", app: ['/app/reports/monthly'] },
  { key: 'my-qa', label: 'My QA Scores', group: 'main', kinds: ['ITAD', 'CSR'], description: 'Their call quality scores.', app: ['/app/qa/my'] },
  { key: 'feedback', label: 'Feedback', group: 'main', kinds: [], description: 'Ideas and complaints to management.', app: ['/app/feedback'] },
  { key: 'connectors', label: 'Connectors', group: 'main', kinds: [], description: 'Connect Claude, ChatGPT or Gemini to their Metriq.', app: ['/app/connectors'] },
  // Projects
  { key: 'projects', label: 'Projects', group: 'projects', kinds: [], description: 'Project boards, lists and tasks.', app: ['/app/projects'] },
  { key: 'chat', label: 'Chat', group: 'projects', kinds: [], description: 'Direct messages, groups and project channels.', app: ['/app/chat'] },
  { key: 'calendar', label: 'Calendar', group: 'projects', kinds: [], description: 'Meetings and due dates.', app: ['/app/calendar', '/app/meetings'] },
  // Daily Report
  { key: 'daily-report', label: 'My Daily Report', group: 'daily-report', kinds: [], description: 'The daily form your company designed.', app: ['/app/daily-report'] },
  { key: 'daily-report-team', label: 'Team Reports', group: 'daily-report', kinds: [], leadOnly: true, description: "Who sent theirs, and the team's totals against target.", app: ['/app/daily-report/team'] },
  { key: 'daily-report-forms', label: 'Report Forms', group: 'daily-report', kinds: [], leadOnly: true, description: 'Design the daily form.', app: ['/app/daily-report/forms'] },
  // Attendance
  { key: 'attendance', label: 'My Attendance', group: 'attendance', kinds: [], description: 'Their hours, breaks, leave and overtime.', app: ['/app/attendance/me'] },
  { key: 'attendance-team', label: 'Team Attendance', group: 'attendance', kinds: [], leadOnly: true, description: "Who is in, late or away, and the team's register.", app: ['/app/attendance/team'] },
  // Sales calling (ITAD)
  { key: 'itad-log', label: 'Daily calls log', group: 'itad', kinds: ['ITAD'], description: 'Dials, connects, voicemails and deals each day.', app: ['/app/itad/log'], api: ['/api/itad/entries'] },
  { key: 'itad-dialer', label: 'Lead Dialer', group: 'itad', kinds: ['ITAD'], description: 'Who to call now, follow-ups and the funnel, from your CRM export.', app: ['/app/itad/dialer'], api: ['/api/dialer'] },
  { key: 'itad-bids', label: 'Deal tracker', group: 'itad', kinds: ['ITAD'], description: 'Bids and deals with their value and stage.', app: ['/app/itad/bids'], api: ['/api/itad/bids'] },
  { key: 'itad-docs', label: 'Docs & links', group: 'itad', kinds: ['ITAD'], description: 'Price lists, scripts and documents the team shares.', app: ['/app/itad/docs'], api: ['/api/docs'] },
  { key: 'itad-team', label: 'Team view', group: 'itad', kinds: ['ITAD'], leadOnly: true, description: "The team's calls against target.", app: ['/app/itad/team'] },
  { key: 'itad-analytics', label: 'Analytics', group: 'itad', kinds: ['ITAD'], leadOnly: true, description: 'Trends over three months.', app: ['/app/itad/analytics'] },
  // Lead Generation
  { key: 'leadgen-log', label: 'Daily leads log', group: 'leadgen', kinds: ['LEAD_GEN'], description: 'Leads found each day by industry, MQL and SQL.', app: ['/app/leadgen/log'], api: ['/api/leadgen/entries', '/api/leadgen/verticals'] },
  { key: 'leadgen-team', label: 'Team view', group: 'leadgen', kinds: ['LEAD_GEN'], leadOnly: true, description: "The team's leads against target.", app: ['/app/leadgen/team'] },
  { key: 'leadgen-breakdown', label: 'Monthly breakdown', group: 'leadgen', kinds: ['LEAD_GEN'], leadOnly: true, description: 'Leads per category for each month.', app: ['/app/leadgen/breakdown'], api: ['/api/leadgen/breakdown'] },
  { key: 'leadgen-analytics', label: 'Analytics', group: 'leadgen', kinds: ['LEAD_GEN'], leadOnly: true, description: 'The lead funnel over time.', app: ['/app/leadgen/analytics'] },
  // E-commerce
  { key: 'ecom-log', label: 'Daily log', group: 'ecommerce', kinds: ['ECOMMERCE'], description: 'Listings and orders handled each day.', app: ['/app/ecommerce/log'], api: ['/api/ecommerce/entries'] },
  { key: 'ecom-board', label: 'Task board', group: 'ecommerce', kinds: ['ECOMMERCE'], description: 'Listing and store tasks on a board.', app: ['/app/ecommerce/board'], api: ['/api/ecommerce/tasks', '/api/ecommerce/board'] },
  { key: 'ecom-stock', label: 'Stock tracking', group: 'ecommerce', kinds: ['ECOMMERCE'], description: 'Stock problems to fix, with who has them.', app: ['/app/ecommerce/stock'], api: ['/api/ecommerce/stock'] },
  { key: 'ecom-team', label: 'Team view', group: 'ecommerce', kinds: ['ECOMMERCE'], description: "The team's numbers.", app: ['/app/ecommerce/team'] },
  { key: 'ecom-notes', label: 'Meeting notes', group: 'ecommerce', kinds: ['ECOMMERCE'], description: 'Notes and decisions from team meetings.', app: ['/app/ecommerce/notes'], api: ['/api/ecommerce/meeting-notes'] },
  { key: 'ecom-rdp', label: 'Remote desktops', group: 'ecommerce', kinds: ['ECOMMERCE'], leadOnly: true, description: 'Which remote desktop each person uses.', app: ['/app/ecommerce/rdp'], api: ['/api/rdp'] },
  // Inventory
  { key: 'inv-items', label: 'Stock list', group: 'inventory', kinds: ['INVENTORY'], description: 'Every item, where it is and how many.', app: ['/app/inventory$'], api: ['/api/inventory/items'] },
  { key: 'inv-requests', label: 'Requests', group: 'inventory', kinds: ['INVENTORY'], description: 'People ask for items; the team hands them out.', app: ['/app/inventory/requests'], api: ['/api/inventory/movements', '/api/inventory/requests'] },
  { key: 'inv-team', label: 'Team', group: 'inventory', kinds: ['INVENTORY'], leadOnly: true, description: 'Who has what.', app: ['/app/inventory/team'] },
  // Marketing
  { key: 'mkt-team', label: 'Team', group: 'marketing', kinds: ['MARKETING'], leadOnly: true, description: "The team's work by discipline.", app: ['/app/marketing/team'] },
  { key: 'mkt-analytics', label: 'Analytics', group: 'marketing', kinds: ['MARKETING'], leadOnly: true, description: 'Marketing numbers over time.', app: ['/app/marketing/analytics'] },
  { key: 'mkt-brands', label: 'Brands', group: 'marketing', kinds: ['MARKETING'], leadOnly: true, description: 'Your brands.', app: ['/app/marketing/brands'], api: ['/api/marketing/brands'] },
  { key: 'mkt-profiles', label: 'Profiles & Platforms', group: 'marketing', kinds: ['MARKETING'], leadOnly: true, description: 'Social profiles and business suites.', app: ['/app/marketing/profiles'], api: ['/api/marketing/profiles', '/api/marketing/business-suites'] },
  { key: 'mkt-planner', label: 'Social Planner', group: 'marketing', kinds: ['MARKETING'], description: 'Plan social posts.', app: ['/app/marketing/planner'], api: ['/api/marketing/social'] },
  { key: 'mkt-social-monthly', label: 'Social Reports', group: 'marketing', kinds: ['MARKETING'], description: 'Monthly social media reports.', app: ['/app/marketing/social/monthly'], api: ['/api/marketing/social'] },
  { key: 'mkt-social-analytics', label: 'Social Analytics', group: 'marketing', kinds: ['MARKETING'], description: 'Social media numbers over time.', app: ['/app/marketing/social/analytics'] },
  { key: 'mkt-plan', label: 'Master Plan', group: 'marketing', kinds: ['MARKETING'], description: 'The content master plan.', app: ['/app/marketing/plan'], api: ['/api/marketing/plan'] },
  { key: 'mkt-content-log', label: 'Content daily log', group: 'marketing', kinds: ['MARKETING'], description: 'Content made each day.', app: ['/app/marketing/content/log'], api: ['/api/marketing/content'] },
  { key: 'mkt-blogs', label: 'Blogs', group: 'marketing', kinds: ['MARKETING'], description: 'Blog posts and their status.', app: ['/app/marketing/blogs'], api: ['/api/marketing/blogs'] },
  { key: 'mkt-content', label: 'Content board', group: 'marketing', kinds: ['MARKETING'], description: 'Content pieces on a board.', app: ['/app/marketing/content'], api: ['/api/marketing/content'] },
  { key: 'mkt-seo', label: 'SEO daily log', group: 'marketing', kinds: ['MARKETING'], description: 'SEO work each day and search terms.', app: ['/app/marketing/seo'], api: ['/api/marketing/seo', '/api/marketing/search-terms'] },
  { key: 'mkt-ads', label: 'Ads campaigns', group: 'marketing', kinds: ['MARKETING'], description: 'Paid campaigns, spend and results.', app: ['/app/marketing/ads'], api: ['/api/marketing/ads'] },
  { key: 'mkt-email', label: 'Email marketing', group: 'marketing', kinds: ['MARKETING'], description: 'Email campaigns and their numbers.', app: ['/app/marketing/email'], api: ['/api/marketing/email'] },
]

export const BLOCK_KEYS = BLOCKS.map((b) => b.key)
/** A block the company made itself (part C): "custom:<its id>". */
export const CUSTOM_BLOCK = /^custom:[a-z0-9]{8,40}$/
const byKey = new Map(BLOCKS.map((b) => [b.key, b]))
export const blockByKey = (key: string): Block | undefined => byKey.get(key)

export interface Layout { member: string[]; lead: string[] }

/** Which of a department's two menus a role uses. */
export const menuOf = (role: Role): 'member' | 'lead' => (role === 'TEAM_LEAD' || role === 'SUB_DEPT_LEAD' ? 'lead' : 'member')

/** Can this block go in this menu of a department of this kind? Returns why not, or null. */
export function blockRefusal(b: Block, kind: DepartmentType, menu: 'member' | 'lead'): string | null {
  // Team screens go in any department (it works as that kind on them, with its own entries);
  // the everyday report screens need the daily log of their own kind.
  if (b.group === 'main' && b.kinds.length && !b.kinds.includes(kind)) return `${b.label} comes with a ${b.kinds.map((k) => KIND_LABEL[k]).join(' or ')} department.`
  if (b.leadOnly && menu === 'member') return `${b.label} is for team leads.`
  return null
}

/** The stored layout, if it is a valid one (old or broken data counts as none). */
export function readLayout(stored: unknown): Layout | null {
  const x = stored as Partial<Layout> | null
  if (!x || !Array.isArray(x.member) || !Array.isArray(x.lead)) return null
  const ok = (k: string) => byKey.has(k) || CUSTOM_BLOCK.test(k)
  return { member: x.member.filter(ok), lead: x.lead.filter(ok) }
}

/** The block an address belongs to (longest prefix wins). For the API, every block owning that prefix. */
export function blocksOfPath(pathname: string, where: 'app' | 'api'): Block[] {
  const p = pathname.split('?')[0].replace(/\/+$/, '')
  let best = -1
  let hits: Block[] = []
  for (const b of BLOCKS) for (const prefix of where === 'app' ? b.app : b.api ?? []) {
    const exact = prefix.endsWith('$')
    const base = exact ? prefix.slice(0, -1) : prefix
    const hit = exact ? p === base : p === base || p.startsWith(base + '/')
    if (!hit) continue
    if (base.length > best) { best = base.length; hits = [b] } else if (base.length === best && !hits.includes(b)) hits.push(b)
  }
  return hits
}
