import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { getMyTickets, replyMyTicket, SUPPORT_STATUS_LABEL, type MyTicket, type SupportStatus } from '../../lib/supportApi'

/** My requests to Metriq support (from the Help button) and the answers (erp, step 0). */
const TONE: Record<SupportStatus, BadgeTone> = { OPEN: 'warning', IN_PROGRESS: 'primary', WAITING_ON_COMPANY: 'accent', RESOLVED: 'success' }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function HelpPage() {
  const { addToast } = useToast()
  const [params] = useSearchParams()
  const [tickets, setTickets] = useState<MyTicket[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(params.get('ticket'))
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => getMyTickets().then((r) => setTickets(r.tickets)).catch(() => setTickets([]))
  useEffect(() => { void load() }, [])

  async function send(id: string) {
    if (!reply.trim()) return
    setBusy(true)
    try { await replyMyTicket(id, reply.trim()); setReply(''); await load(); addToast({ type: 'success', message: 'Sent to support.' }) }
    catch { addToast({ type: 'error', message: 'Could not send. Try again.' }) } finally { setBusy(false) }
  }

  if (!tickets) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>
  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div>
        <h1 className="text-headline-lg text-ink">My requests to support</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">What you sent with the Help button and the answers. New answers also arrive in your bell.</p>
      </div>
      {tickets.length === 0 ? (
        <p className="rounded-card border border-line bg-card py-12 text-center text-body-md text-ink-muted">Nothing sent yet. Use the Help icon at the top to ask for help.</p>
      ) : tickets.map((t) => {
        const open = openId === t.id
        return (
          <div key={t.id} className="rounded-card border border-line bg-card">
            <button type="button" onClick={() => setOpenId(open ? null : t.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="text-body-sm tabular-nums text-ink-muted">#{t.number}</span>
              <span className="min-w-0 flex-1 truncate text-body-md font-medium text-ink">{t.subject}</span>
              <span className="hidden text-body-sm text-ink-muted sm:inline">{fmt(t.updatedAt)}</span>
              <Badge tone={TONE[t.status]}>{SUPPORT_STATUS_LABEL[t.status]}</Badge>
            </button>
            {open && (
              <div className="space-y-3 border-t border-line px-4 py-4">
                <p className="whitespace-pre-wrap text-body-md text-ink">{t.body}</p>
                {t.messages.map((m) => (
                  <div key={m.id} className={'rounded-btn p-3 ' + (m.fromOwner ? 'bg-primary/5' : 'bg-slate-50')}>
                    <p className="mb-1 text-body-sm text-ink-muted"><span className="font-semibold text-ink">{m.authorName}</span> · {fmt(m.createdAt)}</p>
                    <p className="whitespace-pre-wrap text-body-md text-ink">{m.body}</p>
                  </div>
                ))}
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write to support…" aria-label="Message to support"
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none" />
                <div className="flex justify-end"><Button size="sm" onClick={() => send(t.id)} disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</Button></div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
