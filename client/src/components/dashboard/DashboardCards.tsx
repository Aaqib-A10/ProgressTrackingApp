import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, ClipboardList, ClipboardPen, LineChart, MessagesSquare, PieChart, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge, SubmissionBadge } from '../ui/Badge'
import { StatCard } from '../StatCard'
import { DataTable, type Column } from '../DataTable'
import { TrendLineChart } from '../charts/TrendLineChart'
import { DonutChart } from '../charts/DonutChart'
import { EmptyState } from '../ui/EmptyState'
import { AssignedTasksCard } from '../AssignedTasksCard'
import { EmployeeOfMonthCard } from '../EmployeeOfMonthCard'
import { TodoList } from '../TodoList'
import { useRange } from '../layout/AppShell'
import { filterNav } from '../layout/navConfig'
import { canOpen } from '../../lib/access'
import { cn } from '../../lib/cn'
import { ROLE_LABEL, type CurrentUser } from '../../lib/types'
import { DEPARTMENT_LABEL } from '../../lib/departments'
import { formatNumber, formatPercent } from '../../lib/format'
import { getTeamDashboard, type DashSubmission, type TeamDashboard } from '../../lib/dashboardApi'
import { getAttendanceMe, getAttendanceTeam, type MeResponse, type TeamAttendanceResponse } from '../../lib/attendanceApi'
import { chatApi, type ConversationListItem } from '../../lib/chatApi'
import { todayIso, workLogApi, type TeamWorkLog, type WorkEntry } from '../../lib/workLogApi'
import { customApi, iconOf, type CustomSummary } from '../../lib/customApi'
import { CUSTOM_CARD, cardByKey, type DashCard } from '../../lib/cards'
import { QuickAction, RecentFeedback, greeting, logPath } from '../../pages/app/DashboardHome'
import { fmtAgo } from '../projects/pmUi'

/**
 * The cards a department's dashboard is made of (Department Studio, part B; the list is in
 * lib/cards.ts). Each card loads its own data, and shows a quiet note when there is nothing.
 */

export const SPAN: Record<1 | 2 | 3, string> = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3' }

export function DashboardCard({ card, user }: { card: DashCard; user: CurrentUser }) {
  if (CUSTOM_CARD.test(card.key)) return <CustomBlockCard id={card.key.slice(7)} />
  switch (card.key) {
    case 'greeting': return <Greeting user={user} />
    case 'quick-actions': return <QuickActions user={user} />
    case 'shortcuts': return <Shortcuts user={user} />
    case 'my-tasks': return <AssignedTasksCard />
    case 'todo-today': return <TodoToday />
    case 'checklist': return <Card title="Quick checklist" subtitle="Private to you"><TodoList limit={8} /></Card>
    case 'attendance': return <AttendanceCard />
    case 'chat-unread': return <ChatUnread />
    case 'feedback': return <RecentFeedback />
    case 'employee-of-month': return <EmployeeOfMonthCard />
    case 'team-today': return <TeamToday />
    case 'team-todo': return <TeamTodo />
    case 'team-kpis': case 'team-trend': case 'team-breakdown': case 'team-improvement': case 'team-submissions': return <TeamCard part={card.key} />
    default: return <Card title={cardByKey(card.key)?.label ?? 'Card'}><p className="text-body-sm text-ink-muted">This card is not available.</p></Card>
  }
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-body-sm text-ink-muted">{children}</p>
}
function Loading() {
  return <div className="space-y-2 py-1">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-5 rounded" />)}</div>
}
const More = ({ to, children = 'Open' }: { to: string; children?: ReactNode }) => (
  <Link to={to} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm font-medium text-ink-muted hover:bg-slate-100 hover:text-ink">{children} <ArrowRight size={13} /></Link>
)

function Greeting({ user }: { user: CurrentUser }) {
  return (
    <div className="py-1">
      <p className="text-body-sm font-medium text-ink-faint">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{greeting()}, {user.name.split(' ')[0]}</h1>
        <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
      </div>
      <p className="mt-1 text-body-md text-ink-muted">{user.department ? `${DEPARTMENT_LABEL[user.department]} · ` : ''}Here&apos;s where you pick up your work.</p>
    </div>
  )
}

