import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Plus, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { api } from '../../../lib/api'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'

/**
 * Company settings → API: keys for the public API (/api/v1) and webhooks (Metriq tells your address when something
 * happens). A key and a webhook secret are shown once, when made. People with the Company settings power only.
 */

interface ApiKeyRow { id: string; name: string; prefix: string; access: 'read' | 'write'; lastUsedAt: string | null; createdAt: string }
interface WebhookRow { id: string; url: string; events: string[]; active: boolean; failCount: number; lastStatus: number | null; lastAt: string | null; createdAt: string }
interface Delivery { id: string; event: string; ok: boolean; status: number | null; error: string | null; durationMs: number | null; createdAt: string }
interface Overview { keys: ApiKeyRow[]; webhooks: WebhookRow[]; events: { key: string; label: string }[] }

const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never')
function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}

/** Something shown once (a new key, a webhook's secret), with a copy button. */
function ShownOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const { addToast } = useToast()
  const copy = () => navigator.clipboard.writeText(value).then(() => addToast({ type: 'success', message: 'Copied.' })).catch(() => addToast({ type: 'error', message: 'Could not copy. Select it and copy.' }))
  return (
    <div className="rounded-btn border border-success/40 bg-success/10 p-3" role="status">
      <p className="text-body-sm font-semibold text-ink">{label}</p>
      <p className="mt-0.5 text-body-sm text-ink-muted">Copy it now and keep it somewhere safe. It is not shown again.</p>
      <p className="mt-2 break-all rounded-btn border border-line bg-card px-3 py-2 font-mono text-body-sm text-ink">{value}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" leadingIcon={<Copy size={14} />} onClick={() => void copy()}>Copy</Button>
        <Button size="sm" leadingIcon={<Check size={14} />} onClick={onDone}>I saved it</Button>
      </div>
    </div>
  )
}

