import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Search, X } from 'lucide-react'
import type { EmojiGroup } from '../../lib/emojiData'
import { cn } from '../../lib/cn'

/**
 * The full emoji picker: search, categories, and the ones you used last. Opens next to
 * the button that opened it (kept on screen), closes on Esc or a click elsewhere.
 * The list (~1,500 emojis) loads the first time it is opened.
 */

const RECENT_KEY = 'pt-emoji-recent'
const TAB_ICON: Record<string, string> = {
  'Smileys & Emotion': '😀', 'People & Body': '👋', 'Animals & Nature': '🐶', 'Food & Drink': '🍔',
  'Travel & Places': '✈️', Activities: '⚽', Objects: '💡', Symbols: '❤️', Flags: '🏁',
}
const SHORT: Record<string, string> = {
  'Smileys & Emotion': 'Smileys', 'People & Body': 'People', 'Animals & Nature': 'Nature', 'Food & Drink': 'Food',
  'Travel & Places': 'Travel', Activities: 'Activities', Objects: 'Objects', Symbols: 'Symbols', Flags: 'Flags',
}

let groupsCache: EmojiGroup[] | null = null

export function recentEmojis(): string[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).slice(0, 24) } catch { return [] }
}
function remember(e: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 24))) } catch { /* storage off */ }
}

/** Keep a floating box next to its button and inside the window. */
function usePlace(anchor: HTMLElement | null, box: React.RefObject<HTMLDivElement>, prefer: 'top' | 'bottom', align: 'start' | 'end') {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current
      if (!anchor || !el) return
      const a = anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let top = prefer === 'top' ? a.top - h - 6 : a.bottom + 6
      if (top < 8) top = a.bottom + 6
      if (top + h > vh - 8) top = Math.max(8, a.top - h - 6)
      let left = align === 'end' ? a.right - w : a.left
      left = Math.min(Math.max(8, left), vw - w - 8)
      setPos({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, box, prefer, align])
  return pos
}

function useDismiss(box: React.RefObject<HTMLDivElement>, anchor: HTMLElement | null, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true) }
  }, [box, anchor, onClose])
}

