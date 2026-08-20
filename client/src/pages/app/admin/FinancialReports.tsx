import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Trash2, Pencil, Download } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { PillFilter } from '../../../components/ui/PillFilter'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { formatMoney, formatNumber, formatPercent } from '../../../lib/format'
import type { Department } from '../../../lib/types'
import { listUsers, type AdminUser } from '../../../lib/adminApi'
import {
  getFinancialReport, listSalaries, createSalary, updateSalary, deleteSalary, downloadFinancialCsv,
  type FinancialReport, type TeamFinancials, type SalaryRecord, type PersonCost,
} from '../../../lib/financialApi'

const TEAMS: { value: Department; label: string }[] = [
  { value: 'ITAD', label: 'ITAD' },
  { value: 'LEAD_GEN', label: 'Lead Generation' },
  { value: 'MARKETING', label: 'Marketing' },
]
const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const money = (n: number | null) => (n == null ? '—' : formatMoney(n))
const pct = (f: number | null) => (f == null ? '—' : formatPercent(f))
const teamLabel = (t: Department) => TEAMS.find((x) => x.value === t)?.label ?? t

interface Draft { id: string | null; userId: string; name: string; department: Department; monthlyCost: string; startDate: string; endDate: string }
const emptyDraft = (): Draft => ({ id: null, userId: '', name: '', department: 'ITAD', monthlyCost: '', startDate: monthsBefore(thisMonth(), 5), endDate: '' })