export function ApiSettings() {
  const { addToast } = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [failed, setFailed] = useState(false)
  const load = () => api.get<Overview>('/company/api').then(setData).catch(() => setFailed(true))
  useEffect(() => { void load() }, [])

  // ---- keys
  const [keyName, setKeyName] = useState('')
  const [keyAccess, setKeyAccess] = useState<'read' | 'write'>('read')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function addKey(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.post<{ key: ApiKeyRow; token: string }>('/company/api/keys', { name: keyName.trim(), access: keyAccess })
      setNewToken(r.token); setKeyName(''); await load()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not make the key.') }) } finally { setBusy(false) }
  }
  async function removeKey(k: ApiKeyRow) {
    if (!window.confirm(`Remove the key "${k.name}"? Anything using it stops working at once.`)) return
    try { await api.del(`/company/api/keys/${k.id}`); await load(); addToast({ type: 'success', message: 'Key removed.' }) } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not remove the key.') }) }
  }

  // ---- webhooks
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [openHook, setOpenHook] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)
  async function addHook(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.post<{ webhook: WebhookRow; secret: string }>('/company/api/webhooks', { url: url.trim(), events })
      setNewSecret(r.secret); setUrl(''); setEvents([]); await load()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not add the webhook.') }) } finally { setBusy(false) }
  }
  async function showDeliveries(id: string) {
    if (openHook === id) { setOpenHook(null); return }
    setOpenHook(id); setDeliveries(null)
    api.get<{ deliveries: Delivery[] }>(`/company/api/webhooks/${id}/deliveries`).then((r) => setDeliveries(r.deliveries)).catch(() => setDeliveries([]))
  }
  async function test(w: WebhookRow) {
    try {
      const r = await api.post<{ ok: boolean; status: number | null; error: string | null }>(`/company/api/webhooks/${w.id}/test`)
      addToast(r.ok ? { type: 'success', message: `Your address answered (${r.status}).` } : { type: 'error', message: `It did not work: ${r.error ?? `the address answered ${r.status}`}.` })
      await load(); if (openHook === w.id) { setOpenHook(null); void showDeliveries(w.id) }
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not send the test.') }) }
  }
  async function toggle(w: WebhookRow) {
    try { await api.patch(`/company/api/webhooks/${w.id}`, { active: !w.active }); await load() } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not change it.') }) }
  }
  async function removeHook(w: WebhookRow) {
    if (!window.confirm(`Remove the webhook to ${w.url}?`)) return
    try { await api.del(`/company/api/webhooks/${w.id}`); await load(); addToast({ type: 'success', message: 'Webhook removed.' }) } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not remove it.') }) }
  }

  if (failed) return <Card title="API"><p className="text-body-md text-ink-muted">Only the Super Admin, or someone given Company settings, can manage the API.</p></Card>
  if (!data) return <p className="py-8 text-center text-body-md text-ink-muted">Loading…</p>
  const base = `${window.location.origin}/api/v1`
  const label = (key: string) => data.events.find((e) => e.key === key)?.label ?? key

  return (
    <div className="space-y-5">
      <Card title="API keys" subtitle="A key lets another program read your Metriq (or add leads to it) through the API. Make one key per tool, so you can remove one without touching the others.">
        {newToken && <div className="mb-4"><ShownOnce label="Your new API key" value={newToken} onDone={() => setNewToken(null)} /></div>}
        {data.keys.length > 0 && (
          <ul className="mb-4 divide-y divide-line rounded-card border border-line">
            {data.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <KeyRound size={16} className="shrink-0 text-ink-muted" />
                <span className="min-w-[140px] flex-1 text-body-md font-medium text-ink">{k.name}<span className="ml-2 font-mono text-body-sm font-normal text-ink-muted">{k.prefix}…</span></span>
                <Badge tone={k.access === 'write' ? 'warning' : 'neutral'}>{k.access === 'write' ? 'read and write' : 'read only'}</Badge>
                <span className="text-body-sm text-ink-muted">Last used: {when(k.lastUsedAt)}</span>
                <button type="button" onClick={() => void removeKey(k)} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger-ink" aria-label={`Remove the key ${k.name}`} title="Remove this key"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addKey} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-body-sm font-semibold text-ink">Name<input className={inputCls + ' mt-1 font-normal'} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Zapier, our website, the reporting sheet" maxLength={60} /></label>
          <label className="text-body-sm font-semibold text-ink">Can<select className={inputCls + ' mt-1 w-auto font-normal'} value={keyAccess} onChange={(e) => setKeyAccess(e.target.value as 'read' | 'write')}><option value="read">Read only</option><option value="write">Read, and add leads</option></select></label>
          <Button type="submit" leadingIcon={<Plus size={16} />} disabled={busy || keyName.trim().length < 2}>Make key</Button>
        </form>
      </Card>

      <Card title="Webhooks" subtitle="Give Metriq an address and it tells that address when something happens, within seconds. Use it to connect other tools without anyone copying data by hand.">
        {newSecret && <div className="mb-4"><ShownOnce label="This webhook's signing secret" value={newSecret} onDone={() => setNewSecret(null)} /></div>}
        {data.webhooks.length > 0 && (
          <ul className="mb-4 divide-y divide-line rounded-card border border-line">
            {data.webhooks.map((w) => (
              <li key={w.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <WebhookIcon size={16} className="shrink-0 text-ink-muted" />
                  <span className="min-w-[200px] flex-1 break-all font-mono text-body-sm text-ink">{w.url}</span>
                  <Badge tone={!w.active ? 'danger' : w.failCount > 0 ? 'warning' : 'success'}>{!w.active ? (w.failCount >= 20 ? 'Off after 20 failures' : 'Off') : w.failCount > 0 ? `On · ${w.failCount} failed` : 'On'}</Badge>
                  <span className="text-body-sm text-ink-muted">Last: {w.lastAt ? `${w.lastStatus ?? 'no answer'} · ${when(w.lastAt)}` : 'nothing sent yet'}</span>
                </div>
                <p className="mt-1 text-body-sm text-ink-muted">{w.events.map(label).join(' · ')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" leadingIcon={<Send size={14} />} onClick={() => void test(w)}>Send a test</Button>
                  <Button size="sm" variant="ghost" onClick={() => void showDeliveries(w.id)}>{openHook === w.id ? 'Hide what was sent' : 'What was sent'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggle(w)}>{w.active ? 'Switch off' : 'Switch on'}</Button>
                  <Button size="sm" variant="ghost" className="text-danger-ink" onClick={() => void removeHook(w)}>Remove</Button>
                </div>
                {openHook === w.id && (
                  <div className="mt-2 rounded-btn border border-line bg-bg p-2 text-body-sm">
                    {!deliveries ? <p className="text-ink-muted">Loading…</p> : deliveries.length === 0 ? <p className="text-ink-muted">Nothing sent yet.</p> : (
                      <ul className="space-y-1">
                        {deliveries.map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center gap-2">
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', d.ok ? 'bg-success' : 'bg-danger')} aria-hidden />
                            <span className="font-mono text-ink">{d.event}</span>
                            <span className="text-ink-muted">{d.ok ? `answered ${d.status}` : d.error ?? `answered ${d.status}`}{d.durationMs != null ? ` · ${d.durationMs} ms` : ''} · {when(d.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addHook} className="space-y-3">
          <label className="block text-body-sm font-semibold text-ink">Address<input className={inputCls + ' mt-1 font-normal'} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/metriq" maxLength={500} /></label>
          <fieldset>
            <legend className="mb-1 text-body-sm font-semibold text-ink">Tell it when</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {data.events.map((ev) => (
                <label key={ev.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-body-sm text-ink hover:bg-slate-200/45">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={events.includes(ev.key)} onChange={() => setEvents((p) => (p.includes(ev.key) ? p.filter((x) => x !== ev.key) : [...p, ev.key]))} />
                  {ev.label}<span className="font-mono text-[11.5px] text-ink-faint">{ev.key}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" leadingIcon={<Plus size={16} />} disabled={busy || !url.trim() || events.length === 0}>Add webhook</Button>
        </form>
      </Card>

      <Card title="How to use it" subtitle="For the person or tool that will connect to Metriq.">
        <div className="space-y-4 text-body-sm text-ink">
          <div>
            <p className="font-semibold">Reading</p>
            <p className="mt-0.5 text-ink-muted">Send your key with every request. Lists come 50 at a time: pass <code className="font-mono">limit</code> (up to 200) and the <code className="font-mono">nextCursor</code> of the page before as <code className="font-mono">cursor</code>. 120 requests a minute per key.</p>
            <pre className="mt-2 overflow-x-auto rounded-btn border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed text-ink">{`curl ${base}/people \\\n  -H "Authorization: Bearer mtq_your_key"`}</pre>
          </div>
          <table className="w-full text-left">
            <tbody className="divide-y divide-line">
              {[
                ['GET /company', 'Your company: name, time zone, plan'],
                ['GET /people', 'Everyone, with role, department and whether they are active'],
                ['GET /departments', 'Your departments and how many people each has'],
                ['GET /attendance?from=2026-11-01&to=2026-11-30', 'Check-in, check-out and break minutes per person and day (3 months at most); add personId for one person'],
                ['GET /tasks?status=open', 'Project tasks: open (default), done or all; add updatedSince for changes only'],
                ['GET /leads', 'CRM leads; add status or updatedSince'],
                ['POST /leads', 'Add a lead (a key that can write): name, email, phone, organization, message, externalId'],
                ['GET /deals', 'Deal Tracker deals, without prices; add status'],
              ].map(([path, what]) => (
                <tr key={path}><td className="whitespace-nowrap py-1.5 pr-4 align-top font-mono text-[12.5px] text-ink">{path}</td><td className="py-1.5 text-ink-muted">{what}</td></tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="font-semibold">Webhooks</p>
            <p className="mt-0.5 text-ink-muted">Each message is a POST with a JSON body: <code className="font-mono">{'{ id, event, createdAt, data }'}</code>. To check it came from Metriq, compute HMAC-SHA256 of the raw body with your signing secret and compare it with the header <code className="font-mono">X-Metriq-Signature</code> (it reads <code className="font-mono">sha256=…</code>). Answer with any 2xx within 8 seconds. A failed message is tried three times; twenty failures in a row switch the webhook off.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