function QuickActions({ user }: { user: CurrentUser }) {
  const log = logPath(user)
  const items = [
    log && canOpen(user, log) ? <QuickAction key="log" to={log} icon={<ClipboardList size={17} />} title="Log today's progress" desc="Submit your daily entry in under a minute." /> : null,
    canOpen(user, '/app/daily-report') && (user.blocks?.includes('daily-report') ?? false) ? <QuickAction key="dr" to="/app/daily-report" icon={<ClipboardPen size={17} />} title="Daily report" desc="Fill in today's report." /> : null,
    canOpen(user, '/app/qa/my') && (!user.blocks || user.blocks.includes('my-qa')) ? <QuickAction key="qa" to="/app/qa/my" icon={<ClipboardCheck size={17} />} title="My QA scores" desc="See how your calls were scored." /> : null,
    canOpen(user, '/app/analytics') && (!user.blocks || user.blocks.includes('my-analytics')) ? <QuickAction key="an" to="/app/analytics" icon={<LineChart size={17} />} title="My analytics" desc="Your numbers over time." /> : null,
  ].filter(Boolean)
  if (!items.length) return <Card title="Quick actions"><Quiet>Nothing to log today.</Quiet></Card>
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{items}</div>
}

function Shortcuts({ user }: { user: CurrentUser }) {
  const items = filterNav(user).flatMap((g) => [...g.items, ...(g.subgroups ?? []).flatMap((s) => s.items)]).filter((i) => i.to !== '/app/dashboard').slice(0, 18)
  return (
    <Card title="Shortcuts">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((i) => {
          const Icon = i.icon
          return (
            <Link key={i.to} to={i.to} className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-2 text-body-sm font-medium text-ink hover:border-primary/40 hover:bg-primary/5">
              <Icon size={15} className="shrink-0 text-primary" /><span className="truncate">{i.label}</span>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

function TodoToday() {
  const [rows, setRows] = useState<WorkEntry[] | null>(null)
  useEffect(() => {
    const d = todayIso()
    workLogApi.list(d, d).then((r) => setRows(r.entries.filter((e) => e.period === 'DAY' && e.periodStart === d))).catch(() => setRows([]))
  }, [])
  const done = rows?.filter((e) => e.status === 'DONE').length ?? 0
  return (
    <Card title="Today's to-dos" subtitle={rows ? `${done} of ${rows.length} done` : undefined} action={<More to="/app/todo" />}>
      {!rows ? <Loading /> : rows.length === 0 ? <Quiet>Nothing planned for today yet.</Quiet> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 7).map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-body-sm">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.status === 'DONE' ? 'bg-success' : e.status === 'IN_PROGRESS' ? 'bg-warning' : 'bg-slate-300')} />
              <span className={cn('line-clamp-2 break-words', e.status === 'DONE' ? 'text-ink-muted line-through' : 'text-ink')}>{e.title}</span>
            </li>
          ))}
          {rows.length > 7 && <li className="text-body-sm text-ink-muted">+{rows.length - 7} more</li>}
        </ul>
      )}
    </Card>
  )
}

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  NOT_IN: { text: 'Not checked in', tone: 'bg-slate-100 text-ink-muted' },
  IN: { text: 'Checked in', tone: 'bg-success/10 text-success' },
  ON_BREAK: { text: 'On a break', tone: 'bg-warning/10 text-warning' },
  OUT: { text: 'Checked out', tone: 'bg-primary/10 text-primary' },
}
const hm = (min: number | null | undefined) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`)

function AttendanceCard() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { getAttendanceMe().then(setMe).catch(() => setFailed(true)) }, [])
  const s = me ? STATE_LABEL[me.today.state] : null
  return (
    <Card title="My attendance" action={<More to="/app/attendance/me" />}>
      {failed ? <Quiet>Attendance is not available.</Quiet> : !me ? <Loading /> : me.offLabel ? <Quiet>{me.offName ?? 'Day off'} today.</Quiet> : (
        <div className="space-y-2">
          <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-body-sm font-semibold', s?.tone)}>{s?.text}</span>
          <dl className="grid grid-cols-2 gap-2 text-body-sm">
            <div><dt className="text-ink-muted">In at</dt><dd className="font-semibold text-ink">{me.today.checkInLabel ?? '—'}</dd></div>
            <div><dt className="text-ink-muted">Worked</dt><dd className="font-semibold tabular-nums text-ink">{hm(me.today.workedMin)}</dd></div>
          </dl>
          {me.today.late && <p className="text-body-sm font-medium text-warning">Late today</p>}
        </div>
      )}
    </Card>
  )
}

function ChatUnread() {
  const [list, setList] = useState<ConversationListItem[] | null>(null)
  useEffect(() => { chatApi.conversations().then((r) => setList(r.conversations.filter((c) => c.unread > 0))).catch(() => setList([])) }, [])
  const navigate = useNavigate()
  return (
    <Card title="New messages" action={<More to="/app/chat" />}>
      {!list ? <Loading /> : list.length === 0 ? <Quiet>You are all caught up.</Quiet> : (
        <ul className="space-y-1">
          {list.slice(0, 6).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => navigate(`/app/chat?c=${encodeURIComponent(c.id)}`)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50">
                <MessagesSquare size={14} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-ink">{c.title}</span>
                  {c.lastMessage && <span className="block truncate text-[12px] text-ink-muted">{c.lastMessage.body}</span>}
                </span>
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-white">{c.unread}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TeamToday() {
  const [d, setD] = useState<TeamAttendanceResponse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { getAttendanceTeam('today').then(setD).catch(() => setFailed(true)) }, [])
  const order: Record<string, number> = { ON_BREAK: 0, IN: 1, NOT_IN: 2, OUT: 3 }
  return (
    <Card title="Who is in" subtitle={d ? `${d.summary.inNow} in · ${d.summary.onBreakNow} on a break · ${d.summary.notInNow} not in yet` : undefined} action={<More to="/app/attendance/team" />}>
      {failed ? <Quiet>Team attendance is not available.</Quiet> : !d ? <Loading /> : d.board.length === 0 ? <Quiet>No one in the team yet.</Quiet> : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {[...d.board].sort((a, b) => order[a.state] - order[b.state]).slice(0, 12).map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-body-sm dark:bg-slate-800/40">
              <span className="truncate font-medium text-ink">{p.name}</span>
              <span className={cn('shrink-0 rounded-full px-2 text-[11px] font-semibold', STATE_LABEL[p.state]?.tone)}>{p.state === 'IN' && p.checkIn ? `in ${p.checkIn}` : STATE_LABEL[p.state]?.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TeamTodo() {
  const [d, setD] = useState<TeamWorkLog | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { workLogApi.team('DAY', todayIso()).then(setD).catch(() => setFailed(true)) }, [])
  const help = d?.members.filter((m) => m.blocked > 0).length ?? 0
  return (
    <Card title="Team's to-dos today" subtitle={d ? `${d.members.filter((m) => m.entries.length).length} of ${d.members.length} logged${help ? ` · ${help} need help` : ''}` : undefined} action={<More to="/app/todo?view=team" />} flush>
      {failed ? <div className="px-5 pb-4"><Quiet>The team view is not available.</Quiet></div> : !d ? <div className="px-5 pb-4"><Loading /></div> : d.members.length === 0 ? <div className="px-5 pb-4"><Quiet>No one in the team yet.</Quiet></div> : (
        <ul className="divide-y divide-line">
          {[...d.members].sort((a, b) => b.blocked - a.blocked || a.entries.length - b.entries.length).slice(0, 10).map((m) => (
            <li key={m.id} className={cn('flex flex-wrap items-center gap-2 px-5 py-2 text-body-sm', m.blocked > 0 && 'bg-danger/5')}>
              <span className="min-w-[120px] flex-1 truncate font-medium text-ink">{m.name}</span>
              {m.entries.length === 0 ? <span className="text-ink-muted">Nothing logged yet</span> : <>
                <span className="rounded-full bg-success/10 px-2 font-semibold text-success">{m.done} done</span>
                <span className="rounded-full bg-slate-100 px-2 font-semibold text-ink-muted">{m.planned} open</span>
                {m.blocked > 0 && <span className="rounded-full bg-danger/10 px-2 font-semibold text-danger">needs help</span>}
              </>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// The team performance cards share one load per range.
const teamCache = new Map<string, Promise<TeamDashboard>>()
function useTeamDashboard() {
  const { range, custom } = useRange()
  const [d, setD] = useState<TeamDashboard | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const k = `${range}|${custom ? JSON.stringify(custom) : ''}`
    let p = teamCache.get(k)
    if (!p) { p = getTeamDashboard(range, custom); teamCache.set(k, p); setTimeout(() => teamCache.delete(k), 30_000) }
    let live = true
    p.then((x) => live && setD(x)).catch(() => { teamCache.delete(k); if (live) setFailed(true) })
    return () => { live = false }
  }, [range, custom])
  return { d, failed }
}

function TeamCard({ part }: { part: string }) {
  const { d, failed } = useTeamDashboard()
  const navigate = useNavigate()
  const title = cardByKey(part)?.label ?? ''
  if (failed) return <Card title={title}><Quiet>Team numbers are not available for this department.</Quiet></Card>
  if (!d) return <Card title={title}><Loading /></Card>
  if (part === 'team-kpis') {
    const fmt = (k: { value: number; format: 'number' | 'percent' }) => (k.format === 'percent' ? formatPercent(k.value) : formatNumber(k.value))
    return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{d.kpis.map((k) => <StatCard key={k.label} label={k.label} value={fmt(k)} delta={k.now ? undefined : k.delta} caption={k.caption} />)}</div>
  }
  if (part === 'team-trend') {
    const target = d.trend.points.some((p) => p.target !== undefined)
    return <Card title={`${d.trend.metricLabel} over time`} subtitle={target ? 'Actual vs target' : 'Team total'}><TrendLineChart data={d.trend.points} showTargetSeries={target} /></Card>
  }
  if (part === 'team-breakdown') {
    const total = d.breakdown.reduce((a, b) => a + b.value, 0)
    return <Card title={d.breakdownTitle ?? 'Breakdown'}>{total > 0 ? <DonutChart data={d.breakdown} centerValue={formatNumber(total)} centerLabel="Total" /> : <EmptyState icon={<PieChart />} title="No activity in this period" />}</Card>
  }
  if (part === 'team-improvement') {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-primary/10 text-primary"><Sparkles size={18} /></span>
          <div><p className="text-body-sm font-semibold uppercase tracking-wide text-primary">Improvement Summary</p><p className="mt-0.5 text-body-md text-ink">{d.improvement}</p></div>
        </div>
      </Card>
    )
  }
  const showStatus = d.people?.showStatus ?? true
  const cols: Column<DashSubmission>[] = [
    { key: 'name', header: 'Team Member', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    ...(showStatus ? [{ key: 'status', header: 'Status', render: (r: DashSubmission) => <SubmissionBadge status={r.status} /> }] : []),
    { key: 'metric', header: d.todaySubmissions[0]?.metricLabel ?? 'Today', align: 'right', render: (r) => formatNumber(r.metricValue) },
  ]
  return (
    <Card title={d.people?.title ?? "Today's Submissions"} subtitle={d.people?.subtitle ?? `${d.counts.submitted} of ${d.counts.total} submitted`} flush>
      <DataTable columns={cols} rows={d.todaySubmissions} getRowId={(r) => r.id} onRowClick={(r) => navigate(`/app/members/${r.id}`)} emptyMessage="No team members yet." />
    </Card>
  )
}

function CustomBlockCard({ id }: { id: string }) {
  const [s, setS] = useState<CustomSummary | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { customApi.summary(id).then(setS).catch(() => setFailed(true)) }, [id])
  if (failed) return <Card title="Block"><Quiet>This block is not in your menu.</Quiet></Card>
  if (!s) return <Card title="…"><Loading /></Card>
  const Icon = iconOf(s.block.icon)
  const max = Math.max(1, ...(s.by?.counts.map((c) => c.count) ?? [1]))
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${s.block.color}1f`, color: s.block.color }}><Icon size={14} /></span>{s.block.name}</span>}
      subtitle={`${s.total} in all · ${s.thisWeek} this week`}
      action={<More to={`/app/custom/${s.block.id}`} />}
    >
      {s.by && s.by.counts.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {s.by.counts.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-body-sm">
              <span className="w-24 shrink-0 truncate text-ink-muted">{c.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, background: s.block.color }} /></span>
              <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-ink">{c.count}</span>
            </div>
          ))}
        </div>
      )}
      {s.latest.length === 0 ? <Quiet>Nothing added yet.</Quiet> : (
        <ul className="space-y-1 text-body-sm">
          {s.latest.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="truncate text-ink">{r.title}</span><span className="shrink-0 text-[11px] text-ink-faint">{fmtAgo(r.createdAt)}</span></li>)}
        </ul>
      )}
    </Card>
  )
}
