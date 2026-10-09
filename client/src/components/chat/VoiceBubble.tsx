import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Mic, Pause, Play } from 'lucide-react'
import { cn } from '../../lib/cn'
import { fmtClock, voiceSeconds } from './VoiceRecorder'

/**
 * A voice message the WhatsApp way: play button, the sound wave (tap or drag on it to
 * jump), the time, and a 1x / 1.5x / 2x speed switch. The wave is worked out once from
 * the audio itself, so it looks right for everyone without storing anything extra.
 */

const BARS = 44
const waves = new Map<string, Promise<{ peaks: number[]; duration: number }>>()
let playing: HTMLAudioElement | null = null // only one voice message plays at a time

function loadWave(src: string): Promise<{ peaks: number[]; duration: number }> {
  let p = waves.get(src)
  if (!p) {
    p = (async () => {
      const res = await fetch(src, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const buf = await res.arrayBuffer()
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      try {
        const audio = await ctx.decodeAudioData(buf)
        const data = audio.getChannelData(0)
        const step = Math.max(1, Math.floor(data.length / BARS))
        const peaks: number[] = []
        for (let b = 0; b < BARS; b++) {
          let sum = 0
          const from = b * step
          const to = Math.min(data.length, from + step)
          for (let i = from; i < to; i++) sum += data[i] * data[i]
          peaks.push(Math.sqrt(sum / Math.max(1, to - from)))
        }
        const max = Math.max(...peaks, 0.01)
        return { peaks: peaks.map((v) => Math.max(0.14, Math.sqrt(v / max))), duration: audio.duration }
      } finally {
        void ctx.close().catch(() => undefined)
      }
    })()
    p.catch(() => waves.delete(src))
    waves.set(src, p)
  }
  return p
}

/** A gentle made-up wave while the real one loads (or if this browser cannot read it). */
function fakeWave(seed: string): number[] {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    return 0.25 + 0.5 * Math.abs(Math.sin(i / 3 + (h % 100) / 50))
  })
}

const SPEEDS = [1, 1.5, 2]

export function VoiceBubble({ href, name, mine }: { href: string; name: string | null; mine: boolean }) {
  const src = `${href}?inline=1`
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [duration, setDuration] = useState<number>(voiceSeconds(name) ?? 0)
  const [pos, setPos] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [broken, setBroken] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const raf = useRef(0)

  // Work out the wave once the bubble is on screen.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let alive = true
    const go = () => loadWave(src).then((w) => { if (alive) { setPeaks(w.peaks); if (isFinite(w.duration) && w.duration > 0) setDuration(w.duration) } }).catch(() => undefined)
    if (typeof IntersectionObserver === 'undefined') { void go(); return () => { alive = false } }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); void go() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [src])

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    const a = audio.current
    if (a) { a.pause(); if (playing === a) playing = null }
  }, [])

  function ensureAudio(): HTMLAudioElement {
    if (audio.current) return audio.current
    const a = new Audio(src)
    a.preload = 'auto'
    a.onplaying = () => { setLoading(false); setIsPlaying(true); tick() }
    a.onwaiting = () => setLoading(true)
    a.onpause = () => { setIsPlaying(false); cancelAnimationFrame(raf.current) }
    a.onended = () => { setIsPlaying(false); setPos(0); cancelAnimationFrame(raf.current); if (playing === a) playing = null }
    a.onloadedmetadata = () => { if (isFinite(a.duration) && a.duration > 0) setDuration((d) => d || a.duration) }
    a.onerror = () => { setLoading(false); setIsPlaying(false); setBroken(true) }
    audio.current = a
    return a
  }

  function tick() {
    const a = audio.current
    if (!a) return
    setPos(a.currentTime)
    raf.current = requestAnimationFrame(tick)
  }

  function toggle() {
    const a = ensureAudio()
    if (!a.paused) { a.pause(); return }
    if (playing && playing !== a) playing.pause()
    playing = a
    a.playbackRate = speed
    setLoading(true)
    void a.play().catch(() => { setLoading(false); setBroken(true) })
  }

  function seekTo(clientX: number) {
    const el = box.current
    if (!el || !duration) return
    const r = el.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const a = ensureAudio()
    a.currentTime = f * duration
    setPos(f * duration)
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    if (audio.current) audio.current.playbackRate = next
  }

  if (broken) {
    return (
      <a href={href} className="mt-1 inline-flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-2 text-body-sm text-ink hover:bg-slate-50">
        <Mic size={16} className="text-primary" /> Voice message (this browser cannot play it here) <Download size={14} className="text-ink-muted" />
      </a>
    )
  }

  const bars = peaks ?? fakeWave(src)
  const done = duration ? pos / duration : 0
  return (
    <div className="flex w-[min(300px,72vw)] items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-card transition-transform active:scale-95', mine ? 'bg-primary hover:bg-primary/90' : 'bg-teal-500 hover:bg-teal-500/90')}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {loading && isPlaying ? <Loader2 size={18} className="animate-spin" /> : isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          ref={box}
          role="slider"
          tabIndex={0}
          aria-label="Position in the voice message"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(pos)}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seekTo(e.clientX) }}
          onPointerMove={(e) => { if (e.buttons & 1) seekTo(e.clientX) }}
          onKeyDown={(e) => {
            const a = ensureAudio()
            if (e.key === 'ArrowRight') { a.currentTime = Math.min(duration, a.currentTime + 5); setPos(a.currentTime) }
            if (e.key === 'ArrowLeft') { a.currentTime = Math.max(0, a.currentTime - 5); setPos(a.currentTime) }
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() }
          }}
          className="relative flex h-8 cursor-pointer touch-none items-center gap-[2px]"
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn('flex-1 rounded-full transition-colors', (i + 0.5) / bars.length <= done ? (mine ? 'bg-primary' : 'bg-teal-500') : 'bg-slate-300', !peaks && 'opacity-60')}
              style={{ height: `${Math.round(v * 100)}%`, minHeight: 3 }}
            />
          ))}
          {/* the playhead */}
          {duration > 0 && <span className={cn('pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow', mine ? 'bg-primary' : 'bg-teal-500')} style={{ left: `${done * 100}%` }} />}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
          <span className="tabular-nums">{isPlaying || pos > 0 ? fmtClock(pos) : fmtClock(duration)}</span>
          <button type="button" onClick={cycleSpeed} className={cn('rounded-full px-1.5 font-semibold leading-4', speed !== 1 ? 'bg-ink text-white' : 'bg-slate-200 text-ink hover:bg-slate-300')} aria-label={`Playback speed ${speed}x`} title="Playback speed">
            {speed}x
          </button>
          <a href={href} className="ml-auto rounded p-0.5 hover:text-ink" aria-label="Download voice message" title="Download"><Download size={12} /></a>
        </div>
      </div>
    </div>
  )
}
