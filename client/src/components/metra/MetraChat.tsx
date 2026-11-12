import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AlertCircle, ArrowUp, Check, Copy, Hourglass, Loader2, Pencil, RotateCcw, Square, ThumbsDown, ThumbsUp, PlugZap } from 'lucide-react'
import { cn } from '../../lib/cn'
import { metraApi, type MetraAction, type MetraConversation, type MetraSource } from '../../lib/metraApi'
import type { ChatMessage, UseMetraChat } from './useMetraChat'
import { MetraMark } from './MetraMark'
import { CitationChip, MetraMarkdown, citedNumbers } from './MetraMarkdown'
import { MetraInsights } from './MetraInsights'

export interface MetraChatHandle { focus: () => void }

export interface MetraChatProps {
  chat: UseMetraChat
  llm: boolean
  suggestions: string[]
  firstName?: string
  /** Narrow (the side panel). */
  compact?: boolean
  /** Called after a source or a lead opens (the panel closes on a phone). */
  onNavigate?: () => void
  /** The full page: which answer's sources the side column shows. */
  selectedKey?: string | null
  onSelect?: (key: string) => void
  /** A brief to show on top (the bell's link). */
  focusInsight?: string | null
  /** Open a past conversation from "Recent chats" (the page keeps the address in step). */
  onOpenConversation?: (id: string) => void
  /** Open the full history (the panel's History view). */
  onShowHistory?: () => void
}

