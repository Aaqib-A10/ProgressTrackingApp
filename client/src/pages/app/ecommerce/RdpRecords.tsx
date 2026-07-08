import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Search, Trash2, History, Users, Server } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import {
  listRdps, getRdp, createRdp, updateRdp, deleteRdp,
  assignAgent, endAssignment, deleteAssignment,
  listRdpAgents, getAgentHistory,
  TEAM_LABEL, type RdpTeam, type RdpRow, type RdpListResponse, type RdpDetail, type RdpAgentRow, type AgentHistoryRow, type RdpInput,
} from '../../../lib/rdpApi'

const TEAM_TONE: Record<RdpTeam, BadgeTone> = { EC: 'primary', CSR: 'accent', SHIPPING: 'warning' }
const sel = 'h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function TeamBadge({ team }: { team: RdpTeam }) {
  return <Badge tone={TEAM_TONE[team]}>{TEAM_LABEL[team]}</Badge>
}

export default function RdpRecords() {
  const [view, setView] = useState<'rdps' | 'agents'>('rdps')
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">RDP Records</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Remote machines, who uses them, and full assignment history.</p>
        </div>
        <div className="inline-flex rounded-btn border border-line bg-card p-0.5">
          <button onClick={() => setView('rdps')} className={'flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-body-sm font-semibold ' + (view === 'rdps' ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink')}>
            <Server size={15} /> Machines
          </button>
          <button onClick={() => setView('agents')} className={'flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-body-sm font-semibold ' + (view === 'agents' ? 'bg-primary/10 text-primary' : 'text-ink-muted hover:text-ink')}>
            <Users size={15} /> By agent
          </button>
        </div>
      </div>

      {view === 'rdps' ? <MachinesView /> : <AgentsView />}
    </div>
  )
}

function MachinesView() {
  const { addToast } = useToast()
  const [data, setData] = useState<RdpListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState('')
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<RdpRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  function reload() {
    setLoading(true)
    listRdps({ team, provider, status, search })
      .then(setData)
      .catch(() => addToast({ type: 'error', message: 'Could not load RDPs.' }))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [team, provider, status, search])

  const columns: Column<RdpRow>[] = [
    { key: 'team', header: 'Team', render: (r) => <TeamBadge team={r.team} /> },
    { key: 'provider', header: 'Provider', render: (r) => <span className="font-medium text-ink">{r.provider}</span> },
    { key: 'address', header: 'Address', render: (r) => <span className="font-mono text-body-sm text-ink">{r.address}</span> },
    {
      key: 'agents',
      header: 'Current agents',
      render: (r) =>
        r.currentAgents.length === 0 ? (
          <span className="text-body-sm text-ink-muted">— none —</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.currentAgents.map((a) => (
              <span key={a} className="rounded-full bg-slate-100 px-2 py-0.5 text-body-sm text-ink">{a}</span>
            ))}
          </div>
        ),
    },
    { key: 'total', header: 'Ever used by', align: 'right', render: (r) => r.totalAgents },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'} dot>{r.active ? 'Active' : 'Retired'}</Badge> },
  ]

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, provider, agent…" className={sel + ' h-9 w-full pl-8'} />
          </div>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
            <option value="">All teams</option>
            {(['EC', 'CSR', 'SHIPPING'] as RdpTeam[]).map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
          </select>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={sel}>
            <option value="">All providers</option>
            {(data?.providers ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
          <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setAddOpen(true)}>Add RDP</Button>
        </div>
      </Card>

      <Card flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={data?.rdps ?? []} getRowId={(r) => r.id} onRowClick={(r) => setSelected(r)} emptyMessage="No RDPs match these filters." />
        )}
      </Card>

      {selected && <RdpDetailModal rdp={selected} onClose={() => setSelected(null)} onChanged={reload} />}
      {addOpen && <AddRdpModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); reload() }} />}
    </>
  )
}

