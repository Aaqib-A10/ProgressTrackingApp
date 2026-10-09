import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellOff, CheckCheck, CornerUpLeft, Download, Expand, FileText, Loader2, MoreHorizontal, Paperclip, Pencil, Phone, PhoneMissed, Send, Smile, SmilePlus, Sparkles, Trash2, Users, Video, X } from 'lucide-react'
import { chatApi, visiblePoll, type ChatMessage, type ConversationDetail } from '../../lib/chatApi'
import { errMsg } from '../../lib/projectsApi'
import { useToast } from '../ui/Toast'
import { PersonAvatar, fmtBytes, fmtDateTime } from '../projects/pmUi'
import { refreshChatUnread } from './useChatUnread'
import { cn } from '../../lib/cn'
import { useCalls } from '../calls/CallProvider'
import { NotesModal } from '../calls/MeetingNotes'
import { ChatPicture } from '../ui/Pictures'
import { MediaViewer } from '../ui/MediaViewer'

const API = import.meta.env.VITE_API_URL ?? '/api'
const EMOJI = ['👍', '🙏', '✅', '🎉', '👀', '🔥', '😂', '❤️', '🚀', '⏰', '❗', '🙂']
const TASK_RE = /\b([A-Z][A-Z0-9]{1,5}-\d{1,7})\b/g

/**
 * One conversation: history (scroll up for older), live polling for new messages,
 * edits and deletes, typing indicator, read receipts, replies, @mentions and files.
 */