/** The Metra conversation: messages, the empty state and the composer. Shared by the side panel and /app/metra. */
export const MetraChat = forwardRef<MetraChatHandle, MetraChatProps>(function MetraChat({ chat, llm, suggestions, firstName, compact, onNavigate, selectedKey, onSelect, focusInsight, onOpenConversation, onShowHistory }, ref) {
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)
  useImperativeHandle(ref, () => ({ focus: () => composer.current?.focus() }), [])

  // Follow the answer as it streams in, unless the person scrolled up to read.
  const last = chat.messages[chat.messages.length - 1]
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, last?.content, last?.statusText, last?.actions.length])
  useEffect(() => { stick.current = true }, [chat.conversationId])

  const empty = !chat.loading && chat.messages.length === 0
  const ask = (q: string) => { stick.current = true; chat.send(q) }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}
        className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', compact ? 'px-3.5 py-4' : 'px-4 py-5 sm:px-6')}
      >
        {chat.loading ? (
          <div className="flex h-full items-center justify-center text-ink-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">Loading</span></div>
        ) : chat.loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <AlertCircle size={20} className="text-danger" />
            <p className="text-body-md text-ink-muted">{chat.loadError}</p>
            <button type="button" onClick={() => chat.newChat()} className="text-body-sm font-semibold text-primary hover:underline">Start a new chat</button>
          </div>
        ) : empty ? (
          <div className={cn('mx-auto flex max-w-xl flex-col items-center gap-4 text-center', compact ? 'pt-2' : 'pt-6')}>
            <MetraMark size={compact ? 40 : 52} />
            <div>
              <p className="text-headline-md text-ink">{firstName ? `Hi ${firstName}, I'm Metra.` : "Hi, I'm Metra."}</p>
              <p className="mt-1 text-body-md text-ink-muted">Ask about your leads, tasks, notes, meetings and team logs. I answer only from what you can see in Metriq, and show where it came from.</p>
            </div>
            <MetraInsights onAsk={ask} focusId={focusInsight} onNavigate={onNavigate} compact={compact} />
            {llm && suggestions.length > 0 && (
              <div className="flex w-full flex-wrap justify-center gap-2" aria-label="Suggested questions">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-body-sm text-ink shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <RecentChats onOpen={onOpenConversation ?? ((id) => chat.open(id))} onShowAll={onShowHistory} />
          </div>
        ) : (
          <ol className="mx-auto max-w-3xl space-y-5" aria-label="Conversation">
            {chat.messages.map((m) => (
              <li key={m.key}>
                {m.role === 'USER'
                  ? <UserBubble text={m.content} disabled={chat.streaming} onEdit={(t) => composer.current?.setText(t)} />
                  : <Answer m={m} chat={chat} onNavigate={onNavigate} selected={selectedKey === m.key} onSelect={onSelect} />}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!llm && (
        <p role="status" className="mx-3 mb-2 flex items-center gap-2 rounded-btn border border-line bg-slate-50 px-3 py-2 text-body-sm text-ink-muted">
          <PlugZap size={15} className="shrink-0" />Metra isn't connected to its AI model yet.
        </p>
      )}
      <Composer ref={composer} disabled={!llm} streaming={chat.streaming} queued={!!chat.queued} onSend={ask} onStop={chat.stop} compact={compact} />
    </div>
  )
})

/**
 * A question. Its text can be selected (the app's light indigo selection is invisible on this indigo bubble, so
 * selected text here turns white with indigo letters), copied, or put back in the box to edit and ask again.
 */
function UserBubble({ text, onEdit, disabled }: { text: string; onEdit: (t: string) => void; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* nothing more to try */ }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group flex flex-col items-end gap-1">
      <p className="max-w-[85%] cursor-text select-text whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-body-md text-white selection:bg-white selection:text-primary">{text}</p>
      <div className="flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
        <IconBtn label="Edit and ask again" onClick={() => onEdit(text)} disabled={disabled}><Pencil size={14} /></IconBtn>
        <IconBtn label={copied ? 'Copied' : 'Copy question'} pressed={copied} tone="ok" onClick={() => void copy()}>{copied ? <Check size={14} strokeWidth={2.6} /> : <Copy size={14} />}</IconBtn>
      </div>
    </div>
  )
}

function Answer({ m, chat, onNavigate, selected, onSelect }: { m: ChatMessage; chat: UseMetraChat; onNavigate?: () => void; selected?: boolean; onSelect?: (key: string) => void }) {
  const [copied, setCopied] = useState(false)
  const [why, setWhy] = useState<'closed' | 'open' | 'sent'>('closed')
  const [note, setNote] = useState('')
  const thinking = m.pending && !m.content
  async function copy() {
    try { await navigator.clipboard.writeText(m.content) } catch {
      const t = document.createElement('textarea'); t.value = m.content; document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { /* nothing more to try */ }
      t.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      className={cn('flex gap-2.5', onSelect && 'cursor-default')}
      onClick={onSelect && !m.pending ? () => onSelect(m.key) : undefined}
    >
      <MetraMark size={24} className="mt-0.5" />
      <div className={cn('min-w-0 flex-1', selected && 'rounded-card')}>
        {thinking && (m.queue ? <QueuePill queue={m.queue} /> : (
          <p role="status" aria-live="polite" className="flex items-center gap-2 py-0.5 text-body-md text-ink-muted">
            <Loader2 size={14} className="animate-spin" />{(m.statusText || 'Thinking').replace(/[.…]+$/, '')}…
          </p>
        ))}
        {m.content && <MetraMarkdown text={m.content} sources={m.sources} onOpen={onNavigate} />}
        {m.pending && m.content && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-ink-faint align-middle" />}
        {m.error && (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 rounded-btn border border-danger/25 bg-danger/5 px-3 py-2 text-body-sm text-ink">
            <AlertCircle size={15} className="shrink-0 text-danger" />
            <span className="min-w-0 flex-1">{m.error}</span>
            {!chat.streaming && (m.question || m.error !== 'Stopped.') && (
              <button type="button" onClick={() => chat.retry(m.key)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><RotateCcw size={13} />Retry</button>
            )}
          </div>
        )}
        {m.actions.length > 0 && (
          <div className="mt-2.5 space-y-2">
            {m.actions.map((a) => <ActionCardView key={a.id} a={a} busy={chat.busyActions.has(a.id)} canDecide={!!m.id && !m.pending} onDecide={(d) => void chat.decide(m.key, a.id, d)} />)}
          </div>
        )}
        {!m.pending && m.sources.length > 0 && <SourcesRow text={m.content} sources={m.sources} onNavigate={onNavigate} />}
        {!m.pending && m.content && m.id && (
          <div className="mt-1.5 flex items-center gap-0.5 text-ink-faint">
            <IconBtn label={m.feedback === 'UP' ? 'Helpful (chosen: tap to undo)' : 'Helpful'} pressed={m.feedback === 'UP'} tone="up" onClick={() => chat.setFeedback(m.key, m.feedback === 'UP' ? null : 'UP')}><ThumbsUp size={15} fill={m.feedback === 'UP' ? 'currentColor' : 'none'} /></IconBtn>
            <IconBtn label={m.feedback === 'DOWN' ? 'Not helpful (chosen: tap to undo)' : 'Not helpful'} pressed={m.feedback === 'DOWN'} tone="down"
              onClick={() => { const off = m.feedback === 'DOWN'; chat.setFeedback(m.key, off ? null : 'DOWN'); setWhy(off ? 'closed' : 'open'); setNote('') }}><ThumbsDown size={15} fill={m.feedback === 'DOWN' ? 'currentColor' : 'none'} /></IconBtn>
            <IconBtn label={copied ? 'Copied' : 'Copy'} pressed={copied} tone="ok" onClick={() => void copy()}>{copied ? <Check size={15} strokeWidth={2.6} /> : <Copy size={15} />}</IconBtn>
            <span aria-live="polite" className="sr-only">{copied ? 'Copied' : ''}</span>
          </div>
        )}
        {/* After a 👎: what was wrong, in the person's words (optional). It goes to the admin with the question. */}
        {m.feedback === 'DOWN' && why === 'open' && (
          <form className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; chat.setFeedback(m.key, 'DOWN', note.trim()); setWhy('sent') }}>
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} aria-label="What was wrong with this answer?" placeholder="What was wrong? (optional)"
              className="min-w-0 flex-1 rounded-btn border border-line bg-card px-2.5 py-1.5 text-body-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            <button type="submit" disabled={!note.trim()} className="rounded-btn bg-primary px-2.5 py-1.5 text-body-sm font-semibold text-white disabled:opacity-40">Send</button>
            <button type="button" onClick={() => setWhy('closed')} className="rounded-btn px-1.5 py-1.5 text-body-sm text-ink-muted hover:text-ink">Skip</button>
          </form>
        )}
        {m.feedback === 'DOWN' && why === 'sent' && <p role="status" className="mt-1.5 text-body-sm text-ink-muted">Thanks. Your note was sent with your question.</p>}
      </div>
    </div>
  )
}

const TONE = { up: 'bg-primary/15 text-primary hover:bg-primary/20', down: 'bg-danger/15 text-danger hover:bg-danger/20', ok: 'bg-success/15 text-success hover:bg-success/20' } as const
function IconBtn({ label, pressed, tone, onClick, disabled, children }: { label: string; pressed?: boolean; tone?: keyof typeof TONE; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick() }} aria-label={label} title={label} aria-pressed={pressed}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40',
        pressed && tone ? TONE[tone] : 'text-ink-faint hover:bg-slate-100 hover:text-ink')}>
      {children}
    </button>
  )
}

