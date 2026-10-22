import { useEffect, useState } from 'react'
import { Bot, Copy, KeyRound, Power } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { api } from '../lib/api'
import { copyText } from '../lib/workLogApi'

/**
 * Settings → Connect Claude. Makes a private key and shows the connector link once, with the
 * steps to add it to Claude. Claude can then list this person's tickets, read them, comment,
 * tick the checklist and move them, as this person. Switching a key off stops it at once.
 */

interface ClaudeKey { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string }

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ConnectClaude() {
  const { addToast } = useToast()
  const [keys, setKeys] = useState<ClaudeKey[] | null>(null)
  const [name, setName] = useState('My Claude')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState<string | null>(null)

  const load = () => api.get<{ keys: ClaudeKey[] }>('/claude/keys').then((r) => setKeys(r.keys)).catch(() => setKeys([]))
  useEffect(() => { load() }, [])

  async function make() {
    setBusy(true)
    try {
      const r = await api.post<{ key: ClaudeKey; connectorUrl: string }>('/claude/keys', { name: name.trim() })
      setLink(r.connectorUrl); load()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not make the key') }) } finally { setBusy(false) }
  }
  async function off(k: ClaudeKey) {
    try { await api.del(`/claude/keys/${k.id}`); setConfirmOff(null); addToast({ type: 'success', message: `"${k.name}" switched off. Claude can no longer use it.` }); load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not switch it off') }) }
  }

  return (
    <Card title="Connect Claude" subtitle="Let Claude read your tickets, comment on them and move them, as you">
      <div className="space-y-4 text-body-sm">
        {link ? (
          <div className="space-y-3 rounded-card border border-success/40 bg-success/5 p-4">
            <p className="font-semibold text-ink">Your connector link. It is shown only this once: copy it now and keep it like a password.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-btn border border-line bg-card px-3 py-2 font-mono text-[12px] text-ink">{link}</code>
              <Button size="sm" leadingIcon={<Copy size={14} />} onClick={async () => { await copyText(link); addToast({ type: 'success', message: 'Link copied' }) }}>Copy link</Button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-ink">
              <li>In Claude, open <b>Settings</b>, then <b>Connectors</b>, then <b>Add custom connector</b>.</li>
              <li>Name it <b>Metriq</b>, paste the link, and save.</li>
              <li>Ask Claude, for example: <i>"Do my Metriq tickets in CMR"</i> or <i>"Work on CMR-6"</i>. Claude reads the ticket, does the work where the project says the work lives, comments what it changed and moves the ticket to In review.</li>
            </ol>
            <button type="button" onClick={() => setLink(null)} className="font-semibold text-ink-muted hover:text-ink">I saved it, hide the link</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block font-semibold text-ink">Name for the key</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10 w-56 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none" />
            </label>
            <Button leadingIcon={<Bot size={16} />} disabled={busy || !name.trim()} onClick={make}>{busy ? 'Making…' : 'Make a key for Claude'}</Button>
          </div>
        )}

        <p className="text-ink-muted">Claude sees only what you can see in Metriq. Its comments and moves show under your name. Switch a key off at any time and Claude loses access at once.</p>

        {keys && keys.length > 0 && (
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
  )
}
