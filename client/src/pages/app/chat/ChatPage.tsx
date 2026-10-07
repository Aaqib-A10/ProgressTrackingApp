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
    <div className="-m-4 flex h-[calc(100vh-4rem)] overflow-hidden bg-card sm:-m-6">
      <aside className={cn('w-full shrink-0 border-r border-line md:w-80', active && 'hidden md:block')}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="text-headline-md text-ink">Chat</h1>
          <button type="button" onClick={() => setSearchOpen((s) => !s)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Search messages" title="Search messages"><Search size={17} /></button>
        </div>
        {searchOpen ? <MessageSearch onPick={(cid) => { setSearchOpen(false); select(cid) }} onClose={() => setSearchOpen(false)} /> : (
          <div className="h-[calc(100%-57px)]"><ConversationList activeId={active} onSelect={select} refreshKey={refresh} /></div>
        )}
      </aside>
      <section className={cn('min-w-0 flex-1', !active && 'hidden md:block')}>
        {active ? (
          <div className="flex h-full flex-col">
            {share && (
              <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-body-sm text-ink">
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
                actions={detail && <ConversationActions id={active} muted={detail.muted} isGroup={detail.type === 'GROUP'} onChanged={() => setRefresh((n) => n + 1)} onLeft={() => { setActive(null); setParams({}); setRefresh((n) => n + 1) }} />}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <MessagesSquare size={36} className="text-ink-muted" />
            <p className="text-body-lg text-ink">{share ? `Pick a chat to share ${share}` : 'Pick a conversation'}</p>
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
    <div className="flex h-[calc(100%-57px)] flex-col">
      <div className="flex gap-2 border-b border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search all my messages" className={cn(fieldCls, 'h-8 text-body-sm')} />
        <button type="button" onClick={onClose} className="text-ink-muted" aria-label="Close search"><X size={16} /></button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {results.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r.conversationId)} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
              <span className="flex items-center gap-2 text-body-sm text-ink-muted"><b className="text-ink">{r.userName}</b> in {r.conversationName ?? 'chat'} <span className="ml-auto">{fmtAgo(r.createdAt)}</span></span>
              <span className="block text-body-sm text-ink">{r.body}</span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && results.length === 0 && <li className="p-4 text-center text-body-sm text-ink-muted">No messages found.</li>}
      </ul>
    </div>
  )
}
