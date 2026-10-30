/**
 * Words and numbers on the public website (Phase 2). Kept in one place so the copy can be
 * changed without touching the layout. Rules for this file: no invented customers, reviews or
 * numbers; every feature named here exists in Metriq today (or is marked "soon").
 */

export const site = (name: string) => `/assets/site/${name}`

/** Same as the server's lib/plans.ts (a test checks the prices and limits match). */
export const PLANS = [
  {
    key: 'personal', name: 'Personal', monthly: 5, yearly: 50, people: 1, storageGb: 2, aiHours: 2,
    blurb: 'For one person who wants their day in order.',
    includes: ['My tasks, to-dos and projects', 'Your own daily report', 'Attendance and hours', 'Chat with guests by link'],
  },
  {
    key: 'starter', name: 'Starter', monthly: 29, yearly: 290, people: 10, storageGb: 20, aiHours: 10,
    blurb: 'For a small team getting out of WhatsApp groups and spreadsheets.',
    includes: ['Everything in Personal', 'Attendance with office check-in', 'Departments and roles you shape', 'Team daily reports with targets', 'Lead Generation, Marketing, E-commerce and Inventory screens'],
  },
  {
    key: 'business', name: 'Business', monthly: 99, yearly: 990, people: 50, storageGb: 100, aiHours: 40, highlight: true,
    blurb: 'For growing companies with sales, operations and support teams.',
    includes: ['Everything in Starter', 'Lead Dialer for calling teams', 'Quality Assurance scoring', 'More files and AI meeting notes', 'Up to 50 people'],
  },
] as const

/** Rows of the pricing comparison: true, false, or the text to show. */
export const COMPARE: { label: string; group: string; values: [string | boolean, string | boolean, string | boolean] }[] = [
  { group: 'Plan', label: 'People', values: ['Just you', 'Up to 10', 'Up to 50'] },
  { group: 'Plan', label: 'File storage', values: ['2 GB', '20 GB', '100 GB'] },
  { group: 'Plan', label: 'AI meeting notes a month', values: ['2 hours', '10 hours', '40 hours'] },
  { group: 'Everyday work', label: 'Attendance, breaks and overtime', values: [true, true, true] },
  { group: 'Everyday work', label: 'Projects, boards and tasks', values: [true, true, true] },
  { group: 'Everyday work', label: 'Chat, calls and meetings', values: [true, true, true] },
  { group: 'Everyday work', label: 'Daily report you design', values: [true, true, true] },
  { group: 'Everyday work', label: 'To-do lists', values: [true, true, true] },
  { group: 'Teams', label: 'Departments, roles and sections', values: [false, true, true] },
  { group: 'Teams', label: 'Team reports and analytics', values: [false, true, true] },
  { group: 'Teams', label: 'Feedback from the team', values: [false, true, true] },
  { group: 'Teams', label: 'Lead Generation, Marketing, E-commerce, Inventory', values: [false, true, true] },
  { group: 'Teams', label: 'Lead Dialer for calling teams', values: [false, false, true] },
  { group: 'Teams', label: 'Quality Assurance scoring', values: [false, false, true] },
]

export const TOUR = [
  {
    key: 'attendance', tab: 'Attendance', image: 'app-attendance.webp',
    title: "Know who's in, without a fingerprint machine",
    text: 'People check in from the browser or their phone. Metriq keeps the hours, breaks, late starts, leave and overtime, and team leads see the whole picture by day or by month.',
    points: ['Check-in only from the office network, if you want it', 'Breaks with limits, and overtime when someone stays on', 'Register by day, totals by month, export to CSV'],
  },
  {
    key: 'projects', tab: 'Projects', image: 'app-board.webp',
    title: 'Every task on a board, with an owner and a date',
    text: 'Projects with boards and lists, assignees, priorities, checklists and reviews. Overdue work is flagged before it slips, not after.',
    points: ['Boards and lists, with due dates and reminders', 'Reviews: the person who asked signs the work off', 'A project chat next to every board'],
  },
  {
    key: 'chat', tab: 'Chat & calls', image: 'app-chat.webp',
    title: 'Team chat and calls that stay with the work',
    text: 'Groups, direct messages, voice and video calls and meetings in the same app as the tasks, so a decision in chat becomes a task in one click.',
    points: ['Mention a task and it links itself', 'Meetings on a calendar, with AI notes', 'Guests join a call from a link, no account'],
  },
  {
    key: 'reports', tab: 'Daily reports', image: 'app-daily.webp',
    title: 'A daily report your team fills in under a minute',
    text: 'Design the form yourself: numbers with targets, text, choices and ratings. Leads see who sent theirs, the totals against target, and how the team moves over the month.',
    points: ['One form for everyone, or one per department', 'Targets turn numbers green or red', 'The month in one table, ready to send'],
  },
  {
    key: 'sales', tab: 'Sales calling', image: 'app-dialer.webp',
    title: 'Call the right lead at the right time',
    text: "For calling teams: import your CRM list and the Lead Dialer shows who is open right now by time zone, who needs a follow-up, and how the funnel is moving.",
    points: ['Who can I call right now, by region and prime time', 'Follow-ups that went quiet, before they go cold', 'Funnel and industries, filtered any way you like'],
  },
] as const

export const REPLACES = ['WhatsApp groups', 'Attendance machine', 'Spreadsheets of hours', 'Google Forms reports', 'Separate video calls', 'Sticky-note task lists']

