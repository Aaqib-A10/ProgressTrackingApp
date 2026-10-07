import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Maximize2, MessagesSquare, X } from 'lucide-react'
import { ChatThread } from './ChatThread'
import { ConversationList } from './ConversationList'
import { useChatUnread } from './useChatUnread'
import { cn } from '../../lib/cn'

/**
 * Small chat launcher in the bottom-right of every app page, so people can reply
 * while looking at a board. Hidden on the full /app/chat page.
 */
export function FloatingChat({ meId }: { meId: string }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { total } = useChatUnread()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  if (pathname.startsWith('/app/chat')) return null

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-40 flex h-[min(560px,calc(100vh-7rem))] w-[min(380px,calc(100vw-2rem))] animate-scale-in flex-col overflow-hidden rounded-card border border-line bg-card shadow-overlay" role="dialog" aria-label="Chat">
          <div className="flex shrink-0 items-center gap-1 border-b border-line bg-slate-50 px-2 py-1.5">
            {active && <button type="button" onClick={() => setActive(null)} className="rounded p-1 text-ink-muted hover:bg-slate-200" aria-label="Back to chats"><ArrowLeft size={16} /></button>}
            <span className="flex-1 px-1 text-body-md font-semibold text-ink">Chat</span>
            <button type="button" onClick={() => { setOpen(false); navigate(active ? `/app/chat?c=${active}` : '/app/chat') }} className="rounded p-1 text-ink-muted hover:bg-slate-200" aria-label="Open full chat" title="Open full chat"><Maximize2 size={15} /></button>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-ink-muted hover:bg-slate-200" aria-label="Close chat"><X size={16} /></button>
          </div>
          <div className="min-h-0 flex-1">
            {active ? <ChatThread conversationId={active} meId={meId} compact /> : <ConversationList activeId={null} onSelect={setActive} compact />}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-overlay transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30', open && 'bg-primary-700')}
        aria-label={total ? `Chat, ${total} unread` : 'Chat'}
        title="Chat"
      >
        {open ? <X size={20} /> : <MessagesSquare size={20} />}
        {!open && total > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[20px] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 ring-2 ring-card">{total > 99 ? '99+' : total}</span>}
      </button>
    </>
  )
}
