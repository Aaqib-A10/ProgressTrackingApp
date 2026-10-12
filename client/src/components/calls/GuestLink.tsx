import { useEffect, useState } from 'react'
import { Check, Copy, Globe, Loader2, RefreshCw, UserCheck, UserX } from 'lucide-react'
import { guestApi } from '../../lib/callsApi'
import { errMsg } from '../../lib/projectsApi'
import { useToast } from '../ui/Toast'
import { cn } from '../../lib/cn'

/**
 * A link for people outside Metriq (clients, candidates, partners). They open it, type
 * their name and ask to join; someone in the call lets them in. They show as "Name (Guest)"
 * and only get the call: no chat, files or notes.
 */
export function GuestLinkBox({ conversationId, className }: { conversationId: string; className?: string }) {
  const { addToast } = useToast()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { guestApi.getLink(conversationId).then((r) => setUrl(r.url)).catch(() => setUrl(null)) }, [conversationId])

  async function copy(u: string) {
    try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { addToast({ type: 'info', message: u }) }
  }
  async function make(reset = false) {
    setBusy(true)
    try {
      const r = await guestApi.makeLink(conversationId, reset)
      setUrl(r.url)
      await copy(r.url)
      addToast({ type: 'success', message: reset ? 'New guest link copied. The old one no longer works.' : 'Guest link copied. Send it to the person you want to invite.' })
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }
  async function off() {
    setBusy(true)
    try { await guestApi.removeLink(conversationId); setUrl(null); addToast({ type: 'success', message: 'Guest link turned off' }) } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }

  return (
    <div className={cn('rounded-btn border border-line p-2.5', className)}>
      <p className="flex items-center gap-1.5 text-body-sm font-semibold text-ink"><Globe size={14} className="text-primary" /> People outside Metriq</p>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">Send a guest link. They type their name, and someone in the call lets them in. They only see the call.</p>
      {url === undefined ? <Loader2 size={14} className="mt-2 animate-spin text-ink-muted" /> : url ? (
        <>
          <div className="mt-2 flex items-center gap-1.5">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-btn border border-line bg-slate-50 px-2 py-1 font-mono text-[11px] text-ink" aria-label="Guest link" />
            <button type="button" onClick={() => void copy(url)} className="inline-flex shrink-0 items-center gap-1 rounded-btn bg-primary px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-primary/90">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-1.5 flex gap-3 text-[12px]">
            <button type="button" disabled={busy} onClick={() => void make(true)} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"><RefreshCw size={12} /> New link</button>
            <button type="button" disabled={busy} onClick={() => void off()} className="text-ink-muted hover:text-danger">Turn off</button>
          </div>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => void make()} className="mt-2 inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Get a guest link
        </button>
      )}
    </div>
  )
}

/** "Sara Khan wants to join" with Let in / Not now, for everyone in the call. */
export function LobbyRequests({ callId, lobby, dark }: { callId: string; lobby: { id: string; name: string }[]; dark?: boolean }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (!lobby.length) return null
  async function answer(id: string, admit: boolean) {
    setBusy(id)
    try { await guestApi.answer(callId, id, admit) } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(null) }
  }
  return (
    <div className="space-y-1.5">
      {lobby.map((g) => (
        <div key={g.id} className={cn('flex animate-scale-in flex-wrap items-center gap-2 rounded-btn px-3 py-2 text-body-sm shadow-overlay', dark ? 'bg-white text-ink' : 'border border-line bg-card')}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Globe size={15} /></span>
          <span className="min-w-0 flex-1"><b className="font-semibold">{g.name}</b> wants to join as a guest</span>
          <button type="button" disabled={busy === g.id} onClick={() => void answer(g.id, false)} className="inline-flex shrink-0 items-center gap-1 rounded-btn border border-line px-2 py-1 text-[12px] font-semibold text-ink-muted hover:bg-slate-50 hover:text-danger"><UserX size={13} /> Not now</button>
          <button type="button" disabled={busy === g.id} onClick={() => void answer(g.id, true)} className="inline-flex shrink-0 items-center gap-1 rounded-btn bg-success px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-success/90">{busy === g.id ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Let in</button>
        </div>
      ))}
    </div>
  )
}