export const BENTO = [
  { key: 'sections', title: 'Shaped to each team', text: 'Make departments, pick what kind of work each one does, and turn on only the screens it uses.' },
  { key: 'roles', title: 'Roles you define', text: 'Start from Member, Team Lead or Admin and decide what each role sees and can do.' },
  { key: 'ai', title: 'AI meeting notes', text: 'Record a meeting and get the notes and action items written for you.' },
  { key: 'claude', title: 'Works with your AI', text: 'Connect Claude and ask about your team’s tasks, leads and reports in plain words.' },
  { key: 'timezones', title: 'Your time zone', text: 'Days, shifts and reports follow your company’s clock, wherever your people are.' },
  { key: 'mobile', title: 'On the phone too', text: 'Works in any phone browser today. iPhone and Android apps are on the way.' },
] as const

export const TEAMS = [
  { key: 'sales', image: 'team-sales.webp', title: 'Sales and call centres', text: 'Daily call numbers, the Lead Dialer, deals and call quality scoring in one place.', includes: ['Lead Dialer', 'Daily calls log', 'Deals', 'Call quality scoring'] },
  { key: 'ops', image: 'team-ops.webp', title: 'Operations and logistics', text: 'Shifts, attendance and inventory requests, with tasks that do not get lost.', includes: ['Shifts and attendance', 'Inventory requests', 'Tasks with owners'] },
  { key: 'remote', image: 'team-remote.webp', title: 'Remote and hybrid teams', text: 'See who is working and what got done, without asking everyone every day.', includes: ['Who is working now', 'Daily reports', 'Chat and calls'] },
  { key: 'agency', image: 'team-agency.webp', title: 'Agencies and studios', text: 'Projects per client, content plans and marketing work, with reviews before anything ships.', includes: ['Projects per client', 'Content calendar', 'Reviews before it ships'] },
] as const

/** "A day in Metriq" on the home page: what our own teams do in it, in order. */
export const DAY = [
  { time: '09:02', title: 'Checks in from the office Wi-Fi', text: 'The day, breaks and overtime are kept from here on.', icon: 'attendance' },
  { time: '10:15', title: 'Calls the leads that are open now', text: 'The Lead Dialer picks them by time zone and prime time.', icon: 'sales' },
  { time: '14:40', title: 'Moves a task to Done', text: 'The person who asked for it reviews and signs it off.', icon: 'projects' },
  { time: '18:05', title: 'Sends the daily report', text: 'Numbers against target, in under a minute.', icon: 'reports' },
] as const

export const STEPS = [
  { title: 'Make your company', text: 'Name it and pick your time zone. No card, nothing to install.' },
  { title: 'Add your teams', text: 'Pick departments, say what each one does, and choose a daily report from a template.' },
  { title: 'Invite your people', text: 'Paste a list of emails. Everyone gets a link and is in within minutes.' },
] as const

/** The first two answers depend on whether Metriq is still free while it launches. */
const PRICE_FAQS = {
  free: [
    { q: 'Is Metriq free?', a: 'Yes, while we launch. Every company gets everything on, and no card is needed. The plans and prices are what Metriq will cost once online payment opens.' },
    { q: 'What happens when payment opens?', a: 'We will write to every company before it opens, so you have time to choose a plan. Nothing you made is removed.' },
  ],
  paid: [
    { q: 'Is there a free trial?', a: 'Yes. Every new company gets 14 days with everything on, and no card is needed to start.' },
    { q: 'What happens when the trial ends?', a: 'Choose a plan to keep adding to Metriq. Until you do, everything you made is still there and can be looked at.' },
  ],
}
export const faqsFor = (free: boolean) => [...PRICE_FAQS[free ? 'free' : 'paid'], ...FAQS]

export const FAQS = [
  { q: 'Can I use Metriq on my own?', a: 'Yes. Choose "Just me" when you start, for your own tasks, to-dos, daily report and hours, on the Personal plan.' },
  { q: 'Can each team have different screens?', a: 'Yes. A department has a kind of work (General, Sales calling, Lead Generation, Marketing, E-commerce, Inventory or Customer service) and you turn its screens on or off. Nothing is deleted when you turn one off.' },
  { q: 'Can I bring my people and lists from Excel?', a: 'Paste or upload your people when you invite them. Calling teams import their lead lists from a CSV or Excel export of their CRM.' },
  { q: 'Is our data safe and private?', a: 'Each company only ever sees its own records, everything travels encrypted, and the database is backed up every night. Our team can only look inside your Metriq when you allow it, for a set time, and every visit is logged.' },
  { q: 'Is there a mobile app?', a: 'Metriq works in any phone browser today, check-in included. iPhone and Android apps are on the way.' },
  { q: 'Can we cancel?', a: 'Any time. A plan runs to the end of what is paid, and you can ask us for a full export of your data.' },
] as const

export const SECURITY = [
  { title: 'Your company, walled off', text: 'Every record belongs to one company. The app and the database itself both stop one company from seeing or changing another’s data.' },
  { title: 'Encrypted on the way', text: 'Every page and every file travels over HTTPS. Passwords are stored as strong one-way hashes, never as text.' },
  { title: 'Backed up every night', text: 'The database and uploaded files are backed up nightly and before every update, and we can roll an update back.' },
  { title: 'Roles and permissions', text: 'Decide who sees finance, settings and each team’s screens. Team leads see their team; members see their own work.' },
  { title: 'Support only with your say-so', text: 'Our team can sign in to help only when your Super Admin allows it, for up to a week, with a banner on screen and a log of every visit.' },
  { title: 'Your data stays yours', text: 'Ask and we export everything your company has in Metriq. Close your account and it is removed.' },
] as const
