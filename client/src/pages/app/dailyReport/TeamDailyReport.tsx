import { useEffect, useMemo, useState } from 'react'
import { Download, Users, Send, Clock, Palmtree } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { CHART, SERIES_COLORS, tooltipStyle } from '../../../components/charts/chartTheme'
import { useTheme } from '../../../lib/theme'
import { cn } from '../../../lib/cn'
import { dailyReportApi, type Monthly, type ReportForm, type TeamDay, type Trend, type Answer, type Tone } from '../../../lib/dailyReportApi'
import { errMsg, inputCls } from './MyDailyReport'

/** The team's daily reports (Phase 1, step 5): the day, the trend, and the month. */

const TONE_TEXT: Record<Tone, string> = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-ink' }
const STATUS: Record<TeamDay['rows'][number]['status'], { label: string; tone: BadgeTone }> = {
  SENT: { label: 'Sent', tone: 'success' }, MISSING: { label: 'Not sent', tone: 'warning' }, ON_LEAVE: { label: 'On leave', tone: 'neutral' }, HOLIDAY: { label: 'Holiday', tone: 'neutral' },
}
const SERIES = SERIES_COLORS
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 1 }))
function show(v: Answer | undefined): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return num(v)
  return v
}
const todayIso = () => new Date().toLocaleDateString('en-CA')

