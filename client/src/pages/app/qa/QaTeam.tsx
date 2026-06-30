import { useEffect, useState } from 'react'
import { Users, Trophy, ClipboardCheck, CheckCircle2, AlertTriangle } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line } from 'recharts'
import { Card } from '../../../components/ui/Card'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { DonutChart } from '../../../components/charts/DonutChart'
import { CHART, SERIES_COLORS } from '../../../components/charts/chartTheme'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import type { RangeKey } from '../../../components/layout/RangeSelector'
import { getQaTeamDashboard, type QaTeamDashboard, type QaDashAgent } from '../../../lib/qaApi'

type Dept = 'ITAD' | 'CSR'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'rolling3m', label: 'Last 3 Months' },
]

function scoreColor(s: number): string {
  if (s >= 82) return CHART.success
  if (s >= 64) return CHART.primary
  if (s >= 50) return CHART.warning
  return CHART.danger
}
function heatBg(s: number): string {
  if (s >= 82) return 'rgba(34,197,94,.16)'
  if (s >= 64) return 'rgba(79,70,229,.12)'
  if (s >= 50) return 'rgba(245,158,11,.16)'
  return 'rgba(239,68,68,.16)'
}
const FLAG: Record<QaDashAgent['flag'], { tone: BadgeTone; text: string }> = {
  good: { tone: 'success', text: 'On track' },
  warn: { tone: 'warning', text: 'Watch' },
  coach: { tone: 'danger', text: 'Coach' },
}
const agentColor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]
const TT = { borderRadius: 12, border: `1px solid ${CHART.grid}`, fontSize: 12, boxShadow: '0 10px 15px -3px rgba(15,23,42,0.08)' }

