import { useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, Camera, LogOut, Plus, Search } from 'lucide-react'
import { chatApi, visiblePoll, type ChatUser, type ConversationListItem } from '../../lib/chatApi'
import { errMsg } from '../../lib/projectsApi'
import { ApiError } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { PersonAvatar, fieldCls, fmtAgo } from '../projects/pmUi'
import { cn } from '../../lib/cn'
import { ChatPicture, PictureEditor } from '../ui/Pictures'

/** Sidebar list of my conversations, grouped Project channels / Direct / Groups. */
export function ConversationList({ activeId, onSelect, compact, refreshKey }: { activeId: string | null; onSelect: (id: string) => void; compact?: boolean; refreshKey?: number }) {
  const [list, setList] = useState<ConversationListItem[] | null>(null)
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const load = () => chatApi.conversations().then((r) => setList((cur) => (cur && JSON.stringify(cur) === JSON.stringify(r.conversations) ? cur : r.conversations))).catch(() => undefined)
  useEffect(() => { load() }, [refreshKey])
  useEffect(() => visiblePoll(load, 8000), [])

  const shown = useMemo(() => (list ?? []).filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase())), [list, q])
  const groups: { title: string; items: ConversationListItem[] }[] = [
    { title: 'Project channels', items: shown.filter((c) => c.type === 'PROJECT') },
    { title: 'Direct messages', items: shown.filter((c) => c.type === 'DIRECT') },
    { title: 'Groups', items: shown.filter((c) => c.type === 'GROUP') },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex shrink-0 items-center gap-2 border-b border-line', compact ? 'p-2' : 'p-3')}>
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a chat" aria-label="Find a chat" className={cn(fieldCls, 'h-8 pl-8 text-body-sm')} />
        </div>
        <Button size="sm" onClick={() => setNewOpen(true)} aria-label="New message" title="New message"><Plus size={16} /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!list && <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div>}
        {list && shown.length === 0 && <p className="p-4 text-center text-body-sm text-ink-muted">{q ? 'No chats match.' : 'No conversations yet. Start one with the + button.'}</p>}
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.title} className="mb-1">
            <p className="px-3 pb-1 pt-2 text-label-md uppercase text-ink-muted">{g.title}</p>
            <ul>
              {g.items.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onSelect(c.id)} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50', activeId === c.id && 'bg-primary/5')}>
                    {c.type === 'DIRECT' && c.other ? <PersonAvatar person={c.other} size={32} presence={c.other.presence} /> : (
                      <ChatPicture type={c.type} conversationId={c.id} projectKey={c.projectKey} color={c.color} size={32} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className={cn('truncate text-body-md', c.unread > 0 ? 'font-semibold text-ink' : 'text-ink')}>{c.title}</span>
                        {c.muted && <BellOff size={11} className="shrink-0 text-ink-muted" />}
                        {c.lastMessage && <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{fmtAgo(c.lastMessage.createdAt)}</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={cn('truncate text-body-sm', c.unread > 0 ? 'text-ink' : 'text-ink-muted')}>{c.lastMessage ? `${c.lastMessage.mine ? 'You' : c.type === 'DIRECT' ? '' : c.lastMessage.userName.split(' ')[0]}${c.lastMessage.mine || c.type !== 'DIRECT' ? ': ' : ''}${c.lastMessage.body}` : 'No messages yet'}</span>
                        {c.unread > 0 && <span className={cn('ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-bold text-white', c.muted ? 'bg-slate-400' : 'bg-primary')}>{c.unread > 99 ? '99+' : c.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {newOpen && <NewChatModal onClose={() => setNewOpen(false)} onOpened={(id) => { setNewOpen(false); load(); onSelect(id) }} />}
    </div>
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
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-btn border border-line">
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
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Conversation options">{muted ? <BellOff size={17} /> : <Bell size={17} />}</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-card border border-line bg-card py-1 shadow-overlay">
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
  return <button type="button" onClick={onClick} className={cn('block w-full px-3 py-1.5 text-left text-body-sm hover:bg-slate-50', danger ? 'text-danger' : 'text-ink')}>{children}</button>
}
