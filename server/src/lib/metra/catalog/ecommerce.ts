import type { Asker } from '../access'
import type { Entry, Row } from './types'
import { get, idOf, nameOf, period, ymd } from './load'
import { norm, sameName } from './table'

/**
 * E-commerce: the daily listings log, the task board, stock tracking, the team's numbers, meeting notes and remote
 * desktops. Shapes are those of controllers/ecommerceController.ts, meetingNotesController.ts and rdpController.ts.
 */

const inTeam = (a: Asker) => a.role === 'SUPER_ADMIN' || a.kinds.includes('ECOMMERCE' as never)
const own = (a: Asker) => a.kinds.includes('ECOMMERCE' as never)
const leads = (a: Asker) => a.role === 'SUPER_ADMIN' || (a.role === 'TEAM_LEAD' && a.kinds.includes('ECOMMERCE' as never))

interface TeamBody {
  range: { startDate: string; endDate: string; key: string }
  team: { totalListings: number; agents: number; openStockRequests: number; topMarketplace: string | null; tasksTodo: number; tasksInProgress: number; tasksDone: number }
  byMarketplace: { name: string; listings: number }[]
  byType: { type: string; total: number; byMarketplace: { name: string; value: number }[] }[]
  agents: { id: string; name: string; status: string; onLeaveToday: boolean; daysLogged: number; totalListings: number; byMarketplace: Record<string, number> }[]
}
interface TaskT { id: string; title: string; description: string; source: string; status: string; assignee: { id: string; name: string } | null; dueDate: string | null; commentCount: number }
interface RdpT { id: string; team: string; provider: string; address: string; label: string; notes: string; active: boolean; currentAgents: string[]; totalAgents: number }
/** A remote desktop named without its address (an IP or an AnyDesk id is how it is reached): only the ending tells desktops apart. */
const desktop = (x: { provider: string; address: string; label?: string }) => `${x.provider}${x.label ? ` "${x.label}"` : ''} (address ending ${x.address.slice(-4)})`
interface StockT { id: string; itemName: string; quantity: number | null; requestedByName: string; note: string; requestedAt: string; status: string; action: string; assignee: { id: string; name: string } | null; resolvedAt: string | null; createdBy: { id: string; name: string } | null }
interface NoteT { title: string; body: string; meetingDate: string; deadline: string | null; author: { id: string; name: string }; updatedAt: string }
interface DayBody {
  date: string
  entry: { status: string; notes: string; pricingNotes: string; lines: { taskTypeId: string; marketplaceId: string; listings: number }[]; totalListings: number } | null
  types: { name: string; fields: { id: string; name: string }[] }[]
  marketplaces: { id: string; name: string }[]
  stats: { avgListings: number; daysLogged: number }
}

