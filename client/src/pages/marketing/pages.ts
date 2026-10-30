/**
 * The Product and Solutions pages. Same rules as content.ts: every feature named here is in
 * Metriq today; no invented customers, quotes or numbers.
 */

export type FeatureKey = 'attendance' | 'projects' | 'chat' | 'reports' | 'sales'
export type Hue = { a: string; b: string }

export interface Feature {
  key: FeatureKey
  slug: string
  name: string
  menu: string
  title: string
  /** The part of the title shown in the feature's colours. */
  accent: string
  lead: string
  image: string
  darkImage?: string
  hue: Hue
  highlights: { title: string; text: string }[]
  steps: { title: string; text: string }[]
  faqs: { q: string; a: string }[]
}

export const FEATURES: Feature[] = [
  {
    key: 'attendance', slug: 'attendance', name: 'Attendance', menu: 'Check-in, breaks, overtime and leave',
    title: "Know who's in. No fingerprint machine.",
    accent: 'No fingerprint machine.',
    lead: 'People check in from the browser or their phone. Metriq keeps the hours, breaks, late starts, leave and overtime, and team leads see the whole day and the whole month.',
    image: 'app-attendance.webp', hue: { a: '16 185 129', b: '6 182 212' },
    highlights: [
      { title: 'Check in from anywhere you allow', text: 'From the browser or a phone. Limit check-in to your office network if you want people at their desks.' },
      { title: 'Breaks with limits', text: 'Lunch, prayer and short breaks, each with its own limit. Leads see who is over, as it happens.' },
      { title: 'Overtime that counts', text: 'Someone stays on: overtime starts with one tap, even after the shift has closed itself.' },
      { title: 'Automatic check-out', text: 'Forgot to check out? The day closes itself after the shift, and the hours stay right.' },
      { title: 'Leave and work from home', text: 'Requests go to the right lead and land on the register once decided.' },
      { title: 'The month in one table', text: 'Days, hours, late starts and leave per person, by day or by month, ready to export.' },
    ],
    steps: [
      { title: 'Set the shift', text: 'Start and end time, breaks and their limits, and the days your people work.' },
      { title: 'People check in', text: 'One tap in the browser or on the phone; the day starts counting.' },
      { title: 'Leads see the picture', text: 'Who is in, on a break, late or on leave, now and for the month.' },
    ],
    faqs: [
      { q: 'Do we need any hardware?', a: 'No. Attendance works in the browser and on phones. If you want check-in only at the office, Metriq checks the office network.' },
      { q: 'Whose clock does it use?', a: 'Your company’s time zone. Days, shifts and reports follow it, wherever your people are.' },
    ],
  },
  {
    key: 'projects', slug: 'projects', name: 'Projects', menu: 'Boards, owners, due dates and reviews',
    title: 'Every task gets an owner and a date',
    accent: 'an owner and a date',
    lead: 'Projects with boards and lists, assignees, priorities, checklists and reviews. Overdue work is flagged before it slips, not after.',
    image: 'app-board.webp', darkImage: 'app-board-dark.webp', hue: { a: '99 102 241', b: '168 85 247' },
    highlights: [
      { title: 'Boards and lists', text: 'Drag tasks from Backlog to Done, or work through a list. Same tasks, the view you like.' },
      { title: 'One owner, one date', text: 'Every task has someone on it and a due date, with reminders before it is late.' },
      { title: 'Reviews', text: 'The person who asked signs the work off, so “done” means done.' },
      { title: 'Checklists and priorities', text: 'Break a task into steps and mark what is urgent.' },
      { title: 'More time, asked for properly', text: 'Need longer? Ask for a new date; the project lead decides.' },
      { title: 'A chat next to every board', text: 'Talk about the project where the work is, not in another app.' },
    ],
    steps: [
      { title: 'Make a project', text: 'Name it, add the people and the columns your team works in.' },
      { title: 'Add the work', text: 'Tasks with owners, dates and priorities, from the board or from chat.' },
      { title: 'Watch it move', text: 'Overdue work is flagged; reviews close the loop.' },
    ],
    faqs: [
      { q: 'Can we bring tasks from a spreadsheet?', a: 'Add them on the board, or turn a message in chat into a task in one click.' },
      { q: 'Who sees a project?', a: 'Its members, and the people your roles and permissions allow.' },
    ],
  },
  {
    key: 'chat', slug: 'chat', name: 'Chat and calls', menu: 'Groups, calls, meetings with AI notes',
    title: 'Chat and calls that stay with the work',
    accent: 'stay with the work',
    lead: 'Groups, direct messages, voice and video calls and meetings, in the same app as the tasks, so a decision in chat becomes a task in one click.',
    image: 'app-chat.webp', hue: { a: '14 165 233', b: '99 102 241' },
    highlights: [
      { title: 'Groups and direct messages', text: 'One place for the team’s talk, with a project chat beside every board.' },
      { title: 'Voice and video calls', text: 'Call from any conversation; no separate meeting app.' },
      { title: 'Meetings on a calendar', text: 'Plan them, get a reminder, and join from Metriq.' },
      { title: 'AI meeting notes', text: 'Record a meeting and get the notes and action items written for you.' },
      { title: 'Guests by link', text: 'A customer or supplier joins a call from a link, no account needed.' },
      { title: 'Tasks that link themselves', text: 'Mention a task and it links; turn a message into a task in one click.' },
    ],
    steps: [
      { title: 'Start the groups', text: 'Every project has its chat; add groups and direct messages as you need.' },
      { title: 'Talk and call', text: 'Messages, voice and video, from the browser or a phone.' },
      { title: 'Decisions become tasks', text: 'One click from a message to a task with an owner and a date.' },
    ],
    faqs: [
      { q: 'Can we leave WhatsApp groups?', a: 'That is the idea: the team’s chat and calls sit with the work, in an app the company controls.' },
      { q: 'Do guests need an account?', a: 'No. They join a call from a link you send.' },
    ],
  },
  {
    key: 'reports', slug: 'daily-reports', name: 'Daily reports', menu: 'A form your team fills in under a minute',
    title: 'The daily report, done in under a minute',
    accent: 'under a minute',
    lead: 'Design the form yourself: numbers with targets, text, choices and ratings. Leads see who sent theirs, the totals against target, and how the team moves over the month.',
    image: 'app-daily.webp', hue: { a: '245 158 11', b: '239 68 68' },
    highlights: [
      { title: 'A form you design', text: 'Numbers, text, choices and ratings, from a template or from scratch.' },
      { title: 'One per department', text: 'Sales counts calls; operations counts orders. Each team its own form.' },
      { title: 'Targets that colour themselves', text: 'Numbers turn green or red against the target you set.' },
      { title: 'Who sent theirs', text: 'Leads see at a glance who has sent today’s report and who has not.' },
      { title: 'The month in one table', text: 'Every day of the month, per person, with the totals, ready to send.' },
      { title: 'A monthly email', text: 'The month’s report lands in the inbox at the start of the next one.' },
    ],
    steps: [
      { title: 'Pick a template', text: 'Start from a ready form for your kind of team and change what you like.' },
      { title: 'People fill it in', text: 'Under a minute at the end of the day, on any device.' },
      { title: 'Leads read it', text: 'Totals against target, who sent theirs, and the month’s trend.' },
    ],
    faqs: [
      { q: 'Can different teams have different forms?', a: 'Yes. One form for everyone, or one per department.' },
      { q: 'Can we change the form later?', a: 'Any time, from the daily report settings.' },
    ],
  },
  {
    key: 'sales', slug: 'lead-dialer', name: 'Lead Dialer', menu: 'Who to call now, follow-ups and tasks',
    title: 'Call the right lead at the right time',
    accent: 'at the right time',
    lead: 'For calling teams: import your CRM list and the Lead Dialer shows who is open right now by time zone, who needs a follow-up, and how the funnel is moving.',
    image: 'app-dialer.webp', darkImage: 'app-dialer-dark.webp', hue: { a: '139 92 246', b: '236 72 153' },
    highlights: [
      { title: 'Who can I call right now', text: 'Leads by time zone and prime time, so every dial lands in calling hours.' },
      { title: 'Follow-ups with tasks', text: 'Leads quiet past their rule become tasks, with reminders in the app.' },
      { title: 'One-tap outcomes', text: 'No answer, voicemail, gatekeeper, connected or wrong number: one tap logs the try.' },
      { title: 'Tries you can see', text: 'Each import shows status changes and re-attempts, so you know how hard a lead was worked.' },
      { title: 'Funnel and industries', text: 'Attempted, connected and positive, by state, region and industry.' },
      { title: 'Works with your CRM', text: 'Import your CRM’s export; your CRM stays the record. A predictive dialer can send its calls in too.' },
    ],
    steps: [
      { title: 'Import your leads', text: 'Export from your CRM and import the file; columns are matched for you.' },
      { title: 'Call who is open', text: 'The list picks who is inside calling hours now, best first.' },
      { title: 'Follow up on time', text: 'Tasks and reminders for the leads that went quiet.' },
    ],
    faqs: [
      { q: 'Does it replace our CRM?', a: 'No. Your CRM stays the record; Metriq reads its export and helps the team decide who to call.' },
      { q: 'Does it dial for us?', a: 'Reps dial from their phone or dialer. Metriq copies the number and keeps the follow-ups; a predictive dialer can report its calls back.' },
    ],
  },
]
export const featureBySlug = (slug?: string) => FEATURES.find((f) => f.slug === slug)

