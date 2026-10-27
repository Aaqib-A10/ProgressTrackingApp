import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronRight, Copy, KeyRound, Plug, Power, ShieldCheck } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { copyText } from '../../lib/workLogApi'
import { CAPABILITIES, CONNECTORS, connectorById, geminiCliConfig, type Connector, type ConnectorId } from '../../lib/connectors'

/**
 * Connectors: link an AI app (Claude, ChatGPT, Gemini) to Metriq. /app/connectors lists them;
 * /app/connectors/:id shows one: what it can do, how to add it, and the person's keys for it.
 * The app works in Metriq as the person who made the key, and sees only what they can see.
 */

interface ConnectorKey { id: string; name: string; client: ConnectorId; prefix: string; lastUsedAt: string | null; createdAt: string }

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function useKeys() {
  const [keys, setKeys] = useState<ConnectorKey[] | null>(null)
  const load = () => api.get<{ keys: ConnectorKey[] }>('/claude/keys').then((r) => setKeys(r.keys)).catch(() => setKeys([]))
  useEffect(() => { void load() }, [])
  return { keys, load }
}

function Mark({ c, size = 'md' }: { c: Connector; size?: 'md' | 'lg' }) {
  return <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[10px] font-bold', c.tone, size === 'lg' ? 'h-12 w-12 text-[17px]' : 'h-10 w-10 text-[14px]')} aria-hidden>{c.mark}</span>
}

export default function Connectors() {
  const { id } = useParams()
  if (id) {
    const c = connectorById(id)
    return c ? <ConnectorDetail c={c} /> : <Navigate to="/app/connectors" replace />
  }
  return <ConnectorList />
}

function ConnectorList() {
  const { keys } = useKeys()
  const on = (c: Connector) => (keys ?? []).filter((k) => k.client === c.id).length
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-headline-lg text-ink"><Plug size={22} className="text-ink-muted" /> Connectors</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Connect your AI assistant to Metriq. It can then read your tickets, comment, move them and give work, as you.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONNECTORS.map((c) => {
          const n = on(c)
          return (
            <Link key={c.id} to={`/app/connectors/${c.id}`} className="group flex flex-col rounded-card border border-line bg-card p-4 shadow-card transition-shadow hover:shadow-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <div className="flex items-center gap-3">
                <Mark c={c} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-lg font-semibold text-ink">{c.name}</p>
                  <p className="text-body-sm text-ink-muted">by {c.maker}</p>
                </div>
                <ChevronRight size={18} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-3 flex-1 text-body-sm text-ink-muted">{c.tagline}</p>
              <p className={cn('mt-3 inline-flex items-center gap-1.5 text-body-sm font-semibold', n ? 'text-success' : 'text-ink-muted')}>
                {keys == null ? 'Checking…' : n ? <><Check size={14} /> Connected · {n} key{n === 1 ? '' : 's'} on</> : 'Not connected'}
              </p>
            </Link>
          )
        })}
      </div>
      <Card>
        <div className="flex gap-3 text-body-sm text-ink-muted">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
          <p>Every connector sees only what you can see in Metriq, and everything it does shows under your name, through the same checks and notifications as the app. Each key works until you switch it off; switching it off stops that app at once.</p>
        </div>
      </Card>
    </div>
  )
}