/** The sources an answer used: the cited ones first, the rest behind "N more". */
export function SourcesRow({ text, sources, onNavigate }: { text: string; sources: MetraSource[]; onNavigate?: () => void }) {
  const [all, setAll] = useState(false)
  const cited = citedNumbers(text).map((n) => sources.find((s) => s.n === n)).filter((s): s is MetraSource => !!s)
  const rest = sources.filter((s) => !cited.includes(s))
  const shown = all ? [...cited, ...rest] : cited
  const more = rest.length
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {(cited.length > 0 || all) && <span className="text-[11.5px] font-medium text-ink-faint">Sources</span>}
      {shown.map((s) => (
        <CitationChip key={s.n} n={s.n} source={s} onOpen={onNavigate} label={<><span className="font-semibold tabular-nums text-primary">{s.n}</span><span className="max-w-[160px] truncate">{s.title}</span></>} />
      ))}
      {more > 0 && (
        <button type="button" aria-expanded={all} onClick={(e) => { e.stopPropagation(); setAll((x) => !x) }} className="rounded-full px-1.5 text-[12px] font-medium text-ink-faint hover:text-ink hover:underline">
          {all ? 'Show less' : `Show ${more} more`}
        </button>
      )}
    </div>
  )
}

const STATE_TEXT: Record<MetraAction['state'], string> = { PROPOSED: '', DONE: 'Done', DISMISSED: 'Dismissed', FAILED: 'Could not do it' }