export const ECOMMERCE: Entry[] = [
  {
    key: 'ecommerce.listings', label: 'Listings by person', area: 'E-commerce', app: '/app/ecommerce/team',
    about: 'How many listings each person on the e-commerce team logged in a period (today, this week, this month or any dates), by marketplace and by type of work, and who has logged nothing.',
    says: ['listings', 'listing', 'listed', 'how many listings', 'my listings', 'listings this month', 'listings this week', 'listings today', 'team listings', 'ecommerce numbers', 'e-commerce numbers', 'amazon', 'ebay', 'walmart', 'marketplace', 'top lister', 'who listed the most', 'daily log', 'kitni listings', 'kitni listing', 'listing ki', 'team view'],
    who: inTeam, pin: own, takes: ['range'],
    blocks: ['ecom-team', 'ecom-log'], apis: ['/api/ecommerce/team'], models: ['EcommerceDailyEntry', 'EcommerceListingLine'],
    async load(ctx, a) {
      const p = period(a, ctx)
      const r = await get<TeamBody>(ctx, '/api/ecommerce/team', p.query)
      if (r.error !== undefined) return { error: r.error }
      const b = r.body
      const rows: Row[] = b.agents.map((x) => ({ id: x.id, name: x.name, status: x.status, daysLogged: x.daysLogged, totalListings: x.totalListings, byMarketplace: Object.entries(x.byMarketplace).sort((m, n) => n[1] - m[1]).map(([m, n]) => `${m} ${n}`).join(', ') }))
      return {
        rows, dated: true, notes: p.notes,
        head: [
          `Period read: ${b.range.startDate} to ${b.range.endDate}${b.range.key === 'today' ? ' (today)' : ''}.`,
          `Whole team: ${b.team.totalListings.toLocaleString('en-US')} listings by ${b.team.agents} people${b.team.topMarketplace ? `; most on ${b.team.topMarketplace}` : ''}.`,
          b.byMarketplace.length ? `Team by marketplace: ${b.byMarketplace.map((m) => `${m.name} ${m.listings}`).join(', ')}.` : '',
          b.byType.length ? `Team by type of work: ${b.byType.map((t) => `${t.type} ${t.total}${t.byMarketplace.length ? ` (${t.byMarketplace.map((m) => `${m.name} ${m.value}`).join(', ')})` : ''}`).join('; ')}.` : '',
        ].filter(Boolean),
      }
    },
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'person' }, { key: 'status', label: 'log status' }, { key: 'daysLogged', label: 'days logged', kind: 'number' }, { key: 'totalListings', label: 'listings', kind: 'number' }, { key: 'byMarketplace', label: 'by marketplace' }],
      people: ['name'], mine: 'id', status: 'status', sums: ['totalListings'],
      words: { status: { SUBMITTED: 'Logged', PENDING: 'Nothing logged', ON_LEAVE: 'On leave today' } },
      flags: { nothing: { label: 'logged nothing', says: ['pending', 'not logged', 'not submitted', 'missing', 'no listings', 'nahi kiya'], test: (r) => r.status === 'PENDING' } },
    },
    suggest: 'How many listings did I add this month?',
    tip: 'For one person pass person (their name, or "me"). "Log status" is for the period read: with range today it means today\'s log.',
  },
  {
    key: 'ecommerce.my_day', label: 'My daily log', area: 'E-commerce', app: '/app/ecommerce/log',
    about: "The asker's own e-commerce daily log for ONE day: listings per type of work and marketplace, the notes and the pricing notes they wrote.",
    says: ['my daily log', 'my log', 'what did i log', 'my entry', 'todays log', 'yesterday log', 'pricing notes', 'my notes for the day', 'did i submit', 'did i log', 'aaj ka log', 'mera log'],
    who: inTeam, pin: own, takes: ['date'],
    blocks: ['ecom-log'], apis: ['/api/ecommerce/entries'], models: ['EcommerceDailyEntry', 'EcommerceListingLine', 'Tag'],
    async load(ctx, a) {
      const date = ymd(a.date) || ymd(a.from) || ctx.today
      const r = await get<DayBody>(ctx, '/api/ecommerce/entries', { date })
      if (r.error !== undefined) return { error: r.error }
      const b = r.body
      const field = new Map(b.types.flatMap((t) => t.fields.map((f) => [f.id, { type: t.name, field: f.name }] as const)))
      const market = new Map(b.marketplaces.map((m) => [m.id, m.name]))
      const rows: Row[] = (b.entry?.lines ?? []).filter((l) => l.listings > 0).map((l) => ({ type: field.get(l.taskTypeId)?.type ?? 'Other', field: field.get(l.taskTypeId)?.field ?? '', marketplace: market.get(l.marketplaceId) ?? '', listings: l.listings }))
      const said: Record<string, string> = { SUBMITTED: 'submitted', ON_LEAVE: 'marked on leave', HOLIDAY: 'marked a holiday', OFF: 'marked a day off' }
      return {
        rows, dated: true,
        head: [
          b.entry ? `${ctx.me.name}'s log for ${b.date}: ${said[b.entry.status] ?? b.entry.status}, ${b.entry.totalListings} listings in all.` : `${ctx.me.name} has logged nothing for ${b.date}.`,
          b.entry?.notes ? `Notes written that day: ${b.entry.notes}` : '',
          b.entry?.pricingNotes ? `Pricing notes written that day: ${b.entry.pricingNotes}` : '',
          `Over the last ${b.stats.daysLogged} logged days: ${b.stats.avgListings} listings a day on average.`,
        ].filter(Boolean),
      }
    },
    table: {
      unit: ['line', 'lines'],
      columns: [{ key: 'type', label: 'type of work' }, { key: 'field', label: 'work' }, { key: 'marketplace', label: 'marketplace' }, { key: 'listings', label: 'listings', kind: 'number' }],
      groups: ['marketplace', 'type'], sums: ['listings'],
    },
    tip: 'One day only. For a week, a month or other people use what="ecommerce.listings".',
  },
  {
    key: 'ecommerce.tasks', label: 'Task board', area: 'E-commerce', app: '/app/ecommerce/board',
    about: 'Every task on the e-commerce team board: To Do, In Progress and Done, who has it, when it is due and where it came from.',
    says: ['ecommerce tasks', 'e-commerce tasks', 'task board', 'board', 'team tasks', 'who has which task', 'overdue tasks', 'tasks in progress', 'to do', 'listing tasks', 'store tasks', 'ecommerce board', 'kaam', 'tasks kis ke paas'],
    who: inTeam, pin: own,
    blocks: ['ecom-board'], apis: ['/api/ecommerce/board'], models: ['EcommerceTask', 'EcomTaskComment'],
    async load(ctx) {
      const r = await get<{ columns: { status: string; tasks: TaskT[] }[] }>(ctx, '/api/ecommerce/board')
      if (r.error !== undefined) return { error: r.error }
      const rows: Row[] = r.body.columns.flatMap((c) => c.tasks.map((t) => ({ title: t.title, status: t.status, assignee: nameOf(t.assignee), assigneeId: idOf(t.assignee), dueDate: t.dueDate, source: t.source, description: t.description, comments: t.commentCount })))
      return { rows }
    },
    table: {
      unit: ['task', 'tasks'],
      columns: [{ key: 'title', label: 'task' }, { key: 'status', label: 'status' }, { key: 'assignee', label: 'assigned to' }, { key: 'assigneeId', label: 'id', hidden: true }, { key: 'dueDate', label: 'due', kind: 'date' }, { key: 'source', label: 'source' }, { key: 'description', label: 'description', kind: 'long' }, { key: 'comments', label: 'comments', kind: 'number' }],
      people: ['assignee'], mine: 'assigneeId', status: 'status', date: 'dueDate',
      words: { status: { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' } },
      flags: {
        open: { label: 'not done', says: ['open', 'pending', 'remaining', 'left', 'baqi'], test: (r) => r.status !== 'DONE' },
        overdue: { label: 'overdue', says: ['late', 'past due', 'missed deadline', 'due date passed'], test: (r, c) => r.status !== 'DONE' && !!r.dueDate && String(r.dueDate) < c.today },
        today: { label: 'due today', says: ['today', 'aaj'], test: (r, c) => r.status !== 'DONE' && r.dueDate === c.today },
        unassigned: { label: 'not assigned', says: ['unassigned', 'nobody', 'no one', 'free'], test: (r) => r.status !== 'DONE' && !r.assignee },
      },
    },
    brief: (rows, c) => { const mine = rows.filter((r) => r.assigneeId === c.me.id && r.status !== 'DONE'); const late = mine.filter((r) => !!r.dueDate && String(r.dueDate) < c.today).length; return mine.length ? `E-commerce board: ${mine.length} open task${mine.length === 1 ? '' : 's'} of yours${late ? `, ${late} overdue` : ''}.` : null },
    tip: 'This is the whole team\'s board. "My tasks" (everything given to the asker, from every board) is the My Tasks line of the guide.',
  },
  {
    key: 'ecommerce.stock', label: 'Stock tracking', area: 'E-commerce', app: '/app/ecommerce/stock',
    about: 'Stock problems and stock-in / stock-out requests the e-commerce team logged: the item, how many, who asked, who is fixing it, whether it is resolved, and the note written on it.',
    says: ['stock', 'stock issues', 'stock issue', 'stock problems', 'stock tracking', 'stock request', 'stock requests', 'out of stock', 'stock in', 'stock out', 'which products have stock issues', 'unresolved stock', 'pending stock', 'stock ka masla', 'stock khatam', 'maal'],
    who: inTeam, pin: own,
    blocks: ['ecom-stock'], apis: ['/api/ecommerce/stock'], models: ['StockRequest'],
    async load(ctx) {
      const r = await get<{ requests: StockT[] }>(ctx, '/api/ecommerce/stock')
      if (r.error !== undefined) return { error: r.error }
      const rows: Row[] = r.body.requests.map((s) => ({ item: s.itemName, action: s.action, quantity: s.quantity, status: s.status, requestedBy: s.requestedByName, assignee: nameOf(s.assignee), assigneeId: idOf(s.assignee), loggedBy: nameOf(s.createdBy), requestedAt: s.requestedAt, resolvedAt: s.resolvedAt, note: s.note }))
      return { rows }
    },
    table: {
      unit: ['stock request', 'stock requests'],
      columns: [{ key: 'item', label: 'item' }, { key: 'action', label: 'kind' }, { key: 'quantity', label: 'quantity', kind: 'number' }, { key: 'status', label: 'status' }, { key: 'requestedBy', label: 'requested by' }, { key: 'assignee', label: 'assigned to' }, { key: 'assigneeId', label: 'id', hidden: true }, { key: 'loggedBy', label: 'logged by' }, { key: 'requestedAt', label: 'requested', kind: 'time' }, { key: 'resolvedAt', label: 'resolved', kind: 'time' }, { key: 'note', label: 'note', kind: 'long' }],
      people: ['assignee', 'requestedBy', 'loggedBy'], mine: 'assigneeId', status: 'status', groups: ['action'], date: 'requestedAt',
      words: { status: { REQUESTED: 'Requested (nobody on it yet)', ASSIGNED: 'Assigned', RESOLVED: 'Resolved' }, action: { STOCK_IN: 'Stock in', STOCK_OUT: 'Stock out' } },
      flags: {
        open: { label: 'not resolved', says: ['open', 'pending', 'unresolved', 'issue', 'issues', 'problem', 'problems', 'right now', 'current', 'masla', 'baqi'], test: (r) => r.status !== 'RESOLVED' },
        unassigned: { label: 'nobody on it', says: ['unassigned', 'not assigned', 'waiting'], test: (r) => r.status === 'REQUESTED' },
      },
    },
    suggest: 'Which stock issues are still not resolved?',
    brief: (rows, c) => { const open = rows.filter((r) => r.status !== 'RESOLVED'); const mine = open.filter((r) => r.assigneeId === c.me.id).length; const free = open.filter((r) => r.status === 'REQUESTED').length; return open.length ? `Stock tracking: ${open.length} not resolved${mine ? `, ${mine} of them yours` : ''}${free ? `, ${free} with nobody on ${free === 1 ? 'it' : 'them'}` : ''}.` : null },
    tip: 'A stock issue that is still a problem is one that is "not resolved". This is the e-commerce team\'s list; the warehouse stock itself (quantities) is the Inventory stock list.',
  },
  {
    key: 'ecommerce.meeting_notes', label: 'Meeting notes', area: 'E-commerce', app: '/app/ecommerce/notes',
    about: 'Notes and decisions the e-commerce team wrote after its meetings: title, the meeting date, a deadline if one was set, who wrote it and the full text. Newest meeting first.',
    says: ['meeting notes', 'meeting note', 'last meeting', 'team meeting', 'what was decided', 'decisions', 'notes from the meeting', 'minutes', 'deadline', 'what did we discuss', 'meeting mein kya', 'meeting ke notes', 'pichli meeting'],
    who: inTeam, pin: own,
    blocks: ['ecom-notes'], apis: ['/api/ecommerce/meeting-notes'], models: ['MeetingNote'],
    async load(ctx) {
      const r = await get<{ notes: NoteT[] }>(ctx, '/api/ecommerce/meeting-notes')
      if (r.error !== undefined) return { error: r.error }
      const rows: Row[] = r.body.notes.map((x) => ({ title: x.title, meetingDate: x.meetingDate, deadline: x.deadline, author: nameOf(x.author), authorId: idOf(x.author), body: x.body }))
      const first = r.body.notes[0]
      return { rows, head: first ? [`The latest meeting with notes: "${first.title}", meeting of ${first.meetingDate}, written by ${first.author.name}.`] : [] }
    },
    table: {
      unit: ['meeting note', 'meeting notes'],
      columns: [{ key: 'title', label: 'title' }, { key: 'meetingDate', label: 'meeting date', kind: 'date' }, { key: 'deadline', label: 'deadline', kind: 'date' }, { key: 'author', label: 'written by' }, { key: 'authorId', label: 'id', hidden: true }, { key: 'body', label: 'what was written', kind: 'long' }],
      people: ['author'], mine: 'authorId', date: 'meetingDate',
      flags: {
        ahead: { label: 'deadline still ahead', says: ['upcoming deadline', 'due soon', 'open deadline', 'pending'], test: (r, c) => !!r.deadline && String(r.deadline) >= c.today },
        passed: { label: 'deadline passed', says: ['overdue', 'late', 'missed'], test: (r, c) => !!r.deadline && String(r.deadline) < c.today },
      },
    },
    suggest: 'What was decided in our last team meeting?',
    brief: (rows, c) => { const due = rows.filter((r) => r.deadline === c.today); return due.length ? `Meeting note deadline today: ${due.map((r) => `"${r.title}"`).join(', ')}.` : null },
    tip: 'The rows are newest meeting first, so the first row is the last meeting. With limit 1 to 5 the full text of each note is given.',
  },
  {
    key: 'ecommerce.rdp', label: 'Remote desktops', area: 'E-commerce', app: '/app/ecommerce/rdp',
    about: 'The remote desktops (RDPs) the team uses: provider, team, whether it is in use, and which agents are on it now.',
    says: ['rdp', 'rdps', 'remote desktop', 'remote desktops', 'anydesk', 'which rdp', 'who is using', 'free rdp', 'kaun sa rdp'],
    who: leads, pin: (a) => own(a) && leads(a),
    blocks: ['ecom-rdp'], apis: ['/api/rdp'], models: ['Rdp', 'RdpAssignment'],
    async load(ctx) {
      const r = await get<{ rdps: RdpT[] }>(ctx, '/api/rdp')
      if (r.error !== undefined) return { error: r.error }
      const rows: Row[] = r.body.rdps.map((x) => ({ desktop: desktop(x), team: x.team, provider: x.provider, active: x.active ? 'In service' : 'Retired', agents: x.currentAgents.join(', '), inUse: x.currentAgents.length, everUsedBy: x.totalAgents, notes: x.notes }))
      return { rows }
    },
    table: {
      unit: ['remote desktop', 'remote desktops'],
      columns: [{ key: 'desktop', label: 'desktop' }, { key: 'team', label: 'team' }, { key: 'provider', label: 'provider', hidden: true }, { key: 'active', label: 'state' }, { key: 'agents', label: 'used now by' }, { key: 'inUse', label: 'people on it now', kind: 'number' }, { key: 'everUsedBy', label: 'people ever on it', kind: 'number' }, { key: 'notes', label: 'notes', kind: 'long' }],
      people: ['agents'], status: 'active', groups: ['team', 'provider'],
      flags: {
        free: { label: 'free (in service, nobody on it)', says: ['free', 'available', 'unused', 'empty', 'khali'], test: (r) => r.active === 'In service' && !r.inUse },
        used: { label: 'in use', says: ['in use', 'busy', 'taken', 'occupied'], test: (r) => Number(r.inUse) > 0 },
      },
    },
    tip: 'Full addresses are shown only on the Remote desktops screen itself. Who used a desktop before, or every desktop one agent has had: what="ecommerce.rdp_history" with item.',
  },
  {
    key: 'ecommerce.rdp_people', label: 'Remote desktop users', area: 'E-commerce', app: '/app/ecommerce/rdp',
    about: 'Every agent who has a remote desktop: how many desktops they are on now, how many they ever had, and for which teams.',
    says: ['who has an rdp', 'agents on rdp', 'rdp users', 'how many rdps does', 'rdp per agent', 'agents with remote desktops'],
    who: leads,
    blocks: ['ecom-rdp'], apis: ['/api/rdp/agents'], models: ['RdpAssignment'],
    async load(ctx) {
      const r = await get<{ agents: { name: string; active: number; total: number; teams: string[] }[] }>(ctx, '/api/rdp/agents')
      if (r.error !== undefined) return { error: r.error }
      return { rows: r.body.agents.map((x) => ({ name: x.name, active: x.active, total: x.total, teams: x.teams.join(', ') })) }
    },
    table: {
      unit: ['agent', 'agents'],
      columns: [{ key: 'name', label: 'agent' }, { key: 'active', label: 'desktops now', kind: 'number' }, { key: 'total', label: 'desktops ever', kind: 'number' }, { key: 'teams', label: 'teams' }],
      people: ['name'], sums: ['active'],
      flags: { none: { label: 'on no desktop now', says: ['no rdp', 'without rdp', 'none'], test: (r) => !r.active } },
    },
  },
  {
    key: 'ecommerce.rdp_history', label: 'Remote desktop history', area: 'E-commerce', app: '/app/ecommerce/rdp',
    about: 'For ONE agent: every remote desktop they have used and when. Or for ONE remote desktop: everyone who has used it and when.',
    says: ['rdp history', 'which rdps did', 'who used', 'who had this rdp', 'previous rdp', 'rdp before', 'history of rdp'],
    who: leads, takes: ['item'],
    blocks: ['ecom-rdp'], apis: ['/api/rdp', '/api/rdp/agents', '/api/rdp/agent-history', '/api/rdp/:id'], models: ['RdpAssignment', 'Rdp'],
    async load(ctx, a) {
      const want = a.item || a.person || a.search || ''
      const [people, list] = await Promise.all([get<{ agents: { name: string }[] }>(ctx, '/api/rdp/agents'), get<{ rdps: RdpT[] }>(ctx, '/api/rdp')])
      if (people.error !== undefined) return { error: people.error }
      if (list.error !== undefined) return { error: list.error }
      if (!want.trim()) return { error: `Say whose history (pass item with an agent's name) or which desktop. Agents: ${people.body.agents.slice(0, 60).map((x) => x.name).join(', ')}.` }
      const agents = people.body.agents.filter((x) => norm(x.name) === norm(want))
      const loose = agents.length ? agents : people.body.agents.filter((x) => sameName(want, x.name))
      if (loose.length === 1) {
        const r = await get<{ name: string; history: { team: string; provider: string; address: string; assignedAt: string; unassignedAt: string | null; active: boolean }[] }>(ctx, '/api/rdp/agent-history', { name: loose[0].name })
        if (r.error !== undefined) return { error: r.error }
        return { rows: r.body.history.map((h) => ({ who: r.body.name, desktop: desktop(h), team: h.team, from: h.assignedAt, until: h.unassignedAt, state: h.active ? 'On it now' : 'Ended' })), head: [`Remote desktops of ${r.body.name}.`] }
      }
      if (loose.length > 1) return { error: `"${want}" fits ${loose.length} agents: ${loose.slice(0, 20).map((x) => x.name).join('; ')}. Ask which one, or call again with the full name.` }
      const w = norm(want)
      const desks = list.body.rdps.filter((x) => norm(desktop(x)).includes(w) || (!!x.label && norm(x.label) === w) || norm(x.address).endsWith(w) || w.split(' ').every((k) => norm(`${x.provider} ${x.label} ${x.team} ${x.address.slice(-4)}`).includes(k)))
      if (!desks.length) return { error: `No agent and no remote desktop fits "${want}". Agents: ${people.body.agents.slice(0, 60).map((x) => x.name).join(', ')}.` }
      if (desks.length > 1) return { error: `"${want}" fits ${desks.length} remote desktops: ${desks.slice(0, 15).map(desktop).join('; ')}. Ask which one.` }
      const r = await get<{ assignments: { agentName: string; assignedAt: string; unassignedAt: string | null; note: string; active: boolean }[] }>(ctx, `/api/rdp/${encodeURIComponent(desks[0].id)}`)
      if (r.error !== undefined) return { error: r.error }
      return { rows: r.body.assignments.map((h) => ({ who: h.agentName, desktop: desktop(desks[0]), team: desks[0].team, from: h.assignedAt, until: h.unassignedAt, state: h.active ? 'On it now' : 'Ended', note: h.note })), head: [`Everyone who has used ${desktop(desks[0])}.`] }
    },
    table: {
      unit: ['use', 'uses'],
      columns: [{ key: 'who', label: 'agent' }, { key: 'desktop', label: 'desktop' }, { key: 'team', label: 'team' }, { key: 'from', label: 'from', kind: 'date' }, { key: 'until', label: 'until', kind: 'date' }, { key: 'state', label: 'state' }, { key: 'note', label: 'note', kind: 'long' }],
      people: ['who'], status: 'state', date: 'from',
    },
  },
  {
    key: 'ecommerce.task', label: 'One task and its comments', area: 'E-commerce', app: '/app/ecommerce/board',
    about: 'ONE task of the e-commerce board in full: its description, who has it, when it is due, and every comment written on it with who wrote it and when.',
    says: ['comments on', 'comment on the task', 'what did they say on', 'task details', 'details of the task', 'updates on the task', 'discussion on'],
    who: inTeam, takes: ['item'],
    blocks: ['ecom-board'], apis: ['/api/ecommerce/board', '/api/ecommerce/tasks/:id'], models: ['EcommerceTask', 'EcomTaskComment'],
    async load(ctx, a) {
      const board = await get<{ columns: { tasks: TaskT[] }[] }>(ctx, '/api/ecommerce/board')
      if (board.error !== undefined) return { error: board.error }
      const tasks = board.body.columns.flatMap((c) => c.tasks)
      const want = norm(a.item || a.search)
      if (!want) return { error: `Say which task (pass item with its title). Tasks: ${tasks.slice(0, 40).map((t) => t.title).join('; ') || 'none'}.` }
      const exact = tasks.filter((t) => norm(t.title) === want)
      const hits = exact.length ? exact : tasks.filter((t) => norm(t.title).includes(want) || want.split(' ').every((w) => norm(`${t.title} ${t.description}`).includes(w)))
      if (!hits.length) return { error: `No task on the e-commerce board fits "${a.item || a.search}". Tasks: ${tasks.slice(0, 40).map((t) => t.title).join('; ') || 'none'}.` }
      if (hits.length > 1) return { error: `"${a.item || a.search}" fits ${hits.length} tasks: ${hits.slice(0, 15).map((t) => t.title).join('; ')}. Ask which one, or call again with the full title.` }
      const r = await get<{ task: TaskT; comments: { body: string; createdAt: string; author: { name: string } }[] }>(ctx, `/api/ecommerce/tasks/${encodeURIComponent(hits[0].id)}`)
      if (r.error !== undefined) return { error: r.error }
      const t = r.body.task
      const status: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', DONE: 'Done' }
      return {
        rows: r.body.comments.map((c) => ({ when: c.createdAt, by: c.author.name, comment: c.body })),
        head: [`Task: ${t.title}. Status: ${status[t.status] ?? t.status}. Assigned to: ${nameOf(t.assignee) || 'nobody'}. Due: ${t.dueDate ?? 'no due date'}.${t.source ? ` Source: ${t.source}.` : ''}`, t.description ? `Description: ${t.description}` : 'No description.'],
      }
    },
    table: {
      unit: ['comment', 'comments'],
      columns: [{ key: 'when', label: 'when', kind: 'time' }, { key: 'by', label: 'by' }, { key: 'comment', label: 'comment', kind: 'long' }],
      people: ['by'], date: 'when',
    },
  },
  {
    key: 'ecommerce.stock_history', label: 'History of a stock request', area: 'E-commerce', app: '/app/ecommerce/stock',
    about: 'What happened to the stock requests of ONE item: who logged each, who it was given to, when its status changed and what was edited, with who did it.',
    says: ['history of the stock', 'who changed the stock', 'who resolved', 'who assigned', 'stock log history', 'what happened with the stock'],
    who: inTeam, takes: ['item'],
    blocks: ['ecom-stock'], apis: ['/api/ecommerce/stock', '/api/ecommerce/stock/:id/history'], models: ['StockRequest'],
    async load(ctx, a) {
      const list = await get<{ requests: StockT[] }>(ctx, '/api/ecommerce/stock')
      if (list.error !== undefined) return { error: list.error }
      const want = norm(a.item || a.search)
      const names = [...new Set(list.body.requests.map((s) => s.itemName))]
      if (!want) return { error: `Say which item (pass item with its name). Items with stock requests: ${names.slice(0, 50).join('; ') || 'none'}.` }
      const hits = list.body.requests.filter((s) => norm(s.itemName) === want || norm(s.itemName).includes(want) || want.split(' ').every((w) => norm(s.itemName).includes(w)))
      if (!hits.length) return { error: `No stock request is about "${a.item || a.search}". Items with stock requests: ${names.slice(0, 50).join('; ') || 'none'}.` }
      // The newest five requests that fit (an item is often requested more than once).
      const newest = [...hits].sort((x, y) => y.requestedAt.localeCompare(x.requestedAt)).slice(0, 5)
      const rows: Row[] = []
      for (const s of newest) {
        const r = await get<{ history: { at: string; by: string; what: string }[] }>(ctx, `/api/ecommerce/stock/${encodeURIComponent(s.id)}/history`)
        if (r.error !== undefined) return { error: r.error }
        const label = `${s.itemName} (${s.action === 'STOCK_IN' ? 'stock in' : 'stock out'}, requested ${s.requestedAt.slice(0, 10)})`
        for (const h of r.body.history) rows.push({ request: label, when: h.at, by: h.by, what: h.what })
      }
      return { rows, notes: hits.length > newest.length ? [`${hits.length} stock requests fit; the history of the newest ${newest.length} is given.`] : [] }
    },
    table: {
      unit: ['change', 'changes'],
      columns: [{ key: 'request', label: 'stock request' }, { key: 'when', label: 'when', kind: 'time' }, { key: 'by', label: 'by' }, { key: 'what', label: 'what changed', kind: 'long' }],
      people: ['by'], groups: ['request'], date: 'when',
    },
  },
]