function ConnectorDetail({ c }: { c: Connector }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const { keys: all, load } = useKeys()
  const keys = (all ?? []).filter((k) => k.client === c.id)
  const [name, setName] = useState(c.keyName)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState<string | null>(null)
  const seesHealth = user?.role === 'SUPER_ADMIN' || !!user?.isDeveloper

  useEffect(() => { setName(c.keyName); setLink(null) }, [c.id, c.keyName])

  async function make() {
    setBusy(true)
    try {
      const r = await api.post<{ key: ConnectorKey; connectorUrl: string }>('/claude/keys', { name: name.trim(), client: c.id })
      setLink(r.connectorUrl); void load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not make the key') }) } finally { setBusy(false) }
  }
  async function off(k: ConnectorKey) {
    try { await api.del(`/claude/keys/${k.id}`); setConfirmOff(null); addToast({ type: 'success', message: `"${k.name}" switched off. ${c.name} can no longer use it.` }); void load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not switch it off') }) }
  }
  const copy = async (text: string, what: string) => { await copyText(text); addToast({ type: 'success', message: `${what} copied` }) }
  const shown = link ?? 'https://…/api/mcp/your-key (make a key first)'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/app/connectors" className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={15} /> All connectors</Link>
      <div className="flex items-center gap-4">
        <Mark c={c} size="lg" />
        <div className="min-w-0">
          <h1 className="text-headline-lg text-ink">{c.name}</h1>
          <p className="text-body-md text-ink-muted">{c.tagline}</p>
        </div>
        {keys.length > 0 && <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-body-sm font-semibold text-success"><Check size={14} /> Connected</span>}
      </div>

      {/* 1. The key */}
      <Card title={`1. Make a key for ${c.name}`} subtitle="The key goes inside a private link. Anyone with the link can act as you, so keep it like a password.">
        <div className="space-y-4 text-body-sm">
          {link ? (
            <div className="space-y-3 rounded-card border border-success/40 bg-success/5 p-4">
              <p className="font-semibold text-ink">Your connector link. It is shown only this once: copy it now, then follow step 2.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-btn border border-line bg-card px-3 py-2 font-mono text-[12px] text-ink">{link}</code>
                <Button size="sm" leadingIcon={<Copy size={14} />} onClick={() => copy(link, 'Link')}>Copy link</Button>
              </div>
              <button type="button" onClick={() => setLink(null)} className="font-semibold text-ink-muted hover:text-ink">I saved it, hide the link</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Name for the key</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none" />
              </label>
              <Button leadingIcon={<KeyRound size={16} />} disabled={busy || !name.trim()} onClick={make}>{busy ? 'Making…' : `Make a key for ${c.name}`}</Button>
            </div>
          )}
          {keys.length > 0 && (
            <ul className="divide-y divide-line rounded-btn border border-line">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <KeyRound size={16} className="text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{k.name} <code className="ml-1 font-mono text-[11px] font-normal text-ink-muted">{k.prefix}…</code></p>
                    <p className="text-ink-muted">Made {when(k.createdAt)} · {k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : 'not used yet'}</p>
                  </div>
                  {confirmOff === k.id ? (
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => off(k)} className="rounded px-2 py-1 font-semibold text-danger hover:bg-danger/10">Switch off</button>
                      <button type="button" onClick={() => setConfirmOff(null)} className="rounded px-2 py-1 text-ink-muted hover:bg-slate-100">Keep</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmOff(k.id)} className="inline-flex items-center gap-1 rounded-btn border border-line px-2.5 py-1 font-semibold text-ink-muted hover:border-danger/40 hover:text-danger"><Power size={13} /> Switch off</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* 2. How to add it */}
      <Card title={`2. Add Metriq to ${c.name}`} subtitle={c.ways.length > 1 ? 'Two ways: pick the one you use.' : undefined}>
        <div className="space-y-5">
          {c.ways.map((w) => (
            <div key={w.title} className="space-y-2">
              <p className="text-body-md font-semibold text-ink">{w.title}</p>
              <p className="text-body-sm text-ink-muted">{w.needs}</p>
              <ol className="list-decimal space-y-2 pl-5 text-body-sm text-ink">
                {w.steps.map((s) => (
                  <li key={s.text}>
                    {s.text}
                    {s.code === 'link' && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <code className={cn('min-w-0 flex-1 break-all rounded-btn border border-line bg-bg px-3 py-1.5 font-mono text-[12px]', link ? 'text-ink' : 'text-ink-muted')}>{shown}</code>
                        {link && <Button size="sm" variant="secondary" leadingIcon={<Copy size={14} />} onClick={() => copy(link, 'Link')}>Copy</Button>}
                      </div>
                    )}
                    {s.code === 'gemini-cli' && (
                      <div className="mt-1.5 space-y-1.5">
                        <pre className="overflow-x-auto rounded-btn border border-line bg-bg px-3 py-2 font-mono text-[12px] text-ink">{geminiCliConfig(shown)}</pre>
                        {link && <Button size="sm" variant="secondary" leadingIcon={<Copy size={14} />} onClick={() => copy(geminiCliConfig(link), 'Settings')}>Copy settings</Button>}
                        <p className="text-ink-muted">If the file already has an mcpServers part, add only the metriq lines inside it.</p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <div className="rounded-btn bg-bg px-3 py-2.5 text-body-sm">
            <p className="font-semibold text-ink">Then try</p>
            <ul className="mt-1 space-y-0.5 text-ink-muted">{c.examples.map((e) => <li key={e}>"{e}"</li>)}</ul>
          </div>
        </div>
      </Card>

      {/* What it can do */}
      <Card title="What it can do" subtitle={`${c.name} sees only what you can see in Metriq. Comments, moves and new tickets show under your name.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.filter((g) => !g.healthOnly || seesHealth).map((g) => (
            <div key={g.group}>
              <p className="text-body-sm font-semibold text-ink">{g.group}{g.healthOnly && <span className="ml-1.5 font-normal text-ink-muted">(developers and Super Admins)</span>}</p>
              <ul className="mt-1 space-y-1 text-body-sm text-ink-muted">
                {g.items.map((i) => <li key={i} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-success" />{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-body-sm text-ink-muted">It is told never to move a ticket to Done unless you ask, and to check with you before deleting one.</p>
      </Card>
    </div>
  )
}
