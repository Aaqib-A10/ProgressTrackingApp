import type { Asker } from '../access'
import type { Entry, Row, Table } from './types'
import { get, loose, nameOf, period, reader, ymd } from './load'
import { norm } from './table'

/**
 * QA scores, feedback, the team's to-dos, ITAD documents, work-from-home requests, the chat list and the blocks a
 * company built itself. Shapes are those of controllers/qaController.ts, feedbackController.ts,
 * workLogController.ts, docsController, attendanceController.ts (wfh), chatController.ts and customBlocksController.ts.
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const lead = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD'
const qaTeam = (a: Asker) => sa(a) || a.role === 'TEAM_LEAD' || a.role === ('QA' as Asker['role']) || a.role === ('QA_LEAD' as Asker['role'])
const qaOnly = (a: Asker) => sa(a) || a.role === ('QA' as Asker['role']) || a.role === ('QA_LEAD' as Asker['role'])
const everyone = () => true
const dyn = (unit: [string, string]): Table => ({ unit, columns: [{ key: 'value', label: unit[0] }] })

interface Evaluation { scorecardName: string; evaluatorName: string; agentName: string; agentId: string; totalScore: number; band: string; passed: boolean; criticalFailTriggered: boolean; coachingNeeded: boolean; acknowledged: boolean; createdAt: string }
const evalRow = (e: Evaluation): Row => ({ agent: e.agentName, agentId: e.agentId, score: e.totalScore, band: e.band, result: e.passed ? 'Passed' : 'Failed', critical: e.criticalFailTriggered ? 'Critical fail' : '', coaching: e.coachingNeeded ? 'Coaching needed' : '', seen: e.acknowledged ? 'Acknowledged' : 'Not acknowledged yet', scorecard: e.scorecardName, evaluator: e.evaluatorName, when: e.createdAt })
const EVALS: Table = {
  unit: ['evaluation', 'evaluations'],
  columns: [{ key: 'agent', label: 'agent' }, { key: 'agentId', label: 'id', hidden: true }, { key: 'score', label: 'score', kind: 'number' }, { key: 'band', label: 'band' }, { key: 'result', label: 'result' }, { key: 'critical', label: 'critical' }, { key: 'coaching', label: 'coaching' }, { key: 'seen', label: 'agent saw it' }, { key: 'scorecard', label: 'scorecard' }, { key: 'evaluator', label: 'evaluated by' }, { key: 'when', label: 'date', kind: 'date' }],
  people: ['agent', 'evaluator'], mine: 'agentId', status: 'result', groups: ['band', 'scorecard'], date: 'when',
  flags: {
    failed: { label: 'failed', says: ['fail', 'fails', 'did not pass'], test: (r) => r.result === 'Failed' },
    coaching: { label: 'coaching needed', says: ['coaching', 'needs coaching'], test: (r) => !!r.coaching },
    critical: { label: 'critical fail', says: ['critical', 'auto fail'], test: (r) => !!r.critical },
    unseen: { label: 'not acknowledged yet', says: ['unacknowledged', 'not seen', 'pending acknowledgement'], test: (r) => r.seen !== 'Acknowledged' },
  },
}

/** The dashboard's "What everyone is working on" (server/src/lib/teamWork.ts). */
interface WorkItem { kind: string; title: string; where: string | null }
interface PersonWork { id: string; name: string; department: string | null; doing: WorkItem[]; done: { total: number; tasks: number; todos: number; marketing: number; recent: WorkItem[] }; open: number; overdue: number; minutes: number; lastActive: string | null }
const items = (l: WorkItem[]) => l.map((i) => `${i.title}${i.where ? ` (${i.where})` : ''}`).join('; ')

