import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import { ExternalLink, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { MetraSource } from '../../lib/metraApi'

/**
 * Metra's answers as text: a small, SAFE piece of markdown (paragraphs, **bold**, bullet and numbered lists,
 * `code`, tables, line breaks) built from React elements, never from HTML. Citations become small source chips.
 */

export function sourceDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

/** Open a source: Metriq pages inside the app, anything else in a new tab. */
export function openSourceLink(link: string | null, navigate: NavigateFunction, after?: () => void): void {
  if (!link) return
  if (link.startsWith('/')) { navigate(link); after?.(); return }
  if (/^https?:\/\//i.test(link)) window.open(link, '_blank', 'noopener,noreferrer')
}

// ------------------------------------------------------------------ citations in text

/**
 * A citation in any form the model writes: [2], [1, 3], [1†L3], 【1】, 【1†source】.
 * Group 1 or 2 holds the numbers.
 */
const CITE_SRC = String.raw`\[(\d+(?:\s*,\s*\d+)*)(?:†[^\]\n]*)?\]|【(\d+(?:\s*,\s*\d+)*)(?:†[^】\n]*)?】`

function citeNums(raw: string): number[] {
  const m = new RegExp(CITE_SRC).exec(raw)
  return (m?.[1] ?? m?.[2] ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0)
}

/** The numbers an answer cites, in the order they first appear. */
export function citedNumbers(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(new RegExp(CITE_SRC, 'g'))) for (const n of citeNums(m[0])) if (!out.includes(n)) out.push(n)
  return out
}

// ------------------------------------------------------------------ blocks

type Align = 'left' | 'center' | 'right' | undefined
type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[]; start: number }
  | { t: 'code'; text: string }
  | { t: 'h'; text: string }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] }

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** The cells of a table row: split on | (not \|), the outer pipes dropped. */
function cells(line: string): string[] {
  let l = line.trim()
  if (l.startsWith('|')) l = l.slice(1)
  if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < l.length; i++) {
    if (l[i] === '\\' && l[i + 1] === '|') { cur += '|'; i++; continue }
    if (l[i] === '|') { out.push(cur.trim()); cur = ''; continue }
    cur += l[i]
  }
  out.push(cur.trim())
  return out
}
const alignOf = (c: string): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : undefined)
const isTableStart = (lines: string[], i: number) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1])

function blocksOf(src: string): Block[] {
  const out: Block[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      out.push({ t: 'code', text: body.join('\n') })
      continue
    }
    if (!line.trim()) { i++; continue }
    if (isTableStart(lines, i)) {
      const head = cells(line)
      const align = cells(lines[i + 1]).map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
      out.push({ t: 'table', head, align, rows })
      continue
    }
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (h) { out.push({ t: 'h', text: h[1] }); i++; continue }
    if (BULLET.test(line)) {
      const items: string[] = []
      while (i < lines.length && (BULLET.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !NUMBERED.test(lines[i])))) {
        const b = BULLET.exec(lines[i])
        if (b) items.push(b[1]); else items[items.length - 1] += ' ' + lines[i].trim()
        i++
      }
      out.push({ t: 'ul', items })
      continue
    }
    const num = NUMBERED.exec(line)
    if (num) {
      const items: string[] = []
      const start = Number(num[1]) || 1
      while (i < lines.length && (NUMBERED.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i])))) {
        const n = NUMBERED.exec(lines[i])
        if (n) items.push(n[2]); else items[items.length - 1] += ' ' + lines[i].trim()
        i++
      }
      out.push({ t: 'ol', items, start })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*#{1,6}\s/.test(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++])
    out.push({ t: 'p', lines: para })
  }
  return out
}

// ------------------------------------------------------------------ inline

const INLINE_SRC = '(`[^`\\n]+`)|(\\*\\*[^*\\n]+?\\*\\*)|(' + CITE_SRC + ')'

