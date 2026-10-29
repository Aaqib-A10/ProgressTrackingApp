import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, User, FolderKanban, ListChecks, MessagesSquare, Paperclip, CalendarDays, LayoutGrid, PhoneCall, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { filterNav } from './navConfig'

/**
 * The command bar: one box that finds pages, people, projects, tasks, chats, files and
 * meetings, and jumps there. Ctrl+K (Cmd+K on Mac) or the search button opens it from
 * anywhere. Before typing it lists the main pages, so it also works as quick navigation.
 * Everyone only finds what they can open.
 */

interface Hit { id: string; title: string; sub?: string; link: string; icon?: ReactNode }
interface Results { q: string; people: Hit[]; leads?: Hit[]; projects: Hit[]; tasks: Hit[]; chats: Hit[]; files: Hit[]; meetings: Hit[] }

const GROUPS: { key: keyof Omit<Results, 'q'> | 'pages'; label: string; icon: ReactNode }[] = [
  { key: 'pages', label: 'Pages', icon: <LayoutGrid size={14} /> },
  { key: 'people', label: 'People', icon: <User size={14} /> },
  { key: 'leads', label: 'Leads', icon: <PhoneCall size={14} /> },
  { key: 'projects', label: 'Projects', icon: <FolderKanban size={14} /> },
  { key: 'tasks', label: 'Tasks', icon: <ListChecks size={14} /> },
  { key: 'chats', label: 'Chats', icon: <MessagesSquare size={14} /> },
  { key: 'files', label: 'Files', icon: <Paperclip size={14} /> },
  { key: 'meetings', label: 'Meetings', icon: <CalendarDays size={14} /> },
]

const OPEN_EVENT = 'pt:open-search'
/** Opens the command bar from anywhere (a button, a shortcut). */
export function openSearch(): void { window.dispatchEvent(new Event(OPEN_EVENT)) }

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const SEARCH_KEYS = isMac ? '⌘K' : 'Ctrl K'

function mark(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (!q || i < 0) return text
  return <>{text.slice(0, i)}<span className="rounded-sm bg-warning/25 text-ink">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>
}

/** The search button in the top bar (opens the command bar). */
export function GlobalSearch({ className, compact }: { className?: string; compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" onClick={openSearch} className={cn('rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink', className)} aria-label="Search">
        <Search size={18} />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={openSearch}
      className={cn('group flex h-8 w-full items-center gap-2 rounded-btn border border-line bg-card px-2.5 text-left text-body-md text-ink-faint shadow-xs transition-colors hover:border-line-strong hover:text-ink-muted', className)}
      aria-label="Search"
    >
      <Search size={15} className="shrink-0" />
      <span className="flex-1 truncate">Search or jump to…</span>
      <kbd className="hidden rounded border border-line bg-slate-50 px-1.5 font-sans text-[11px] text-ink-muted lg:inline">{SEARCH_KEYS}</kbd>
    </button>
  )
}

/** Mounted once in the app shell. */
export function CommandPalette() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Results | null>(null)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = () => { setOpen(true); setCursor(0) }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setCursor(0) }
    }
    window.addEventListener(OPEN_EVENT, show)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener('keydown', onKey) }
  }, [])
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 0); else { setQ(''); setRes(null) } }, [open])

  // Ask the server a moment after typing stops.
  const term = q.trim()
  useEffect(() => {
    if (term.length < 2) { setRes(null); setLoading(false); return }
    setLoading(true)
    let alive = true
    const t = window.setTimeout(() => {
      api.get<Results>(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => { if (alive) { setRes(r); setCursor(0) } })
        .catch(() => { if (alive) setRes(null) })
        .finally(() => { if (alive) setLoading(false) })
    }, 200)
    return () => { alive = false; window.clearTimeout(t) }
  }, [term])

  // Pages this person can open: all of them before typing (main ones first), else the matches.
  const pages: Hit[] = useMemo(() => {
    if (!user) return []
    const t = term.toLowerCase()
    const out: Hit[] = []
    for (const g of filterNav(user)) {
      const items = [...g.items.map((i) => ({ i, where: g.title ?? '' })), ...(g.subgroups ?? []).flatMap((sg) => sg.items.map((i) => ({ i, where: `${g.title} · ${sg.title}` })))]
      for (const { i, where } of items) {
        const Icon = i.icon
        if (!t || i.label.toLowerCase().includes(t) || where.toLowerCase().includes(t)) out.push({ id: i.to, title: i.label, sub: where || undefined, link: i.to, icon: <Icon size={15} /> })
      }
    }
    return t ? out.slice(0, 6) : out.filter((h) => !h.sub).slice(0, 9)
  }, [user, term])

  const groups = useMemo(() => GROUPS
    .map((g) => ({ ...g, label: g.key === 'pages' && !term ? 'Go to' : g.label, hits: g.key === 'pages' ? pages : (term.length >= 2 ? res?.[g.key] ?? [] : []) }))
    .filter((g) => g.hits.length > 0), [pages, res, term])
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const go = (h: Hit) => { setOpen(false); navigate(h.link) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { const h = flat[cursor]; if (h) { e.preventDefault(); go(h) } }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  if (!open) return null
  let index = -1
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 animate-fade-in bg-black/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[600px] animate-scale-in overflow-hidden rounded-xl border border-line bg-card shadow-overlay">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          {loading ? <Loader2 size={17} className="shrink-0 animate-spin text-ink-muted" /> : <Search size={17} className="shrink-0 text-ink-muted" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, people, leads, projects, tasks, chats…"
            aria-label="Search"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint focus:ring-0"
          />
          <kbd className="rounded border border-line bg-slate-50 px-1.5 text-[11px] text-ink-muted">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5" role="listbox">
          {groups.length === 0 ? (
            <p className="px-3 py-10 text-center text-body-md text-ink-muted">{loading ? 'Searching…' : term.length < 2 ? 'Type at least two letters.' : `Nothing found for “${term}”`}</p>
          ) : groups.map((g) => (
            <div key={g.key} className="mb-1">
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-ink-faint">{g.label}</p>
              {g.hits.map((h) => {
                index++
                const i = index
                const active = i === cursor
                return (
                  <button
                    key={`${g.key}-${h.id}`}
                    type="button"
                    role="option"
                    data-i={i}
                    aria-selected={active}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', active ? 'bg-slate-100' : '')}
                  >
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', active ? 'border-line-strong bg-card text-ink' : 'border-line bg-slate-50 text-ink-muted')}>{h.icon ?? g.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-md font-medium text-ink">{mark(h.title, term)}</span>
                      {h.sub && <span className="block truncate text-[12px] text-ink-muted">{h.sub}</span>}
                    </span>
                    {active && <CornerDownLeft size={14} className="shrink-0 text-ink-faint" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-slate-50/70 px-4 py-2 text-[11.5px] text-ink-muted">
          <span className="inline-flex items-center gap-1"><ArrowUp size={12} /><ArrowDown size={12} /> move</span>
          <span className="inline-flex items-center gap-1"><CornerDownLeft size={12} /> open</span>
          <span className="ml-auto">{SEARCH_KEYS} anytime</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