/** More of Metriq, on the Product page. */
export const EXTRAS = [
  { key: 'studio', title: 'Department Studio', text: 'Each department’s menu and dashboard, by drag and drop, for members and team leads apart.' },
  { key: 'roles', title: 'Roles and permissions', text: 'Members see their work, leads their team, admins the company. You decide who sees finance.' },
  { key: 'ai', title: 'Works with your AI', text: 'Connect Claude and ask about tasks, leads and reports in plain words.' },
  { key: 'mobile', title: 'On the phone', text: 'Works in any phone browser today, check-in included. Apps are on the way.' },
] as const

export interface Solution {
  key: string
  slug: string
  name: string
  menu: string
  image: string
  title: string
  lead: string
  hue: Hue
  fixes: { before: string; after: string }[]
  features: FeatureKey[]
  day: { time: string; text: string }[]
}

export const SOLUTIONS: Solution[] = [
  {
    key: 'sales', slug: 'sales-teams', name: 'Sales and call centres', menu: 'Calls, follow-ups and deals', image: 'team-sales.webp', hue: { a: '139 92 246', b: '236 72 153' },
    title: 'A calling team that knows who to call next',
    lead: 'Daily call numbers, the Lead Dialer, deals and call quality scoring in one place, with attendance and a daily report your callers fill in under a minute.',
    fixes: [
      { before: 'Reps call leads outside their hours', after: 'The Lead Dialer shows who is open now, by time zone' },
      { before: 'Follow-ups go quiet', after: 'Quiet leads become tasks with reminders' },
      { before: 'Call numbers in a spreadsheet', after: 'A daily calls log with targets, totals by month' },
    ],
    features: ['sales', 'reports', 'attendance', 'chat'],
    day: [
      { time: '7:00 PM', text: 'Check in for the night shift; Eastern leads open first.' },
      { time: '7:15 PM', text: 'Import the CRM export; follow-ups and tasks update.' },
      { time: '9:30 PM', text: 'Prime time on the West Coast: call who is open.' },
      { time: '3:55 AM', text: 'Send the daily calls log and check out.' },
    ],
  },
  {
    key: 'ops', slug: 'operations', name: 'Operations and logistics', menu: 'Shifts, stock and tasks', image: 'team-ops.webp', hue: { a: '16 185 129', b: '6 182 212' },
    title: 'Shifts, stock and tasks that do not get lost',
    lead: 'Attendance by shift, inventory requests and tasks with owners, so the floor and the office see the same day.',
    fixes: [
      { before: 'A queue at the fingerprint machine', after: 'Check in from a phone, on the office network' },
      { before: 'Stock requests on paper', after: 'Inventory requests with an owner and a status' },
      { before: 'Tasks shouted across the floor', after: 'A board with owners, dates and reviews' },
    ],
    features: ['attendance', 'projects', 'reports', 'chat'],
    day: [
      { time: '8:55 AM', text: 'The morning shift checks in from their phones.' },
      { time: '10:20 AM', text: 'A stock request is assigned and picked.' },
      { time: '2:00 PM', text: 'The lead moves the rollout tasks on the board.' },
      { time: '5:05 PM', text: 'Daily reports in; the month’s register updates itself.' },
    ],
  },
  {
    key: 'remote', slug: 'remote-teams', name: 'Remote and hybrid teams', menu: 'See the day without asking', image: 'team-remote.webp', hue: { a: '14 165 233', b: '99 102 241' },
    title: 'See who is working and what got done',
    lead: 'Without asking everyone every day: who is in, what moved, and a short report from each person, wherever they work.',
    fixes: [
      { before: '“Are you online?” messages', after: 'Who is working now, at a glance' },
      { before: 'Status meetings to find out what happened', after: 'A daily report that takes a minute' },
      { before: 'Calls in one app, tasks in another', after: 'Chat, calls and tasks together' },
    ],
    features: ['attendance', 'reports', 'chat', 'projects'],
    day: [
      { time: '9:00 AM', text: 'People check in from home or the office.' },
      { time: '11:30 AM', text: 'A video call; the AI notes land in the meeting.' },
      { time: '3:00 PM', text: 'A decision in chat becomes a task with an owner.' },
      { time: '6:00 PM', text: 'Daily reports in; the lead reads them in one place.' },
    ],
  },
  {
    key: 'agency', slug: 'agencies', name: 'Agencies and studios', menu: 'Client projects and reviews', image: 'team-agency.webp', hue: { a: '245 158 11', b: '239 68 68' },
    title: 'Client work, reviewed before it ships',
    lead: 'Projects per client, content plans and marketing work, with reviews before anything goes out and hours you can account for.',
    fixes: [
      { before: 'Feedback scattered across emails', after: 'Reviews on the task, signed off by the person who asked' },
      { before: 'Deadlines discovered late', after: 'Overdue work flagged before it slips' },
      { before: 'Guessing where the hours went', after: 'Attendance and daily reports per person' },
    ],
    features: ['projects', 'chat', 'reports', 'attendance'],
    day: [
      { time: '9:30 AM', text: 'Stand-up on the client board; today’s tasks have owners.' },
      { time: '12:00 PM', text: 'A client joins a call from a link, no account.' },
      { time: '4:30 PM', text: 'Work goes to review; the account lead signs it off.' },
      { time: '6:00 PM', text: 'Daily report: what shipped and what is blocked.' },
    ],
  },
]
export const solutionBySlug = (slug?: string) => SOLUTIONS.find((s) => s.slug === slug)
