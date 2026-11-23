import type { Asker } from '../access'
import type { Entry, Row } from './types'
import { get, hours, nameOf, period, reader } from './load'

/**
 * Attendance, leave, people, targets, missing reports and notifications. Shapes are those of
 * controllers/attendanceController.ts, adminController.ts, notificationsController.ts and chatController.ts (users).
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const lead = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD'
const everyone = () => true

const STATE: Record<string, string> = { IN: 'In (working)', ON_BREAK: 'On a break', OUT: 'Checked out', NOT_IN: 'Not in yet', NOT_YET: 'Not in yet', ON_LEAVE: 'On leave', OFF: 'Day off', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly day off', PRESENT: 'Present', ABSENT: 'Absent' }
const LEAVE: Record<string, string> = { ON_LEAVE: 'Leave', OFF: 'Day off', HOLIDAY: 'Holiday', WFH: 'Work from home' }
const clock = (v: unknown, zone: string): string => {
  if (typeof v !== 'string' || !v) return ''
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return v
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(v))
}
const breakOf = (b: unknown): string => (!b ? '' : typeof b === 'string' ? b : String((b as { type?: unknown }).type ?? 'break').toLowerCase())

interface TeamRow { userId: string; name: string; department: string; presentDays: number; lateDays: number; completedShifts: number; leaveDays: number; totalWorkedMin: number; totalBreakMin: number; totalOvertimeMin: number; avgCheckIn: string | null; todayState: string; todayCheckIn: string | null; openBreak: unknown; brbOverToday: boolean; breakOverToday: boolean; lateThisMonth: number; graceLimitExceeded: boolean; workModeToday: string | null; wfhDays: number }
interface TeamBody { range: { startDate: string; endDate: string }; shift?: { startTime: string; endTime: string; graceMin: number; requiredMinutes: number; timeZone: string } | null; rows: TeamRow[]; summary: { members: number; inNow: number; onBreakNow: number; outNow: number; notInNow: number } }

/** The team's shift, as the Team Attendance screen shows it. */
const shiftLine = (b: TeamBody) => (b.shift ? `The team's shift: ${b.shift.startTime} to ${b.shift.endTime} (${b.shift.timeZone}), ${hours(b.shift.requiredMinutes)} a day; a check-in up to ${b.shift.graceMin} minutes after the start is not late.` : '')

