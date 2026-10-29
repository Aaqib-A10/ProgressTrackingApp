import type { Department as DepartmentType } from './types'

/**
 * THE APP'S COPY of server/src/lib/cards.ts (a test checks the cards match): keep both the same.
 *
 * Department Studio, part B: a department's dashboard is made of cards. The Super Admin picks the
 * cards for its members and for its team leads (Company Settings, Departments, Open studio,
 * Dashboard); each person can then move or hide cards on their own dashboard. A department with
 * no dashboard of its own keeps the one that comes with its kind, exactly as before.
 *
 * The app's copy is client/src/lib/cards.ts (a test checks they match). Rules:
 * - "Team lead" cards (team numbers, who is in) go only on the team lead dashboard.
 * - Team performance cards need a kind with a daily log (not General).
 * - A card of the company's own block ("custom:<id>") counts its records.
 * - Sizes: 1 = a third of the width, 2 = two thirds, 3 = the whole width.
 */

export interface CardDef {
  key: string
  label: string
  description: string
  /** Kinds of department it works for; empty = any. */
  kinds: DepartmentType[]
  leadOnly?: boolean
  size: CardSize
}
export type CardSize = 1 | 2 | 3
export interface DashCard { key: string; size: CardSize }
export interface Dashboard { member: DashCard[]; lead: DashCard[] }

const TEAM_KINDS: DepartmentType[] = ['ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE', 'INVENTORY', 'CSR']

export const CARDS: CardDef[] = [
  { key: 'greeting', label: 'Welcome', description: 'Their name, the date and their role.', kinds: [], size: 3 },
  { key: 'quick-actions', label: 'Quick actions', description: 'Shortcuts to log today, the daily report and their scores.', kinds: [], size: 3 },
  { key: 'shortcuts', label: 'Shortcuts', description: 'A button for every screen in their menu.', kinds: [], size: 3 },
  { key: 'my-tasks', label: 'My tasks', description: 'Project tasks given to them, the ones due soon first.', kinds: [], size: 2 },
  { key: 'todo-today', label: "Today's to-dos", description: 'What they planned and did today in My To-Do.', kinds: [], size: 1 },
  { key: 'checklist', label: 'Quick checklist', description: 'A short private checklist.', kinds: [], size: 1 },
  { key: 'attendance', label: 'My attendance', description: 'Checked in or not, and the hours worked today.', kinds: [], size: 1 },
  { key: 'chat-unread', label: 'New messages', description: 'Chats with messages they have not read yet.', kinds: [], size: 1 },
  { key: 'feedback', label: 'Recent feedback', description: 'Their latest feedback threads.', kinds: [], size: 2 },
  { key: 'employee-of-month', label: 'Top achiever', description: "The month's top achiever in the department.", kinds: [], size: 3 },
  // Team leads
  { key: 'team-today', label: 'Who is in', description: 'Who is in, on a break or not in yet, right now.', kinds: [], leadOnly: true, size: 2 },
  { key: 'team-todo', label: "Team's to-dos today", description: 'What each person planned and did today, and who needs help.', kinds: [], leadOnly: true, size: 3 },
  { key: 'team-kpis', label: 'Team numbers', description: "The team's key numbers against the last period.", kinds: TEAM_KINDS, leadOnly: true, size: 3 },
  { key: 'team-trend', label: 'Trend', description: 'The main number over time, against target.', kinds: TEAM_KINDS, leadOnly: true, size: 2 },
  { key: 'team-breakdown', label: 'Breakdown', description: 'Where the work went, as a donut chart.', kinds: TEAM_KINDS, leadOnly: true, size: 1 },
  { key: 'team-improvement', label: 'Improvement summary', description: 'One line on how the team is moving.', kinds: TEAM_KINDS, leadOnly: true, size: 3 },
  { key: 'team-submissions', label: "Today's submissions", description: 'Who sent their daily log today.', kinds: TEAM_KINDS, leadOnly: true, size: 3 },
]

export const CARD_KEYS = CARDS.map((c) => c.key)
const byKey = new Map(CARDS.map((c) => [c.key, c]))
export const cardByKey = (k: string): CardDef | undefined => byKey.get(k)
export const CUSTOM_CARD = /^custom:[a-z0-9]{8,40}$/

/** Can this card go on this dashboard of a department of this kind? Returns why not, or null. */
export function cardRefusal(c: CardDef, kind: DepartmentType, menu: 'member' | 'lead'): string | null {
  if (c.kinds.length && !c.kinds.includes(kind)) return `${c.label} needs a department with a daily log (not General).`
  if (c.leadOnly && menu === 'member') return `${c.label} is for team leads.`
  return null
}

/** The stored dashboard, if it is a valid one. */
export function readDashboard(stored: unknown): Dashboard | null {
  const x = stored as Partial<Dashboard> | null
  if (!x || !Array.isArray(x.member) || !Array.isArray(x.lead)) return null
  const ok = (c: DashCard) => !!c && typeof c.key === 'string' && (byKey.has(c.key) || CUSTOM_CARD.test(c.key)) && [1, 2, 3].includes(c.size)
  return { member: x.member.filter(ok), lead: x.lead.filter(ok) }
}

/** How a person arranged their own dashboard: the order of the cards, and the ones they hid. */
export interface DashboardPrefs { order: string[]; hidden: string[] }
