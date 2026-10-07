import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, ListChecks, Timer } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { useToast } from '../../../components/ui/Toast'
import { AvatarStack, PriorityIcon, fieldCls, fmtDateTime } from '../../../components/projects/pmUi'
import { errMsg, projectsApi, type ReportData } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** /app/projects/dashboard — task health across the projects I administer (all for Super Admin). */
export default function ProjectsDashboard() {
  const { addToast } = useToast()
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 86400000)))
  const [to, setTo] = useState(() => iso(new Date()))
  const [project, setProject] = useState('')
  const [data, setData] = useState<ReportData | null>(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    projectsApi.report({ from, to, project })
      .then(setData)
      .catch((e) => { if (/403|admins/i.test(errMsg(e))) setDenied(true); else addToast({ type: 'error', message: errMsg(e) }) })
  }, [from, to, project, addToast])

  if (denied) return <p className="py-20 text-center text-body-md text-ink-muted">The projects dashboard is for project admins.</p>
  const o = data?.overall

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Projects dashboard</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Open work, overdue tasks and on time delivery by person and project.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-body-sm text-ink-muted">Project
            <select value={project} onChange={(e) => setProject(e.target.value)} className={cn(fieldCls, 'mt-0.5 h-9 w-44')}>
              <option value="">All my projects</option>
              {data?.projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-body-sm text-ink-muted">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cn(fieldCls, 'mt-0.5 h-9 w-40')} /></label>
          <label className="text-body-sm text-ink-muted">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cn(fieldCls, 'mt-0.5 h-9 w-40')} /></label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<ListChecks size={18} />} label="Open tasks" value={o?.open} tone="primary" />
        <Stat icon={<AlertTriangle size={18} />} label="Overdue now" value={o?.overdue} tone="danger" />
        <Stat icon={<CheckCircle2 size={18} />} label="Completed in range" value={o?.completed} tone="success" />
        <Stat icon={<Timer size={18} />} label="On time rate" value={o ? (o.onTimeRate == null ? 'n/a' : `${o.onTimeRate}%`) : undefined} tone="accent" hint={o ? `${o.completedOnTime} of ${o.completedWithDue} with a due date` : undefined} />
      </div>

      <Card title="By person" subtitle="Tasks each person is assigned to" action={<CsvLink href={projectsApi.reportCsvUrl('members', { from, to, project })} />} flush>
        <Table head={['Person', 'Open', 'Overdue', 'Completed', 'On time', 'Avg days late']} rows={(data?.byMember ?? []).map((m) => [
          <span key="n" className="font-medium text-ink">{m.name}</span>,
          m.open,
          <span key="o" className={cn(m.overdue > 0 && 'font-semibold text-danger')}>{m.overdue}</span>,
          m.completed,
          m.onTimeRate == null ? '·' : `${m.onTimeRate}%`,
          m.avgDaysLate == null ? '·' : m.avgDaysLate,
        ])} empty="No assigned tasks in these projects yet." />
      </Card>

      <Card title="By project" action={<CsvLink href={projectsApi.reportCsvUrl('projects', { from, to, project })} />} flush>
        <Table head={['Project', 'Open', 'In progress', 'Overdue', 'Done in range']} rows={(data?.byProject ?? []).map((p) => [
          <Link key="p" to={`/app/projects/${p.key}`} className="inline-flex items-center gap-2 font-medium text-ink hover:text-primary"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />{p.name}</Link>,
          p.open, p.inProgress,
          <span key="o" className={cn(p.overdue > 0 && 'font-semibold text-danger')}>{p.overdue}</span>,
          p.done,
        ])} empty="No projects." />
      </Card>

      <Card title={`Overdue now (${data?.overdue.length ?? 0})`} action={<CsvLink href={projectsApi.reportCsvUrl('overdue', { from, to, project })} />} flush>
        <Table head={['Task', 'Title', 'Project', 'Assignees', 'Status', 'Due', 'Late']} rows={(data?.overdue ?? []).map((t) => [
          <Link key="c" to={`/app/projects/${t.project.key}?task=${t.code}`} className="font-mono text-body-sm text-primary">{t.code}</Link>,
          <span key="t" className="inline-flex items-center gap-1.5"><PriorityIcon priority={t.priority} />{t.title}</span>,
          t.project.name,
          <AvatarStack key="a" people={t.assignees} size={22} />,
          t.status,
          fmtDateTime(t.dueAt),
          <span key="l" className="font-semibold text-danger">{t.daysOverdue === 0 ? 'today' : `${t.daysOverdue}d`}</span>,
        ])} empty="Nothing is overdue. 🎉" />
      </Card>
    </div>
  )
}

function Stat({ icon, label, value, tone, hint }: { icon: React.ReactNode; label: string; value: number | string | undefined; tone: 'primary' | 'danger' | 'success' | 'accent'; hint?: string }) {
  const cls = { primary: 'text-primary', danger: 'text-danger', success: 'text-success', accent: 'text-accent' }[tone]
  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className={cn('flex items-center gap-1.5 text-body-sm', cls)}>{icon}{label}</div>
      <div className="mt-1 text-metric-lg tabular-nums text-ink">{value ?? <span className="inline-block h-8 w-12 animate-pulse rounded bg-slate-100" />}</div>
      {hint && <p className="text-body-sm text-ink-muted">{hint}</p>}
    </div>
  )
}

function CsvLink({ href }: { href: string }) {
  return <a href={href} className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary"><Download size={14} /> CSV</a>
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[620px] text-body-md">
        <thead className="border-y border-line bg-slate-50"><tr>{head.map((h, i) => <th key={h} scope="col" className={cn('px-4 py-2 text-label-md uppercase text-ink-muted', i === 0 ? 'text-left' : 'text-right', i === 1 && head[1] === 'Title' && 'text-left')}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={i} className={cn(i % 2 === 1 && 'bg-slate-50/50')}>{r.map((c, j) => <td key={j} className={cn('px-4 py-2 tabular-nums', j === 0 || (j === 1 && head[1] === 'Title') ? 'text-left' : 'text-right')}>{c}</td>)}</tr>)}
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-4 py-8 text-center text-ink-muted">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
