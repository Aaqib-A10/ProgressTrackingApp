import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessagesSquare, Search, Share2, X } from 'lucide-react'
import { useAuth } from '../../../lib/auth'
import { chatApi, type ConversationDetail } from '../../../lib/chatApi'
import { errMsg } from '../../../lib/projectsApi'
import { useToast } from '../../../components/ui/Toast'
import { ChatThread } from '../../../components/chat/ChatThread'
import { ConversationActions, ConversationList } from '../../../components/chat/ConversationList'
import { fieldCls, fmtAgo } from '../../../components/projects/pmUi'
import { cn } from '../../../lib/cn'

/**
 * /app/chat — conversations on the left, the open thread on the right.
 *   ?c=<id>          open a conversation
 *   ?project=<KEY>   open that project's # channel
 *   ?share=<CODE>    pick a chat to share a task into (prefills the composer)
 */
export default function ChatPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const [active, setActive] = useState<string | null>(params.get('c'))
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const share = params.get('share')

  useEffect(() => {
    const key = params.get('project')
    if (!key) return
    chatApi.projectChannel(key)
      .then((r) => { setActive(r.conversation.id); setRefresh((n) => n + 1); setParams({ c: r.conversation.id }, { replace: true }) })
      .catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not open the project chat') }))
  }, [params, setParams, addToast])

  // ?dm=<userId> (from search): open, or start, the direct chat with that person.
  useEffect(() => {
    const dm = params.get('dm')
    if (!dm) return
    chatApi.openDirect(dm)
      .then((r) => { setActive(r.conversation.id); setRefresh((n) => n + 1); setParams({ c: r.conversation.id }, { replace: true }) })
      .catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not open the chat') }))
  }, [params, setParams, addToast])

  useEffect(() => { const c = params.get('c'); if (c) setActive(c) }, [params])
  useEffect(() => {
    if (!active) { setDetail(null); return }
    chatApi.conversation(active).then((r) => setDetail(r.conversation)).catch(() => setDetail(null))
  }, [active, refresh])

  const select = (id: string) => {
    setActive(id)
    const n = new URLSearchParams()
    n.set('c', id)
    if (share) n.set('share', share)
    setParams(n, { replace: true })
  }

  if (!user) return null
  return (
    <div className="-m-4 flex h-[calc(100dvh-52px)] overflow-hidden bg-card sm:-mx-8 sm:-my-7">
      <aside className={cn('w-full shrink-0 border-r border-line bg-sidebar/50 md:w-[300px]', active && 'hidden md:block')}>
        <div className="flex h-12 items-center justify-between px-4">
          <h1 className="text-[15px] font-semibold text-ink">Chat</h1>
          <button type="button" onClick={() => setSearchOpen((s) => !s)} className={cn('flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-slate-200/60 hover:text-ink', searchOpen && 'bg-slate-200/70 text-ink')} aria-label="Search messages" title="Search messages"><Search size={15} /></button>
        </div>
        {searchOpen ? <MessageSearch onPick={(cid) => { setSearchOpen(false); select(cid) }} onClose={() => setSearchOpen(false)} /> : (
          <div className="h-[calc(100%-48px)]"><ConversationList activeId={active} onSelect={select} refreshKey={refresh} /></div>
        )}
      </aside>
      <section className={cn('min-w-0 flex-1', !active && 'hidden md:block')}>
        {active ? (
          <div className="flex h-full flex-col">
            {share && (
              <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/[0.05] px-4 py-2 text-body-sm text-ink">
                <Share2 size={14} className="text-primary" /> Sharing <b className="font-mono">{share}</b>. Press Enter to send it here, or pick another chat.
                <button type="button" className="ml-auto text-ink-muted" onClick={() => { const n = new URLSearchParams(params); n.delete('share'); setParams(n, { replace: true }) }} aria-label="Cancel sharing"><X size={14} /></button>
              </div>
            )}
            <div className="flex items-center gap-1 md:hidden"><button type="button" onClick={() => { setActive(null); setParams({}, { replace: true }) }} className="m-2 inline-flex items-center gap-1 text-body-sm text-ink-muted"><ArrowLeft size={15} /> All chats</button></div>
            <div className="min-h-0 flex-1">
              <ChatThread
                key={active + (share ?? '')}
                conversationId={active}
                meId={user.id}
                prefill={share ? `${share} ` : undefined}
                onSent={() => { setRefresh((n) => n + 1); if (share) { const n = new URLSearchParams(params); n.delete('share'); setParams(n, { replace: true }) } }}
                actions={detail && <ConversationActions id={active} muted={detail.muted} isGroup={detail.type === 'GROUP'} picture={detail.canChangePicture ? { type: detail.type, projectKey: detail.project?.key ?? null, color: detail.project?.color ?? null } : undefined} onChanged={() => setRefresh((n) => n + 1)} onLeft={() => { setActive(null); setParams({}); setRefresh((n) => n + 1) }} />}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-slate-50 text-ink-muted shadow-xs"><MessagesSquare size={22} /></span>
            <p className="text-[15px] font-semibold text-ink">{share ? `Pick a chat to share ${share}` : 'Pick a conversation'}</p>
            <p className="max-w-xs text-body-md text-ink-muted">Every project has its own channel. Use + to message someone directly or start a group.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function MessageSearch({ onPick, onClose }: { onPick: (conversationId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof chatApi.search>>['results']>([])
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = window.setTimeout(() => chatApi.search(q.trim()).then((r) => setResults(r.results)).catch(() => undefined), 250)
    return () => window.clearTimeout(t)
  }, [q])
  return (
    <div className="flex h-[calc(100%-48px)] flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search all my messages" className={cn(fieldCls, 'h-8 text-body-sm')} />
        <button type="button" onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-slate-200/60 hover:text-ink" aria-label="Close search"><X size={15} /></button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {results.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r.conversationId)} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-slate-200/50">
              <span className="flex items-center gap-1.5 text-[12px] text-ink-muted"><span className="font-medium text-ink">{r.userName}</span> in {r.conversationName ?? 'chat'} <span className="ml-auto text-ink-faint">{fmtAgo(r.createdAt)}</span></span>
              <span className="mt-0.5 line-clamp-2 block text-body-sm text-ink">{r.body}</span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && results.length === 0 && <li className="p-4 text-center text-body-sm text-ink-muted">No messages found.</li>}
      </ul>
    </div>
  )
}
