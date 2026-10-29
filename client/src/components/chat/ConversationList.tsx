import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, Camera, CheckCheck, LogOut, Plus, Search } from 'lucide-react'
import { chatApi, visiblePoll, type ChatUser, type ConversationListItem } from '../../lib/chatApi'
import { errMsg } from '../../lib/projectsApi'
import { ApiError } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { PersonAvatar, fieldCls, fmtAgo } from '../projects/pmUi'
import { cn } from '../../lib/cn'
import { ChatPicture, PictureEditor } from '../ui/Pictures'

/**
 * Sidebar list of my conversations, in tabs so people never scroll past every project channel
 * to reach a message: Chats (direct messages and groups), Projects (project channels) and
 * Unread (anything with new messages, from either). Newest activity first; a chat with new
 * messages is tinted and bold, and each tab shows how many chats in it have something new.
 * Typing in "Find a chat" searches all of them at once.
 */
type Tab = 'chats' | 'projects' | 'unread'
const TABS: { key: Tab; label: string }[] = [{ key: 'chats', label: 'Chats' }, { key: 'projects', label: 'Projects' }, { key: 'unread', label: 'Unread' }]
const isProject = (c: ConversationListItem) => c.type === 'PROJECT'
/** Has something new that should catch the eye (muted chats count quietly). */
const isNew = (c: ConversationListItem) => c.unread > 0 && !c.muted
function readTab(): Tab {
  try { const t = localStorage.getItem('chat.tab'); return t === 'projects' || t === 'unread' ? t : 'chats' } catch { return 'chats' }
}
/** Newest first; channels that never had a message go last, by name. */
function byActivity(a: ConversationListItem, b: ConversationListItem): number {
  if (!!a.lastMessage !== !!b.lastMessage) return a.lastMessage ? -1 : 1
  if (!a.lastMessage) return a.title.localeCompare(b.title)
  return a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0
}

