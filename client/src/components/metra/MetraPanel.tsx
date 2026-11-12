import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, History, Loader2, Maximize2, MessageSquarePlus, Pin, SquarePen, X } from 'lucide-react'
import { MetraFeedbackForm } from './MetraFeedbackForm'
import { metraApi, type MetraConversation, type MetraStatus } from '../../lib/metraApi'
import { usePhone } from '../../mobile/usePhone'
import { cn } from '../../lib/cn'
import { MetraMark } from './MetraMark'
import { MetraChat, type MetraChatHandle } from './MetraChat'
import { useMetraChat } from './useMetraChat'

type Ready = Extract<MetraStatus, { enabled: true }>

/** The Metra side panel (desktop, on the right over the page) or bottom sheet (phone). Kept mounted while closed, so the chat stays. */
export function MetraPanel({ open, onClose, status, firstName, question }: { open: boolean; onClose: () => void; status: Ready; firstName?: string; question: { q: string; n: number } | null }) {
  const navigate = useNavigate()
  const phone = usePhone()
  const [view, setView] = useState<'chat' | 'history' | 'feedback'>('chat')
  const [list, setList] = useState<MetraConversation[] | null>(null)
  const chatRef = useRef<MetraChatHandle>(null)
  const chat = useMetraChat()

  const loadList = useCallback(() => {
    setList(null)
    metraApi.conversations().then(setList).catch(() => setList([]))
  }, [])

  // Every time the panel opens it starts on a clear new chat (greeting, insights, suggestions, recent chats).
  // An answer still being written is left alone. This runs before the Ctrl+K question below.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current && !chat.streaming) { setView('chat'); chat.newChat() }
    wasOpen.current = open
  }, [open, chat])

  // A question from Ctrl+K: a new chat, asked at once.
  const asked = useRef(0)
  useEffect(() => {
    if (!question || question.n === asked.current) return
    asked.current = question.n
    setView('chat')
    chat.newChat()
    chat.send(question.q)
  }, [question, chat])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => chatRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[data-metra-popover]') || document.querySelector('[aria-modal="true"]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  // Phones: the page under the sheet stays still.
  useEffect(() => {
    if (!open || !phone) return
    document.body.classList.add('overflow-hidden')
    return () => document.body.classList.remove('overflow-hidden')
  }, [open, phone])

  if (!open) return null
  const leave = () => { if (phone) onClose() }

  return createPortal(
    <>
      {phone && <div className="fixed inset-0 z-[60] animate-fade-in bg-black/30" onClick={onClose} aria-hidden />}
      <div
        role="dialog"
        aria-modal={phone ? 'true' : 'false'}
        aria-label="Metra"
        className={cn(
          'fixed z-[60] flex flex-col overflow-hidden border-line bg-card shadow-overlay',
          phone
            ? 'inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] animate-sheet-up rounded-t-[20px] border-t'
            : 'bottom-0 right-0 top-0 w-[420px] max-w-[100vw] animate-slide-in-right border-l',
        )}
      >
        {phone && <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />}
        <header className="flex shrink-0 items-center gap-1 border-b border-line px-2.5 py-2">
          {view !== 'chat' ? (
            <button type="button" onClick={() => setView('chat')} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Back to the chat"><ArrowLeft size={17} /></button>
          ) : <MetraMark size={26} className="ml-1" />}
          <h2 className="min-w-0 flex-1 truncate px-1.5 text-body-md font-semibold text-ink">
            {view === 'history' ? 'Your chats' : view === 'feedback' ? 'Feedback on Metra' : chat.title ? <><span className="sr-only">Metra: </span>{chat.title}</> : 'Metra'}
          </h2>
          <HeadBtn label="New chat" onClick={() => { setView('chat'); chat.newChat(); chatRef.current?.focus() }}><SquarePen size={16} /></HeadBtn>
          <HeadBtn label="History" pressed={view === 'history'} onClick={() => { if (view === 'history') setView('chat'); else { setView('history'); loadList() } }}><History size={16} /></HeadBtn>
          <HeadBtn label="Give feedback on Metra" pressed={view === 'feedback'} onClick={() => setView(view === 'feedback' ? 'chat' : 'feedback')}><MessageSquarePlus size={16} /></HeadBtn>
          <HeadBtn label="Open full page" onClick={() => { navigate(chat.conversationId ? `/app/metra?c=${encodeURIComponent(chat.conversationId)}` : '/app/metra'); onClose() }}><Maximize2 size={15} /></HeadBtn>
          <HeadBtn label="Close" onClick={onClose}><X size={17} /></HeadBtn>
        </header>
        <div className="min-h-0 flex-1">
          {view === 'history' ? (
            <div className="h-full overflow-y-auto p-2">
              {list === null ? (
                <div className="flex justify-center py-10 text-ink-muted"><Loader2 size={18} className="animate-spin" /></div>
              ) : list.length === 0 ? (
                <p className="px-3 py-10 text-center text-body-md text-ink-muted">No chats yet. Ask Metra something to start one.</p>
              ) : (
                <ul>
                  {list.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => { chat.open(c.id); setView('chat') }}
                        className={cn('flex w-full items-center gap-2 rounded-btn px-2.5 py-2 text-left hover:bg-slate-100', c.id === chat.conversationId && 'bg-slate-100')}>
                        {c.pinned && <Pin size={12} className="shrink-0 text-ink-faint" aria-label="Pinned" />}
                        <span className="min-w-0 flex-1 truncate text-body-md text-ink">{c.title}</span>
                        <span className="shrink-0 text-[11.5px] text-ink-faint">{new Date(c.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : view === 'feedback' ? (
            <div className="h-full overflow-y-auto p-4">
              <MetraFeedbackForm onDone={() => setView('chat')} onCancel={() => setView('chat')} />
            </div>
          ) : (
            <MetraChat ref={chatRef} chat={chat} llm={status.llm} suggestions={status.suggestions} firstName={firstName} compact onNavigate={leave}
              onShowHistory={() => { setView('history'); loadList() }} />
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

function HeadBtn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}
      className={cn('rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', pressed && 'bg-slate-100 text-ink')}>
      {children}
    </button>
  )
}