export const WORK: Entry[] = [
  {
    key: 'work.people', label: 'What everyone is working on', area: 'Dashboard', app: '/app/dashboard',
    about: "Each person's real work, whatever their department: what they have in progress now (project tasks, to-dos, marketing items) and what they finished in the period, with open and overdue task counts and time logged. A member reads themself; a team lead the team; a Super Admin everyone.",
    says: ['what is everyone working on', 'what is the team working on', 'who is working on what', 'what is he working on', 'what is she working on', 'what are they working on', 'what am i working on', 'what did i finish', 'what did i do this week', 'what did the team finish', 'who finished the most', 'who did the most work', 'work done this week', 'kaun kya kar raha hai', 'kya kar raha hai', 'kis pe kaam'],
    who: everyone, takes: ['range'],
    blocks: [], apis: ['/api/dashboard/work'], models: ['PmTask', 'WorkLogEntry', 'MarketingTask', 'PmTimeEntry'],
    load: reader<{ range: { startDate: string; endDate: string }; scope: string; people: PersonWork[] }>('/api/dashboard/work', {
      query: (a, c) => period(a, c, 'week'),
      rows: (b) => b.people.map((p) => ({ id: p.id, name: p.name, department: p.department, finished: p.done.total, tasksDone: p.done.tasks, todosDone: p.done.todos, marketingDone: p.done.marketing, doing: items(p.doing), doingCount: p.doing.length, recent: items(p.done.recent), open: p.open, overdue: p.overdue, hours: p.minutes ? Math.round((p.minutes / 60) * 10) / 10 : 0, lastActive: p.lastActive })),
      head: (b) => [`Period read: ${b.range.startDate} to ${b.range.endDate}. ${b.scope === 'me' ? 'Only the asker themself.' : b.scope === 'team' ? "The asker's team." : 'Everyone in the company.'} "Finished" counts project tasks completed, to-dos done and marketing items published in the period; "in progress" is right now.`],
      dated: true,
    }),
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'department', label: 'team' }, { key: 'finished', label: 'finished', kind: 'number' }, { key: 'tasksDone', label: 'project tasks done', kind: 'number' }, { key: 'todosDone', label: 'to-dos done', kind: 'number' }, { key: 'marketingDone', label: 'marketing published', kind: 'number' }, { key: 'doing', label: 'working on now', kind: 'long' }, { key: 'doingCount', label: 'in progress', kind: 'number' }, { key: 'recent', label: 'finished lately', kind: 'long' }, { key: 'open', label: 'open tasks', kind: 'number' }, { key: 'overdue', label: 'overdue', kind: 'number' }, { key: 'hours', label: 'hours logged', kind: 'number' }, { key: 'lastActive', label: 'last active', kind: 'date' }],
      people: ['name'], mine: 'id', groups: ['department'], sums: ['finished', 'open', 'overdue'],
      flags: {
        overdue: { label: 'with overdue tasks', says: ['overdue', 'late tasks', 'behind'], test: (r) => Number(r.overdue) > 0 },
        idle: { label: 'with nothing in progress and nothing finished', says: ['idle', 'doing nothing', 'not working', 'free', 'no work'], test: (r) => !Number(r.doingCount) && !Number(r.finished) },
      },
    },
  },
  {
    key: 'qa.mine', label: 'My QA Scores', area: 'Quality', app: '/app/qa/my',
    about: "The asker's own call-quality evaluations: the score and band of each, pass or fail, whether coaching is needed, who evaluated it and when.",
    says: ['my qa', 'my qa score', 'my qa scores', 'my quality score', 'my evaluations', 'my call score', 'did i pass', 'my last evaluation', 'my most recent evaluation', 'my most recent qa evaluation', 'my latest evaluation', 'my latest qa score', 'my recent qa', 'what did i score', 'mera qa score'],
    who: everyone,
    blocks: ['my-qa'], apis: ['/api/qa/my-evaluations'], models: ['QaEvaluation', 'QaEvaluationCategory', 'QaAnswer'],
    load: reader<{ evaluations: Evaluation[] }>('/api/qa/my-evaluations', {
      rows: (b) => b.evaluations.map(evalRow),
      head: (b) => (b.evaluations.length ? [
        `The newest (the last evaluation) is the first row: score ${b.evaluations[0].totalScore}, ${b.evaluations[0].band}, ${b.evaluations[0].passed ? 'passed' : 'failed'}.`,
        `Average score over these ${b.evaluations.length}: ${Math.round((b.evaluations.reduce((s, e) => s + e.totalScore, 0) / b.evaluations.length) * 10) / 10}. Newest first.`,
        // This list has no comments: never answer "no comment" from it.
        'This list does not hold the evaluator\'s comments, the category scores or the questions: they are read with what="qa.evaluation".',
      ] : []),
    }),
    table: EVALS,
  },
  {
    key: 'qa.evaluations', personal: 'qa.mine', label: 'QA evaluations', area: 'Quality', app: '/app/qa/evaluations',
    about: 'The call-quality evaluations the asker may see (a QA person or team lead: their agents\'): agent, score, band, pass or fail, coaching needed, scorecard, evaluator and date. The newest 100.',
    says: ['qa evaluations', 'evaluations', 'qa scores', 'quality scores', 'who failed qa', 'qa results', 'call quality', 'agents needing coaching', 'lowest qa score', 'highest qa score', 'qa score of'],
    who: everyone, // the app gives each person the evaluations they may see (an agent: none but their own screen's)
    blocks: [], apis: ['/api/qa/evaluations'], models: ['QaEvaluation'],
    load: reader<{ evaluations: Evaluation[] }>('/api/qa/evaluations', {
      rows: (b) => b.evaluations.map(evalRow),
      head: (b) => (b.evaluations.length >= 100 ? ['Only the newest 100 evaluations are read. For averages over a period use what="qa.team".'] : []),
    }),
    table: EVALS,
  },
  {
    key: 'qa.team', personal: 'qa.mine', label: 'QA team dashboard', area: 'Quality', app: '/app/qa/analytics',
    about: 'For QA people and team leads, over a period: evaluations done, the average score, the pass rate, how many need coaching, the top performer, and each agent with their average, number of evaluations and passes and fails.',
    says: ['qa dashboard', 'qa average', 'average qa score', 'pass rate', 'qa this month', 'top performer', 'qa by agent', 'team qa', 'quality dashboard'],
    who: qaTeam, takes: ['range'],
    blocks: [], apis: ['/api/qa/team-dashboard'], models: ['QaEvaluation', 'QaEvaluationCategory'],
    async load(ctx, a) {
      const p = period(a, ctx)
      const r = await get<{ range: { startDate: string; endDate: string }; department: string; totals: { evaluations: number; avgScore: number; passRate: number; coachingCount: number; topPerformer: unknown; agentCount: number }; passFail: { pass: number; fail: number }; agents: Record<string, unknown>[] }>(ctx, '/api/qa/team-dashboard', p.query)
      if (r.error !== undefined) return { error: r.error }
      const t = r.body.totals
      const rate = t.passRate <= 1 ? Math.round(t.passRate * 1000) / 10 : Math.round(t.passRate * 10) / 10
      return {
        ...loose(r.body.agents, ['agent', 'agents'], { people: ['name'], status: 'flag', sums: ['evals', 'passCalls', 'failCalls'], drop: /^(initials|cats)$/ }),
        dated: true, notes: p.notes,
        head: [`QA, ${r.body.department}, ${r.body.range.startDate} to ${r.body.range.endDate}: ${t.evaluations} evaluations of ${t.agentCount} agents; average score ${Math.round(t.avgScore * 10) / 10}; pass rate ${rate}% (${r.body.passFail.pass} passed, ${r.body.passFail.fail} failed); ${t.coachingCount} need coaching${nameOf(t.topPerformer) ? `; top performer ${nameOf(t.topPerformer)}` : ''}.`],
      }
    },
    table: dyn(['agent', 'agents']),
  },
  {
    key: 'qa.scorecards', label: 'QA scorecards', area: 'Quality', app: '/app/qa/scorecards',
    about: 'The scorecards calls are evaluated with: name, what it is for, the pass mark, how many categories it has and how many evaluations used it.',
    says: ['scorecard', 'scorecards', 'qa form', 'pass mark', 'pass threshold', 'evaluation form', 'how are calls scored'],
    who: qaOnly,
    blocks: [], apis: ['/api/qa/scorecards'], models: ['QaScorecard'],
    load: reader<{ scorecards: { name: string; description: string | null; departmentType: string | null; passThreshold: number; categoryCount: number; evaluationCount: number }[] }>('/api/qa/scorecards', {
      rows: (b) => b.scorecards.map((s) => ({ name: s.name, description: s.description, team: s.departmentType ?? 'Any team', pass: s.passThreshold, categories: s.categoryCount, used: s.evaluationCount })),
    }),
    table: { unit: ['scorecard', 'scorecards'], columns: [{ key: 'name', label: 'scorecard' }, { key: 'description', label: 'for', kind: 'long' }, { key: 'team', label: 'team' }, { key: 'pass', label: 'pass mark', kind: 'number' }, { key: 'categories', label: 'categories', kind: 'number' }, { key: 'used', label: 'evaluations done with it', kind: 'number' }], sums: ['used'] },
  },
  {
    key: 'feedback.threads', label: 'Feedback', area: 'Feedback', app: '/app/feedback',
    about: 'Feedback given to or by the asker (a team lead: their team\'s): the title, what was written, whether it is praise or something to improve, who gave it to whom, the replies and the date.',
    says: ['feedback', 'feedback i got', 'feedback for me', 'feedback given', 'praise', 'what did my lead say', 'feedback from', 'feedback to', 'mera feedback'],
    who: everyone,
    blocks: ['feedback'], apis: ['/api/feedback'], models: ['Feedback', 'FeedbackReply'],
    load: reader<{ feedback: { title: string; body: string; sentiment: string | null; author: { id: string; name: string } | null; recipient: { id: string; name: string } | null; replyCount: number; createdAt: string }[] }>('/api/feedback', {
      rows: (b) => b.feedback.map((f) => ({ title: f.title, body: f.body, kind: f.sentiment ?? '', from: nameOf(f.author), to: nameOf(f.recipient), toId: (f.recipient as { id?: string } | null)?.id ?? '', replies: f.replyCount, when: f.createdAt })),
    }),
    table: {
      unit: ['feedback', 'feedback'],
      columns: [{ key: 'title', label: 'title' }, { key: 'body', label: 'what was written', kind: 'long' }, { key: 'kind', label: 'kind' }, { key: 'from', label: 'from' }, { key: 'to', label: 'to' }, { key: 'toId', label: 'id', hidden: true }, { key: 'replies', label: 'replies', kind: 'number' }, { key: 'when', label: 'date', kind: 'date' }],
      people: ['to', 'from'], mine: 'toId', status: 'kind', date: 'when',
    },
    tip: '"me" narrows to feedback given TO the asker.',
  },
  {
    key: 'todo.team', personal: 'todo.mine', label: "The team's to-dos", area: 'My To-Do', app: '/app/todo',
    about: "For team leads: each person's to-do list for a day (today unless a date is given): what they planned, what is done, in progress or blocked, and the hours and quantities they logged.",
    says: ['team to-dos', 'team todo', 'team to do', 'what is my team working on', 'what did my team do', 'what did my team log', 'who finished', 'blocked', 'who is blocked', 'team plan today', 'team ne kya kiya'],
    who: lead, pin: lead, takes: ['date'],
    blocks: ['my-todo'], apis: ['/api/worklog/team'], models: ['WorkLogEntry', 'WorkLogNote', 'WorkLogReview'],
    load: reader<{ start: string; end: string; members: { id: string; name: string; department: string; entries: { title: string; status: string; blocked?: boolean }[]; done: number; inProgress: number; planned: number; blocked: number; hours: number; quantity: number }[] }>('/api/worklog/team', {
      query: (a, c) => ({ query: { date: ymd(a.date) || ymd(a.from) || c.today } }),
      rows: (b) => b.members.map((m) => ({ id: m.id, name: m.name, team: m.department, done: m.done, inProgress: m.inProgress, planned: m.planned, blocked: m.blocked, hours: m.hours, quantity: m.quantity, items: m.entries.map((e) => `${e.title.replace(/\s+/g, ' ').slice(0, 90)} (${e.status === 'DONE' ? 'done' : e.status === 'IN_PROGRESS' ? 'in progress' : 'planned'}${e.blocked ? ', blocked' : ''})`).join('; ') })),
      head: (b) => [`Day read: ${b.start}${b.end !== b.start ? ` to ${b.end}` : ''}.`],
      dated: true,
    }),
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'team', label: 'team' }, { key: 'done', label: 'done', kind: 'number' }, { key: 'inProgress', label: 'in progress', kind: 'number' }, { key: 'planned', label: 'planned', kind: 'number' }, { key: 'blocked', label: 'blocked', kind: 'number' }, { key: 'hours', label: 'hours', kind: 'number' }, { key: 'quantity', label: 'quantity', kind: 'number' }, { key: 'items', label: 'their to-dos', kind: 'long' }],
      people: ['name'], mine: 'id', groups: ['team'], sums: ['done', 'inProgress', 'planned', 'blocked', 'hours'],
      flags: {
        nothing: { label: 'wrote no to-dos', says: ['nothing', 'empty', 'no to-dos', 'did not plan'], test: (r) => !r.items },
        blocked: { label: 'has something blocked', says: ['blocked', 'stuck'], test: (r) => Number(r.blocked) > 0 },
      },
    },
    tip: 'One day at a time: pass date for another day. A person\'s own to-dos are todo_list.',
  },
  {
    key: 'itad.docs', label: 'Docs & links', area: 'Sales calling', app: '/app/itad/docs',
    about: 'The ITAD team\'s saved documents and links: name, what it is for, who added it.',
    says: ['docs', 'documents', 'links', 'saved docs', 'saved links', 'itad documents', 'where is the document', 'price list', 'template', 'script'],
    who: (a) => sa(a) || a.kinds.includes('ITAD' as never),
    blocks: ['itad-docs'], apis: ['/api/docs'], models: ['SavedDoc'],
    async load(ctx) {
      const r = await get<{ docs: unknown[] }>(ctx, '/api/docs')
      if (r.error !== undefined) return { error: r.error }
      return loose(r.body.docs, ['document', 'documents'], { people: ['createdBy', 'addedBy', 'owner'], drop: /^(fileKey|filePath|storageKey|mime|size)$/ })
    },
    table: dyn(['document', 'documents']),
  },
  {
    key: 'wfh.requests', label: 'Work-from-home requests', area: 'Attendance', app: '/app/attendance/me',
    about: 'Requests to work from home: the asker\'s own, and for a team lead their team\'s, with the day asked for, the reason and whether it was approved.',
    says: ['work from home request', 'wfh request', 'wfh requests', 'remote request', 'pending wfh', 'approve wfh', 'did my wfh get approved', 'ghar se kaam'],
    who: everyone,
    blocks: ['attendance'], apis: ['/api/attendance/wfh-requests/mine', '/api/attendance/wfh-requests/team'], models: ['WfhRequest'],
    async load(ctx) {
      const team = ctx.asker.role === 'SUPER_ADMIN' || ctx.asker.role === 'TEAM_LEAD'
      const r = await get<{ requests: unknown[] }>(ctx, team ? '/api/attendance/wfh-requests/team' : '/api/attendance/wfh-requests/mine')
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.requests, ['work-from-home request', 'work-from-home requests'], { people: ['userName', 'name', 'user', 'requestedBy'], date: 'date' }), head: [team ? "The team's requests." : `${ctx.me.name}'s own requests.`] }
    },
    table: dyn(['work-from-home request', 'work-from-home requests']),
  },
  {
    key: 'attendance.fixes', label: 'Attendance fix requests', area: 'Attendance', app: '/app/attendance/me',
    about: 'Requests to fix a day someone forgot to check in or out: the asker\'s own, and for a team lead their team\'s, with the day, the times asked for, the reason and whether it was approved.',
    says: ['forgot to check in', 'forgot check in', 'missed check in', 'attendance fix', 'fix my attendance', 'attendance request', 'attendance correction request', 'pending attendance requests', 'approve attendance fix'],
    who: everyone,
    blocks: ['attendance'], apis: ['/api/attendance/fix-requests/mine', '/api/attendance/fix-requests/team'], models: ['AttendanceFixRequest'],
    async load(ctx) {
      const team = ctx.asker.role === 'SUPER_ADMIN' || ctx.asker.role === 'TEAM_LEAD'
      const r = await get<{ requests: unknown[] }>(ctx, team ? '/api/attendance/fix-requests/team' : '/api/attendance/fix-requests/mine')
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.requests, ['attendance fix request', 'attendance fix requests'], { people: ['name', 'user', 'decidedBy'], status: 'status', date: 'date' }), head: [team ? "The team's requests." : `${ctx.me.name}'s own requests.`] }
    },
    table: dyn(['attendance fix request', 'attendance fix requests']),
  },
  {
    key: 'notes.mine', label: 'Notes', area: 'Notes', app: '/app/notes',
    about: "The asker's own sticky notes and the ones shared with them (Notes): title, text or checklist, tags, pinned, archived, a reminder time, who owns it and who it is shared with. Only notes the asker owns or was given.",
    says: ['my notes', 'notes', 'sticky notes', 'note', 'notes shared with me', 'shared notes', 'my reminders', 'note reminder', 'pinned notes', 'archived notes', 'notes tagged'],
    who: everyone,
    blocks: ['my-notes'], apis: ['/api/notes'], models: ['Note', 'NoteShare'],
    async load(ctx) {
      const r = await get<{ notes: Record<string, unknown>[] }>(ctx, '/api/notes')
      if (r.error !== undefined) return { error: r.error }
      const rows = r.body.notes.map((n) => {
        const items = Array.isArray(n.items) ? (n.items as { text: string; done: boolean }[]) : null
        const text = items ? items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('; ') : String(n.body ?? '')
        return {
          title: n.title || text.split('\n')[0].slice(0, 80),
          text: text.length > 400 ? `${text.slice(0, 397)}...` : text,
          tags: Array.isArray(n.tags) ? (n.tags as string[]).join(', ') : '',
          where: n.archived ? 'archived' : n.pinned ? 'pinned' : 'notes',
          reminder: n.remindAt ?? null,
          owner: nameOf(n.owner),
          sharedWith: Array.isArray(n.shares) ? (n.shares as { name: string }[]).map((s) => s.name).join(', ') : '',
          access: n.access,
          updated: n.updatedAt,
        }
      })
      return { ...loose(rows, ['note', 'notes'], { people: ['owner'], status: 'where', date: 'updated' }), head: [`${ctx.me.name}'s notes and the ones shared with them.`] }
    },
    table: dyn(['note', 'notes']),
  },
  {
    key: 'chat.list', label: 'My chats', area: 'Chat', app: '/app/chat',
    about: "The asker's own chats: each group, project chat and direct message they are in, and how many unread messages it has. What was SAID in a chat is found with search_metriq.",
    says: ['my chats', 'chat list', 'which chats', 'unread chats', 'unread messages', 'which groups am i in', 'group chats'],
    who: everyone,
    blocks: ['chat'], apis: ['/api/chat/conversations'], models: ['ChatConversation', 'ChatMember'],
    async load(ctx) {
      const r = await get<{ conversations: Record<string, unknown>[] }>(ctx, '/api/chat/conversations')
      if (r.error !== undefined) return { error: r.error }
      // The list only: names and counts. The words of the messages stay in search, where each chat is checked again.
      return loose(r.body.conversations.map((c) => ({ name: c.name ?? c.title ?? nameOf(c.other) ?? '', type: c.type, members: Array.isArray(c.members) ? c.members.length : c.memberCount, unreadMessages: c.unreadCount ?? c.unread ?? 0, lastActivity: c.lastMessageAt ?? c.updatedAt })), ['chat', 'chats'], { status: 'type', sums: ['unreadMessages'], date: 'lastActivity' })
    },
    table: dyn(['chat', 'chats']),
  },
  {
    key: 'custom.records', label: 'Custom blocks', area: 'Custom blocks', app: '/app/custom',
    about: 'The records of a block the company built itself in the Department Studio (its own tracker or list): pass item with the block\'s name; without it the blocks this person has are listed.',
    says: ['custom block', 'our tracker', 'tracker', 'custom list', 'records in', 'entries in the'],
    who: (a) => sa(a) || [...a.principals].some((p) => p.startsWith('cb:')), takes: ['item'],
    blocks: [], apis: ['/api/company/blocks', '/api/custom/:id', '/api/custom/:id/records'], models: ['CustomBlock', 'CustomRecord'],
    async load(ctx, a) {
      const ids = [...new Set([...ctx.asker.principals].filter((p) => p.startsWith('cb:')).map((p) => p.split(':')[1]))]
      if (ctx.asker.role === 'SUPER_ADMIN') { const all = await get<{ blocks?: { id?: string }[] }>(ctx, '/api/company/blocks'); for (const b of all.body?.blocks ?? []) { const id = String(b.id ?? ''); if (id && !ids.includes(id)) ids.push(id) } }
      const blocks: { id: string; name: string; fields: { key: string; label: string; type?: string }[] }[] = []
      for (const id of ids.slice(0, 30)) { const r = await get<{ block: { id: string; name: string; fields?: { key: string; label: string; type?: string }[] } }>(ctx, `/api/custom/${encodeURIComponent(id)}`); if (r.body?.block) blocks.push({ id, name: r.body.block.name, fields: Array.isArray(r.body.block.fields) ? r.body.block.fields : [] }) }
      if (!blocks.length) return { error: 'Nothing here: this person has no blocks the company built itself.' }
      const want = norm(a.item || a.search)
      const hit = blocks.filter((b) => norm(b.name) === want)
      const pick = hit.length === 1 ? hit[0] : blocks.filter((b) => want && (norm(b.name).includes(want) || want.includes(norm(b.name))))[0] ?? (blocks.length === 1 ? blocks[0] : null)
      if (!pick) return { rows: blocks.map((b) => ({ value: b.name })), notes: [`Say which block (pass item with its name). ${want ? `No block is called "${a.item || a.search}". ` : ''}The blocks are listed.`], table: { unit: ['block', 'blocks'], columns: [{ key: 'value', label: 'block' }] } }
      const r = await get<{ records: { data?: Record<string, unknown>; createdBy?: { name: string } | null; createdAt?: string; updatedAt?: string }[] }>(ctx, `/api/custom/${encodeURIComponent(pick.id)}/records`)
      if (r.error !== undefined) return { error: r.error }
      // The block's own fields, in its own order; anything saved under a field that was since removed comes after them.
      const known = new Set(pick.fields.map((f) => f.key))
      const t = loose((r.body.records ?? []).map((x) => ({ ...Object.fromEntries(pick.fields.map((f) => [f.label, x.data?.[f.key] ?? null])), ...Object.fromEntries(Object.entries(x.data ?? {}).filter(([k]) => !known.has(k))), 'added by': x.createdBy?.name ?? '', 'last changed': x.updatedAt ?? x.createdAt ?? '' })), ['record', 'records'], { people: ['added by'], date: 'last changed', sums: pick.fields.filter((f) => f.type === 'number').map((f) => f.label), groups: pick.fields.filter((f) => f.type === 'select').map((f) => f.label) })
      return { ...t, head: [`Block "${pick.name}".`] }
    },
    table: dyn(['record', 'records']),
  },
]