export default function FinancialReports() {
  const { addToast } = useToast()
  const [to, setTo] = useState(thisMonth())
  const [from, setFrom] = useState(monthsBefore(thisMonth(), 5))
  const [dept, setDept] = useState<'ALL' | Department>('ALL')
  const [report, setReport] = useState<FinancialReport | null>(null)
  const [salaries, setSalaries] = useState<SalaryRecord[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const loadReport = useCallback(() => {
    getFinancialReport(from, to).then(setReport).catch(() => addToast({ type: 'error', message: 'Could not load report.' }))
  }, [from, to, addToast])
  const loadSalaries = useCallback(() => {
    listSalaries().then((r) => setSalaries(r.salaries)).catch(() => undefined)
  }, [])
  useEffect(() => { loadReport() }, [loadReport])
  useEffect(() => { loadSalaries() }, [loadSalaries])
  useEffect(() => { listUsers().then((r) => setUsers(r.users.filter((u) => u.isActive))).catch(() => undefined) }, [])
  // When filtering to a team, default the Add-salary form to it (unless mid-edit).
  useEffect(() => { if (dept !== 'ALL') setDraft((d) => (d.id ? d : { ...d, department: dept })) }, [dept])

  // Only PulseTrack profiles in the three tracked teams, for the link dropdown.
  const linkableUsers = useMemo(
    () => users.filter((u) => u.department === 'ITAD' || u.department === 'LEAD_GEN' || u.department === 'MARKETING'),
    [users],
  )
  function pickUser(userId: string) {
    const u = linkableUsers.find((x) => x.id === userId)
    if (!u) { setDraft((d) => ({ ...d, userId: '' })); return }
    setDraft((d) => ({ ...d, userId, name: u.name, department: (u.department as Department) ?? d.department }))
  }

  async function saveSalary(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim()) { addToast({ type: 'error', message: 'Name is required.' }); return }
    const cost = Number(draft.monthlyCost)
    if (!(cost >= 0)) { addToast({ type: 'error', message: 'Enter a valid monthly cost.' }); return }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        userId: draft.userId || null,
        department: draft.department,
        monthlyCost: cost,
        startDate: draft.startDate,
        endDate: draft.endDate || null,
      }
      if (draft.id) await updateSalary(draft.id, payload)
      else await createSalary(payload)
      addToast({ type: 'success', message: draft.id ? 'Salary updated.' : 'Salary added.' })
      setDraft(emptyDraft())
      loadSalaries()
      loadReport()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  function editSalary(s: SalaryRecord) {
    setDraft({ id: s.id, userId: s.userId ?? '', name: s.name, department: s.department, monthlyCost: String(s.monthlyCost), startDate: s.startDate.slice(0, 7), endDate: s.endDate ? s.endDate.slice(0, 7) : '' })
  }
  async function removeSalary(s: SalaryRecord) {
    const prev = salaries
    setSalaries((xs) => xs.filter((x) => x.id !== s.id))
    try {
      await deleteSalary(s.id)
      loadReport()
    } catch {
      setSalaries(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  async function download() {
    setDownloading(true)
    try { await downloadFinancialCsv(from, to) }
    catch { addToast({ type: 'error', message: 'Could not download CSV.' }) }
    finally { setDownloading(false) }
  }

  // Per-team table
  const teamColumns: Column<TeamFinancials>[] = [
    { key: 'team', header: 'Team', render: (t) => <span className="font-medium text-ink">{t.teamName}</span> },
    { key: 'staff', header: 'Staff', align: 'right', render: (t) => formatNumber(t.staff) },
    { key: 'cost', header: 'Cost', align: 'right', render: (t) => money(t.cost) },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (t) => (t.revenue == null ? <span className="text-ink-muted">—</span> : money(t.revenue)) },
    { key: 'net', header: 'Net Return', align: 'right', render: (t) => (t.netReturn == null ? <span className="text-ink-muted">—</span> : <span className={t.netReturn >= 0 ? 'text-success' : 'text-danger'}>{money(t.netReturn)}</span>) },
    { key: 'roi', header: 'ROI', align: 'right', render: (t) => (t.roi == null ? <span className="text-ink-muted">—</span> : <span className={t.roi >= 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>{pct(t.roi)}</span>) },
  ]
  const totalRow = report && {
    cells: {
      team: 'TOTAL',
      staff: formatNumber(report.totals.staff),
      cost: money(report.totals.cost),
      revenue: money(report.totals.revenue),
      net: money(report.totals.netReturn),
      roi: pct(report.totals.roi),
    } as Record<string, ReactNode>,
  }

  // Department filter drives every box + table on the page.
  const isAll = dept === 'ALL'
  const selectedTeam = report && !isAll ? report.teams.find((t) => t.team === dept) : null
  // Dynamic summary boxes: overall totals, or the selected team's figures.
  const box = !report
    ? null
    : isAll
      ? { staff: report.totals.staff, cost: report.totals.cost, revenue: report.totals.revenue as number | null, netReturn: report.totals.netReturn as number | null, roi: report.totals.roi }
      : { staff: selectedTeam?.staff ?? 0, cost: selectedTeam?.cost ?? 0, revenue: selectedTeam?.revenue ?? null, netReturn: selectedTeam?.netReturn ?? null, roi: selectedTeam?.roi ?? null }
  const shownTeams = report ? (isAll ? report.teams : report.teams.filter((t) => t.team === dept)) : []
  const shownFormer = report ? (isAll ? report.former : report.former.filter((p) => p.team === dept)) : []
  const shownSalaries = isAll ? salaries : salaries.filter((s) => s.department === dept)

  // Per-person table (grouped by team), scoped to the selected department.
  const people = useMemo(
    () => (report ? (isAll ? report.teams.flatMap((t) => t.people) : (report.teams.find((t) => t.team === dept)?.people ?? [])) : []),
    [report, dept, isAll],
  )
  const personColumns: Column<PersonCost>[] = [
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium text-ink">{p.name}</span> },
    { key: 'monthlyCost', header: 'Monthly', align: 'right', render: (p) => money(p.monthlyCost) },
    { key: 'startDate', header: 'Start', render: (p) => p.startDate.slice(0, 7) },
    { key: 'endDate', header: 'End', render: (p) => (p.endDate ? p.endDate.slice(0, 7) : '—') },
    { key: 'activeMonths', header: 'Months', align: 'right', render: (p) => formatNumber(p.activeMonths) },
    { key: 'costInRange', header: 'Cost in range', align: 'right', render: (p) => money(p.costInRange) },
  ]

  const salaryColumns: Column<SalaryRecord>[] = [
    { key: 'name', header: 'Name', render: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Former'}</Badge> },
    { key: 'department', header: 'Team', render: (s) => teamLabel(s.department) },
    { key: 'monthlyCost', header: 'Monthly', align: 'right', render: (s) => money(s.monthlyCost) },
    { key: 'startDate', header: 'Start', render: (s) => s.startDate.slice(0, 7) },
    { key: 'endDate', header: 'End', render: (s) => (s.endDate ? s.endDate.slice(0, 7) : '—') },
    { key: 'actions', header: '', align: 'right', render: (s) => (
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => editSalary(s)} className="text-ink-muted hover:text-primary" title="Edit"><Pencil size={16} /></button>
        <button onClick={() => removeSalary(s)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button>
      </div>
    ) },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Financial Reports</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Team cost vs. revenue (closed deals) and ROI. Revenue is pulled from won deals in the Deal Tracker.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">From</label>
            <input type="month" className={sel} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">To</label>
            <input type="month" className={sel} value={to} min={from} max={thisMonth()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="secondary" leadingIcon={<Download size={16} />} onClick={download} disabled={downloading || !report}>CSV</Button>
        </div>
      </div>

      <PillFilter
        options={[{ value: 'ALL', label: 'All teams' }, ...TEAMS.map((t) => ({ value: t.value, label: t.label }))]}
        value={dept}
        onChange={(v) => setDept(v as 'ALL' | Department)}
      />

      {box && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={isAll ? 'Total Cost' : `${teamLabel(dept as Department)} Cost`} value={money(box.cost)} caption={`${box.staff} active staff`} />
          <StatCard label="Revenue" value={money(box.revenue)} caption={box.revenue == null ? 'no deal tracking yet' : 'won deals in range'} />
          <StatCard label="Net Return" value={money(box.netReturn)} valueClassName={`text-metric-lg ${(box.netReturn ?? 0) >= 0 ? 'text-success' : 'text-danger'}`} caption="revenue − cost" />
          <StatCard label="ROI" value={pct(box.roi)} caption="(revenue − cost) ÷ cost" />
        </div>
      )}

      <Card title="By team" flush>
        {report
          ? <DataTable columns={teamColumns} rows={shownTeams} getRowId={(t) => t.team} totalRow={isAll ? (totalRow || undefined) : undefined} emptyMessage="No teams." />
          : <div className="p-5 text-body-md text-ink-muted">Loading…</div>}
      </Card>
      <p className="-mt-3 px-1 text-body-sm text-ink-muted">Totals count active employees only (former employees are listed separately below). Lead Gen &amp; Marketing show cost only — revenue tracking for those teams isn't set up yet.</p>

      <Card title="Cost by person" flush>
        {report
          ? <DataTable
              columns={personColumns}
              rows={people}
              getRowId={(p) => p.id}
              groupBy={(p) => p.team}
              renderGroupHeader={(key, rows) => (
                <div className="flex items-center justify-between">
                  <span className="text-label-md uppercase text-ink-muted">{teamLabel(key as Department)}</span>
                  <span className="text-body-sm text-ink-muted">{rows.length} · {money(rows.reduce((s, p) => s + p.costInRange, 0))}</span>
                </div>
              )}
              emptyMessage="No salaries entered yet — add people below."
            />
          : <div className="p-5 text-body-md text-ink-muted">Loading…</div>}
      </Card>

      {report && shownFormer.length > 0 && (
        <Card title={`Former employees (${shownFormer.length})`} subtitle="No active PulseTrack profile — excluded from the totals and ROI above." flush>
          <DataTable
            columns={[
              { key: 'name', header: 'Name', render: (p: PersonCost) => <span className="font-medium text-ink">{p.name}</span> },
              { key: 'teamName', header: 'Team', render: (p: PersonCost) => p.teamName },
              { key: 'monthlyCost', header: 'Monthly', align: 'right', render: (p: PersonCost) => money(p.monthlyCost) },
              { key: 'startDate', header: 'Start', render: (p: PersonCost) => p.startDate.slice(0, 7) },
              { key: 'endDate', header: 'End', render: (p: PersonCost) => (p.endDate ? p.endDate.slice(0, 7) : '—') },
              { key: 'costInRange', header: 'Cost in range', align: 'right', render: (p: PersonCost) => money(p.costInRange) },
            ]}
            rows={shownFormer}
            getRowId={(p) => p.id}
          />
        </Card>
      )}

      <Card title={draft.id ? 'Edit salary' : 'Add salary'}>
        <form onSubmit={saveSalary} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-body-sm font-semibold text-ink">PulseTrack profile <span className="font-normal text-ink-muted">(sets Active)</span></label>
            <select className={sel} value={draft.userId} onChange={(e) => pickUser(e.target.value)}>
              <option value="">— none (former / no profile) —</option>
              {linkableUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {teamLabel(u.department as Department)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-body-sm font-semibold text-ink">Name</label>
            <input className={sel} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Employee name" />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Team</label>
            <select className={sel} value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value as Department })}>
              {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Monthly cost</label>
            <input type="number" min={0} step="0.01" inputMode="decimal" className={sel} value={draft.monthlyCost} onChange={(e) => setDraft({ ...draft, monthlyCost: e.target.value })} placeholder="0.00" />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Start month</label>
            <input type="month" className={sel} value={draft.startDate} max={thisMonth()} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">End month <span className="font-normal text-ink-muted">(optional)</span></label>
            <input type="month" className={sel} value={draft.endDate} min={draft.startDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving} leadingIcon={draft.id ? undefined : <Plus size={16} />}>{draft.id ? 'Save' : 'Add'}</Button>
            {draft.id && <Button type="button" variant="ghost" onClick={() => setDraft(emptyDraft())}>Cancel</Button>}
          </div>
        </form>
      </Card>

      <Card title={isAll ? 'All salaries' : `${teamLabel(dept as Department)} salaries`} flush>
        <DataTable columns={salaryColumns} rows={shownSalaries} getRowId={(s) => s.id} emptyMessage="No salaries entered yet." />
      </Card>
    </div>
  )
}