function RdpDetailModal({ rdp, onClose, onChanged }: { rdp: RdpRow; onClose: () => void; onChanged: () => void }) {
  const { addToast } = useToast()
  const [detail, setDetail] = useState<RdpDetail | null>(null)
  const [agentName, setAgentName] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    getRdp(rdp.id).then(setDetail).catch(() => addToast({ type: 'error', message: 'Could not load history.' }))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [rdp.id])

  async function assign(e: FormEvent) {
    e.preventDefault()
    if (!agentName.trim()) return
    setBusy(true)
    try {
      await assignAgent(rdp.id, { agentName: agentName.trim() })
      setAgentName('')
      load(); onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not assign.') })
    } finally { setBusy(false) }
  }
  async function end(id: string) {
    await endAssignment(id).catch(() => undefined)
    load(); onChanged()
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this history row permanently?')) return
    await deleteAssignment(id).catch(() => undefined)
    load(); onChanged()
  }
  async function retire() {
    try {
      await updateRdp(rdp.id, { active: !rdp.active })
      addToast({ type: 'success', message: rdp.active ? 'RDP retired.' : 'RDP reactivated.' })
      onChanged(); onClose()
    } catch { addToast({ type: 'error', message: 'Could not update.' }) }
  }
  async function del() {
    if (!window.confirm('Delete this RDP and its entire history? This cannot be undone.')) return
    try {
      await deleteRdp(rdp.id)
      addToast({ type: 'success', message: 'RDP deleted.' })
      onChanged(); onClose()
    } catch { addToast({ type: 'error', message: 'Could not delete.' }) }
  }

  const current = detail?.assignments.filter((a) => a.active) ?? []
  const past = detail?.assignments.filter((a) => !a.active) ?? []

  return (
    <Modal open onClose={onClose} title={`${rdp.provider} · ${rdp.address}`} size="lg">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TeamBadge team={rdp.team} />
        <Badge tone={rdp.active ? 'success' : 'neutral'} dot>{rdp.active ? 'Active' : 'Retired'}</Badge>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={retire}>{rdp.active ? 'Retire' : 'Reactivate'}</Button>
          <Button size="sm" variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={del}>Delete</Button>
        </span>
      </div>

      <form onSubmit={assign} className="mb-4 flex items-end gap-2 rounded-card border border-line bg-bg p-3">
        <label className="flex-1">
          <span className="mb-1 block text-body-sm font-semibold text-ink">Assign an agent</span>
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent name" className={sel + ' h-10 w-full'} />
        </label>
        <Button size="md" onClick={assign} disabled={busy}>Assign</Button>
      </form>

      {detail == null ? (
        <div className="py-6 text-center text-body-sm text-ink-muted">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-label-md uppercase text-ink-muted">Currently using ({current.length})</p>
            {current.length === 0 ? (
              <p className="text-body-sm text-ink-muted">No one is assigned right now.</p>
            ) : (
              <ul className="space-y-1.5">
                {current.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-btn border border-line px-3 py-2">
                    <span className="font-medium text-ink">{a.agentName}</span>
                    <span className="text-body-sm text-ink-muted">since {fmtDate(a.assignedAt)}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => end(a.id)}>End</Button>
                      <button onClick={() => remove(a.id)} className="rounded-btn p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" title="Delete row"><Trash2 size={15} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-label-md uppercase text-ink-muted"><History size={13} /> Past users ({past.length})</p>
            {past.length === 0 ? (
              <p className="text-body-sm text-ink-muted">No past users recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {past.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-btn bg-slate-50 px-3 py-2">
                    <span className="font-medium text-ink">{a.agentName}</span>
                    <span className="text-body-sm text-ink-muted">{fmtDate(a.assignedAt)} → {a.unassignedAt ? fmtDate(a.unassignedAt) : '—'}</span>
                    <button onClick={() => remove(a.id)} className="ml-auto rounded-btn p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" title="Delete row"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function AddRdpModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { addToast } = useToast()
  const [form, setForm] = useState<RdpInput>({ team: 'EC', provider: '', address: '' })
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<RdpInput>) => setForm((f) => ({ ...f, ...p }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.provider.trim() || !form.address.trim()) return
    setSaving(true)
    try {
      await createRdp(form)
      addToast({ type: 'success', message: 'RDP added.' })
      onCreated()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not add RDP.') })
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Add RDP" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>Add</Button></>}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Team</label>
          <select value={form.team} onChange={(e) => set({ team: e.target.value as RdpTeam })} className={sel + ' h-10 w-full'}>
            {(['EC', 'CSR', 'SHIPPING'] as RdpTeam[]).map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
          </select>
        </div>
        <TextField label="Provider" value={form.provider} onChange={(e) => set({ provider: e.target.value })} placeholder="e.g. Sj Computers" />
        <TextField label="Address (IP or Anydesk ID)" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="e.g. 192.168.10.100" />
        <TextField label="Label (optional)" value={form.label ?? ''} onChange={(e) => set({ label: e.target.value })} />
      </form>
    </Modal>
  )
}

function AgentsView() {
  const { addToast } = useToast()
  const [agents, setAgents] = useState<RdpAgentRow[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    listRdpAgents().then((r) => setAgents(r.agents)).catch(() => addToast({ type: 'error', message: 'Could not load agents.' }))
  }, [addToast])

  const columns: Column<RdpAgentRow>[] = [
    { key: 'name', header: 'Agent', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'teams', header: 'Teams', render: (r) => <div className="flex gap-1">{r.teams.map((t) => <TeamBadge key={t} team={t} />)}</div> },
    { key: 'active', header: 'Active RDPs', align: 'right', render: (r) => r.active },
    { key: 'total', header: 'Ever used', align: 'right', render: (r) => r.total },
  ]

  return (
    <>
      <Card flush>
        {agents == null ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={agents} getRowId={(r) => r.name} onRowClick={(r) => setSelected(r.name)} emptyMessage="No agents on record yet." />
        )}
      </Card>
      {selected && <AgentHistoryModal name={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function AgentHistoryModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [rows, setRows] = useState<AgentHistoryRow[] | null>(null)
  useEffect(() => { getAgentHistory(name).then((r) => setRows(r.history)).catch(() => setRows([])) }, [name])
  return (
    <Modal open onClose={onClose} title={`${name} — RDP history`} size="lg">
      <p className="mb-3 text-body-sm text-ink-muted">Every machine {name} has used. Useful when they leave the team.</p>
      {rows == null ? (
        <div className="py-6 text-center text-body-sm text-ink-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-body-sm text-ink-muted">No RDP history.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.assignmentId} className={'flex flex-wrap items-center gap-3 rounded-btn border border-line px-3 py-2 ' + (r.active ? '' : 'bg-slate-50')}>
              <TeamBadge team={r.team} />
              <span className="font-medium text-ink">{r.provider}</span>
              <span className="font-mono text-body-sm text-ink">{r.address}</span>
              <span className="ml-auto text-body-sm text-ink-muted">
                {fmtDate(r.assignedAt)} → {r.active ? <span className="font-semibold text-success">present</span> : fmtDate(r.unassignedAt!)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