/** Same data? (cheap deep compare for small poll answers) */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function ChatThread({ conversationId, meId, compact, prefill, onHeaderClick, actions, onSent, hideCallButtons }: { conversationId: string; meId: string; compact?: boolean; prefill?: string; onHeaderClick?: () => void; actions?: React.ReactNode; onSent?: () => void; hideCallButtons?: boolean }) {
  const { addToast } = useToast()
  const calls = useCalls()
  const [conv, setConv] = useState<ConversationDetail | null>(null)
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [typing, setTyping] = useState<string[]>([])
  const [reads, setReads] = useState<{ userId: string; lastReadSeq: number }[]>([])
  const [text, setText] = useState(prefill ?? '')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [suggest, setSuggest] = useState<{ id: string; name: string }[] | null>(null)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [reactFor, setReactFor] = useState<string | null>(null)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastSeq = useRef(0)
  const lastSync = useRef<string | null>(null)
  const atBottom = useRef(true)
  const lastTypingPing = useRef(0)
  const keepScroll = useRef<number | null>(null)

  const members = useMemo(() => (conv?.members ?? []).filter((m) => m.id !== meId), [conv, meId])
  const nameOf = (id: string) => conv?.members.find((m) => m.id === id)?.name ?? 'Someone'

  const markRead = useCallback((seq: number) => {
    if (document.visibilityState !== 'visible' || !atBottom.current) return
    chatApi.read(conversationId, seq).then(() => refreshChatUnread()).catch(() => undefined)
  }, [conversationId])

  // Initial load
  useEffect(() => {
    let alive = true
    setConv(null); setMsgs([]); setReplyTo(null); setEditing(null); lastSeq.current = 0; atBottom.current = true
    setText(prefill ?? '')
    chatApi.conversation(conversationId).then((r) => alive && setConv(r.conversation)).catch(() => undefined)
    chatApi.messages(conversationId, { limit: 50 }).then((r) => {
      if (!alive) return
      setMsgs(r.messages); setHasMore(r.hasMore); setReads(r.reads); setTyping(r.typing)
      lastSeq.current = r.messages.at(-1)?.seq ?? 0
      lastSync.current = r.serverTime
      if (lastSeq.current) markRead(lastSeq.current)
    }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not open the chat') }))
    return () => { alive = false }
  }, [conversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live poll
  useEffect(() => visiblePoll(async () => {
    try {
      const r = await chatApi.messages(conversationId, { after: lastSeq.current, changedSince: lastSync.current ?? undefined })
      lastSync.current = r.serverTime
      // Only when something changed: a new array every poll re-drew the whole chat.
      setTyping((cur) => (sameJson(cur, r.typing) ? cur : r.typing))
      setReads((cur) => (sameJson(cur, r.reads) ? cur : r.reads))
      if (r.messages.length || r.changed.length) {
        setMsgs((cur) => {
          const map = new Map(cur.map((m) => [m.id, m]))
          for (const m of [...r.changed, ...r.messages]) map.set(m.id, m)
          return [...map.values()].sort((a, b) => a.seq - b.seq)
        })
      }
      if (r.messages.length) {
        lastSeq.current = r.messages.at(-1)!.seq
        markRead(lastSeq.current)
      }
    } catch { /* transient */ }
  }, 2500), [conversationId, markRead])

  useEffect(() => visiblePoll(() => { chatApi.conversation(conversationId).then((r) => setConv((cur) => (sameJson(cur, r.conversation) ? cur : r.conversation))).catch(() => undefined) }, 30000), [conversationId])

  // Scroll: stick to bottom for new messages, keep position when older ones load.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (keepScroll.current != null) {
      el.scrollTop = el.scrollHeight - keepScroll.current
      keepScroll.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [msgs])

  async function loadOlder() {
    if (!hasMore || loadingOlder || !msgs.length) return
    setLoadingOlder(true)
    try {
      const r = await chatApi.messages(conversationId, { before: msgs[0].seq, limit: 50 })
      keepScroll.current = (scroller.current?.scrollHeight ?? 0) - (scroller.current?.scrollTop ?? 0)
      setMsgs((cur) => [...r.messages, ...cur])
      setHasMore(r.hasMore)
    } finally { setLoadingOlder(false) }
  }

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (bottom && !atBottom.current && lastSeq.current) { atBottom.current = true; markRead(lastSeq.current) }
    atBottom.current = bottom
    if (el.scrollTop < 80) loadOlder()
  }

  function onType(v: string, pos: number) {
    setText(v)
    const m = v.slice(0, pos).match(/(?:^|\s)@([\w.-]{0,30})$/)
    if (!m) { setSuggest(null) } else {
      const tok = m[1].toLowerCase()
      const people = members.filter((x) => x.name.toLowerCase().includes(tok)).slice(0, 6)
      // "@all" notifies everyone in the conversation; offer it first when it matches what's typed.
      const all = members.length > 1 && ('all'.startsWith(tok) || 'everyone'.startsWith(tok)) ? [{ id: ALL_ID, name: 'all' }] : []
      setSuggest([...all, ...people])
    }
    const now = Date.now()
    if (v && now - lastTypingPing.current > 3000) { lastTypingPing.current = now; chatApi.typing(conversationId, true).catch(() => undefined) }
  }
  function pickMention(p: { id: string; name: string }) {
    const el = inputRef.current
    const pos = el?.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const m = before.match(/(?:^|\s)@([\w.-]{0,30})$/)
    if (!m) return
    const at = before.length - m[1].length - 1
    const nb = before.slice(0, at) + '@' + p.name + ' '
    setText(nb + text.slice(pos))
    if (p.id !== ALL_ID) setMentionIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]))
    setSuggest(null)
    setTimeout(() => { el?.focus(); el?.setSelectionRange(nb.length, nb.length) }, 0)
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    if (body.length > 5000) { addToast({ type: 'error', message: 'Messages are limited to 5000 characters' }); return }
    setSending(true)
    try {
      if (editing) {
        const r = await chatApi.edit(editing.id, body)
        setMsgs((cur) => cur.map((m) => (m.id === r.message.id ? r.message : m)))
        setEditing(null)
      } else {
        const mentions = mentionIds.filter((id) => body.includes('@' + nameOf(id)))
        const r = await chatApi.send(conversationId, body, { replyToId: replyTo?.id ?? null, mentions })
        atBottom.current = true
        setMsgs((cur) => (cur.some((m) => m.id === r.message.id) ? cur : [...cur, r.message]))
        lastSeq.current = Math.max(lastSeq.current, r.message.seq)
        setReplyTo(null)
      }
      setText(''); setMentionIds([])
      chatApi.typing(conversationId, false).catch(() => undefined)
      refreshChatUnread()
      onSent?.()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Message not sent') })
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function sendFile(f: File) {
    if (f.size > 25 * 1024 * 1024) { addToast({ type: 'error', message: 'Files are limited to 25 MB' }); return }
    setSending(true)
    try {
      const r = await chatApi.sendFile(conversationId, f, text.trim())
      atBottom.current = true
      setMsgs((cur) => [...cur, r.message]); lastSeq.current = Math.max(lastSeq.current, r.message.seq)
      setText('')
      onSent?.()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Upload failed') }) } finally { setSending(false) }
  }

  async function react(m: ChatMessage, emoji: string) {
    // Show it straight away, then take the server's answer.
    setMsgs((cur) => cur.map((x) => {
      if (x.id !== m.id) return x
      const has = x.reactions.find((r) => r.emoji === emoji)
      const reactions = has
        ? x.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.includes(meId) ? r.userIds.filter((u) => u !== meId) : [...r.userIds, meId] } : r)).filter((r) => r.userIds.length)
        : [...x.reactions, { emoji, userIds: [meId] }]
      return { ...x, reactions }
    }))
    try {
      const r = await chatApi.react(m.id, emoji)
      setMsgs((cur) => cur.map((x) => (x.id === r.message.id ? r.message : x)))
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }
  const nameOrYou = (id: string) => (id === meId ? 'You' : nameOf(id))

  async function remove(m: ChatMessage) {
    try { await chatApi.remove(m.id); setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', file: null, task: null } : x))) } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }

  const otherReadSeq = conv?.type === 'DIRECT' ? reads.find((r) => r.userId !== meId)?.lastReadSeq ?? 0 : 0
  const lastMine = [...msgs].reverse().find((m) => m.user.id === meId && !m.deleted && !m.call)
  const isDirect = conv?.type === 'DIRECT'
  const other = isDirect ? members[0] : null
  // Latest handlers for the memoised message list (it only redraws when messages change).
  const h = useRef({ react, remove, nameOrYou })
  h.current = { react, remove, nameOrYou }
  const messageList = useMemo(() => (
    <>
        {msgs.map((m, i) => {
        const prev = msgs[i - 1]
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
        const grouped = !newDay && prev && prev.user.id === m.user.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60000
        const mine = m.user.id === meId
        return (
          <Fragment key={m.id}>
            {newDay && <div className="my-3 flex items-center gap-3 text-body-sm text-ink-muted"><span className="h-px flex-1 bg-line" />{new Date(m.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}<span className="h-px flex-1 bg-line" /></div>}
            <div className={cn('group relative flex gap-2', mine && 'flex-row-reverse', grouped ? 'mt-0.5' : 'mt-3')}>
              {!mine && <div className="w-8 shrink-0">{!grouped && <PersonAvatar person={m.user} size={32} />}</div>}
              <div className={cn('flex min-w-0 flex-col', compact ? 'max-w-[85%]' : 'max-w-[72%]', mine ? 'items-end' : 'items-start')}>
                {!grouped && (
                  <div className={cn('mb-0.5 flex items-baseline gap-2 px-1', mine && 'flex-row-reverse')}>
                    <span className="text-body-sm font-semibold text-ink">{mine ? 'You' : m.user.name}</span>
                    <span className="text-[11px] text-ink-muted" title={fmtDateTime(m.createdAt)}>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                )}
                <div className={cn(
                  'min-w-0 max-w-full rounded-2xl px-3 py-2',
                  mine ? 'bg-primary/10' : 'bg-slate-100',
                  !grouped && (mine ? 'rounded-tr-md' : 'rounded-tl-md'),
                )}>
                  {m.replyTo && !m.deleted && (
                    <div className="mb-1 border-l-2 border-primary/40 pl-2 text-body-sm text-ink-muted"><b className="text-ink">{m.replyTo.userName}</b>: {m.replyTo.body}</div>
                  )}
                  {m.deleted ? <p className="text-body-md italic text-ink-muted">Message deleted</p> : (
                    <>
                      {m.notes ? <NotesCard callId={m.notes.callId} body={m.body} onOpen={() => setNotesFor(m.notes!.callId)} /> : m.call ? <CallCard call={m.call} conversationId={conversationId} mine={mine} /> : m.body && <p className="whitespace-pre-wrap break-words text-body-md text-ink">{renderBody(m.body, conv?.members ?? [], m.mentions, meId, !!m.task)}{m.editedAt && <span className="ml-1 text-[11px] text-ink-muted">(edited)</span>}</p>}
                      {m.file && <FileBubble file={m.file} />}
                      {m.task && <TaskRefCard task={m.task} />}
                    </>
                  )}
                </div>
                {!m.deleted && m.reactions?.length > 0 && (
                  <div className={cn('mt-0.5 flex flex-wrap gap-1 px-1', mine && 'justify-end')}>
                    {m.reactions.map((r) => {
                      const mineR = r.userIds.includes(meId)
                      return (
                        <button key={r.emoji} type="button" onClick={() => h.current.react(m, r.emoji)} title={r.userIds.map(h.current.nameOrYou).join(', ')} className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[12px] leading-none', mineR ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line bg-card text-ink-muted hover:bg-slate-50')}>
                          <span className="text-[14px]">{r.emoji}</span>{r.userIds.length}
                        </button>
                      )
                    })}
                  </div>
                )}
                {isDirect && mine && lastMine?.id === m.id && otherReadSeq >= m.seq && <p className="mt-0.5 inline-flex items-center gap-1 px-1 text-[11px] text-primary"><CheckCheck size={12} /> Seen</p>}
              </div>
              {!m.deleted && (
                <div className={cn('absolute top-0 hidden items-center gap-0.5 rounded-btn border border-line bg-card p-0.5 shadow-card group-hover:flex', mine ? 'left-1' : 'right-1', menuFor === m.id && 'flex')}>
                  {MSG_REACTIONS.slice(0, compact ? 3 : 5).map((e) => (
                    <button key={e} type="button" onClick={() => h.current.react(m, e)} className="rounded px-0.5 text-[15px] leading-none hover:scale-125" aria-label={`React ${e}`} title={`React ${e}`}>{e}</button>
                  ))}
                  <button type="button" onClick={() => setReactFor(reactFor === m.id ? null : m.id)} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="More reactions" title="More reactions"><SmilePlus size={14} /></button>
                  {reactFor === m.id && MSG_REACTIONS.slice(compact ? 3 : 5).map((e) => (
                    <button key={e} type="button" onClick={() => { h.current.react(m, e); setReactFor(null) }} className="rounded px-0.5 text-[15px] leading-none hover:scale-125" aria-label={`React ${e}`}>{e}</button>
                  ))}
                  <button type="button" onClick={() => { setReplyTo(m); setEditing(null); inputRef.current?.focus() }} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Reply" title="Reply"><CornerUpLeft size={14} /></button>
                  {mine && (
                    <>
                      {!m.file && !m.call && <button type="button" onClick={() => { setEditing(m); setReplyTo(null); setText(m.body); inputRef.current?.focus() }} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Edit" title="Edit"><Pencil size={14} /></button>}
                      <button type="button" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="More"><MoreHorizontal size={14} /></button>
                      {menuFor === m.id && <button type="button" onClick={() => { setMenuFor(null); h.current.remove(m) }} className="rounded px-1.5 py-0.5 text-body-sm text-danger hover:bg-danger/10"><Trash2 size={13} className="inline" /> Delete</button>}
                    </>
                  )}
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </>
  ), [msgs, conv, meId, compact, menuFor, reactFor, isDirect, lastMine?.id, otherReadSeq, conversationId]) // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div className="flex h-full min-h-0 flex-col">
      {notesFor && <NotesModal callId={notesFor} onClose={() => setNotesFor(null)} />}
      {/* Header */}
      <div className={cn('flex shrink-0 items-center gap-3 border-b border-line', compact ? 'px-3 py-2' : 'px-4 py-3')}>
        {conv ? (
          <button type="button" onClick={onHeaderClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {isDirect && other ? <PersonAvatar person={other} size={compact ? 28 : 34} presence={other.presence} /> : (
              <ChatPicture type={conv.type} conversationId={conv.id} projectKey={conv.project?.key} color={conv.project?.color} size={compact ? 28 : 34} />
            )}
            <span className="min-w-0">
              <span className="block truncate text-body-md font-semibold text-ink">{conv.title}</span>
              <span className="block truncate text-body-sm text-ink-muted">
                {isDirect && other ? (other.presence === 'busy' ? 'In a call' : other.presence === 'online' ? 'Online' : other.presence === 'away' ? 'Away' : 'Offline') : `${conv.members.length} members`}
                {conv.muted && <> · <BellOff size={11} className="inline" /> muted</>}
              </span>
            </span>
          </button>
        ) : <span className="h-8 w-40 animate-pulse rounded bg-slate-100" />}
        {conv && calls && !hideCallButtons && <CallButtons conversationId={conversationId} compact={compact} />}
        {conv?.project && !compact && <Link to={`/app/projects/${conv.project.key}`} className="shrink-0 text-body-sm font-semibold text-primary">Open board</Link>}
        {actions}
      </div>

      {/* Messages */}
      <div ref={scroller} onScroll={onScroll} className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 py-2' : 'px-4 py-3')} role="log" aria-live="polite" aria-label="Messages">
        {loadingOlder && <div className="flex justify-center py-2"><Loader2 size={16} className="animate-spin text-ink-muted" /></div>}
        {!hasMore && msgs.length > 0 && <p className="py-3 text-center text-body-sm text-ink-muted">Start of the conversation</p>}
        {msgs.length === 0 && conv && <p className="py-10 text-center text-body-md text-ink-muted">No messages yet. Say hello 👋</p>}
        {messageList}
      </div>

      {/* Typing */}
      <div className="h-5 shrink-0 px-4 text-[12px] text-ink-muted">
        {typing.length > 0 && <span className="animate-pulse">{typing.map(nameOf).slice(0, 2).join(' and ')}{typing.length > 2 ? ' and others' : ''} {typing.length === 1 ? 'is' : 'are'} typing…</span>}
      </div>

      {/* Composer */}
      <div className={cn('relative shrink-0 border-t border-line', compact ? 'p-2' : 'p-3')}>
        {(replyTo || editing) && (
          <div className="mb-2 flex items-center gap-2 rounded-btn bg-slate-50 px-2 py-1 text-body-sm text-ink-muted">
            {replyTo ? <><CornerUpLeft size={13} /> Replying to <b className="text-ink">{replyTo.user.name}</b>: <span className="truncate">{replyTo.body || replyTo.file?.name}</span></> : <><Pencil size={13} /> Editing message</>}
            <button type="button" className="ml-auto" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText('') } }} aria-label="Cancel"><X size={14} /></button>
          </div>
        )}
        {suggest && suggest.length > 0 && (
          <ul className="absolute bottom-full left-3 z-10 mb-1 w-60 overflow-hidden rounded-btn border border-line bg-card shadow-overlay">
            {suggest.map((p) => (
              <li key={p.id}>
                {p.id === ALL_ID ? (
                  <button type="button" onClick={() => pickMention(p)} className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left text-body-sm hover:bg-slate-50">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white"><Users size={11} /></span>
                    <span className="font-semibold text-ink">@all</span>
                    <span className="text-ink-muted">Notify everyone here ({members.length})</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => pickMention(p)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm hover:bg-slate-50"><PersonAvatar person={p} size={20} />{p.name}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {showEmoji && (
          <div className="absolute bottom-full right-3 z-10 mb-1 grid grid-cols-6 gap-1 rounded-btn border border-line bg-card p-2 shadow-overlay">
            {EMOJI.map((e) => <button key={e} type="button" className="rounded p-1 text-lg hover:bg-slate-100" onClick={() => { setText((t) => t + e); setShowEmoji(false); inputRef.current?.focus() }}>{e}</button>)}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-btn border border-line bg-card px-2 py-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Attach a file" title="Attach a file"><Paperclip size={18} /></button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (suggest?.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(suggest[0]); return }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              if (e.key === 'Escape') { setSuggest(null); setShowEmoji(false); if (editing) { setEditing(null); setText('') } }
              if (e.key === 'ArrowUp' && !text && lastMine && !lastMine.file) { e.preventDefault(); setEditing(lastMine); setText(lastMine.body) }
            }}
            onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); sendFile(f) } }}
            rows={1}
            maxLength={5000}
            placeholder={conv ? `Message ${conv.title}` : 'Message'}
            aria-label="Message"
            className="max-h-40 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-body-md text-ink placeholder:text-ink-muted focus:outline-none"
            style={{ height: Math.min(160, 34 + (text.split('\n').length - 1) * 20) }}
          />
          <button type="button" onClick={() => setShowEmoji((s) => !s)} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Emoji"><Smile size={18} /></button>
          <button type="button" onClick={send} disabled={!text.trim() || sending} className="rounded-btn bg-primary p-1.5 text-white disabled:opacity-40" aria-label={editing ? 'Save edit' : 'Send'}>{sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}</button>
        </div>
        {!compact && <p className="mt-1 text-[11px] text-ink-muted">Enter to send, Shift+Enter for a new line, @ to mention, paste a task code like RTI-12 to share it.</p>}
      </div>
    </div>
  )
}

const ALL_ID = '__all__'
const MSG_REACTIONS = ['👍', '❤️', '😂', '🎉', '✅', '😮', '😢', '🙏']

function NotesCard({ body, onOpen }: { callId: string; body: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex max-w-md items-start gap-3 rounded-btn border border-primary/20 bg-card p-2.5 text-left hover:border-primary/40 hover:shadow-card">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles size={17} /></span>
      <span className="min-w-0">
        <span className="block text-body-md font-semibold text-ink">Meeting notes</span>
        <span className="line-clamp-3 block text-body-sm text-ink-muted">{body.replace(/^Meeting notes: /, '')}</span>
        <span className="mt-1 block text-body-sm font-semibold text-primary">Open summary, action items and transcript</span>
      </span>
    </button>
  )
}

function renderBody(body: string, members: { id: string; name: string }[], mentionIds: string[], meId: string, hasTask: boolean): React.ReactNode[] {
  const names = mentionIds.map((id) => members.find((m) => m.id === id)).filter((m): m is { id: string; name: string } => !!m).sort((a, b) => b.name.length - a.name.length)
  const out: React.ReactNode[] = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (!buf) return
    // linkify URLs; highlight task codes softly
    const parts = buf.split(/(https?:\/\/[^\s)]+)/g)
    parts.forEach((p, j) => {
      if (/^https?:\/\//.test(p)) out.push(<a key={`${i}-u${j}`} href={p} target="_blank" rel="noreferrer noopener" className="text-primary underline">{p}</a>)
      else if (hasTask) out.push(...p.split(TASK_RE).map((x, k) => (k % 2 === 1 ? <b key={`${i}-${j}-${k}`} className="font-mono">{x}</b> : x)))
      else out.push(p)
    })
    buf = ''
  }
  while (i < body.length) {
    if (body[i] === '@') {
      const all = /^@(all|everyone)\b/i.exec(body.slice(i))
      if (all && (i === 0 || /\s/.test(body[i - 1]))) {
        flush()
        out.push(<span key={`m${i}`} className="rounded bg-warning/20 px-0.5 font-medium text-amber-800">{all[0]}</span>)
        i += all[0].length
        continue
      }
      const hit = names.find((n) => body.startsWith('@' + n.name, i))
      if (hit) {
        flush()
        out.push(<span key={`m${i}`} className={cn('rounded px-0.5 font-medium', hit.id === meId ? 'bg-warning/20 text-amber-800' : 'bg-primary/10 text-primary')}>@{hit.name}</span>)
        i += hit.name.length + 1
        continue
      }
    }
    buf += body[i]
    i++
  }
  flush()
  return out
}

function FileBubble({ file }: { file: NonNullable<ChatMessage['file']> }) {
  const href = API + file.url.replace(/^\/api/, '')
  const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.mime ?? '')
  const isVideo = /^video\/(webm|mp4)$/i.test(file.mime ?? '')
  const [open, setOpen] = useState(false)
  const name = file.name ?? (isImage ? 'image' : 'video')
  return (
    <div className="mt-1">
      {isVideo ? (
        <div className="w-[min(420px,100%)]">
          <video controls preload="metadata" src={`${href}?inline=1`} className="max-h-64 w-full rounded-btn border border-line bg-black object-contain" />
          <div className="mt-1 flex items-center gap-3 text-[12px] text-ink-muted">
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 hover:text-ink"><Expand size={12} /> Open</button>
            <a href={href} className="inline-flex items-center gap-1 hover:text-ink"><Download size={12} /> Download ({fmtBytes(file.size ?? 0)})</a>
          </div>
        </div>
      ) : isImage ? (
        <div className="group/img relative inline-block max-w-full">
          <button type="button" onClick={() => setOpen(true)} className="block max-w-full cursor-zoom-in" aria-label={`Open ${name}`}>
            <img src={`${href}?inline=1`} alt={name} className="max-h-64 max-w-full rounded-btn border border-line object-contain" loading="lazy" decoding="async" />
          </button>
          <a href={href} onClick={(e) => e.stopPropagation()} className="absolute right-1.5 top-1.5 hidden h-8 w-8 items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900 group-hover/img:inline-flex" aria-label="Download" title="Download">
            <Download size={15} />
          </a>
        </div>
      ) : (
        <a href={href} className="inline-flex max-w-full items-center gap-2 rounded-btn border border-line bg-card px-3 py-2 text-body-sm hover:bg-slate-50">
          <FileText size={18} className="shrink-0 text-primary" />
          <span className="min-w-0"><span className="block truncate font-medium text-ink">{file.name}</span><span className="text-ink-muted">{fmtBytes(file.size ?? 0)}</span></span>
          <Download size={15} className="shrink-0 text-ink-muted" />
        </a>
      )}
      {open && (isImage || isVideo) && <MediaViewer item={{ href, name, kind: isImage ? 'image' : 'video', size: fmtBytes(file.size ?? 0) }} onClose={() => setOpen(false)} />}
    </div>
  )
}

function TaskRefCard({ task }: { task: NonNullable<ChatMessage['task']> }) {
  return (
    <Link to={`/app/projects/${task.projectKey}?task=${task.code}`} className="mt-1.5 flex max-w-md items-center gap-3 rounded-btn border border-line bg-card p-2.5 hover:border-primary/40 hover:shadow-card">
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: task.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-md font-medium text-ink">{task.title}</span>
        <span className="flex items-center gap-2 text-body-sm text-ink-muted">
          <span className="font-mono">{task.code}</span> · {task.status}
          {task.overdue && <span className="inline-flex items-center gap-0.5 font-semibold text-danger"><AlertTriangle size={11} /> overdue</span>}
        </span>
      </span>
    </Link>
  )
}

/** Start a voice / video call here, or join the one already running. */
function CallButtons({ conversationId, compact }: { conversationId: string; compact?: boolean }) {
  const calls = useCalls()!
  const mineHere = calls.call?.conversationId === conversationId
  const live = calls.active.find((c) => c.conversationId === conversationId)
  if (mineHere) {
    return (
      <button type="button" onClick={() => calls.setMinimized(false)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-body-sm font-semibold text-success hover:bg-success/25">
        <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> In call
      </button>
    )
  }
  if (live && !live.joined) {
    return (
      <button type="button" disabled={live.full} onClick={() => void calls.joinCall(live.id, conversationId, live.video)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success px-3 py-1.5 text-body-sm font-semibold text-white hover:bg-success/90 disabled:opacity-50" title={live.full ? 'This call is full' : 'Join the call'}>
        {live.video ? <Video size={14} /> : <Phone size={14} />} Join call · {live.participants.length}
      </button>
    )
  }
  const btn = cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-success/25', compact ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-body-sm')
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={() => void calls.startCall(conversationId, false)} className={cn(btn, 'border-success/40 bg-success/10 text-success hover:bg-success/20')} aria-label="Start a voice call" title="Voice call">
        <Phone size={compact ? 13 : 15} /> Call
      </button>
      <button type="button" onClick={() => void calls.startCall(conversationId, true)} className={cn(btn, 'border-success bg-success text-white hover:bg-success/90')} aria-label="Start a video call" title="Video call">
        <Video size={compact ? 14 : 16} /> {compact ? 'Video' : 'Video call'}
      </button>
    </span>
  )
}

function CallCard({ call, conversationId, mine }: { call: NonNullable<ChatMessage['call']>; conversationId: string; mine: boolean }) {
  const calls = useCalls()
  const live = calls?.active.find((c) => c.id === call.id)
  const inThis = calls?.call?.callId === call.id
  const ongoing = !!live || inThis
  const missed = !ongoing && call.joinedCount <= 1
  const Icon = missed ? PhoneMissed : call.video ? Video : Phone
  const kind = call.video ? 'Video call' : 'Voice call'
  return (
    <div className="flex min-w-[220px] items-center gap-3 py-0.5">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', ongoing ? 'bg-success text-white' : missed ? 'bg-danger/10 text-danger' : 'bg-white text-ink-muted')}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-semibold text-ink">{ongoing ? `${kind} in progress` : missed ? (mine ? 'No answer' : `Missed ${kind.toLowerCase()}`) : kind}</span>
        <span className="block text-body-sm text-ink-muted">
          {ongoing ? `${live?.participants.length ?? 1} in call` : call.durationSec != null && !missed ? `${fmtDuration(call.durationSec)} · ${call.joinedCount} joined` : 'Call ended'}
        </span>
      </span>
      {ongoing && calls && (
        inThis
          ? <button type="button" onClick={() => calls.setMinimized(false)} className="shrink-0 rounded-btn border border-success px-2.5 py-1 text-body-sm font-semibold text-success">Open</button>
          : <button type="button" onClick={() => void calls.joinCall(call.id, conversationId, call.video)} className="shrink-0 rounded-btn bg-success px-2.5 py-1 text-body-sm font-semibold text-white hover:bg-success/90">Join</button>
      )}
    </div>
  )
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} sec`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}
