import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, User, FolderKanban, ListChecks, MessagesSquare, Paperclip, CalendarDays, LayoutGrid, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { filterNav } from './navConfig'

/**
 * The search box at the top: finds pages, people, projects, tasks, chats, files and meetings.
 * Everyone only finds what they can open. Ctrl+K (Cmd+K on Mac) jumps to it from anywhere.
 */

interface Hit { id: string; title: string; sub?: string; link: string }
interface Results { q: string; people: Hit[]; projects: Hit[]; tasks: Hit[]; chats: Hit[]; files: Hit[]; meetings: Hit[] }

const GROUPS: { key: keyof Omit<Results, 'q'> | 'pages'; label: string; icon: ReactNode }[] = [
  { key: 'pages', label: 'Pages', icon: <LayoutGrid size={15} /> },
  { key: 'people', label: 'People', icon: <User size={15} /> },
  { key: 'projects', label: 'Projects', icon: <FolderKanban size={15} /> },
  { key: 'tasks', label: 'Tasks', icon: <ListChecks size={15} /> },
  { key: 'chats', label: 'Chats', icon: <MessagesSquare size={15} /> },
  { key: 'files', label: 'Files', icon: <Paperclip size={15} /> },
  { key: 'meetings', label: 'Meetings', icon: <CalendarDays size={15} /> },
]

function mark(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (!q || i < 0) return text
  return <>{text.slice(0, i)}<mark className="rounded-sm bg-warning/30 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export function GlobalSearch({ autoFocus = false, onDone, className }: { autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Results | null>(null)
  const [cursor, setCursor] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // Ctrl+K / Cmd+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

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
    }, 250)
    return () => { alive = false; window.clearTimeout(t) }
  }, [term])

  // Pages this person can open whose name matches.
  const pages: Hit[] = useMemo(() => {
    if (!user || term.length < 2) return []
    const t = term.toLowerCase()
    const out: Hit[] = []
    for (const g of filterNav(user)) {
      const items = [...g.items.map((i) => ({ i, where: g.title ?? '' })), ...(g.subgroups ?? []).flatMap((sg) => sg.items.map((i) => ({ i, where: `${g.title} · ${sg.title}` })))]
      for (const { i, where } of items) {
        if (i.label.toLowerCase().includes(t) || where.toLowerCase().includes(t)) out.push({ id: i.to, title: i.label, sub: where || undefined, link: i.to })
      }
    }
    return out.slice(0, 5)
  }, [user, term])

  const groups = useMemo(() => GROUPS
    .map((g) => ({ ...g, hits: g.key === 'pages' ? pages : (res?.[g.key] ?? []) }))
    .filter((g) => g.hits.length > 0), [pages, res])
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])

  const go = (h: Hit) => {
    setOpen(false)
    setQ('')
    input.current?.blur()
    onDone?.()
    navigate(h.link)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { const h = flat[cursor]; if (h) { e.preventDefault(); go(h) } }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); onDone?.() }
  }

  const showPanel = open && term.length >= 2
  let index = -1

  return (
    <div ref={box} className={cn('relative', className)}>
      <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        ref={input}
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search"
        aria-label="Search"
        className="h-10 w-full rounded-btn border border-line bg-bg pl-10 pr-16 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 lg:flex">
        {loading ? <Loader2 size={15} className="animate-spin text-ink-muted" /> : <kbd className="rounded border border-line bg-card px-1.5 text-[11px] text-ink-muted">Ctrl K</kbd>}
      </span>
      {onDone && (
        <button type="button" onClick={onDone} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted lg:hidden" aria-label="Close search"><X size={16} /></button>
      )}

      {showPanel && (
        <div className="absolute left-0 top-12 z-50 max-h-[70vh] w-[min(440px,calc(100vw-1.5rem))] overflow-y-auto rounded-card border border-line bg-card p-2 shadow-overlay" role="listbox">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-body-sm text-ink-muted">{loading ? 'Searching…' : `Nothing found for “${term}”`}</p>
          ) : groups.map((g) => (
            <div key={g.key} className="mb-1">
              <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{g.icon}{g.label}</p>
              {g.hits.map((h) => {
                index++
                const i = index
                return (
                  <button
                    key={`${g.key}-${h.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={cn('flex w-full flex-col items-start rounded-btn px-3 py-1.5 text-left', i === cursor ? 'bg-primary/10' : 'hover:bg-slate-50')}
                  >
                    <span className="w-full truncate text-body-sm font-medium text-ink">{mark(h.title, term)}</span>
                    {h.sub && <span className="w-full truncate text-[12px] text-ink-muted">{h.sub}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
