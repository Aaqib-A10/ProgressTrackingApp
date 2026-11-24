import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ListTodo, Megaphone, Search, Users } from 'lucide-react'
import { useRange } from '../layout/AppShell'
import { getTeamWork, type PersonWork, type TeamWork as TeamWorkData, type WorkItem, type WorkKind } from '../../lib/dashboardApi'
import { formatMinutes } from '../../lib/attendanceApi'
import { ago } from '../../lib/leadsApi'
import { PersonAvatar } from '../projects/pmUi'
import { cn } from '../../lib/cn'

/**
 * "What everyone is working on" (24 Nov 2026): each person's real work, whatever their department, from projects,
 * to-dos and the marketing board: what they have in progress now and what they finished in the period picked in the
 * top bar. A developer in Marketing, a designer, a video editor: their work shows here even when their department's
 * own numbers (posts, blogs) do not count it. A member sees themself; a team lead the team; a Super Admin everyone.
 * Data: GET /api/dashboard/work (server/src/lib/teamWork.ts).
 */

const TONES = ['tone-indigo', 'tone-sky', 'tone-emerald', 'tone-amber', 'tone-rose', 'tone-violet'] as const
const KIND: Record<WorkKind, { icon: typeof FolderKanban; label: string }> = {
  task: { icon: FolderKanban, label: 'Project task' },
  todo: { icon: ListTodo, label: 'To-do' },
  marketing: { icon: Megaphone, label: 'Marketing' },
}
const RANGE_WORD: Record<string, string> = { today: 'today', week: 'this week', month: 'this month', rolling3m: 'in the last 3 months', custom: 'in these dates' }

export function TeamWork() {
  const { range, custom } = useRange()
  const [data, setData] = useState<TeamWorkData | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)

  useEffect(() => {
    let live = true
    setFailed(false)
    getTeamWork(range, custom).then((r) => live && setData(r)).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [range, custom])

  const people = useMemo(() => {
    const list = data?.people ?? []
    const s = q.trim().toLowerCase()
    return s ? list.filter((p) => p.name.toLowerCase().includes(s) || (p.department ?? '').toLowerCase().includes(s)) : list
  }, [data, q])

  if (failed) return null
  const when = RANGE_WORD[range] ?? 'in this period'
  const me = data?.scope === 'me'
  const totals = (data?.people ?? []).reduce((t, p) => ({ done: t.done + p.done.total, doing: t.doing + p.doing.length, overdue: t.overdue + p.overdue }), { done: 0, doing: 0, overdue: 0 })
  const shown = all ? people : people.slice(0, 9)

  return (
    <section className="tone-violet g-ring overflow-hidden rounded-card border bg-card shadow-card">
      <div className="g-wash flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="g-fill g-glow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><Users size={19} /></span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{me ? 'My work' : data?.scope === 'company' ? 'What everyone is working on' : 'What the team is working on'}</h2>
            <p className="text-body-sm text-ink-muted">
              {data ? `${totals.done} finished ${when} · ${totals.doing} in progress now${totals.overdue ? ` · ${totals.overdue} overdue` : ''}` : 'Loading…'}
              <span className="max-md:hidden"> · from projects, to-dos and the marketing board</span>
            </p>
          </div>
        </div>
        {!me && (data?.people.length ?? 0) > 6 && (
          <label className="relative block w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or team" aria-label="Find a person or team" className="h-9 w-full rounded-btn border border-line bg-card pl-9 pr-3 text-body-sm text-ink" />
          </label>
        )}
      </div>

      <div className="p-4 sm:p-5">
        {!data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-card" />)}</div>
        ) : !people.length ? (
          <p className="py-6 text-center text-body-md text-ink-muted">{q ? `Nobody called "${q}".` : 'Nobody here yet.'}</p>
        ) : (
          <>
            <div className={cn('grid gap-4', me ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3')}>
              {shown.map((p, i) => <PersonCard key={p.id} p={p} tone={TONES[i % TONES.length]} when={when} wide={me} />)}
            </div>
            {!all && people.length > shown.length && (
              <div className="mt-4 text-center">
                <button type="button" onClick={() => setAll(true)} className="rounded-full border border-line bg-card px-4 py-1.5 text-body-sm font-medium text-primary-ink hover:bg-primary/5">
                  Show all {people.length} people
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function PersonCard({ p, tone, when, wide }: { p: PersonWork; tone: string; when: string; wide?: boolean }) {
  const quiet = !p.doing.length && !p.done.total
  return (
    <article className={cn(tone, 'g-wash g-ring g-bar relative flex flex-col rounded-card border bg-card p-4')}>
      <header className="flex items-center gap-3">
        <PersonAvatar person={{ id: p.id, name: p.name }} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-md font-semibold text-ink">{p.name}</p>
          <p className="truncate text-body-sm text-ink-muted">{[p.department, p.lastActive ? `active ${ago(p.lastActive)}` : null].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="g-text text-[26px] font-bold leading-none tabular-nums">{p.done.total}</p>
          <p className="mt-0.5 text-[11.5px] font-medium text-ink-muted">finished</p>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip>{p.doing.length} in progress</Chip>
        <Chip>{p.open} open</Chip>
        {p.overdue > 0 && <Chip danger><AlertTriangle size={11} /> {p.overdue} overdue</Chip>}
        {p.minutes > 0 && <Chip><Clock size={11} /> {formatMinutes(p.minutes)}</Chip>}
      </div>

      {quiet ? (
        <p className="mt-4 text-body-sm text-ink-faint">Nothing in progress, and nothing finished {when}.</p>
      ) : (
        <div className={cn('mt-3 grid gap-3', wide && 'md:grid-cols-2')}>
          <Items title="Working on now" items={p.doing} max={wide ? 6 : 3} empty="Nothing in progress right now." />
          <Items title={`Finished ${when}`} items={p.done.recent} max={wide ? 6 : 3} empty={`Nothing finished ${when}.`} done more={p.done.total} />
        </div>
      )}
    </article>
  )
}

function Chip({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium', danger ? 'bg-danger/15 text-danger-ink' : 'bg-card/70 text-ink-muted ring-1 ring-line')}>
      {children}
    </span>
  )
}

function Items({ title, items, max, empty, done, more }: { title: string; items: WorkItem[]; max: number; empty: string; done?: boolean; more?: number }) {
  const list = items.slice(0, max)
  const rest = (more ?? items.length) - list.length
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      {!list.length ? (
        <p className="text-body-sm text-ink-faint">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((it, i) => {
            const K = KIND[it.kind]
            const Icon = done ? CheckCircle2 : K.icon
            const body = (
              <>
                <span className={cn('mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md', done ? 'bg-success/15 text-success-ink' : 'g-fill')} title={K.label}>
                  <Icon size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-ink">{it.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {it.where ?? K.label}
                    {it.overdue && <span className="font-semibold text-danger-ink"> · overdue</span>}
                  </span>
                </span>
              </>
            )
            return (
              <li key={`${it.kind}-${i}`}>
                {it.link ? (
                  <Link to={it.link} className="-m-1 flex items-start gap-2 rounded-md p-1 hover:bg-card/80">{body}</Link>
                ) : (
                  <div className="flex items-start gap-2">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rest > 0 && <p className="mt-1.5 text-[11.5px] text-ink-faint">and {rest} more</p>}
    </div>
  )
}