function inline(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(new RegExp(INLINE_SRC, 'g'))) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyBase}-${k++}`
    if (m[1]) out.push(<code key={key} className="rounded bg-slate-100 px-1 py-px font-mono text-[0.88em] text-ink">{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key} className="font-semibold text-ink">{inline(m[2].slice(2, -2), ctx, key)}</strong>)
    else if (m[3]) {
      // A citation: chips for the sources we have; one we do not have is left out (never the raw brackets).
      const known = citeNums(m[3]).filter((n) => ctx.sources.some((s) => s.n === n))
      if (known.length) out.push(<span key={key} className="whitespace-nowrap">{known.map((n) => <CitationChip key={n} n={n} source={ctx.sources.find((s) => s.n === n)!} onOpen={ctx.onOpen} />)}</span>)
    }
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface Ctx { sources: MetraSource[]; onOpen?: () => void }

export function MetraMarkdown({ text, sources, onOpen, className }: { text: string; sources: MetraSource[]; onOpen?: () => void; className?: string }) {
  const ctx: Ctx = { sources, onOpen }
  const blocks = blocksOf(text)
  return (
    <div className={cn('min-w-0 space-y-2 break-words text-body-md leading-relaxed text-ink', className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`
        switch (b.t) {
          case 'h': return <p key={k} className="font-semibold">{inline(b.text, ctx, k)}</p>
          case 'code': return <pre key={k} className="overflow-x-auto rounded-btn border border-line bg-slate-50 p-2.5 font-mono text-[12.5px] text-ink">{b.text}</pre>
          case 'ul': return <ul key={k} className="list-disc space-y-1 pl-5 marker:text-ink-faint">{b.items.map((it, j) => <li key={j}>{inline(it, ctx, `${k}-${j}`)}</li>)}</ul>
          case 'ol': return <ol key={k} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-ink-muted">{b.items.map((it, j) => <li key={j}>{inline(it, ctx, `${k}-${j}`)}</li>)}</ol>
          case 'table': return (
            <div key={k} className="max-h-[420px] max-w-full overflow-auto overscroll-x-contain rounded-btn border border-line">
              <table className="min-w-full border-collapse text-body-sm">
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j} scope="col" style={{ textAlign: b.align[j] ?? 'left' }} className="sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-slate-100 px-2.5 py-1.5 font-semibold text-ink">{inline(h, ctx, `${k}-h${j}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri} className={cn('border-b border-line last:border-b-0', ri % 2 === 1 ? 'bg-slate-50' : 'bg-card')}>
                      {b.head.map((_, j) => (
                        <td key={j} style={{ textAlign: b.align[j] }} className="min-w-[5.5rem] max-w-[20rem] whitespace-normal break-words px-2.5 py-1.5 align-top text-ink">{inline(r[j] ?? '', ctx, `${k}-${ri}-${j}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          default: return <p key={k}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, ctx, `${k}-${j}`)}</span>)}</p>
        }
      })}
    </div>
  )
}

// ------------------------------------------------------------------ source chips and the popover

// One popover at a time: opening a chip closes the one that was open.
let closeOpen: (() => void) | null = null

/** A cited source: a small numbered chip; clicking it shows what the source is, and opens it. */
export function CitationChip({ n, source, onOpen, label }: { n: number; source: MetraSource; onOpen?: () => void; label?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const close = useRef(() => setOpen(false)).current
  useEffect(() => {
    if (!open) return
    if (closeOpen && closeOpen !== close) closeOpen()
    closeOpen = close
    return () => { if (closeOpen === close) closeOpen = null }
  }, [open, close])
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-metra-chip=""
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        aria-expanded={open}
        aria-label={`Source ${n}: ${source.title}`}
        className={cn(
          label
            ? 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-card px-2 py-0.5 text-[12px] text-ink-muted hover:border-line-strong hover:text-ink'
            : 'mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1 align-[1px] text-[11px] font-semibold tabular-nums text-primary hover:bg-primary/20',
          open && 'ring-2 ring-primary/30',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        )}
      >
        {label ?? n}
      </button>
      {open && <SourcePopover anchor={btn} source={source} onClose={close} onOpen={onOpen} />}
    </>
  )
}

function SourcePopover({ anchor, source, onClose, onOpen }: { anchor: React.RefObject<HTMLElement>; source: MetraSource; onClose: () => void; onOpen?: () => void }) {
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    if (!a) return
    const w = Math.min(300, window.innerWidth - 16)
    const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8))
    const above = a.bottom + 220 > window.innerHeight && a.top > 240
    setPos({ left, top: above ? a.top - 6 : a.bottom + 6, above })
  }, [anchor])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus() } }
    // Outside click or tap. The chip's own click toggles it, so the chip is not "outside".
    const onDown = (e: PointerEvent | TouchEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose() }
    // Any scroll except inside the popover (the message list, the page) closes it: it would float away.
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('touchstart', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('touchstart', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])
  const when = sourceDate(source.occurredAt)
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`Source ${source.n}`}
      data-metra-popover=""
      style={pos ? { left: pos.left, top: pos.top, transform: pos.above ? 'translateY(-100%)' : undefined } : { visibility: 'hidden' }}
      className="fixed z-[80] w-[min(300px,calc(100vw-1rem))] animate-fade-in rounded-card border border-line bg-card p-3 text-left shadow-overlay"
    >
      <div className="flex items-start gap-2">
        <span className="mt-px inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1 text-[11px] font-semibold text-primary">{source.n}</span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-ink">{source.title}</p>
          <p className="text-[12px] text-ink-muted">{[source.sourceLabel, when].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-ink-faint hover:bg-slate-100 hover:text-ink" aria-label="Close"><X size={14} /></button>
      </div>
      {source.snippet && <p className="mt-2 line-clamp-5 whitespace-pre-line text-body-sm text-ink-muted">{source.snippet}</p>}
      {source.link && (
        <button type="button" onClick={() => { onClose(); openSourceLink(source.link, navigate, onOpen) }} className="mt-2.5 inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">
          Open <ExternalLink size={13} />
        </button>
      )}
    </div>,
    document.body,
  )
}
