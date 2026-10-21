import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, ShieldCheck, ShieldAlert, Wifi, UserX, MapPin } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import {
  listOfficeNetworks, createOfficeNetwork, setOfficeNetworkActive, deleteOfficeNetwork, allowOfficeNetwork,
  type OfficeNetwork, type BlockedNetwork, type OfficeNetworksResponse,
} from '../../../lib/adminApi'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

const inputCls =
  'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function AdminNetworks() {
  const { addToast } = useToast()
  const [networks, setNetworks] = useState<OfficeNetwork[]>([])
  const [enforced, setEnforced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [cidr, setCidr] = useState('')
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<BlockedNetwork[]>([])
  const [you, setYou] = useState<OfficeNetworksResponse['you'] | null>(null)

  function load() {
    listOfficeNetworks()
      .then((r) => { setNetworks(r.networks); setEnforced(r.enforced); setBlocked(r.blocked ?? []); setYou(r.you ?? null) })
      .catch(() => addToast({ type: 'error', message: 'Could not load office networks.' }))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!label.trim() || !cidr.trim()) return
    setSaving(true)
    try {
      await createOfficeNetwork({ label: label.trim(), cidr: cidr.trim() })
      addToast({ type: 'success', message: 'Office network added.' })
      setLabel(''); setCidr('')
      load()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not add network.') })
    } finally {
      setSaving(false)
    }
  }

  async function allow(ip: string, wholeRange: boolean, label?: string) {
    setSaving(true)
    try {
      const r = await allowOfficeNetwork({ ip, wholeRange, label })
      addToast({ type: 'success', message: `Allowed ${r.network.cidr}. People on it can check in now.` })
      load()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not allow it.') })
    } finally {
      setSaving(false)
    }
  }

  async function toggle(n: OfficeNetwork) {
    try {
      await setOfficeNetworkActive(n.id, !n.isActive)
      load()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not update.') })
    }
  }

  async function remove(n: OfficeNetwork) {
    if (!confirm(`Remove "${n.label}" (${n.cidr}) from the allowlist?`)) return
    try {
      await deleteOfficeNetwork(n.id)
      addToast({ type: 'success', message: 'Removed.' })
      load()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not remove.') })
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Office Networks</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">
          Check-in is only allowed from these office addresses (breaks and check-out are never blocked once someone is in). Add your office’s <b>public</b> IP
          (from your ISP), not a local <code className="rounded bg-slate-100 px-1">192.168.x</code> address.
        </p>
      </div>

      {/* Enforcement status banner */}
      <div className={'flex items-start gap-3 rounded-card border p-4 ' + (enforced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5')}>
        {enforced ? <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success" /> : <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warning" />}
        <div className="text-body-sm">
          {enforced ? (
            <><b className="text-ink">Enforcement is ON.</b> <span className="text-ink-muted">Only the active networks below can check in. Breaks and check-out are not blocked once someone has checked in. Super Admins and localhost are always allowed.</span></>
          ) : (
            <><b className="text-ink">Enforcement is OFF.</b> <span className="text-ink-muted">No active networks — anyone can check in from anywhere. Add and activate at least one network to enforce office-only attendance.</span></>
          )}
        </div>
      </div>

      {blocked.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <UserX size={18} className="text-danger" />
            <h2 className="text-body-lg font-semibold text-ink">Stopped at check-in</h2>
            <span className="text-body-sm text-ink-muted">last 7 days</span>
          </div>
          <p className="mb-3 text-body-sm text-ink-muted">
            These people could not check in because their network is not on the list. If they were in the office, allow it.
            Allowing the whole range also covers the office when the internet provider changes the address or a second line is used.
          </p>
          <ul className="divide-y divide-line rounded-btn border border-line">
            {blocked.map((b) => (
              <li key={b.ip} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <code className="text-body-md font-semibold text-ink">{b.ip}</code>
                  <p className="text-body-sm text-ink-muted">
                    {b.people.join(', ')} · {b.count} time{b.count === 1 ? '' : 's'} · last {new Date(b.lastAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={saving} onClick={() => allow(b.ip, false)}>Allow this address</Button>
                {b.range && <Button size="sm" disabled={saving} onClick={() => allow(b.ip, true)}>Allow range {b.range}</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {you && !/^(127\.|::1$)/.test(you.ip) && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <MapPin size={18} className="text-primary" />
            <div className="min-w-0 flex-1 text-body-sm">
              <span className="text-ink-muted">Your network right now: </span>
              <code className="font-semibold text-ink">{you.ip}</code>
              {enforced && <span className={'ml-2 ' + (you.allowed ? 'text-success' : 'text-warning')}>{you.allowed ? 'on the office list' : 'not on the list'}</span>}
            </div>
            {!you.allowed || !enforced ? (
              <>
                <Button size="sm" variant="secondary" disabled={saving} onClick={() => allow(you.ip, false, 'Office line')}>Add as office</Button>
                {you.range && <Button size="sm" variant="secondary" disabled={saving} onClick={() => allow(you.ip, true, 'Office range')}>Add range {you.range}</Button>}
              </>
            ) : null}
          </div>
          <p className="mt-1 text-body-sm text-ink-muted">Only add this when you are in the office yourself.</p>
        </Card>
      )}

      <Card>
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-body-sm font-medium text-ink">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. HQ Karachi" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-body-sm font-medium text-ink">Public IP or CIDR</span>
            <input value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="203.0.113.7, 203.0.113.0/24 or an IPv6 /64" className={inputCls} />
          </label>
          <Button type="submit" leadingIcon={<Plus size={16} />} disabled={saving}>Add</Button>
        </form>
      </Card>

      <Card flush>
        {loading ? (
          <p className="p-5 text-body-md text-ink-muted">Loading…</p>
        ) : networks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Wifi size={24} className="text-ink-muted" />
            <p className="text-body-md text-ink-muted">No networks yet. Add your office IP above to turn on enforcement.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {networks.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body-md font-medium text-ink">{n.label}</span>
                    {n.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <code className="text-body-sm text-ink-muted">{n.cidr}</code>
                </div>
                <Toggle checked={n.isActive} onChange={() => toggle(n)} label={`Toggle ${n.label}`} />
                <button onClick={() => remove(n)} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Remove">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