export function ConversationList({ activeId, onSelect, compact, refreshKey }: { activeId: string | null; onSelect: (id: string) => void; compact?: boolean; refreshKey?: number }) {
  const [list, setList] = useState<ConversationListItem[] | null>(null)
  const [q, setQ] = useState('')
  const [tab, setTabState] = useState<Tab>(readTab)
  const [newOpen, setNewOpen] = useState(false)
  const placed = useRef(false)
  const load = () => chatApi.conversations().then((r) => setList((cur) => (cur && JSON.stringify(cur) === JSON.stringify(r.conversations) ? cur : r.conversations))).catch(() => undefined)
  useEffect(() => { load() }, [refreshKey])
  useEffect(() => visiblePoll(load, 8000), [])
  function setTab(t: Tab) { setTabState(t); try { localStorage.setItem('chat.tab', t) } catch { /* ignore */ } }

  // Opened straight into a chat (a link, a notification): show the tab it lives in.
  useEffect(() => {
    if (!list || !activeId || placed.current) return
    const c = list.find((x) => x.id === activeId)
    if (!c) return
    placed.current = true
    if (tab === 'unread') return
    const want: Tab = isProject(c) ? 'projects' : 'chats'
    if (want !== tab) setTabState(want)
  }, [list, activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => [...(list ?? [])].sort(byActivity), [list])
  const counts = useMemo(() => ({
    chats: all.filter((c) => !isProject(c) && isNew(c)).length,
    projects: all.filter((c) => isProject(c) && isNew(c)).length,
    unread: all.filter((c) => c.unread > 0).length,
  }), [all])
  const searching = q.trim().length > 0
  const groups: { title: string | null; items: ConversationListItem[] }[] = useMemo(() => {
    if (searching) {
      const m = all.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()))
      return [
        { title: 'Direct messages', items: m.filter((c) => c.type === 'DIRECT') },
        { title: 'Groups', items: m.filter((c) => c.type === 'GROUP') },
        { title: 'Project channels', items: m.filter(isProject) },
      ]
    }
    if (tab === 'projects') return [{ title: null, items: all.filter(isProject) }]
    if (tab === 'unread') return [{ title: null, items: all.filter((c) => c.unread > 0 || c.id === activeId).sort((a, b) => Number(a.muted) - Number(b.muted)) }]
    return [{ title: null, items: all.filter((c) => !isProject(c)) }]
  }, [all, tab, q, searching, activeId])
  const empty = groups.every((g) => g.items.length === 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex shrink-0 items-center gap-1.5', compact ? 'border-b border-line p-2' : 'px-3 pb-2')}>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} placeholder="Find a chat" aria-label="Find a chat" className={cn(fieldCls, 'h-8 pl-8 text-body-sm')} />
        </div>
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn border border-line bg-card text-ink-muted shadow-xs hover:border-line-strong hover:text-ink" onClick={() => setNewOpen(true)} aria-label="New message" title="New message"><Plus size={15} /></button>
      </div>
      {!searching && (
        <div className={cn('shrink-0', compact ? 'px-2 pt-2' : 'px-3 pb-1')}>
          <div className="grid grid-cols-3 gap-0.5 rounded-btn bg-slate-100 p-0.5 dark:bg-slate-800/60" role="tablist" aria-label="Chat lists">
            {TABS.map((t) => {
              const n = counts[t.key]
              const on = tab === t.key
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                  className={cn('flex h-7 items-center justify-center gap-1 rounded-md text-[12.5px] font-semibold transition-colors', on ? 'bg-card text-ink shadow-xs' : 'text-ink-muted hover:text-ink')}>
                  {t.label}
                  {n > 0 && <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums', t.key === 'unread' || !on ? 'bg-primary text-white' : 'bg-primary/15 text-primary')} aria-label={`${n} with new messages`}>{n > 99 ? '99+' : n}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {!list && <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-11 rounded-md" />)}</div>}
        {list && empty && (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            {tab === 'unread' && !searching && <CheckCheck size={22} className="mb-2 text-success" />}
            <p className="text-body-sm text-ink-muted">
              {searching ? 'No chats match.' : tab === 'unread' ? 'You are all caught up. New messages show up here.' : tab === 'projects' ? 'No project channels yet. A channel is made with each project.' : 'No conversations yet. Start one with the + button.'}
            </p>
          </div>
        )}
        {groups.map((g, gi) => g.items.length > 0 && (
          <div key={g.title ?? gi} className="mb-2">
            {g.title && <p className="px-2 pb-1 pt-2 text-[12px] font-medium text-ink-faint">{g.title}</p>}
            {!g.title && tab !== 'unread' && counts[tab] > 0 && <p className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold text-primary">{counts[tab]} with new messages</p>}
            <ul className="space-y-px">
              {g.items.map((c) => <Row key={c.id} c={c} active={activeId === c.id} onSelect={onSelect} showKind={tab === 'unread' && !searching} />)}
            </ul>
          </div>
        ))}
      </div>
      {newOpen && <NewChatModal onClose={() => setNewOpen(false)} onOpened={(id) => { setNewOpen(false); load(); onSelect(id) }} />}
    </div>
  )
}

function Row({ c, active, onSelect, showKind }: { c: ConversationListItem; active: boolean; onSelect: (id: string) => void; showKind: boolean }) {
  const fresh = isNew(c)
  return (
    <li>
      <button type="button" onClick={() => onSelect(c.id)}
        className={cn('relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
          active ? 'bg-slate-200/70 dark:bg-slate-700/60' : fresh ? 'bg-primary/[0.07] hover:bg-primary/[0.12]' : 'hover:bg-slate-200/40')}>
        {fresh && !active && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
        {c.type === 'DIRECT' && c.other ? <PersonAvatar person={c.other} size={30} presence={c.other.presence} /> : (
          <ChatPicture type={c.type} conversationId={c.id} projectKey={c.projectKey} color={c.color} size={30} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className={cn('truncate text-[13px]', c.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink')}>{c.title}</span>
            {c.muted && <BellOff size={11} className="shrink-0 text-ink-muted" />}
            {showKind && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-ink-muted dark:bg-slate-800">{c.type === 'PROJECT' ? 'Project' : c.type === 'GROUP' ? 'Group' : 'Direct'}</span>}
            {c.lastMessage && <span className={cn('ml-auto shrink-0 text-[11px] tabular-nums', fresh ? 'font-semibold text-primary' : 'text-ink-faint')}>{fmtAgo(c.lastMessage.createdAt)}</span>}
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('truncate text-[12.5px]', c.unread > 0 ? 'font-medium text-ink' : 'text-ink-muted')}>{c.lastMessage ? `${c.lastMessage.mine ? 'You' : c.type === 'DIRECT' ? '' : c.lastMessage.userName.split(' ')[0]}${c.lastMessage.mine || c.type !== 'DIRECT' ? ': ' : ''}${c.lastMessage.body}` : 'No messages yet'}</span>
            {c.unread > 0 && <span className={cn('ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums text-white', c.muted ? 'bg-slate-400' : 'bg-primary')}>{c.unread > 99 ? '99+' : c.unread}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

export function NewChatModal({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const { addToast } = useToast()
  const [users, setUsers] = useState<ChatUser[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { chatApi.users().then((r) => setUsers(r.users)).catch(() => undefined) }, [])
  const list = users.filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || (u.department ?? '').toLowerCase().includes(q.toLowerCase()))
  const isGroup = sel.length > 1
  async function go() {
    setBusy(true)
    const open = () => isGroup ? chatApi.createGroup(name.trim() || sel.map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).join(', '), sel) : chatApi.openDirect(sel[0])
    try {
      let r: Awaited<ReturnType<typeof open>>
      try {
        r = await open()
      } catch (e) {
        // A dropped connection or a server restart: opening a direct chat is safe to repeat, so try once more.
        if (isGroup || (e instanceof ApiError && e.status < 500)) throw e
        await new Promise((ok) => setTimeout(ok, 800))
        r = await open()
      }
      onOpened(r.conversation.id)
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not open the chat. Check your connection and try again.') })
    } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="New message" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!sel.length || busy} onClick={go}>{isGroup ? 'Create group' : 'Open chat'}</Button></>}>
      <div className="space-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className={fieldCls} autoFocus />
        {isGroup && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (optional)" className={fieldCls} maxLength={60} />}
        <p className="text-body-sm text-ink-muted">Pick one person for a direct message, or several for a group.</p>
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {list.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                <input type="checkbox" checked={sel.includes(u.id)} onChange={() => setSel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} className="h-4 w-4 accent-primary" />
                <PersonAvatar person={u} size={28} presence={u.presence} />
                <span className="min-w-0 flex-1"><span className="block truncate text-body-md text-ink">{u.name}</span><span className="block truncate text-body-sm text-ink-muted">{u.department ?? u.email}</span></span>
              </label>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-4 text-body-sm text-ink-muted">Nobody found.</li>}
        </ul>
      </div>
    </Modal>
  )
}

/** Header actions for a conversation: mute + (groups) leave. */
export function ConversationActions({ id, muted, isGroup, onChanged, onLeft, picture }: { id: string; muted: boolean; isGroup: boolean; onChanged: () => void; onLeft: () => void; picture?: { type: string; projectKey: string | null; color: string | null } }) {
  const { addToast } = useToast()
  const [open, setOpen] = useState(false)
  const [picOpen, setPicOpen] = useState(false)
  const muteFor = async (hours: number | null) => {
    setOpen(false)
    try { await chatApi.mute(id, hours === null ? null : hours < 0 ? new Date(Date.now() + 3650 * 86400000).toISOString() : new Date(Date.now() + hours * 3600000).toISOString()); onChanged() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Conversation options">{muted ? <BellOff size={16} /> : <Bell size={16} />}</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 animate-scale-in overflow-hidden rounded-lg border border-line bg-card p-1 shadow-overlay">
          {muted ? <MenuBtn onClick={() => muteFor(null)}>Unmute</MenuBtn> : (
            <>
              <MenuBtn onClick={() => muteFor(1)}>Mute for 1 hour</MenuBtn>
              <MenuBtn onClick={() => muteFor(8)}>Mute for 8 hours</MenuBtn>
              <MenuBtn onClick={() => muteFor(168)}>Mute for 1 week</MenuBtn>
              <MenuBtn onClick={() => muteFor(-1)}>Mute until I turn it on</MenuBtn>
            </>
          )}
          {picture && <MenuBtn onClick={() => { setOpen(false); setPicOpen(true) }}><Camera size={13} className="mr-1 inline" />Change picture</MenuBtn>}
          {isGroup && <MenuBtn danger onClick={async () => { setOpen(false); if (!window.confirm('Leave this group?')) return; try { await chatApi.leave(id); onLeft() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } }}><LogOut size={13} className="mr-1 inline" />Leave group</MenuBtn>}
        </div>
      )}
      {picOpen && picture && (
        <Modal open onClose={() => setPicOpen(false)} title={picture.type === 'PROJECT' ? 'Project picture' : 'Group picture'} size="sm">
          <PictureEditor
            kind={picture.type === 'PROJECT' ? 'project' : 'chat'}
            id={picture.type === 'PROJECT' ? picture.projectKey ?? '' : id}
            label={picture.type === 'PROJECT' ? 'Project picture' : 'Group picture'}
            preview={<ChatPicture type={picture.type} conversationId={id} projectKey={picture.projectKey} color={picture.color} size={72} />}
          />
          {picture.type === 'PROJECT' && <p className="mt-3 text-body-sm text-ink-muted">This is also the project's picture on the Projects page and board.</p>}
        </Modal>
      )}
    </div>
  )
}
function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={cn('block w-full rounded-md px-2.5 py-1.5 text-left text-body-sm hover:bg-slate-100', danger ? 'text-danger' : 'text-ink')}>{children}</button>
}
