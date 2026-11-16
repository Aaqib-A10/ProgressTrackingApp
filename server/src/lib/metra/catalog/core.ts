import type { Asker } from '../access'
import { STATUSES as DIALER_STATUSES } from '../../dialer/rules'
import type { Entry } from './types'

/**
 * The areas Metra already knew before the catalog, moved here as they were: each keeps its own guide line and its own
 * reader (deal_tracker, dialer_*, list_my_tickets, todo_list, metriq_read). The wording of every line was earned from
 * a wrong answer on the live site and is kept word for word. Phase 2 of docs/metra/ROADMAP.md gives the ones that still
 * read a raw screen (metriq_read) a counted table like E-commerce and Inventory have.
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const lead = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD'
const has = (k: string) => (a: Asker) => sa(a) || a.kinds.includes(k as never)
const read = (p: string) => `metriq_read ${p}`
const everyone = () => true
const line = (who: (a: Asker) => boolean, text: (a: Asker) => string) => (a: Asker) => (who(a) ? text(a) : null)

type Core = Omit<Entry, 'about' | 'says' | 'who' | 'area'> & { who?: (a: Asker) => boolean; area?: string; about?: string; says?: string[] }
const core = (e: Core): Entry => ({ area: 'Metriq', about: e.label, says: [], who: everyone, pin: e.who ?? everyone, ...e } as Entry)

/** Personal screens: first in the guide. */
export const CORE_PERSONAL: Entry[] = [
  core({
    key: 'tasks.mine', label: 'My Tasks', app: '/app/tasks', blocks: ['my-tasks'], apis: ['/api/tasks/mine', '/api/projects/me/tasks'], models: ['PmTask', 'PmTaskAssignee'],
    // "My task(s)" is the My Tasks screen. It was missing by that name (only "project tickets"), and the one line with
    // the word "tasks" was the marketing team's board: live, 14 Nov, "my task" was answered with that board.
    guide: () => `MY TASKS ("my task", "my tasks", "tasks assigned to me", "what do I have to do on my tasks"; a task and a ticket are the same thing) = the My Tasks screen → ${read('/api/tasks/mine')}: every open task given to me (project tasks, and my own Marketing and E-commerce tasks) with its status and due date, and how many are open, due today, overdue and finished. For more about my project tasks (priority, who gave it, the tasks I gave to others with scope "created", finished ones) → list_my_tickets. Never answer "my tasks" from a team board: a board holds everybody's work.`,
  }),
  core({
    key: 'todo.mine', label: 'My To-Do', app: '/app/todo', blocks: ['my-todo'], apis: ['/api/worklog', '/api/todos'], models: ['WorkLogEntry', 'WorkLogNote', 'TodoItem'],
    guide: () => 'My to-dos (the My To-Do screen: my own daily list, a different screen from My Tasks) → todo_list.',
  }),
]

/** Everything else the old guide held, in its old order. */
export const CORE_WORK: Entry[] = [
  core({
    key: 'projects.tickets', label: 'Projects', app: '/app/projects', blocks: ['projects'], apis: ['/api/projects'], models: ['PmProject', 'PmTask', 'PmColumn', 'PmComment', 'PmProjectMember'],
    guide: () => 'Project tickets in general, overdue tickets, who has which ticket → FIRST list_projects (real project keys with open and overdue counts; never guess a key), then list_project_tickets for the projects that matter (for overdue pass overdue: true and no status or assignee).',
  }),
  core({
    key: 'dashboard.company', label: 'Executive dashboard', app: '/app/dashboard', who: sa, blocks: ['dashboard'], apis: ['/api/dashboard/executive'], models: [],
    guide: line(sa, () => `Whole company at a glance → ${read('/api/dashboard/executive?range=month')}.`),
  }),
  core({
    key: 'itad.deals', label: 'Deal tracker', app: '/app/itad/bids', who: has('ITAD'), blocks: ['itad-bids'], apis: ['/api/itad/bids'], models: ['Bid'],
    guide: line(has('ITAD'), () => 'Bids, deals, RFQs, RFPs, POs, won/lost, win rate, overdue bids → deal_tracker.'),
  }),
  core({
    key: 'itad.dialer', label: 'Lead Dialer', app: '/app/itad/dialer', who: has('ITAD'), blocks: ['itad-dialer'], apis: ['/api/dialer/data'], models: ['DialerLead', 'DialerNote', 'DialerAction', 'DialerStatusChange'],
    guide: line(has('ITAD'), () => 'Lead Dialer leads, follow-ups, who to call → dialer_summary (the funnel: how many leads in each status), dialer_leads (the leads themselves; pass status with the exact status name; for several statuses make one call per status, all in the same round).'),
  }),
  core({
    key: 'itad.dialer_statuses', label: 'Lead Dialer statuses', who: has('ITAD'), blocks: [], apis: [], models: [],
    guide: line(has('ITAD'), () => `Lead Dialer statuses are exactly: ${DIALER_STATUSES.join(', ')}. There is no "Won", "Lost" or "Closed" status there: won, lost and closed clients or deals are in the Deal Tracker → deal_tracker with status won / lost. So "my interested and won leads" = dialer_leads status Interested AND deal_tracker status won, both in the same round; answer with two separate lists (Interested leads, then Won deals) and say so when one of them is empty.`),
  }),
  core({
    key: 'daily_report.forms', label: 'Daily Report', app: '/app/daily-report', blocks: ['daily-report', 'daily-report-team', 'daily-report-forms'], apis: ['/api/daily-report/forms'], models: ['ReportForm', 'ReportField', 'ReportEntry'],
    guide: (a) => `Daily Report (the form a person fills in each day) → ${read('/api/daily-report/forms')} for the forms, then ${read('/api/daily-report/forms/FORM_ID/entry?date=YYYY-MM-DD')} for what I sent that day${lead(a) ? `, or ${read('/api/daily-report/forms/FORM_ID/team?date=YYYY-MM-DD')} for the team` : ''}.`,
  }),
]

/** Closes the guide: how periods are passed to metriq_read. */
export const RANGES_LINE = 'Ranges: today, week, month, rolling3m, or range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD (a year, a quarter or last month is custom with its two dates).'
