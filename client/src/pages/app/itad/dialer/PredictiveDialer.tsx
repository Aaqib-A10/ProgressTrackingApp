import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Link2, Plus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { cn } from '../../../../lib/cn'
import { copyText } from '../../../../lib/workLogApi'
import { dialerApi, type IntegrationCall, type IntegrationData, type IntegrationTest } from '../../../../lib/dialerApi'
import { Panel, errMsg } from './ui'

/**
 * Lead Dialer → Settings → Predictive dialer (ITAD team leads and Super Admins).
 * The dialer calls a private link after every call; Metriq finds the lead (Metriq lead ID,
 * CRM lead ID or phone), logs the call (outcome, notes, agent, time, length) and updates the
 * lead: status forward, Callback → call back in Follow-ups, DNC and wrong numbers out of dialing.
 */

const inp = 'h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none'
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dur = (s: number | null) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`)
const FIELD_LABEL: Record<string, string> = {
  leadId: 'Metriq lead ID', crmId: 'CRM lead ID', phone: 'Phone number', disposition: 'Disposition', notes: 'Call notes',
  agent: 'Agent', duration: 'Talk time (seconds)', callId: 'Call ID', calledAt: 'Call time', callbackAt: 'Callback time',
}

export function PredictiveDialer() {
  const { addToast } = useToast()
  const [d, setD] = useState<IntegrationData | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [name, setName] = useState('Predictive dialer')
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<[string, string][]>([])
  const [agents, setAgents] = useState<[string, string][]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [testMsg, setTestMsg] = useState('')
  const [test, setTest] = useState<IntegrationTest | null>(null)

  const load = () => dialerApi.integration().then((r) => {
    setD(r)
    setCodes(Object.entries(r.integration?.dispositionMap ?? {}))
    setAgents(Object.entries(r.integration?.agentMap ?? {}))
    setFields(r.integration?.fieldMap ?? {})
  }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the dialer set-up') }))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div className="h-32 animate-pulse rounded-card bg-slate-100" />
  const it = d.integration
  const hook = link ?? (it ? `https://…/api/dialer-hook/${it.prefix}… (shown once when made)` : '')

  async function make() {
    if (it && !window.confirm('Make a new link? The old link stops working at once, so the dialer must be given the new one.')) return
    setBusy(true)
    try { const r = await dialerApi.makeIntegration(name.trim() || 'Predictive dialer'); setLink(r.hookUrl); await load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not make the link') }) } finally { setBusy(false) }
  }
  async function save(extra: { enabled?: boolean } = {}) {
    setBusy(true)
    try {
      await dialerApi.saveIntegration({ ...extra, fieldMap: fields, dispositionMap: Object.fromEntries(codes.filter(([k, v]) => k.trim() && v)), agentMap: Object.fromEntries(agents.filter(([k, v]) => k.trim() && v)) })
      addToast({ type: 'success', message: extra.enabled === false ? 'Dialer link switched off.' : extra.enabled ? 'Dialer link switched on.' : 'Saved.' })
      await load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save') }) } finally { setBusy(false) }
  }
  async function runTest() {
    try { setTest(await dialerApi.testIntegration(testMsg)) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not read that message') }) }
  }

  return (
    <div className="space-y-4">
      <Panel title="Predictive dialer" info="After every call the dialer sends the result to a private Metriq link. Metriq finds the lead (by the Metriq lead ID in your download, the CRM lead ID, or the phone number), logs the call with the agent, time, length and notes, and updates the lead. Nobody types anything.">
        <div className="space-y-3 text-body-sm">
          {it ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold', it.enabled ? 'bg-success/10 text-success' : 'bg-slate-100 text-ink-muted')}>{it.enabled ? <><CheckCircle2 size={13} /> On</> : 'Off'}</span>
              <span className="text-ink">{it.name}</span>
              <code className="font-mono text-[11px] text-ink-muted">{it.prefix}…</code>
              <span className="text-ink-muted">· {it.lastReceivedAt ? `last call received ${when(it.lastReceivedAt)}` : 'no call received yet'}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" leadingIcon={<Power size={14} />} disabled={busy} onClick={() => save({ enabled: !it.enabled })}>{it.enabled ? 'Switch off' : 'Switch on'}</Button>
                <Button size="sm" variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={busy} onClick={make}>New link</Button>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="mb-1 block font-semibold text-ink">Dialer name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={cn(inp, 'h-10 w-56')} /></label>
              <Button leadingIcon={<Link2 size={15} />} disabled={busy} onClick={make}>Make the dialer link</Button>
            </div>
          )}
          {link && (
            <div className="space-y-2 rounded-card border border-success/40 bg-success/5 p-3">
              <p className="font-semibold text-ink">The dialer link. It is shown only this once: copy it into the dialer now. Anyone with it can log calls, so keep it private.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-btn border border-line bg-card px-3 py-2 font-mono text-[12px] text-ink">{link}</code>
                <Button size="sm" leadingIcon={<Copy size={14} />} onClick={async () => { await copyText(link); addToast({ type: 'success', message: 'Link copied' }) }}>Copy</Button>
              </div>
            </div>
          )}
          {it && (
            <ol className="list-decimal space-y-1.5 pl-5 text-ink">
              <li>In the dialer, find the setting that calls a link after each call: it is often called <b>Dispo URL</b>, <b>Webhook</b>, <b>Post-call URL</b> or <b>API notification</b>. Paste the link. POST (JSON or a web form) or GET with the fields on the link both work.</li>
              <li>The dialer should send the phone number, the disposition and, if it can, the agent, notes, talk time, a call ID and the callback time. Metriq knows the usual field names; set others under <b>Field names</b>.</li>
              <li>When you upload leads to the dialer, use Metriq's <b>Download</b>: it has a <b>Metriq lead ID</b> column. Map it to the dialer's own lead reference field (vendor or source ID) and every call matches the right lead even when two leads share a number.</li>
              <li>Check it with <b>Try a message</b> below, then make one test call.</li>
            </ol>
          )}
          {it && (
            <details className="rounded-btn border border-line px-3 py-2">
              <summary className="cursor-pointer font-semibold text-ink">Example for a VICIdial-style dispo URL</summary>
              <code className="mt-2 block break-all font-mono text-[11px] text-ink-muted">{hook}?phone_number=--A--phone_number--B--&amp;dispo=--A--dispo--B--&amp;user=--A--user--B--&amp;talk_time=--A--talk_time--B--&amp;uniqueid=--A--uniqueid--B--&amp;vendor_lead_code=--A--vendor_lead_code--B--&amp;comments=--A--comments--B--&amp;callback_datetime=--A--callback_datetime--B--</code>
            </details>
          )}
        </div>
      </Panel>

      {it && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Dispositions" info="Each disposition becomes an outcome. No answer and Busy: Contact Attempted. Voicemail: Voicemail Sent. Connected: Connected. Interested: Interested. Callback: Connected plus a call back (it shows in Follow-ups at that time; tomorrow if the dialer sends no time). Not interested: Not Interested. Wrong number: out of dialing until the CRM sends a new phone. DNC: status DNC and never dialed again. A status only moves forward, except Not interested and DNC. Changes are marked for Earthzone.">
            <div className="space-y-2 text-body-sm">
              <p className="text-ink-muted">Metriq already knows the common codes (NA, N, B, A, AM, VM, NI, DNC, DC, CALLBK, SALE, XFER and the plain words). Add your dialer's own codes here.</p>
              {codes.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={k} onChange={(e) => setCodes(codes.map((c, j) => (j === i ? [e.target.value, c[1]] : c)))} placeholder="Dialer code, e.g. NOINT" className={cn(inp, 'w-44')} />
                  <span className="text-ink-muted">→</span>
                  <select value={v} onChange={(e) => setCodes(codes.map((c, j) => (j === i ? [c[0], e.target.value] : c)))} className={cn(inp, 'flex-1')}>
                    <option value="">Pick an outcome</option>
                    {d.outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setCodes(codes.filter((_, j) => j !== i))} className="rounded p-1 text-ink-muted hover:bg-slate-100 hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setCodes([...codes, ['', '']])} className="inline-flex items-center gap-1 font-semibold text-primary"><Plus size={14} /> Add a code</button>
            </div>
          </Panel>

          <Panel title="Agents" info="Who made the call. Metriq links an agent by the same email or name on its own; link the others here (the agent ID or login the dialer sends). Calls from an agent not linked are logged under the lead's rep, with the agent's dialer name.">
            <div className="space-y-2 text-body-sm">
              {agents.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={k} onChange={(e) => setAgents(agents.map((c, j) => (j === i ? [e.target.value, c[1]] : c)))} placeholder="Dialer agent ID, e.g. 1003" className={cn(inp, 'w-44')} />
                  <span className="text-ink-muted">→</span>
                  <select value={v} onChange={(e) => setAgents(agents.map((c, j) => (j === i ? [c[0], e.target.value] : c)))} className={cn(inp, 'flex-1')}>
                    <option value="">Pick the person</option>
                    {d.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setAgents(agents.filter((_, j) => j !== i))} className="rounded p-1 text-ink-muted hover:bg-slate-100 hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setAgents([...agents, ['', '']])} className="inline-flex items-center gap-1 font-semibold text-primary"><Plus size={14} /> Add an agent</button>
            </div>
          </Panel>

          <Panel title="Field names (only if your dialer uses other names)" info="Leave a box empty and Metriq looks for the usual names, shown in grey.">
            <div className="grid gap-2 text-body-sm sm:grid-cols-2">
              {d.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-0.5 block text-ink-muted">{FIELD_LABEL[f.key] ?? f.key}</span>
                  <input value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} placeholder={f.names.slice(0, 3).join(', ')} className={cn(inp, 'w-full')} />
                </label>
              ))}
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-ink-muted">The dialer's clock, for times sent without a time zone</span>
                <input value={fields.timeZone ?? ''} onChange={(e) => setFields({ ...fields, timeZone: e.target.value })} placeholder="UTC (e.g. America/New_York or Asia/Karachi)" className={cn(inp, 'w-full')} />
              </label>
            </div>
          </Panel>

          <Panel title="Try a message" info="Paste what the dialer sends (JSON, a form, or the full link with ?fields). Metriq shows how it reads it and which lead it finds. Nothing is saved.">
            <div className="space-y-2 text-body-sm">
              <textarea value={testMsg} onChange={(e) => setTestMsg(e.target.value)} rows={4} placeholder='{"phone_number":"3096627723","dispo":"NA","user":"1003","talk_time":"0"}' className="w-full rounded-btn border border-line bg-card px-2 py-1.5 font-mono text-[12px] text-ink focus:border-primary focus:outline-none" />
              <Button size="sm" variant="secondary" disabled={!testMsg.trim()} onClick={runTest}>Read it</Button>
              {test && (
                <div className="space-y-1 rounded-btn bg-bg px-3 py-2">
                  <p><span className="text-ink-muted">Lead:</span> <b className="text-ink">{test.lead ? `${test.lead.company} (${test.lead.owner}, ${test.lead.status}) by ${test.lead.matchedBy?.replace('_', ' ')}` : 'none found'}</b></p>
                  <p><span className="text-ink-muted">Outcome:</span> <b className="text-ink">{test.outcomeLabel ?? 'not mapped'}</b>{test.read.disposition ? ` from "${test.read.disposition}"` : ''}</p>
                  <p><span className="text-ink-muted">Agent:</span> <b className="text-ink">{test.agent ?? test.read.agent ?? 'none'}</b>{test.read.durationSec != null ? ` · ${dur(test.read.durationSec)}` : ''}{test.read.notes ? ` · notes: ${test.read.notes}` : ''}</p>
                  {test.problems.map((p) => <p key={p} className="text-warning">{p}</p>)}
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
      {it && <div className="flex justify-end"><Button disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save dispositions, agents and fields'}</Button></div>}

      {it && d.unmatched.length > 0 && (
        <Panel title={`Calls to match · ${d.unmatched.length}`} info="No lead in Metriq had this number or ID. Pick the lead and the call is logged on it, with the same updates.">
          <ul className="divide-y divide-line text-body-sm">{d.unmatched.map((c) => <Unmatched key={c.id} c={c} onDone={load} />)}</ul>
        </Panel>
      )}

      {it && (
        <Panel title="Latest calls from the dialer">
          {d.recent.length === 0 ? <p className="text-body-sm text-ink-muted">No calls yet. Make a test call after setting up the link.</p> : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-body-sm">
                <thead className="text-[11px] uppercase text-ink-muted"><tr><th className="px-2 py-1">When</th><th className="px-2">Phone</th><th className="px-2">Disposition</th><th className="px-2">Agent</th><th className="px-2">Lead</th><th className="px-2">What Metriq did</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.recent.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{when(c.calledAt)}</td>
                      <td className="whitespace-nowrap px-2 tabular-nums text-ink">{c.phone ?? '—'}</td>
                      <td className="px-2 text-ink">{c.disposition}{c.outcomeLabel ? <span className="text-ink-muted"> → {c.outcomeLabel}</span> : <span className="text-warning"> (not mapped)</span>}{c.durationSec != null && <span className="text-ink-muted"> · {dur(c.durationSec)}</span>}</td>
                      <td className="px-2 text-ink">{c.agent ?? (c.agentRaw ? <span className="text-warning">{c.agentRaw} (not linked)</span> : '—')}</td>
                      <td className="px-2 text-ink">{c.lead ? `${c.lead.company} · ${c.lead.owner}` : <span className="text-warning">not matched</span>}</td>
                      <td className="px-2 text-ink-muted">{c.effect ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function Unmatched({ c, onDone }: { c: IntegrationCall; onDone: () => void }) {
  const { addToast } = useToast()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ id: string; company: string; contactName: string | null; phone: string | null; status: string; owner: string }[]>([])
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(() => { dialerApi.searchLeads(q).then((r) => setHits(r.leads)).catch(() => setHits([])) }, 250)
    return () => clearTimeout(t)
  }, [q])
  async function link(leadId: string) {
    try { const r = await dialerApi.linkCall(c.id, leadId); addToast({ type: 'success', message: `Logged on the lead: ${r.effect}.` }); onDone() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not match it') }) }
  }
  return (
    <li className="space-y-1.5 py-2">
      <p className="text-ink"><b className="tabular-nums">{c.phone ?? 'no phone'}</b> · {c.disposition}{c.outcomeLabel ? ` → ${c.outcomeLabel}` : ''} · {when(c.calledAt)}{c.agent || c.agentRaw ? ` · ${c.agent ?? c.agentRaw}` : ''}{c.notes ? ` · "${c.notes}"` : ''}</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the lead: company, contact or phone" className={cn(inp, 'w-full sm:w-80')} />
      {hits.length > 0 && (
        <ul className="rounded-btn border border-line">
          {hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => link(h.id)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50">
              <span className="text-ink">{h.company}{h.contactName ? ` · ${h.contactName}` : ''} <span className="text-ink-muted">{h.phone ?? ''}</span></span>
              <span className="text-ink-muted">{h.owner} · {h.status}</span>
            </button></li>
          ))}
        </ul>
      )}
    </li>
  )
}
