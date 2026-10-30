import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react'
import { site } from './content'

/**
 * The home page's first screen: a grid that glows under the pointer with squares that light up
 * now and then, slow coloured light behind, and the project board in a frame that straightens as
 * you scroll, with a task being dragged to Done on it.
 */

const CELLS: { x: number; y: number; d: number }[] = [
  { x: -7, y: 1, d: 0 }, { x: -5, y: 3, d: 1.6 }, { x: -9, y: 5, d: 3.1 }, { x: -3, y: 0, d: 4.4 },
  { x: 6, y: 1, d: 0.8 }, { x: 4, y: 4, d: 2.3 }, { x: 8, y: 3, d: 3.8 }, { x: 2, y: 6, d: 5.2 },
  { x: -1, y: 7, d: 2.9 }, { x: 10, y: 6, d: 1.2 }, { x: -11, y: 2, d: 5.8 },
]

export function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[980px] overflow-hidden">
      <div className="mk-aurora mk-aurora-a left-[8%] top-[-160px] h-[520px] w-[620px]" />
      <div className="mk-aurora mk-aurora-b right-[4%] top-[-80px] h-[460px] w-[560px]" />
      <div className="mk-grid absolute inset-0" style={{ backgroundPosition: 'center top' }} />
      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_30%,transparent_75%)]">
        {CELLS.map((c, i) => (
          <span key={i} className="mk-cell" style={{ left: `calc(50% - 28px + ${c.x * 56 + 1}px)`, top: `${c.y * 56 + 1}px`, '--mk-delay': `${c.d}s` } as CSSProperties} />
        ))}
      </div>
      {/* The grid shows a little more where the pointer is. */}
      <div className="mk-grid absolute inset-0 opacity-0 transition-opacity duration-300 [.mk-hero:hover_&]:opacity-100" style={{ backgroundPosition: 'center top', maskImage: 'radial-gradient(260px circle at var(--mx, 50%) var(--my, 0px), #000, transparent 70%)', WebkitMaskImage: 'radial-gradient(260px circle at var(--mx, 50%) var(--my, 0px), #000, transparent 70%)', backgroundImage: 'linear-gradient(to right, rgb(var(--primary) / 0.28) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--primary) / 0.28) 1px, transparent 1px)' }} />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
    </div>
  )
}

/** Pointer position for the glow, set on the hero section. */
export function trackPointer(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}

/** 0 when the frame first shows below the headline, 1 once it has scrolled up into view. */
function useScrollTilt() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.style.setProperty('--p', '1'); return }
    let raf = 0
    const set = () => {
      raf = 0
      const top = el.getBoundingClientRect().top
      const p = Math.min(1, Math.max(0, 1 - (top - 90) / (window.innerHeight * 0.55)))
      el.style.setProperty('--p', p.toFixed(3))
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(set) }
    set()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf) }
  }, [])
  return ref
}

export function HeroStage() {
  const tilt = useScrollTilt()
  return (
    <div className="relative mx-auto max-w-6xl" style={{ perspective: '1800px' }}>
      <div className="mk-glow" aria-hidden />
      <div
        ref={tilt}
        className="relative rounded-[26px] bg-white/50 p-[7px] shadow-[0_40px_80px_-30px_rgb(var(--shadow)/0.45)] ring-1 ring-line backdrop-blur-sm will-change-transform dark:bg-white/[0.04]"
        style={{ transform: 'rotateX(calc((1 - var(--p, 0)) * 14deg)) scale(calc(0.93 + var(--p, 0) * 0.07))', transformOrigin: '50% 0%' }}
      >
        <div className="mk-beam" aria-hidden />
        <div className="relative overflow-hidden rounded-[20px]">
          <img src={site('office.webp')} alt="" aria-hidden className="mk-kenburns absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/5" />
          <div className="mk-rise relative px-2.5 pt-8 sm:px-12 sm:pt-16">
            <BoardWindow />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The board screenshot, with a task dragged from "In progress" to "Done" over it. */
function BoardWindow() {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-t-[14px] border border-b-0 border-white/25 bg-card shadow-overlay">
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-slate-50 px-3" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto hidden h-5 min-w-[220px] items-center justify-center rounded-md bg-card px-3 text-[11px] text-ink-faint ring-1 ring-line sm:flex">metriq.app/app/projects/WR</span>
        <span className="w-[42px]" />
      </div>
      <div className="mk-demo relative">
        <img src={site('app-board.webp')} alt="A project board in Metriq: tasks in Backlog, To do, In progress, In review and Done, each with an owner and a due date" className="block w-full dark:hidden" loading="eager" decoding="async" width={1680} height={1050} />
        <img src={site('app-board-dark.webp')} alt="A project board in Metriq: tasks in Backlog, To do, In progress, In review and Done, each with an owner and a due date" className="hidden w-full dark:block" loading="lazy" decoding="async" width={1680} height={1050} />
        <div aria-hidden>
          <div className="mk-slot" />
          <div className="mk-ghost" style={{ transformOrigin: '0 0' }}>
            <div className="flex items-center justify-between" style={{ fontSize: '0.72cqw' }}>
              <span className="text-zinc-400">WR-2</span>
              <span className="flex">
                <span className="flex items-center justify-center rounded-full bg-emerald-500 font-semibold text-white" style={{ width: '1.35cqw', height: '1.35cqw', fontSize: '0.6cqw' }}>A</span>
                <span className="-ml-[0.3cqw] flex items-center justify-center rounded-full bg-sky-500 font-semibold text-white" style={{ width: '1.35cqw', height: '1.35cqw', fontSize: '0.6cqw' }}>DB</span>
              </span>
            </div>
            <p className="font-medium" style={{ fontSize: '0.98cqw', lineHeight: 1.3, marginTop: '0.45cqw' }}>Racking and forklift quotes</p>
            <div className="relative flex items-center" style={{ marginTop: '0.55cqw', gap: '0.35cqw', fontSize: '0.7cqw', height: '1.45cqw' }}>
              <span className="mk-chip-old flex h-full items-center rounded border border-zinc-200 px-[0.4cqw] text-zinc-600 dark:border-white/15 dark:text-zinc-300">Oct 31</span>
              <span className="mk-chip-new absolute left-0 flex h-full items-center gap-[0.25cqw] rounded border border-emerald-300 bg-emerald-50 px-[0.4cqw] font-semibold text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300">
                <svg viewBox="0 0 24 24" style={{ width: '0.8cqw', height: '0.8cqw' }} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>Done
              </span>
            </div>
            <p className="truncate text-zinc-400" style={{ fontSize: '0.72cqw', marginTop: '0.55cqw' }}>Sara Ahmed → Ayesha K.</p>
          </div>
          <svg className="mk-cursor" viewBox="0 0 24 24" aria-hidden>
            <path d="M5 3l14 7.5-6.2 1.6L10 18.5Z" fill="#111827" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
          <div className="mk-sweep" />
        </div>
      </div>
    </div>
  )
}