function ActionCardView({ a, busy, canDecide, onDecide }: { a: MetraAction; busy: boolean; canDecide: boolean; onDecide: (d: 'confirm' | 'dismiss') => void }) {
  const open = a.state === 'PROPOSED'
  return (
    <div className={cn('rounded-card border bg-card p-3 shadow-card', a.state === 'FAILED' ? 'border-danger/30' : a.state === 'DONE' ? 'border-success/30' : 'border-line')}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{a.label}</p>
      <p className="mt-0.5 text-body-md text-ink">{a.summary}</p>
      {open ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !canDecide} onClick={() => onDecide('confirm')} className="inline-flex h-8 items-center gap-1.5 rounded-btn bg-primary px-3 text-body-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Confirm
          </button>
          <button type="button" disabled={busy || !canDecide} onClick={() => onDecide('dismiss')} className="inline-flex h-8 items-center rounded-btn border border-line bg-card px-3 text-body-sm font-medium text-ink-muted hover:text-ink disabled:opacity-60">Dismiss</button>
          {a.result && <span className="text-body-sm text-danger">{a.result}</span>}
        </div>
      ) : (
        <p className={cn('mt-2 text-body-sm', a.state === 'DONE' ? 'text-success' : a.state === 'FAILED' ? 'text-danger' : 'text-ink-muted')}>
          <span className="font-semibold">{STATE_TEXT[a.state]}</span>{a.result ? `: ${a.result}` : ''}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ composer

interface ComposerHandle { focus: () => void; setText: (t: string) => void }

const Composer = forwardRef<ComposerHandle, { disabled: boolean; streaming: boolean; queued: boolean; onSend: (t: string) => void; onStop: () => void; compact?: boolean }>(function Composer({ disabled, streaming, queued, onSend, onStop, compact }, ref) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    // Edit a question: it goes back in the box, ready to change and send again (cursor at the end).
    setText: (t: string) => {
      setText(t)
      requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(t.length, t.length) } })
    },
  }), [])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [text])
  const submit = () => {
    if (disabled || streaming || !text.trim()) return
    onSend(text)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit() }}
      className={cn('shrink-0 border-t border-line bg-card', compact ? 'p-2.5 max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]' : 'p-3')}
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-card border border-line bg-bg px-2.5 py-1.5 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="Ask Metra"
          placeholder={disabled ? 'Metra is not ready yet' : 'Ask Metra about your Metriq data…'}
          className="max-h-[168px] min-h-[36px] flex-1 resize-none border-0 bg-transparent py-1.5 text-body-md text-ink outline-none placeholder:text-ink-faint focus:ring-0 disabled:cursor-not-allowed"
        />
        {streaming ? (
          <button type="button" onClick={onStop} aria-label="Stop" title="Stop" className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-card hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" disabled={disabled || !text.trim()} aria-label="Send" title="Send (Enter)" className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-white transition-opacity disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        )}
      </div>
      {queued
        ? <p role="status" className="mx-auto mt-1.5 max-w-3xl text-center text-[11.5px] text-ink-muted">Many questions at once: yours is in line and will be answered by itself. You can keep typing.</p>
        : !compact && <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11.5px] text-ink-faint">Enter to send, Shift+Enter for a new line. Metra can be wrong: check the sources.</p>}
    </form>
  )
})

/** The AI model is busy: a calm countdown with a thin progress bar instead of a spinner. */
function QueuePill({ queue }: { queue: { until: number; total: number } }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(t) }, [])
  const left = Math.max(0, Math.ceil((queue.until - now) / 1000))
  const done = queue.total > 0 ? Math.min(1, 1 - (queue.until - now) / (queue.total * 1000)) : 1
  return (
    <div role="status" aria-live="polite" className="inline-flex max-w-full flex-col gap-1.5 rounded-card border border-primary/20 bg-primary/5 px-3 py-2">
      <span className="flex items-center gap-2 text-body-sm font-medium text-ink">
        <Hourglass size={14} className="shrink-0 text-primary motion-safe:animate-pulse" />
        {left > 0 ? <>Metra is queued — answering in <span className="tabular-nums">{left}</span> s</> : 'Metra is queued — answering now'}
      </span>
      <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-primary/15">
        <span className="block h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300 ease-linear" style={{ width: `${Math.round(done * 100)}%` }} />
      </span>
    </div>
  )
}

const rel = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** The last five chats, under the suggestions on a new chat. */
function RecentChats({ onOpen, onShowAll }: { onOpen: (id: string) => void; onShowAll?: () => void }) {
  const [list, setList] = useState<MetraConversation[] | null>(null)
  useEffect(() => {
    let alive = true
    metraApi.conversations().then((xs) => { if (alive) setList(xs) }).catch(() => { if (alive) setList([]) })
    return () => { alive = false }
  }, [])
  if (!list?.length) return null
  const recent = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
  return (
    <section aria-label="Recent chats" className="w-full text-left">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Recent chats</p>
        {onShowAll && list.length > 5 && <button type="button" onClick={onShowAll} className="text-[12px] font-medium text-primary hover:underline">See all</button>}
      </div>
      <ul className="overflow-hidden rounded-card border border-line bg-card">
        {recent.map((c) => (
          <li key={c.id} className="border-b border-line last:border-b-0">
            <button type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50">
              <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{c.title}</span>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{rel(c.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
