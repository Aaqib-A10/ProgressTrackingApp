import { DateTime } from 'luxon'
import type { Entry, Row } from './types'
import { get, span, type Got } from './load'
import { dayOf } from './table'

/**
 * "My calendar": what a person has on which day. The Calendar screen itself shows meetings; people also mean their
 * days off, due dates and to-dos when they say "what is on my calendar / my week / tomorrow". So one read joins:
 *   meetings (with the notes written on them: the agenda), company holidays, the person's leave and days off,
 *   tasks due (My Tasks), to-dos (My To-Do and the personal list), and for the e-commerce team its meeting notes
 *   and their deadlines.
 * Each part is read through its own screen's API as the person; a part they cannot open is simply left out.
 */

interface MeetingT { title: string; agenda: string; startsAt: string; endsAt: string; organizer: { name: string }; isOrganizer: boolean; myResponse: string | null; attendees: { name: string; response: string }[]; project: { name?: string } | null; repeat: string | null }

export const CALENDAR: Entry[] = [
  {
    key: 'calendar.my', label: 'My calendar', area: 'Calendar', app: '/app/calendar',
    about: "The asker's own days: meetings with the notes (agenda) written on them and who is invited, company holidays, their leave and days off, tasks due, to-dos, and e-commerce meeting notes and deadlines. Today and the next 7 days unless dates are given.",
    says: ['calendar', 'my calendar', 'schedule', 'my schedule', 'my week', 'this week', 'next week', 'today', 'tomorrow', 'my day', 'what do i have', 'what is on', 'whats on', 'upcoming', 'meetings', 'meeting', 'agenda', 'notes in my calendar', 'notes on my calendar', 'notes on the call', 'notes on tomorrow', 'supplier call', 'call tomorrow', 'calendar notes', 'event', 'events', 'appointment', 'due this week', 'holiday', 'holidays', 'day off', 'am i free', 'aaj kya hai', 'kal kya hai', 'is hafte', 'meeting kab', 'chutti'],
    who: () => true, pin: () => true, takes: ['from_to', 'date'],
    blocks: ['calendar'], apis: ['/api/meetings', '/api/admin/holidays', '/api/attendance/history', '/api/tasks/mine', '/api/worklog', '/api/todos', '/api/ecommerce/meeting-notes'], models: ['Meeting', 'MeetingAttendee', 'Holiday', 'LeaveDay'],
    async load(ctx, a) {
      const s = span(a, ctx, 7)
      const z = ctx.zone
      const startIso = DateTime.fromISO(s.from, { zone: z }).startOf('day').toUTC().toISO()!
      const endIso = DateTime.fromISO(s.to, { zone: z }).endOf('day').toUTC().toISO()!
      const inside = (d: string) => !!d && d >= s.from && d <= s.to
      const ecommerce = ctx.asker.role === 'SUPER_ADMIN' || ctx.asker.kinds.includes('ECOMMERCE' as never)
      const past = s.from <= ctx.today
      const [meet, hol, tasks, log, todos, hist, notes] = await Promise.all([
        get<{ meetings: MeetingT[] }>(ctx, '/api/meetings', { from: startIso, to: endIso }),
        get<{ holidays: { date: string; name: string }[] }>(ctx, '/api/admin/holidays'),
        get<{ pending: { source: string; title: string; code?: string; projectName?: string; status: string; dueDate: string | null; overdue: boolean }[] }>(ctx, '/api/tasks/mine'),
        get<{ entries: { title: string; status: string; period: string; periodStart: string; blocked?: boolean }[] }>(ctx, '/api/worklog', { from: s.from, to: s.to }),
        get<{ todos: { title: string; done: boolean; dueDate: string | null }[] }>(ctx, '/api/todos'),
        past ? get<{ rows: { date: string; label: string; offName: string | null; wfh: boolean }[] }>(ctx, '/api/attendance/history', { range: 'custom', start: s.from, end: s.to < ctx.today ? s.to : ctx.today }) : Promise.resolve({ error: 'future' } as Got<{ rows: { date: string; label: string; offName: string | null; wfh: boolean }[] }>),
        ecommerce ? get<{ notes: { title: string; body: string; meetingDate: string; deadline: string | null; author: { name: string } }[] }>(ctx, '/api/ecommerce/meeting-notes') : Promise.resolve({ error: 'not e-commerce' } as Got<{ notes: { title: string; body: string; meetingDate: string; deadline: string | null; author: { name: string } }[] }>),
      ])
      const rows: Row[] = []
      const missing: string[] = []
      const hm = (iso: string) => DateTime.fromISO(iso).setZone(z).toFormat('h:mm a')
      if (meet.body) for (const m of meet.body.meetings) rows.push({
        day: dayOf(m.startsAt, z), time: `${hm(m.startsAt)} to ${hm(m.endsAt)}`, kind: 'Meeting', title: m.title,
        detail: [m.agenda.trim() ? `Notes on it (agenda): ${m.agenda.trim()}` : 'No notes written on it', `organised by ${m.isOrganizer ? `${ctx.me.name} (the asker)` : m.organizer.name}`, m.attendees.length ? `invited: ${m.attendees.map((x) => `${x.name} (${x.response.toLowerCase()})`).join(', ')}` : 'nobody else invited', m.myResponse && !m.isOrganizer ? `my reply: ${m.myResponse.toLowerCase()}` : '', m.project?.name ? `project ${m.project.name}` : '', m.repeat ? `repeats ${m.repeat}` : ''].filter(Boolean).join('; '),
      }); else missing.push('meetings')
      if (hol.body) for (const h of hol.body.holidays) if (inside(h.date)) rows.push({ day: h.date, time: 'all day', kind: 'Holiday', title: h.name.trim(), detail: 'Company holiday' })
      if (hist.body) for (const r of hist.body.rows) {
        if (r.label === 'ON_LEAVE' || r.label === 'OFF') rows.push({ day: r.date, time: 'all day', kind: r.label === 'ON_LEAVE' ? 'Leave' : 'Day off', title: r.offName || (r.label === 'ON_LEAVE' ? 'On leave' : 'Day off'), detail: '' })
        else if (r.wfh) rows.push({ day: r.date, time: 'all day', kind: 'Work from home', title: 'Work from home', detail: '' })
      }
      const overdue: string[] = []
      if (tasks.body) for (const t of tasks.body.pending) {
        const name = `${t.code ? `${t.code} ` : ''}${t.title}`
        if (t.dueDate && inside(t.dueDate)) rows.push({ day: t.dueDate, time: '', kind: 'Task due', title: name, detail: [t.projectName ? `project ${t.projectName}` : t.source === 'marketing' ? 'Marketing' : t.source === 'ecommerce' ? 'E-commerce' : '', `status ${t.status}`, t.overdue ? 'OVERDUE' : ''].filter(Boolean).join('; ') })
        else if (t.overdue && t.dueDate) overdue.push(`${name} (was due ${t.dueDate})`)
      } else missing.push('tasks')
      if (log.body) for (const e of log.body.entries) rows.push({ day: e.periodStart, time: '', kind: 'To-do', title: e.title.replace(/\s+/g, ' ').slice(0, 200), detail: [e.period === 'DAY' ? '' : `for the ${e.period.toLowerCase()} starting that day`, e.status === 'DONE' ? 'done' : e.status === 'IN_PROGRESS' ? 'in progress' : 'not done yet', e.blocked ? 'blocked' : ''].filter(Boolean).join('; ') })
      if (todos.body) for (const t of todos.body.todos) if (!t.done && t.dueDate && inside(t.dueDate)) rows.push({ day: t.dueDate, time: '', kind: 'Personal to-do due', title: t.title, detail: 'not done yet' })
      if (notes.body) for (const x of notes.body.notes) {
        if (inside(x.meetingDate)) rows.push({ day: x.meetingDate, time: '', kind: 'Team meeting note', title: x.title, detail: `E-commerce meeting notes by ${x.author.name}: ${x.body}` })
        if (x.deadline && inside(x.deadline)) rows.push({ day: x.deadline, time: '', kind: 'Deadline from a meeting note', title: x.title, detail: `Set in the e-commerce meeting of ${x.meetingDate} (notes by ${x.author.name}): ${x.body}` })
      }
      const order = (r: Row) => `${r.day} ${r.time && r.time !== 'all day' ? DateTime.fromFormat(String(r.time).split(' to ')[0], 'h:mm a').toFormat('HH:mm') : r.time === 'all day' ? '00:00' : '99:99'}`
      rows.sort((x, y) => order(x).localeCompare(order(y)))
      const nice = (d: string) => DateTime.fromISO(d).toFormat('ccc d LLL yyyy')
      return {
        rows, dated: true,
        head: [
          `${ctx.me.name}'s calendar from ${nice(s.from)} to ${nice(s.to)}${s.asked ? '' : ' (today and the next 7 days; pass from and to for other days)'}. Times are ${z}.`,
          overdue.length ? `Also still overdue from before these days: ${overdue.length} task${overdue.length === 1 ? '' : 's'}: ${overdue.slice(0, 10).join('; ')}.` : '',
        ].filter(Boolean),
        notes: missing.length ? [`Could not read: ${missing.join(', ')}. The rest is complete.`] : [],
      }
    },
    table: {
      unit: ['calendar item', 'calendar items'],
      columns: [{ key: 'day', label: 'day', kind: 'date' }, { key: 'time', label: 'time' }, { key: 'kind', label: 'kind' }, { key: 'title', label: 'what' }, { key: 'detail', label: 'details and notes', kind: 'long' }],
      groups: ['kind', 'day'],
      flags: {
        meetings: { label: 'meetings', says: ['meeting', 'meetings', 'calls', 'events'], test: (r) => r.kind === 'Meeting' },
        due: { label: 'things due', says: ['due', 'deadline', 'deadlines', 'tasks', 'task'], test: (r) => r.kind === 'Task due' || r.kind === 'Personal to-do due' || r.kind === 'Deadline from a meeting note' },
        todos: { label: 'to-dos', says: ['to-do', 'todo', 'to do', 'todos'], test: (r) => r.kind === 'To-do' || r.kind === 'Personal to-do due' },
        off: { label: 'days off', says: ['holiday', 'holidays', 'leave', 'off', 'chutti'], test: (r) => r.kind === 'Holiday' || r.kind === 'Leave' || r.kind === 'Day off' },
      },
    },
    suggest: 'What is on my calendar this week?',
    tip: 'A meeting\'s "notes on it" are what the person wrote on the calendar event. Notes taken during a call (AI meeting notes) and older meetings by topic are found with search_metriq. Leave is listed for days up to today; a future day off shows once it is entered as a holiday.',
  },
]