export function EmojiPicker({ anchor, onPick, onClose, prefer = 'top', align = 'end', keepOpen }: { anchor: HTMLElement | null; onPick: (emoji: string) => void; onClose: () => void; prefer?: 'top' | 'bottom'; align?: 'start' | 'end'; keepOpen?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [groups, setGroups] = useState<EmojiGroup[] | null>(groupsCache)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<string>('Recent')
  const [recent] = useState(recentEmojis)
  const pos = usePlace(anchor, box, prefer, align)
  useDismiss(box, anchor, onClose)

  useEffect(() => {
    if (groupsCache) return
    import('../../lib/emojiData').then((m) => { groupsCache = m.EMOJI_GROUPS; setGroups(m.EMOJI_GROUPS) }).catch(() => setGroups([]))
  }, [])

  const found = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t || !groups) return null
    const words = t.split(/\s+/)
    // Best first: the exact name, then a name that starts with it, then a whole word, then anywhere.
    const score = (name: string) => (name === t ? 0 : name.startsWith(t) ? 1 : (' ' + name).includes(' ' + words[0]) ? 2 : 3)
    const out: { e: [string, string]; s: number; i: number }[] = []
    let i = 0
    for (const g of groups) for (const e of g.emojis) { i++; if (words.every((w) => e[1].includes(w))) out.push({ e, s: score(e[1]), i }) }
    return out.sort((a, b) => a.s - b.s || a.i - b.i).slice(0, 160).map((x) => x.e)
  }, [q, groups])

  function pick(e: string) {
    remember(e)
    onPick(e)
    if (!keepOpen) onClose()
  }

  function jump(name: string) {
    setTab(name)
    setQ('')
    requestAnimationFrame(() => list.current?.querySelector(`[data-group="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'start' }))
  }

  // Which category is in view (for the highlighted tab).
  function onScroll() {
    const el = list.current
    if (!el || q) return
    const heads = [...el.querySelectorAll<HTMLElement>('[data-group]')]
    let cur = heads[0]?.dataset.group ?? 'Recent'
    for (const h of heads) if (h.offsetTop - el.scrollTop <= 8) cur = h.dataset.group!
    setTab(cur)
  }

  const cell = (e: string, name: string) => (
    <button key={e} type="button" onClick={() => pick(e)} title={name} aria-label={name} className="flex h-9 w-9 items-center justify-center rounded-btn text-[22px] leading-none transition-transform hover:scale-110 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
      {e}
    </button>
  )

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Emoji"
      className="fixed z-[90] flex h-[380px] w-[344px] max-w-[calc(100vw-16px)] animate-scale-in flex-col overflow-hidden rounded-card border border-line bg-card shadow-overlay"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <Search size={15} className="shrink-0 text-ink-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji (e.g. heart, fire, ok)" className="min-w-0 flex-1 bg-transparent text-body-sm text-ink placeholder:text-ink-muted focus:outline-none" aria-label="Search emoji" />
        {q && <button type="button" onClick={() => setQ('')} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label="Clear search"><X size={14} /></button>}
      </div>
      <div className="flex shrink-0 justify-between border-b border-line px-1.5">
        {['Recent', ...(groups ?? []).map((g) => g.name)].map((name) => (
          <button key={name} type="button" onClick={() => jump(name)} title={name === 'Recent' ? 'Recently used' : SHORT[name] ?? name} aria-label={name === 'Recent' ? 'Recently used' : name} className={cn('relative px-1 py-1.5 text-[17px] leading-none opacity-60 transition-opacity hover:opacity-100', tab === name && !q && 'opacity-100')}>
            {name === 'Recent' ? '🕘' : TAB_ICON[name] ?? '•'}
            {tab === name && !q && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>
      <div ref={list} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {!groups ? (
          <p className="py-10 text-center text-body-sm text-ink-muted">Loading…</p>
        ) : found ? (
          found.length ? <div className="grid grid-cols-8 pt-2">{found.map(([e, n]) => cell(e, n))}</div> : <p className="py-10 text-center text-body-sm text-ink-muted">No emoji found</p>
        ) : (
          <>
            <p data-group="Recent" className="sticky top-0 z-[1] bg-card pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Recently used</p>
            {recent.length ? <div className="grid grid-cols-8">{recent.map((e) => cell(e, e))}</div> : <p className="pb-1 text-body-sm text-ink-muted">The ones you use will show here.</p>}
            {groups.map((g) => (
              <div key={g.name}>
                <p data-group={g.name} className="sticky top-0 z-[1] bg-card pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{SHORT[g.name] ?? g.name}</p>
                <div className="grid grid-cols-8">{g.emojis.map(([e, n]) => cell(e, n))}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

/**
 * Reacting to a message, WhatsApp style: a row of six quick ones and a "+" for all of them.
 * `mine` marks the ones you already put on the message.
 */
export function ReactionPicker({ anchor, mine, onPick, onClose, align = 'start' }: { anchor: HTMLElement | null; mine: string[]; onPick: (emoji: string) => void; onClose: () => void; align?: 'start' | 'end' }) {
  const box = useRef<HTMLDivElement>(null)
  const plus = useRef<HTMLButtonElement>(null)
  const [full, setFull] = useState(false)
  const pos = usePlace(anchor, box, 'top', align)
  useDismiss(box, full ? null : anchor, () => { if (!full) onClose() })
  // the ones used lately go first, after the usual six
  const quick = useMemo(() => [...new Set([...QUICK_REACTIONS, ...recentEmojis()])].slice(0, 7), [])

  if (full) return <EmojiPicker anchor={anchor} prefer="top" align={align} onPick={onPick} onClose={onClose} />
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="React"
      className="fixed z-[90] flex animate-scale-in items-center gap-0.5 rounded-full border border-line bg-card px-1.5 py-1 shadow-overlay"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {quick.map((e, i) => (
        <button
          key={e}
          type="button"
          onClick={() => { remember(e); onPick(e); onClose() }}
          className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[24px] leading-none transition-transform duration-150 hover:-translate-y-1 hover:scale-125', mine.includes(e) && 'bg-primary/15')}
          style={{ animation: `pt-pop-in 220ms ${i * 25}ms both cubic-bezier(.2,1.4,.4,1)` }}
          aria-label={`React ${e}`}
          title={mine.includes(e) ? 'Take back' : undefined}
        >
          {e}
        </button>
      ))}
      <button ref={plus} type="button" onClick={() => setFull(true)} className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-ink-muted hover:bg-slate-200 hover:text-ink" aria-label="More emojis" title="More emojis">
        <Plus size={17} />
      </button>
    </div>,
    document.body,
  )
}
