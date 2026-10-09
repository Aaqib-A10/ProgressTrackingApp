import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronUp, Lock, Mic, Pause, Send, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * WhatsApp-style voice messages.
 *
 *  - Hold the mic: it records while held. Let go to send it straight away.
 *    Slide left to cancel, slide up to lock (keep recording hands-free).
 *  - Click (tap) the mic: it records "locked" right away; press Send when done,
 *    the bin to throw it away, or pause / carry on in between.
 *
 * While recording, a bar covers the message box with the timer and a live sound wave.
 */

const MAX_MS = 10 * 60_000 // 10 minutes at most
const CANCEL_PX = 90
const LOCK_PX = 70
const TAP_MS = 350

/** File name carries the length, so the chat list can say "Voice message (0:12)". */
export function voiceFileName(sec: number, ext: string): string {
  return `voice-note-${Math.max(1, Math.round(sec))}s.${ext}`
}

/** Seconds from a voice note's file name (null if it is not one of ours). */
export function voiceSeconds(name: string | null | undefined): number | null {
  const m = /^voice-note-(\d+)s\./.exec(name ?? '')
  return m ? Number(m[1]) : null
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Mode = 'hold' | 'locked'

interface Rec {
  mr: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  audio: AudioContext | null
  analyser: AnalyserNode | null
  mime: string
  /** ms recorded before the current run (pauses do not count). */
  doneMs: number
  /** when the current run started, or null while paused. */
  runFrom: number | null
}

export function VoiceRecorder({ onSend, onError, onActive }: { onSend: (file: File, sec: number) => void; onError: (msg: string) => void; onActive?: (on: boolean) => void }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [paused, setPaused] = useState(false)
  const [ms, setMs] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const rec = useRef<Rec | null>(null)
  const startingRef = useRef(false)
  const pointer = useRef<{ id: number; x: number; y: number; at: number } | null>(null)
  const modeRef = useRef<Mode | null>(null)
  modeRef.current = mode

  const elapsed = () => {
    const r = rec.current
    if (!r) return 0
    return r.doneMs + (r.runFrom ? performance.now() - r.runFrom : 0)
  }

  // Timer + live wave while recording.
  useEffect(() => {
    if (!mode) return
    const buf = new Uint8Array(1024)
    const t = window.setInterval(() => {
      const r = rec.current
      if (!r) return
      const now = elapsed()
      setMs(now)
      if (now >= MAX_MS) { finish(true); return }
      if (r.analyser && r.runFrom) {
        r.analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        setLevels((l) => [...l.slice(-119), Math.min(1, rms * 4)])
      }
    }, 100)
    return () => window.clearInterval(t)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onActive?.(!!mode) }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keys while recording: Enter sends, Esc throws it away.
  useEffect(() => {
    if (mode !== 'locked') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false) }
      else if (e.key === 'Enter') { e.preventDefault(); finish(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the chat mid-recording throws it away and frees the microphone.
  useEffect(() => () => { const r = rec.current; rec.current = null; if (r) stopAll(r) }, [])

  function stopAll(r: Rec) {
    r.stream.getTracks().forEach((t) => t.stop())
    void r.audio?.close().catch(() => undefined)
  }

  async function begin(m: Mode): Promise<boolean> {
    if (rec.current || startingRef.current) return false
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { onError('This browser cannot record voice messages'); return false }
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x)) ?? ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined)
      let audio: AudioContext | null = null
      let analyser: AnalyserNode | null = null
      try {
        audio = new AudioContext()
        analyser = audio.createAnalyser()
        analyser.fftSize = 1024
        audio.createMediaStreamSource(stream).connect(analyser)
      } catch { /* no live wave, recording still works */ }
      const r: Rec = { mr, stream, chunks: [], audio, analyser, mime, doneMs: 0, runFrom: performance.now() }
      mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data) }
      mr.start(250)
      rec.current = r
      setLevels([]); setMs(0); setPaused(false); setDrag({ x: 0, y: 0 })
      setMode(m)
      navigator.vibrate?.(30)
      return true
    } catch {
      onError('Microphone blocked: allow it in the browser to record a voice message')
      return false
    } finally {
      startingRef.current = false
    }
  }

  /** Stop recording; send it (keep) or throw it away. */
  function finish(keep: boolean) {
    const r = rec.current
    if (!r) return
    const sec = elapsed() / 1000
    rec.current = null
    setMode(null); setPaused(false); setDrag({ x: 0, y: 0 })
    const done = () => {
      stopAll(r)
      if (!keep) return
      if (sec < 0.8 || !r.chunks.length) { onError('Too short. Hold the mic a little longer, or click it to record.'); return }
      const type = (r.mr.mimeType || r.mime || 'audio/webm').split(';')[0]
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
      onSend(new File(r.chunks, voiceFileName(sec, ext), { type }), sec)
    }
    if (r.mr.state === 'inactive') { done(); return }
    r.mr.onstop = done
    try { r.mr.stop() } catch { done() }
  }

  function togglePause() {
    const r = rec.current
    if (!r) return
    if (r.runFrom) {
      try { r.mr.pause() } catch { return }
      r.doneMs += performance.now() - r.runFrom
      r.runFrom = null
      setPaused(true)
    } else {
      try { r.mr.resume() } catch { return }
      r.runFrom = performance.now()
      setPaused(false)
    }
  }

  // ----- the mic button: hold to talk, tap to lock -----
  async function onDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const target = e.currentTarget
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() }
    try { target.setPointerCapture(e.pointerId) } catch { /* fine */ }
    const ok = await begin('hold')
    // Let go before the microphone was ready: treat it as a tap (record, locked).
    if (ok && !pointer.current) setMode('locked')
  }
  function onMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current
    if (!p || p.id !== e.pointerId || modeRef.current !== 'hold') return
    const dx = Math.min(0, e.clientX - p.x)
    const dy = Math.min(0, e.clientY - p.y)
    setDrag({ x: dx, y: dy })
    if (dx < -CANCEL_PX) { pointer.current = null; finish(false); navigator.vibrate?.([20, 40, 20]) }
    else if (dy < -LOCK_PX) { pointer.current = null; setDrag({ x: 0, y: 0 }); setMode('locked'); navigator.vibrate?.(20) }
  }
  function onUp(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current
    if (!p || p.id !== e.pointerId) return
    pointer.current = null
    if (modeRef.current !== 'hold') return
    if (performance.now() - p.at < TAP_MS) { setMode('locked'); setDrag({ x: 0, y: 0 }); return } // a click: keep recording
    finish(true) // let go after holding: send
  }

  const mic = (
    <button
      type="button"
      onPointerDown={(e) => void onDown(e)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { pointer.current = null; if (modeRef.current === 'hold') finish(false) }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !mode) { e.preventDefault(); void begin('locked') } }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn('relative touch-none select-none rounded-full p-1.5 transition-colors', mode === 'hold' ? 'z-20 bg-primary text-white shadow-overlay' : 'bg-primary text-white hover:bg-primary/90')}
      style={mode === 'hold' ? { transform: `translate(${drag.x}px, ${drag.y}px) scale(1.35)` } : undefined}
      aria-label="Voice message: hold to record and let go to send, or click to record"
      title="Hold to record, let go to send. Or click to record."
    >
      <Mic size={18} />
    </button>
  )

  const bars = levels.length ? levels : [0]
  // The mic stays mounted in the same place the whole time: while held it keeps the
  // pointer (moving it to another spot in the tree would drop the press).
  return (
    <>
      {mic}
      {/* The bar over the message box */}
      {mode && <div className="absolute inset-0 z-10 flex animate-fade-in items-center gap-2 rounded-btn bg-card px-2">
        {mode === 'locked' ? (
          <button type="button" onClick={() => finish(false)} className="rounded-full p-2 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete the recording" title="Delete (Esc)"><Trash2 size={18} /></button>
        ) : null}
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full bg-danger', !paused && 'animate-pulse')} />
        <span className="w-11 shrink-0 font-mono text-body-sm tabular-nums text-ink">{fmtClock(ms / 1000)}</span>
        <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
          {bars.map((v, i) => <span key={i} className={cn('w-[3px] shrink-0 rounded-full', paused ? 'bg-slate-300' : 'bg-primary/70')} style={{ height: `${Math.max(12, v * 100)}%` }} />)}
        </div>
        {mode === 'hold' ? (
          <span className="flex shrink-0 items-center gap-0.5 pr-10 text-body-sm text-ink-muted" style={{ opacity: Math.max(0.3, 1 + drag.x / CANCEL_PX) }}>
            <ChevronLeft size={15} className="animate-pulse" /> Slide to cancel
          </span>
        ) : (
          <>
            <button type="button" onClick={togglePause} className="rounded-full p-2 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label={paused ? 'Carry on recording' : 'Pause'} title={paused ? 'Carry on recording' : 'Pause'}>
              {paused ? <Mic size={18} className="text-danger" /> : <Pause size={18} />}
            </button>
            <button type="button" onClick={() => finish(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-card hover:bg-primary/90" aria-label="Send the voice message" title="Send (Enter)">
              <Send size={17} />
            </button>
          </>
        )}
      </div>}
      {/* Holding: the lock hint above the mic, and the mic itself (it follows the finger). */}
      {mode === 'hold' && (
        <span className="pointer-events-none absolute -top-16 right-1 z-20 flex flex-col items-center gap-0.5 rounded-full bg-card px-2 py-2 text-ink-muted shadow-overlay" style={{ opacity: Math.min(1, 0.6 - drag.y / LOCK_PX) }}>
          <Lock size={15} /><ChevronUp size={14} className="animate-bounce" />
        </span>
      )}
    </>
  )
}
