/**
 * The screens of Metriq that are not in the Department Studio menu (lib/blocks.ts): Lead Management, Quality
 * Assurance, the admin screens and a person's own pages. Metra learns them here, so it can say where something is and
 * what the page a person is looking at is for. `npm run metra:coverage` fails when the web app has a screen that is
 * neither in lib/blocks.ts nor here.
 *
 * `app`: the screen's address; a longer address wins over a shorter one, so "/app/leads" also stands for one lead's page.
 */

export interface Screen {
  key: string
  label: string
  /** The menu heading it sits under. */
  menu: string
  description: string
  /** Who has it, in words. */
  who: string
  app: string[]
}

const LEADS = 'people who work a lead business (the Lead Management switch must be on for the company)'
const CMR = 'people who work a business with the review flow (the CMR switch must be on)'
const QA = 'the Quality Assurance team'

export const MORE_SCREENS: Screen[] = [
  // Lead Management
  { key: 'leads-dashboard', label: 'Lead Dashboard', menu: 'Lead Management', who: LEADS, app: ['/app/leads/dashboard'], description: 'The cards of Lead Management: leads that came in, unassigned and overdue leads, calls, and follow-up tasks due.' },
  { key: 'leads-list', label: 'Leads', menu: 'Lead Management', who: LEADS, app: ['/app/leads'], description: 'Every lead of the businesses they work: search, filter by stage or person, and open a lead for its details, calls, tasks and comments.' },
  { key: 'leads-board', label: 'Deal Board', menu: 'Lead Management', who: `${LEADS}; the Deal Board switch must be on too`, app: ['/app/leads/board'], description: 'The leads of one business as deals on a board, one column per stage, with what each stage is worth.' },
  { key: 'leads-contacts', label: 'Contacts', menu: 'Lead Management', who: `${LEADS}; the Deal Board switch must be on too`, app: ['/app/leads/contacts'], description: 'The people behind the leads: name, role, company, email and phone.' },
  { key: 'leads-tasks', label: 'Agent Tasks', menu: 'Lead Management', who: LEADS, app: ['/app/leads/tasks'], description: 'Follow-up tasks on leads: due today, overdue, upcoming and done.' },
  { key: 'leads-calls', label: 'Calls', menu: 'Lead Management', who: LEADS, app: ['/app/leads/calls'], description: 'The calls logged on leads, and calls to numbers that are not a lead yet.' },
  { key: 'leads-queue', label: 'Jesse Queue', menu: 'Lead Management', who: CMR, app: ['/app/leads/queue'], description: 'Qualified leads waiting for the head of the business to decide, with his decisions and comments.' },
  { key: 'leads-inbox', label: 'Jesse Inbox', menu: 'Lead Management', who: `the head of the business and its managers (${CMR})`, app: ['/app/leads/inbox'], description: "The head's own desk: what the reps sent him, answered by chat." },
  { key: 'leads-report', label: 'Daily Report (leads)', menu: 'Lead Management', who: CMR, app: ['/app/leads/report'], description: 'Dials, connected calls, voicemails, emails and interested leads of a day, counted from the calls.' },
  { key: 'leads-summary', label: 'Jesse Summary', menu: 'Lead Management', who: `managers (${CMR})`, app: ['/app/leads/summary'], description: 'The key numbers of the business, leads per stage, calls per rep and per segment.' },
  { key: 'leads-settings', label: 'Lead Settings', menu: 'Lead Management', who: 'the Super Admin', app: ['/app/leads/settings'], description: 'The businesses leads come in for, their people, stages, forms, inbox and phone system.' },
  // Quality Assurance
  { key: 'qa-evaluate', label: 'Evaluate', menu: 'Quality Assurance', who: QA, app: ['/app/qa/evaluate'], description: 'Score a call of an agent against a scorecard.' },
  { key: 'qa-evaluations', label: 'Evaluations', menu: 'Quality Assurance', who: `${QA} and team leads; an agent sees their own under My QA Scores`, app: ['/app/qa/evaluations'], description: 'Every evaluation, newest first; open one for its questions, scores and comments.' },
  { key: 'qa-scorecards', label: 'Scorecards', menu: 'Quality Assurance', who: QA, app: ['/app/qa/scorecards'], description: 'The scorecards calls are scored with: their categories, questions and pass mark.' },
  { key: 'qa-analytics', label: 'QA Analytics', menu: 'Quality Assurance', who: `${QA} and team leads`, app: ['/app/qa/analytics'], description: 'Scores by team and by agent over time, the pass rate and who needs coaching.' },
  { key: 'qa-evaluators', label: 'QA Team', menu: 'Quality Assurance', who: 'the QA lead and the Super Admin', app: ['/app/qa/evaluators'], description: 'The evaluators and how many evaluations each has done.' },
  // Admin
  { key: 'admin-users', label: 'Users', menu: 'Admin', who: 'the Super Admin', app: ['/app/admin/users'], description: 'Add people, set their role and team, approve team leads and switch accounts off.' },
  { key: 'admin-targets', label: 'Targets', menu: 'Admin', who: 'team leads and the Super Admin', app: ['/app/admin/targets'], description: "Each team's daily, weekly and monthly targets." },
  { key: 'admin-tags', label: 'Tags', menu: 'Admin', who: 'team leads and the Super Admin', app: ['/app/admin/tags'], description: 'The lists teams pick from when they log work: marketplaces, kinds of work, lead types and industries.' },
  { key: 'admin-leave', label: 'Holidays & Leave', menu: 'Admin', who: 'team leads and the Super Admin', app: ['/app/admin/leave'], description: "Company holidays and each person's leave days." },
  { key: 'admin-networks', label: 'Office Networks', menu: 'Admin', who: 'the Super Admin', app: ['/app/admin/networks'], description: 'The office networks people may check in from.' },
  { key: 'admin-company', label: 'Company Settings', menu: 'Admin', who: 'people with the company settings power', app: ['/app/admin/company'], description: "The company's name and time zone, its departments, roles, and what each department has in its menu." },
  { key: 'admin-financials', label: 'Financial Reports', menu: 'Admin', who: 'people with the finance power', app: ['/app/admin/financials'], description: 'Money in and out by month. Metra does not read this screen.' },
  { key: 'admin-activity', label: 'Activity Log', menu: 'Admin', who: 'the Super Admin', app: ['/app/admin/activity'], description: 'Who signed in and what was changed. Metra does not read this screen.' },
  { key: 'admin-health', label: 'System Health', menu: 'Admin', who: 'the developers', app: ['/app/admin/health'], description: 'Errors and checks of the software itself. Metra does not read this screen.' },
  { key: 'billing', label: 'Billing', menu: 'Admin', who: 'people with the company settings power', app: ['/app/billing'], description: "The company's plan, invoices and payment. Metra does not read this screen." },
  { key: 'setup', label: 'Setup', menu: 'Admin', who: 'people with the company settings power', app: ['/app/setup'], description: 'The first steps of setting a company up.' },
  // A person's own pages
  { key: 'notifications', label: 'Notifications', menu: 'Everyday', who: 'everyone', app: ['/app/notifications'], description: 'Everything Metriq told them, newest first, read and unread.' },
  { key: 'settings', label: 'Settings', menu: 'Everyday', who: 'everyone', app: ['/app/settings', '/app/profile'], description: 'Their own account: profile, password and which notifications they get.' },
  { key: 'help', label: 'Help', menu: 'Everyday', who: 'everyone', app: ['/app/help'], description: 'How Metriq works, and how to reach support.' },
  { key: 'metra', label: 'Metra', menu: 'Everyday', who: 'everyone (the Metra switch must be on)', app: ['/app/metra'], description: "The assistant's own page: their chats with it and what it remembers about them." },
  { key: 'not-submitted', label: 'Not submitted', menu: 'Everyday', who: 'team leads and the Super Admin', app: ['/app/team/not-submitted'], description: "Who has not sent today's daily log yet." },
  { key: 'member-profile', label: "A person's profile", menu: 'Everyday', who: 'team leads (their own team) and the Super Admin', app: ['/app/members'], description: "One person's page: their daily numbers for a period, against the period before, and each day's log." },
  { key: 'custom-block', label: 'A custom block', menu: 'The department\'s own menu', who: 'the departments it was added to', app: ['/app/custom'], description: 'A screen the company built for itself in Department Studio.' },
]

/** Addresses of the web app that only send the person on to another screen, or are not a screen of their own. */
export const NOT_A_SCREEN: Record<string, string> = {
  '/app/marketing/board': 'sends the person on to the content or social board',
  '/app/marketing/social': 'sends the person on to Monthly social reports',
  '/app/marketing/calendar': 'sends the person on to the Planner',
  '/app/billing/test-checkout': 'a test payment page for the people who set billing up',
}