export default function QaTeam() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const canPick = user?.role === 'QA' || user?.role === 'QA_LEAD' || user?.role === 'SUPER_ADMIN'
  const [dept, setDept] = useState<Dept>('ITAD')
  const [range, setRange] = useState<RangeKey>('month')
  const [data, setData] = useState<QaTeamDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [openAgent, setOpenAgent] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    getQaTeamDashboard(canPick ? dept : '', range)
      .then((r) => { if (active) { setData(r); setOpenAgent(null) } })
      .catch(() => active && addToast({ type: 'error', message: 'Could not load the QA dashboard.' }))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [dept, range, canPick, addToast])

  const t = data?.totals
  const selected = data?.agents.find((a) => a.id === openAgent) ?? null

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">QA Team Dashboard</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            {data?.department ?? dept} · Call-quality performance{data?.teamLead ? ` · Lead ${data.teamLead.name}` : ''}{data?.scorecard ? ` · ${data.scorecard}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPick && (
            <div className="inline-flex gap-1.5">
              {(['ITAD', 'CSR'] as Dept[]).map((d) => (
                <button key={d} onClick={() => setDept(d)} className={'rounded-full px-3.5 py-1.5 text-body-md font-medium transition-colors ' + (dept === d ? 'bg-primary text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{d}</button>
              ))}
            </div>
          )}
          <div className="inline-flex gap-1.5">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)} className={'rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors ' + (range === r.key ? 'bg-ink text-white' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading || !data || !t ? (
        <Card><p className="py-12 text-center text-body-md text-ink-muted">Loading…</p></Card>
      ) : t.evaluations === 0 ? (
        <Card><p className="py-12 text-center text-body-md text-ink-muted">No evaluations in this period.</p></Card>
      ) : (
        <>
          {/* KPI ROW */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total evaluations" value={t.evaluations} caption="This period" icon={<ClipboardCheck size={16} />} />
            <StatCard label="Team average" value={`${t.avgScore}%`} caption={`Across ${t.agentCount} agent${t.agentCount === 1 ? '' : 's'}`} icon={<Users size={16} />} />
            <StatCard label="Pass rate" value={`${t.passRate}%`} caption={`${data.passFail.pass}P / ${data.passFail.fail}F calls`} icon={<CheckCircle2 size={16} />} />
            <StatCard label="Needs coaching" value={t.coachingCount} caption={`Below ${data.bands.good}%`} icon={<AlertTriangle size={16} />} />
            <StatCard label="Top performer" value={t.topPerformer?.name ?? '—'} caption={t.topPerformer ? `${t.topPerformer.avg}% avg` : ''} icon={<Trophy size={16} />} />
          </div>

          {/* OVERVIEW */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card title="Quality distribution">
              <DonutChart
                height={180}
                centerValue={`${Math.round(t.avgScore)}%`}
                centerLabel="team avg"
                data={data.qualityDistribution.map((d) => ({
                  name: d.band, value: d.count,
                  color: d.band === 'Excellent' ? CHART.success : d.band === 'Watch' ? CHART.warning : CHART.danger,
                }))}
              />
              <div className="mt-2 flex justify-center gap-4 text-body-sm text-ink-muted">
                <Legend swatch={CHART.success} label="Excellent" />
                <Legend swatch={CHART.warning} label="Watch" />
                <Legend swatch={CHART.danger} label="Coach" />
              </div>
            </Card>

            <Card title="Pass vs fail — per agent">
              <div className="space-y-2.5">
                {data.agents.map((a) => {
                  const total = a.passCalls + a.failCalls || 1
                  const p = Math.round((a.passCalls / total) * 100)
                  return (
                    <div key={a.id} className="flex items-center gap-2.5">
                      <span className="w-16 shrink-0 truncate text-body-sm text-ink">{a.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${p}%`, background: CHART.success }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-label-md tabular-nums text-ink-muted">{a.passCalls}P/{a.failCalls}F</span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 border-t border-line pt-2 text-center text-body-sm text-ink-muted">
                Overall <span className="font-semibold text-success">{t.passRate}% pass</span> · {data.passFail.pass + data.passFail.fail} calls
              </p>
            </Card>

            <Card title="Score distribution">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.scoreBands} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={CHART.axis} fontSize={9} tickLine={false} axisLine={false} interval={0} />
                  <YAxis allowDecimals={false} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} agent${v === 1 ? '' : 's'}`, 'Count']} />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]} barSize={34}>
                    {data.scoreBands.map((_, i) => (
                      <Cell key={i} fill={[CHART.danger, CHART.warning, CHART.primary, CHART.success][i]} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* AGENT RANKING + CATEGORY AVERAGE */}
          {selected && (
            <Card>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-body-md font-semibold text-primary">{selected.initials}</span>
                <div>
                  <p className="text-headline-md text-ink">{selected.name}</p>
                  <p className="text-body-sm text-ink-muted">Overall {selected.avg}% · {selected.evals} eval{selected.evals === 1 ? '' : 's'} · {selected.passCalls} pass / {selected.failCalls} fail</p>
                </div>
                <span className="ml-auto"><Badge tone={FLAG[selected.flag].tone}>{FLAG[selected.flag].text}</Badge></span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {data.categoryNames.map((cn) => {
                  const v = selected.cats[cn] ?? 0
                  return (
                    <div key={cn} className="rounded-lg bg-slate-50 p-2.5">
                      <p className="text-label-md uppercase text-ink-muted">{cn}</p>
                      <p className="mt-0.5 text-xl font-bold tabular-nums" style={{ color: scoreColor(v) }}>{v}%</p>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full" style={{ width: `${v}%`, background: scoreColor(v) }} /></div>
                    </div>
                  )
                })}
              </div>
              {(() => {
                const weak = data.categoryNames.reduce((a, b) => ((selected.cats[a] ?? 100) <= (selected.cats[b] ?? 100) ? a : b))
                return <p className="mt-3 rounded-lg border-l-[3px] border-warning bg-warning/10 px-3 py-2 text-body-sm text-warning">Coaching priority: <b>{weak}</b> is lowest at {selected.cats[weak] ?? 0}% — focus here first.</p>
              })()}
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card title="Agent ranking" subtitle="Click a row to drill into category scores" flush>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-body-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                        <th className="px-4 py-2.5 font-semibold">#</th>
                        <th className="px-2 py-2.5 font-semibold">Agent</th>
                        <th className="px-2 py-2.5 text-right font-semibold">Score</th>
                        <th className="px-2 py-2.5 font-semibold">Bar</th>
                        <th className="px-2 py-2.5 text-right font-semibold">Pass</th>
                        <th className="px-2 py-2.5 text-right font-semibold">Fail</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.agents.map((a, i) => (
                        <tr key={a.id} onClick={() => setOpenAgent(openAgent === a.id ? null : a.id)} className={'cursor-pointer ' + (openAgent === a.id ? 'bg-primary/5' : 'hover:bg-slate-50')}>
                          <td className="px-4 py-2.5"><span className={'flex h-5 w-5 items-center justify-center rounded-full text-label-md font-bold ' + (i < 3 ? 'bg-primary/15 text-primary' : 'bg-slate-100 text-ink-muted')}>{i + 1}</span></td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-label-md font-semibold text-ink-muted">{a.initials}</span>
                              <span className="font-medium text-ink">{a.name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right font-bold tabular-nums" style={{ color: scoreColor(a.avg) }}>{a.avg}%</td>
                          <td className="px-2 py-2.5"><div className="h-1.5 w-[70px] overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${a.avg}%`, background: scoreColor(a.avg) }} /></div></td>
                          <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-success">{a.passCalls}</td>
                          <td className="px-2 py-2.5 text-right font-semibold tabular-nums" style={{ color: a.failCalls > 0 ? CHART.danger : CHART.axis }}>{a.failCalls}</td>
                          <td className="px-4 py-2.5 text-right"><Badge tone={FLAG[a.flag].tone}>{FLAG[a.flag].text}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="lg:col-span-2">
              <Card title="Category — team average">
                <ResponsiveContainer width="100%" height={Math.max(180, data.categories.length * 34)}>
                  <BarChart layout="vertical" data={data.categories} margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="name" width={108} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TT} formatter={(v: number) => [`${v}%`, 'Team avg']} />
                    <Bar dataKey="avg" radius={[0, 4, 4, 0]} barSize={16} label={{ position: 'right', fontSize: 11, fill: CHART.axis, formatter: (v: number) => `${v}%` }}>
                      {data.categories.map((c, i) => <Cell key={i} fill={scoreColor(c.avg)} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>

          {/* WEEKLY TREND */}
          <Card title="Weekly score trend — per agent" subtitle="Average score each week">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.weekly.map((w) => ({ week: w.week, ...w.scores }))} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis domain={[40, 100]} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TT} formatter={(v: number) => `${v}%`} />
                {data.agents.map((a, i) => (
                  <Line key={a.id} type="monotone" dataKey={a.name} stroke={agentColor(i)} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-3">
              {data.agents.map((a, i) => <Legend key={a.id} swatch={agentColor(i)} label={a.name} line />)}
            </div>
          </Card>

          {/* CATEGORY BREAKDOWN + GAP */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Category breakdown — all agents">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.categoryNames.map((cn) => { const row: Record<string, number | string> = { category: cn }; data.agents.forEach((a) => { row[a.name] = a.cats[cn] ?? 0 }); return row })} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="category" stroke={CHART.axis} fontSize={9} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={48} />
                  <YAxis domain={[0, 100]} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TT} formatter={(v: number) => `${v}%`} />
                  {data.agents.map((a, i) => <Bar key={a.id} dataKey={a.name} fill={agentColor(i)} fillOpacity={0.85} radius={[2, 2, 0, 0]} />)}
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-3">
                {data.agents.map((a, i) => <Legend key={a.id} swatch={agentColor(i)} label={a.name} />)}
              </div>
            </Card>

            <Card title={`Category gap — team avg vs target (${data.bands.target}%)`} flush>
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                      <th className="px-4 py-2.5 font-semibold">Category</th>
                      <th className="px-2 py-2.5 text-right font-semibold">Team avg</th>
                      <th className="px-2 py-2.5 text-right font-semibold">Gap</th>
                      <th className="px-4 py-2.5 font-semibold">Weakest agent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.catGap.map((c) => (
                      <tr key={c.name}>
                        <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                        <td className="px-2 py-2.5 text-right font-bold tabular-nums" style={{ color: scoreColor(c.avg) }}>{c.avg}%</td>
                        <td className="px-2 py-2.5 text-right">
                          <span className="rounded px-1.5 py-0.5 text-label-md font-bold tabular-nums" style={{ background: c.gap >= 0 ? 'rgba(34,197,94,.14)' : 'rgba(239,68,68,.14)', color: c.gap >= 0 ? CHART.success : CHART.danger }}>{c.gap >= 0 ? `+${c.gap}` : c.gap}%</span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{c.weakest ? `${c.weakest.name} (${c.weakest.score}%)` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* HEATMAP */}
          <Card title="Agent × category heatmap">
            <div className="overflow-x-auto">
              <table className="w-full border-separate text-body-sm" style={{ borderSpacing: 4 }}>
                <thead>
                  <tr>
                    <th className="px-1 py-1 text-left text-label-md uppercase text-ink-muted">Agent</th>
                    {data.categoryNames.map((cn) => <th key={cn} className="px-1 py-1 text-center text-label-md uppercase text-ink-muted">{cn}</th>)}
                    <th className="px-1 py-1 text-center text-label-md uppercase text-ink-muted">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-1 py-1 text-ink">{a.name}</td>
                      {data.categoryNames.map((cn) => {
                        const v = a.cats[cn] ?? 0
                        return <td key={cn} className="rounded-md px-2 py-1.5 text-center font-semibold tabular-nums" style={{ background: heatBg(v), color: scoreColor(v) }}>{v}%</td>
                      })}
                      <td className="rounded-md px-2 py-1.5 text-center font-extrabold tabular-nums" style={{ background: heatBg(a.avg), color: scoreColor(a.avg) }}>{a.avg}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-center text-body-sm text-ink-muted">Click an agent row above to see their category breakdown · scores update with the period filter.</p>
        </>
      )}
    </div>
  )
}

function Legend({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-body-sm text-ink-muted">
      <span className="inline-block rounded-sm" style={{ background: swatch, width: line ? 16 : 9, height: line ? 3 : 9 }} />
      {label}
    </span>
  )
}
