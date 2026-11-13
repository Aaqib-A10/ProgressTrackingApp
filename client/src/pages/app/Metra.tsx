import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, Loader2, MessageSquarePlus, MessagesSquare, MoreHorizontal, Pencil, Pin, PinOff, SquarePen, Trash2, X } from 'lucide-react'
import { MetraFeedbackForm } from '../../components/metra/MetraFeedbackForm'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { metraApi, metraReady, OPEN_METRA_EVENT, useMetraStatus, type MetraConversation, type MetraSource } from '../../lib/metraApi'
import { apiErrorText } from '../../lib/api'
import { MetraChat, type MetraChatHandle } from '../../components/metra/MetraChat'
import { MetraMark } from '../../components/metra/MetraMark'
import { useMetraChat } from '../../components/metra/useMetraChat'
import { openSourceLink, sourceDate } from '../../components/metra/MetraMarkdown'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { usePhone } from '../../mobile/usePhone'

/**
 * Metra's full page (/app/metra): your conversations on the left (pin, rename, delete), the chat in the middle,
 * and the sources of the selected answer on the right on wide screens. ?c=<id> opens a conversation,
 * ?insight=<id> puts that brief on top (the bell's link).
 */
/** One person's Metra page: a different person signing in on the same page gets a fresh one (no chat of the first is kept). */
export default function MetraPage() {
  const { user } = useAuth()
  return <MetraPageFor key={user?.id ?? 'none'} />
}