export const PEOPLE: Entry[] = [
  {
    key: 'attendance.now', label: 'Team attendance now', area: 'Attendance', app: '/app/attendance/team',
    about: 'Right now, for each person of the team: in, on a break, checked out, not in yet or on leave, when they checked in, whether they were late today, and whether they work from home.',
    says: ['who is in', 'who is late', 'who is on break', 'who is not in', 'who is absent', 'who is here', 'who came late', 'attendance today', 'present today', 'checked in', 'who is working', 'who is on leave today', 'kaun aaya', 'kaun late', 'kaun nahi aaya', 'aaj kaun'],
    who: lead, pin: lead,
    blocks: ['attendance-team'], apis: ['/api/attendance/team'], models: ['AttendanceDay', 'BreakEntry', 'AttendanceShift', 'AttendanceViolation'],
    load: reader<TeamBody>('/api/attendance/team', {
      query: () => ({ query: { range: 'today' } }),
      rows: (b, c) => b.rows.map((r) => ({ id: r.userId, name: r.name, department: r.department, state: r.todayState, checkIn: clock(r.todayCheckIn, c.zone), late: r.lateDays > 0 ? 'Late today' : r.todayCheckIn ? 'On time' : '', onBreak: breakOf(r.openBreak), mode: r.workModeToday === 'WFH' ? 'Working from home' : r.workModeToday ?? '', breakOver: r.brbOverToday || r.breakOverToday ? 'Over the break allowance' : '' })),
      head: (b) => [`Now: ${b.summary.inNow} in, ${b.summary.onBreakNow} on a break, ${b.summary.outNow} checked out, ${b.summary.notInNow} not in, of ${b.summary.members} people.`, shiftLine(b)],
      dated: true,
    }),
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'department', label: 'team' }, { key: 'state', label: 'now' }, { key: 'checkIn', label: 'checked in at' }, { key: 'late', label: 'late today' }, { key: 'onBreak', label: 'break' }, { key: 'mode', label: 'working from' }, { key: 'breakOver', label: 'breaks' }],
      people: ['name'], mine: 'id', status: 'state', groups: ['department'], words: { state: STATE },
      flags: {
        in: { label: 'in now', says: ['in', 'present', 'here', 'working', 'online'], test: (r) => r.state === 'IN' || r.state === 'ON_BREAK' },
        late: { label: 'late today', says: ['late', 'came late', 'late comers'], test: (r) => r.late === 'Late today' },
        break: { label: 'on a break now', says: ['break', 'on break', 'brb'], test: (r) => r.state === 'ON_BREAK' },
        notin: { label: 'not in', says: ['not in', 'absent', 'missing', 'not here', 'not checked in', 'nahi aaya'], test: (r) => r.state === 'NOT_IN' || r.state === 'NOT_YET' },
        leave: { label: 'on leave or off today', says: ['leave', 'off', 'holiday', 'chutti'], test: (r) => ['ON_LEAVE', 'OFF', 'HOLIDAY', 'WEEKLY_OFF'].includes(String(r.state)) },
      },
    },
    tip: 'Late means checked in after the shift start (the "late today" column). "Not in yet" only means not checked in yet, which is NOT late: before the shift starts nobody is late. For a week or a month use what="attendance.team".',
  },
  {
    key: 'attendance.team', label: 'Team attendance over a period', area: 'Attendance', app: '/app/attendance/team',
    about: 'For each person of the team over a week, a month or any dates: days present, days late, shifts completed, leave days, hours worked, break time, overtime, average check-in time, and late days this month.',
    says: ['attendance this week', 'attendance this month', 'how many days late', 'late days', 'days present', 'hours worked', 'overtime', 'who was late most', 'attendance report', 'leave days', 'work from home days', 'kitne din late'],
    who: lead, pin: lead, takes: ['range'],
    blocks: ['attendance-team'], apis: ['/api/attendance/team'], models: ['AttendanceDay'],
    load: reader<TeamBody>('/api/attendance/team', {
      query: (a, c) => period(a, c, 'week'),
      rows: (b) => b.rows.map((r) => ({ id: r.userId, name: r.name, department: r.department, presentDays: r.presentDays, lateDays: r.lateDays, completedShifts: r.completedShifts, leaveDays: r.leaveDays, wfhDays: r.wfhDays, worked: hours(r.totalWorkedMin), workedMin: r.totalWorkedMin, breaks: hours(r.totalBreakMin), overtime: hours(r.totalOvertimeMin), avgCheckIn: r.avgCheckIn, lateThisMonth: r.lateThisMonth, grace: r.graceLimitExceeded ? 'Over the late limit this month' : '' })),
      head: (b) => [`Period read: ${b.range.startDate} to ${b.range.endDate}.`, shiftLine(b)],
      dated: true,
    }),
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'department', label: 'team' }, { key: 'presentDays', label: 'days present', kind: 'number' }, { key: 'lateDays', label: 'days late', kind: 'number' }, { key: 'completedShifts', label: 'full shifts', kind: 'number' }, { key: 'leaveDays', label: 'leave days', kind: 'number' }, { key: 'wfhDays', label: 'work-from-home days', kind: 'number' }, { key: 'worked', label: 'worked' }, { key: 'workedMin', label: 'minutes', kind: 'number', hidden: true }, { key: 'breaks', label: 'breaks' }, { key: 'overtime', label: 'overtime' }, { key: 'avgCheckIn', label: 'average check-in' }, { key: 'lateThisMonth', label: 'late days this month', kind: 'number' }, { key: 'grace', label: 'late limit' }],
      people: ['name'], mine: 'id', groups: ['department'], sums: ['presentDays', 'lateDays', 'leaveDays'],
      flags: {
        late: { label: 'late at least once', says: ['late', 'late comers'], test: (r) => Number(r.lateDays) > 0 },
        limit: { label: 'over the late limit this month', says: ['over the limit', 'grace exceeded', 'too many lates'], test: (r) => !!r.grace },
        leave: { label: 'took leave', says: ['leave', 'on leave'], test: (r) => Number(r.leaveDays) > 0 },
      },
    },
  },
  {
    key: 'attendance.mine', label: 'My attendance', area: 'Attendance', app: '/app/attendance/me',
    about: "The asker's own attendance: today's state, check-in and time worked, and each day of a period (present, absent, leave, late, early leave, hours worked, breaks, overtime, work from home).",
    says: ['my attendance', 'was i late', 'did i check in', 'my check in', 'my hours', 'how many hours did i work', 'my late days', 'my leave days', 'my overtime', 'am i late', 'my break', 'break time left', 'meri attendance', 'main late'],
    who: everyone, pin: everyone, takes: ['range'],
    blocks: ['attendance'], apis: ['/api/attendance/me', '/api/attendance/history'], models: ['AttendanceDay', 'BreakEntry'],
    async load(ctx, a) {
      const p = period(a, ctx)
      const [now, hist] = await Promise.all([
        get<{ today: { state: string; checkInAt: string | null; workedMin: number | null; breakMin: number; late: boolean; requiredMin: number; completed: boolean; brbAllowanceMin: number; breakAllowanceMin: number; brbMin: number; regularBreakMin: number }; shift: { startTime: string; endTime: string } }>(ctx, '/api/attendance/me'),
        get<{ range: { startDate: string; endDate: string }; rows: { date: string; label: string; offName: string | null; checkIn: string | null; checkOut: string | null; workedMin: number | null; breakMin: number; late: boolean; earlyLeave: boolean; completed: boolean; shortMin: number | null; note: string | null; overtimeMin: number; wfh: boolean }[]; summary: { presentDays: number; leaveDays: number; lateDays: number; completedShifts: number; totalWorkedMin: number; avgCheckIn: string | null } }>(ctx, '/api/attendance/history', p.query),
      ])
      if (hist.error !== undefined) return { error: hist.error }
      const t = now.body?.today, s = hist.body.summary
      const rows: Row[] = hist.body.rows.map((r) => ({ date: r.date, day: r.offName ? `${STATE[r.label] ?? r.label} (${r.offName})` : r.label, checkIn: clock(r.checkIn, ctx.zone), checkOut: clock(r.checkOut, ctx.zone), worked: hours(r.workedMin), late: r.late ? 'Late' : '', early: r.earlyLeave ? 'Left early' : '', full: r.label === 'PRESENT' ? (r.completed ? 'Full shift' : `Short${r.shortMin ? ` by ${hours(r.shortMin)}` : ''}`) : '', breaks: hours(r.breakMin), overtime: hours(r.overtimeMin), wfh: r.wfh ? 'Worked from home' : '', note: r.note }))
      return {
        rows, dated: true, notes: p.notes,
        head: [
          t ? `Today: ${STATE[t.state] ?? t.state}${t.checkInAt ? `, checked in at ${clock(t.checkInAt, ctx.zone)}${t.late ? ' (late)' : ''}` : ''}${t.workedMin ? `, worked ${hours(t.workedMin)} of ${hours(t.requiredMin)}` : ''}; breaks used: ${t.regularBreakMin} of ${t.breakAllowanceMin} min, short breaks ${t.brbMin} of ${t.brbAllowanceMin} min. Shift ${now.body!.shift.startTime} to ${now.body!.shift.endTime}.` : '',
          `Period read: ${hist.body.range.startDate} to ${hist.body.range.endDate}: ${s.presentDays} days present, ${s.lateDays} late, ${s.leaveDays} on leave, ${s.completedShifts} full shifts, ${hours(s.totalWorkedMin) || '0 h'} worked${s.avgCheckIn ? `, average check-in ${s.avgCheckIn}` : ''}.`,
        ].filter(Boolean),
      }
    },
    table: {
      unit: ['day', 'days'],
      columns: [{ key: 'date', label: 'date', kind: 'date' }, { key: 'day', label: 'day was' }, { key: 'checkIn', label: 'in' }, { key: 'checkOut', label: 'out' }, { key: 'worked', label: 'worked' }, { key: 'late', label: 'late' }, { key: 'early', label: 'early leave' }, { key: 'full', label: 'shift' }, { key: 'breaks', label: 'breaks' }, { key: 'overtime', label: 'overtime' }, { key: 'wfh', label: 'from home' }, { key: 'note', label: 'note' }],
      status: 'day', words: { day: STATE },
      flags: {
        late: { label: 'late days', says: ['late'], test: (r) => r.late === 'Late' },
        absent: { label: 'absent days', says: ['absent', 'missed'], test: (r) => r.day === 'ABSENT' },
        leave: { label: 'leave and days off', says: ['leave', 'off', 'chutti'], test: (r) => /ON_LEAVE|OFF|Leave|Day off/.test(String(r.day)) },
        short: { label: 'short shifts', says: ['short', 'incomplete', 'not completed'], test: (r) => String(r.full).startsWith('Short') },
      },
    },
  },
  {
    key: 'leave.team', label: 'Leave and days off', area: 'Attendance', app: '/app/admin/leave',
    about: 'Every leave day, day off and work-from-home day entered for the people of the team: who, which date, which kind, and the note.',
    says: ['leave', 'on leave', 'who is on leave', 'days off', 'who is off', 'work from home', 'work from home days', 'wfh days', 'wfh', 'leave days', 'leave this week', 'leave next week', 'upcoming leave', 'chutti', 'kaun chutti par'],
    who: lead, pin: lead,
    blocks: [], apis: ['/api/admin/leave'], models: ['LeaveDay'],
    load: reader<{ leave: { userId: string; userName: string; date: string; type: string; note: string }[] }>('/api/admin/leave', {
      rows: (b) => b.leave.map((l) => ({ id: l.userId, name: l.userName, date: l.date, type: l.type, note: l.note })),
      head: (b) => (b.leave.length >= 200 ? ['Only the newest 200 leave days are read.'] : []),
    }),
    table: {
      unit: ['leave day', 'leave days'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'date', label: 'date', kind: 'date' }, { key: 'type', label: 'kind' }, { key: 'note', label: 'note' }],
      people: ['name'], mine: 'id', status: 'type', date: 'date', words: { type: LEAVE },
      flags: {
        today: { label: 'today', says: ['today', 'aaj'], test: (r, c) => r.date === c.today },
        ahead: { label: 'still ahead', says: ['upcoming', 'coming', 'future', 'next'], test: (r, c) => String(r.date) > c.today },
      },
    },
    brief: (rows, c) => { const off = rows.filter((r) => r.date === c.today); const word: Record<string, string> = { ON_LEAVE: 'leave', OFF: 'day off', HOLIDAY: 'holiday', WFH: 'working from home' }; return off.length ? `Off today on your team: ${off.map((r) => `${r.name} (${word[String(r.type)] ?? r.type})`).join(', ')}.` : null },
    tip: 'Pass from and to for the dates asked about ("this week", "next week"); without dates every entered day is counted.',
  },
  {
    key: 'people.directory', label: 'People', area: 'People', app: '/app/team/members',
    about: 'Everyone in the company: name, email, which team they are in and whether they are online now; for a Super Admin also their role and whether the account is active.',
    says: ['who is in', 'who works in', 'which team is', 'email of', 'email address', 'email', 'whose email', 'contact of', 'team members', 'people in', 'how many people', 'how many employees', 'staff', 'colleagues', 'who is online', 'department of', 'kaun kaun hai', 'team mein kaun'],
    who: everyone,
    blocks: ['my-team'], apis: ['/api/chat/users', '/api/admin/users'], models: ['User', 'UserDepartment'],
    async load(ctx) {
      if (ctx.asker.role === 'SUPER_ADMIN') {
        const r = await get<{ users: { id: string; name: string; email: string; role: string; departmentName: string | null; subDepartment: string | null; status: string; isActive: boolean }[] }>(ctx, '/api/admin/users')
        if (r.error !== undefined) return { error: r.error }
        const depts = new Set(r.body.users.map((u) => u.departmentName?.trim()).filter(Boolean))
        const none = r.body.users.filter((u) => !u.departmentName?.trim()).length
        return { head: [`${depts.size} departments have people in them${none ? `; ${none} ${none === 1 ? 'person is' : 'people are'} in no department ("no team" below), which is not a department` : ''}.`], rows: r.body.users.map((u) => ({ id: u.id, name: u.name.trim(), email: u.email, department: u.departmentName?.trim() || 'no team', sub: u.subDepartment ?? '', role: u.role.replace(/_/g, ' ').toLowerCase(), account: u.isActive ? 'Active' : u.status === 'INVITED' ? 'Invited, not joined yet' : 'Not active' })) }
      }
      const r = await get<{ users: { id: string; name: string; email: string; department: string | null; presence: string }[] }>(ctx, '/api/chat/users')
      if (r.error !== undefined) return { error: r.error }
      return { rows: r.body.users.map((u) => ({ id: u.id, name: u.name.trim(), email: u.email, department: u.department ?? '', sub: '', role: '', account: '', presence: u.presence })) }
    },
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'email', label: 'email' }, { key: 'department', label: 'team' }, { key: 'sub', label: 'sub-team' }, { key: 'role', label: 'role' }, { key: 'account', label: 'account' }, { key: 'presence', label: 'online' }],
      people: ['name'], mine: 'id', groups: ['department'],
      flags: {
        online: { label: 'online now', says: ['online', 'available'], test: (r) => r.presence === 'online' || r.presence === 'busy' },
        inactive: { label: 'account not active', says: ['inactive', 'left', 'deactivated', 'invited'], test: (r) => !!r.account && r.account !== 'Active' },
      },
    },
    tip: 'For one team pass search with the team name, or group_by "team" for how many people each team has. Who is at work right now is what="attendance.now" (team leads).',
  },
  {
    key: 'people.teams', label: 'Teams', area: 'People', app: '/app/team/members',
    about: 'The departments of the company: name, what kind of team it is, and how many people it has.',
    says: ['departments', 'teams', 'how many departments', 'how many teams', 'which departments', 'list of teams', 'biggest team'],
    who: everyone,
    blocks: [], apis: ['/api/company/departments'], models: ['Department', 'SubDepartment'],
    load: reader<{ departments: { name: string; kind: string; people: number }[] }>('/api/company/departments', { rows: (b) => b.departments.map((d) => ({ name: d.name, kind: d.kind, people: d.people })) }),
    table: { unit: ['team', 'teams'], columns: [{ key: 'name', label: 'team' }, { key: 'kind', label: 'kind' }, { key: 'people', label: 'people', kind: 'number' }], sums: ['people'] },
  },
  {
    key: 'people.history', label: 'Team changes', area: 'People', app: '/app/team/members',
    about: 'Who was invited, joined, moved or removed from the team, by whom and when.',
    says: ['who joined', 'who left', 'new joiners', 'who was invited', 'who was removed', 'team changes', 'new members', 'recently joined'],
    who: lead,
    blocks: ['my-team'], apis: ['/api/admin/team-history'], models: ['TeamMemberEvent'],
    load: reader<{ events: { memberName: string; memberEmail: string; actorName: string | null; type: string; createdAt: string }[] }>('/api/admin/team-history', { rows: (b) => b.events.map((e) => ({ name: e.memberName, email: e.memberEmail, what: e.type.replace(/_/g, ' ').toLowerCase(), by: e.actorName ?? '', when: e.createdAt })) }),
    table: { unit: ['change', 'changes'], columns: [{ key: 'name', label: 'person' }, { key: 'email', label: 'email' }, { key: 'what', label: 'what happened' }, { key: 'by', label: 'by' }, { key: 'when', label: 'when', kind: 'date' }], people: ['name', 'by'], status: 'what', date: 'when' },
  },
  {
    key: 'targets.team', label: 'Targets', area: 'Targets', app: '/app/admin/targets',
    about: 'The targets set for the team: which number (dials, leads, listings...), per day, week or month, the target value and its lowest and highest acceptable value.',
    says: ['target', 'targets', 'daily target', 'weekly target', 'monthly target', 'what is the target', 'goal', 'goals', 'quota', 'target kya hai'],
    who: lead,
    blocks: [], apis: ['/api/admin/targets'], models: ['Target'],
    load: reader<{ targets: { department: string; brand: string | null; metricKey: string; period: string; value: number; minValue: number | null; maxValue: number | null }[] }>('/api/admin/targets', { rows: (b) => b.targets.map((t) => ({ department: t.department, brand: t.brand ?? '', metric: t.metricKey.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), period: t.period.toLowerCase(), value: t.value, min: t.minValue, max: t.maxValue })) }),
    table: { unit: ['target', 'targets'], columns: [{ key: 'department', label: 'team' }, { key: 'brand', label: 'brand' }, { key: 'metric', label: 'number' }, { key: 'period', label: 'per' }, { key: 'value', label: 'target', kind: 'number' }, { key: 'min', label: 'lowest ok', kind: 'number' }, { key: 'max', label: 'highest', kind: 'number' }], groups: ['department', 'period'] },
  },
  {
    key: 'reports.missing', label: 'Reports not submitted today', area: 'Reports', app: '/app/dashboard',
    about: "Who has not submitted today's daily report, by team.",
    says: ['not submitted', 'has not submitted', 'missing report', 'missing reports', 'who did not submit', 'pending reports', 'daily report missing', 'report nahi di', 'kis ne report nahi'],
    who: lead, pin: lead,
    blocks: [], apis: ['/api/notifications/not-submitted'], models: [],
    load: reader<{ date: string; total: number; groups: { label: string; members: unknown[] }[] }>('/api/notifications/not-submitted', {
      rows: (b) => b.groups.flatMap((g) => g.members.map((m) => ({ name: nameOf(m), team: g.label }))),
      head: (b) => [`Day: ${b.date}. ${b.total} ${b.total === 1 ? 'person has' : 'people have'} not submitted today's report.`],
      dated: true,
    }),
    table: { unit: ['person who has not submitted', 'people who have not submitted'], columns: [{ key: 'name', label: 'person' }, { key: 'team', label: 'team' }], people: ['name'], groups: ['team'] },
    tip: 'Answer with the names under each team.',
  },
  {
    key: 'notifications.mine', label: 'My notifications', area: 'Notifications', app: '/app/notifications',
    about: "The asker's own notifications: what each says, its date and what it is about.",
    says: ['notifications', 'my notifications', 'alerts', 'any alerts', 'what did i miss', 'unread notifications', 'reminders'],
    who: everyone,
    blocks: [], apis: ['/api/notifications'], models: [],
    load: reader<{ notifications: { title: string; body: string; date: string; category: string; type: string }[]; unread: number }>('/api/notifications', {
      rows: (b) => b.notifications.map((n) => ({ title: n.title, body: n.body, date: n.date, category: n.category, level: n.type })),
      head: (b) => [`${b.unread} unread.`],
    }),
    table: { unit: ['notification', 'notifications'], columns: [{ key: 'title', label: 'notification' }, { key: 'body', label: 'says', kind: 'long' }, { key: 'date', label: 'date', kind: 'date' }, { key: 'category', label: 'about' }, { key: 'level', label: 'level' }], groups: ['category'], date: 'date' },
  },
]