export default function TeamDailyReport() {
  const { addToast } = useToast()
  const [forms, setForms] = useState<ReportForm[] | null>(null)
  const [formId, setFormId] = useState<string | null>(null)
  const [view, setView] = useState<'day' | 'trend' | 'month'>('day')
  useEffect(() => {
    dailyReportApi.forms().then((r) => { const mine = r.forms.filter((f) => f.canSeeTeam); setForms(mine); setFormId((id) => id ?? mine[0]?.id ?? null) })
      .catch((e) => { setForms([]); addToast({ type: 'error', message: errMsg(e, 'Could not load the reports.') }) })
  }, [addToast])
  const form = forms?.find((f) => f.id === formId) ?? null
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Team Daily Reports</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Who sent their report, the numbers against targets, and how the team is doing over time.</p>
        </div>
        {forms && forms.length > 1 && (
          <select className={inputCls + ' !w-auto'} value={formId ?? ''} onChange={(e) => setFormId(e.target.value)} aria-label="Form">
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
      </div>
      {!forms ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : !form ? <Card><p className="text-body-md text-ink-muted">No daily form for your team yet. Make one in Report Forms.</p></Card> : (
        <>
          <div role="tablist" className="flex gap-1">
            {([['day', 'The day'], ['trend', 'Over time'], ['month', 'The month']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} type="button" onClick={() => setView(k)} className={cn('rounded-full px-3.5 py-1.5 text-body-sm font-medium', view === k ? 'bg-ink text-card' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{l}</button>
            ))}
          </div>
          {view === 'day' && <DayView key={form.id} form={form} />}
          {view === 'trend' && <TrendView key={form.id} form={form} />}
          {view === 'month' && <MonthView key={form.id} form={form} />}
        </>
      )}
    </div>
  )
}

function DayView({ form }: { form: ReportForm }) {
  const { addToast } = useToast()
  const [date, setDate] = useState(todayIso())
  const [data, setData] = useState<TeamDay | null>(null)
  useEffect(() => { setData(null); dailyReportApi.team(form.id, date).then(setData).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the day.') })) }, [form.id, date, addToast])
  const fields = form.fields
  const columns: Column<TeamDay['rows'][number]>[] = useMemo(() => [
    { key: 'name', header: 'Person', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'status', header: 'Report', render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    ...fields.map((f) => ({
      key: f.id, header: f.label, align: (f.type === 'NUMBER' || f.type === 'RATING' ? 'right' : 'left') as 'right' | 'left', wrap: f.type === 'LONG_TEXT' || f.type === 'TEXT',
      render: (r: TeamDay['rows'][number]) => <span className={cn('tabular-nums', TONE_TEXT[r.tones[f.id] ?? 'neutral'])}>{show(r.values?.[f.id])}</span>,
    })),
  ], [fields])
  return (
    <>
      <div className="flex items-center gap-2"><input type="date" className={inputCls + ' !w-auto'} value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />{data?.holiday && <Badge tone="neutral">{data.holiday}</Badge>}</div>
      {!data ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="People" value={data.counts.people} icon={<Users />} />
            <StatCard label="Sent" value={data.counts.sent} icon={<Send />} />
            <StatCard label="Not sent" value={data.counts.missing} icon={<Clock />} />
            <StatCard label="On leave" value={data.counts.onLeave} icon={<Palmtree />} />
          </div>
          {data.totals.length > 0 && (
            <Card title="Team totals" subtitle="Targets are per person a day, times the people working.">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.totals.map((t) => {
                  const f = fields.find((x) => x.id === t.fieldId)
                  if (!f) return null
                  return (
                    <div key={t.fieldId} className="rounded-btn border border-line p-3.5">
                      <p className="text-body-sm text-ink-muted">{f.label}</p>
                      <p className={cn('mt-1 text-headline-lg tabular-nums', TONE_TEXT[t.tone])}>{f.type === 'RATING' ? `${num(t.average)} / 5` : num(t.total)}{f.unit ? <span className="ml-1 text-body-sm text-ink-muted">{f.unit}</span> : null}</p>
                      <p className="text-body-sm text-ink-muted">{t.target != null ? `Target ${num(t.target)}` : f.type === 'RATING' ? `${t.answers} ratings` : 'No target'}{f.type === 'NUMBER' && t.answers ? ` · ${num(t.average)} each` : ''}</p>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
          <Card title="Everyone" flush>
            <DataTable columns={columns} rows={data.rows} getRowId={(r) => r.userId} />
          </Card>
        </>
      )}
    </>
  )
}

function TrendView({ form }: { form: ReportForm }) {
  const { addToast } = useToast()
  useTheme()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Trend | null>(null)
  useEffect(() => {
    const to = todayIso()
    const from = new Date(Date.now() - (days - 1) * 86400_000).toLocaleDateString('en-CA')
    setData(null)
    dailyReportApi.trend(form.id, from, to).then(setData).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the trend.') }))
  }, [form.id, days, addToast])
  const rows = useMemo(() => data?.days.map((d) => ({ label: new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), sent: d.sent, ...d.totals })) ?? [], [data])
  return (
    <>
      <div className="flex gap-1.5">{[7, 30, 90].map((n) => <button key={n} type="button" onClick={() => setDays(n)} className={cn('rounded-btn border px-3 py-1.5 text-body-sm', days === n ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted')}>{n} days</button>)}</div>
      {!data ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : (
        <>
          <Card title="Reports sent a day" subtitle={`${data.people} people fill this form in`}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle()} />
                <ReferenceLine y={data.people} stroke={CHART.target} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="sent" name="Sent" stroke={SERIES[0]} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          {data.fields.length > 0 && (
            <Card title="The numbers, added up each day">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip {...tooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {data.fields.map((f, i) => <Line key={f.id} type="monotone" dataKey={f.id} name={f.label} stroke={SERIES[(i + 1) % SERIES.length]} strokeWidth={2} dot={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </>
  )
}

function MonthView({ form }: { form: ReportForm }) {
  const { addToast } = useToast()
  const [month, setMonth] = useState(todayIso().slice(0, 7))
  const [data, setData] = useState<Monthly | null>(null)
  useEffect(() => { setData(null); dailyReportApi.monthly(form.id, month).then(setData).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the month.') })) }, [form.id, month, addToast])
  const columns: Column<Monthly['rows'][number]>[] = useMemo(() => [
    { key: 'name', header: 'Person', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'sent', header: 'Reports', align: 'right', render: (r) => <span className="tabular-nums">{r.sent} / {r.due}</span> },
    { key: 'leave', header: 'On leave', align: 'right', render: (r) => <span className="tabular-nums">{r.onLeave}</span> },
    ...(data?.fields ?? []).flatMap((f) => [
      { key: `${f.id}-t`, header: `${f.label} total`, align: 'right' as const, render: (r: Monthly['rows'][number]) => <span className="tabular-nums">{f.type === 'RATING' ? '—' : num(r.fields[f.id]?.total ?? 0)}</span> },
      { key: `${f.id}-a`, header: `${f.label} a day`, align: 'right' as const, render: (r: Monthly['rows'][number]) => <span className={cn('tabular-nums', TONE_TEXT[r.fields[f.id]?.tone ?? 'neutral'])}>{num(r.fields[f.id]?.average ?? 0)}</span> },
    ]),
  ], [data])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className={inputCls + ' !w-auto'} value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        <a href={dailyReportApi.monthlyCsvUrl(form.id, month)} download><Button variant="secondary" size="sm" leadingIcon={<Download size={15} />}>Download spreadsheet</Button></a>
      </div>
      {!data ? <Card><p className="text-body-md text-ink-muted">Loading…</p></Card> : (
        <Card title={new Date(`${month}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} subtitle={`${data.workDays} working days so far (Monday to Saturday, not holidays). Averages are per report sent.`} flush>
          <DataTable columns={columns} rows={data.rows} getRowId={(r) => r.userId} />
        </Card>
      )}
    </>
  )
}