function MetraPageFor() {
  const { user } = useAuth()
  const status = useMetraStatus()
  const navigate = useNavigate()
  const phone = usePhone()
  const { addToast } = useToast()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const c = params.get('c')
  const insight = params.get('insight')
  const [list, setList] = useState<MetraConversation[] | null>(null)
  const [showList, setShowList] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<MetraConversation | null>(null)
  const chatRef = useRef<MetraChatHandle>(null)

  const loadList = useCallback(() => { metraApi.conversations().then(setList).catch(() => setList((l) => l ?? [])) }, [])
  const chat = useMetraChat({
    onConversation: (id) => { setParams((p) => { const n = new URLSearchParams(p); n.set('c', id); n.delete('insight'); return n }, { replace: true }); loadList() },
    onAnswered: loadList,
  })

  const ready = metraReady(status)
  useEffect(() => { if (ready) loadList() }, [ready, loadList])
  // The address picks the conversation (the panel's Expand, the back button).
  useEffect(() => { if (ready && c !== chat.conversationId) chat.open(c) }, [ready, c]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+K "Ask Metra" while on this page: a new chat, asked here.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question?.trim()
      if (!q) { setParams({}, { replace: false }); chatRef.current?.focus(); return }
      setParams({}, { replace: true })
      chat.newChat()
      chat.send(q)
    }
    window.addEventListener(OPEN_METRA_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_METRA_EVENT, onOpen)
  }, [chat, setParams])

  const answers = chat.messages.filter((m) => m.role === 'ASSISTANT')
  const current = answers.find((m) => m.key === selected) ?? answers[answers.length - 1]
  const sources: MetraSource[] = current?.sources ?? []

  const pick = (id: string | null) => {
    setShowList(false)
    setSelected(null)
    setParams(id ? { c: id } : {}, { replace: false })
  }

  async function togglePin(cv: MetraConversation) {
    setList((l) => l?.map((x) => (x.id === cv.id ? { ...x, pinned: !x.pinned } : x)) ?? null)
    try { await metraApi.update(cv.id, { pinned: !cv.pinned }); loadList() } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not pin it.') }); loadList() }
  }
  async function rename(cv: MetraConversation, title: string) {
    setRenaming(null)
    const t = title.trim()
    if (!t || t === cv.title) return
    setList((l) => l?.map((x) => (x.id === cv.id ? { ...x, title: t } : x)) ?? null)
    try { await metraApi.update(cv.id, { title: t }) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not rename it.') }); loadList() }
  }
  async function remove(cv: MetraConversation) {
    setDeleting(null)
    try {
      await metraApi.remove(cv.id)
      setList((l) => l?.filter((x) => x.id !== cv.id) ?? null)
      if (cv.id === chat.conversationId) pick(null)
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not delete it.') }) }
  }

  const sortedList = useMemo(() => list ? [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)) : null, [list])

  if (!status) return <div className="flex h-64 items-center justify-center"><Loader2 size={22} className="animate-spin text-ink-muted" /></div>
  if (!ready) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <MetraMark size={44} className="mx-auto" />
        <p className="mt-3 text-headline-md text-ink">Metra is not on for your company yet.</p>
      </div>
    )
  }

  const conversations = (
    <nav aria-label="Your Metra chats" className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-2.5">
        <Button className="w-full" variant="secondary" leadingIcon={<SquarePen size={15} />} onClick={() => { pick(null); window.setTimeout(() => chatRef.current?.focus(), 0) }}>New chat</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sortedList === null ? (
          <div className="flex justify-center py-8 text-ink-muted"><Loader2 size={17} className="animate-spin" /></div>
        ) : sortedList.length === 0 ? (
          <p className="px-3 py-8 text-center text-body-sm text-ink-muted">No chats yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {sortedList.map((cv) => (
              <ConversationRow key={cv.id} cv={cv} active={cv.id === chat.conversationId} renaming={renaming === cv.id}
                onOpen={() => pick(cv.id)} onPin={() => void togglePin(cv)} onRename={() => setRenaming(cv.id)} onRenamed={(t) => void rename(cv, t)} onCancelRename={() => setRenaming(null)} onDelete={() => setDeleting(cv)} />
            ))}
          </ul>
        )}
      </div>
    </nav>
  )

  return (
    <div className="-m-4 flex h-[calc(100dvh-64px-4.75rem-env(safe-area-inset-bottom))] min-h-[420px] overflow-hidden border-line bg-card sm:-mx-8 sm:-my-7 md:h-[calc(100dvh-64px)]">
      {/* Conversations: a column from lg up, a drawer below */}
      <aside className="hidden w-[260px] shrink-0 border-r border-line bg-bg lg:block">{conversations}</aside>
      {showList && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Your Metra chats">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowList(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(300px,85vw)] animate-fade-in border-r border-line bg-card pt-[env(safe-area-inset-top)]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-body-md font-semibold text-ink">Your chats</span>
              <button type="button" onClick={() => setShowList(false)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="h-[calc(100%-45px)]">{conversations}</div>
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <button type="button" onClick={() => setShowList(true)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink lg:hidden" aria-label="Your chats"><MessagesSquare size={17} /></button>
          <MetraMark size={26} />
          <h1 className="min-w-0 flex-1 truncate text-body-lg font-semibold text-ink">{chat.title ?? 'Metra'}</h1>
          <button type="button" onClick={() => setFeedbackOpen(true)} title="Give feedback on Metra"
            className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1.5 text-body-sm font-medium text-ink-muted hover:bg-slate-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <MessageSquarePlus size={16} /><span className="hidden sm:inline">Feedback</span><span className="sr-only sm:hidden">Give feedback on Metra</span>
          </button>
          {phone && <button type="button" onClick={() => pick(null)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="New chat"><SquarePen size={16} /></button>}
        </header>
        <div className="min-h-0 flex-1">
          <MetraChat ref={chatRef} chat={chat} llm={status.llm} suggestions={status.suggestions} firstName={user?.name?.split(' ')[0]}
            selectedKey={current?.key ?? null} onSelect={setSelected} focusInsight={insight}
            onOpenConversation={(id) => pick(id)} onShowHistory={() => setShowList(true)} />
        </div>
      </section>

      {/* The selected answer's sources (wide screens) */}
      <aside aria-label="Sources" className="hidden w-[320px] shrink-0 flex-col border-l border-line bg-bg xl:flex">
        <p className="shrink-0 border-b border-line px-4 py-3 text-body-md font-semibold text-ink">Sources{sources.length ? <span className="ml-1 font-normal text-ink-muted">({sources.length})</span> : null}</p>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {sources.length === 0 ? (
            <p className="px-1 py-6 text-center text-body-sm text-ink-muted">{answers.length ? 'This answer has no sources.' : 'The records an answer comes from show here.'}</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <li key={s.n} className="rounded-card border border-line bg-card p-3 shadow-card">
                  <div className="flex items-start gap-2">
                    <span className="mt-px inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1 text-[11px] font-semibold text-primary">{s.n}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-semibold text-ink">{s.title}</p>
                      <p className="text-[12px] text-ink-muted">{[s.sourceLabel, sourceDate(s.occurredAt)].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  {s.snippet && <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-body-sm text-ink-muted">{s.snippet}</p>}
                  {s.link && <button type="button" onClick={() => openSourceLink(s.link, navigate)} className="mt-1.5 inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">Open <ExternalLink size={12} /></button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <Modal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="Feedback on Metra" size="md">
        {feedbackOpen && <MetraFeedbackForm onDone={() => setFeedbackOpen(false)} onCancel={() => setFeedbackOpen(false)} />}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this chat?" size="sm"
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={() => deleting && void remove(deleting)}>Delete</Button></>}>
        <p className="text-body-md text-ink-muted">“{deleting?.title}” and its answers are deleted for good.</p>
      </Modal>
    </div>
  )
}

function ConversationRow({ cv, active, renaming, onOpen, onPin, onRename, onRenamed, onCancelRename, onDelete }: {
  cv: MetraConversation; active: boolean; renaming: boolean
  onOpen: () => void; onPin: () => void; onRename: () => void; onRenamed: (t: string) => void; onCancelRename: () => void; onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [title, setTitle] = useState(cv.title)
  const box = useRef<HTMLLIElement>(null)
  useEffect(() => { if (renaming) setTitle(cv.title) }, [renaming, cv.title])
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc) }
  }, [menu])
  if (renaming) {
    return (
      <li className="px-1 py-0.5">
        <form onSubmit={(e) => { e.preventDefault(); onRenamed(title) }} className="flex items-center gap-1">
          <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancelRename() } }} aria-label="Chat name"
            className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" />
          <button type="submit" className="rounded-btn p-1.5 text-primary hover:bg-slate-100" aria-label="Save name"><Check size={14} /></button>
          <button type="button" onClick={onCancelRename} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100" aria-label="Cancel"><X size={14} /></button>
        </form>
      </li>
    )
  }
  return (
    <li ref={box} className="group relative">
      <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined}
        className={cn('flex w-full items-center gap-1.5 rounded-btn py-2 pl-2.5 pr-8 text-left text-body-sm hover:bg-slate-100', active ? 'bg-slate-100 font-medium text-ink' : 'text-ink-muted')}>
        {cv.pinned && <Pin size={12} className="shrink-0 text-ink-faint" aria-label="Pinned" />}
        <span className="min-w-0 flex-1 truncate">{cv.title}</span>
      </button>
      <button type="button" onClick={() => setMenu((m) => !m)} aria-label={`More for ${cv.title}`} aria-expanded={menu}
        className={cn('absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:bg-slate-200 hover:text-ink focus:opacity-100', menu ? 'opacity-100' : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100')}>
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div role="menu" className="absolute right-1 top-full z-20 mt-0.5 w-40 rounded-card border border-line bg-card p-1 shadow-overlay">
          <MenuItem onClick={() => { setMenu(false); onPin() }}>{cv.pinned ? <><PinOff size={14} />Unpin</> : <><Pin size={14} />Pin</>}</MenuItem>
          <MenuItem onClick={() => { setMenu(false); onRename() }}><Pencil size={14} />Rename</MenuItem>
          <MenuItem danger onClick={() => { setMenu(false); onDelete() }}><Trash2 size={14} />Delete</MenuItem>
        </div>
      )}
    </li>
  )
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-body-sm hover:bg-slate-100', danger ? 'text-danger' : 'text-ink')}>{children}</button>
}
