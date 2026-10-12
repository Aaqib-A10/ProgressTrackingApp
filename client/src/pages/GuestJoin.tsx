import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Mic, MicOff, Video, VideoOff, Users } from 'lucide-react'
import { guestApi } from '../lib/callsApi'
import { setGuestMode } from '../lib/api'
import { CallEngine, type CallSnapshot } from '../lib/callEngine'
import { CtrlButton, LeaveButton, PeerAudio, TileView, gridFor, hasVideo, useSpeaking, type Tile } from '../components/calls/CallWindow'
import { cn } from '../lib/cn'

/**
 * /join/:token: someone outside Metriq joins a call by link. They type their name and
 * ask to join; a person in the call lets them in. No account, and only the call itself.
 */

type Step =
  | { kind: 'loading' }
  | { kind: 'bad'; message: string }
  | { kind: 'name' }
  | { kind: 'waiting' }
  | { kind: 'denied' }
  | { kind: 'call'; callId: string; conversationId: string; video: boolean; me: string; name: string }
  | { kind: 'done'; message: string }

const NAME_KEY = 'pt-guest-name'

function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  try { return (JSON.parse(raw) as { error?: string }).error ?? raw } catch { return raw }
}

export default function GuestJoin() {
  const { token = '' } = useParams()
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [title, setTitle] = useState('')
  const [live, setLive] = useState(false)
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setGuestMode(true); return () => setGuestMode(false) }, [])

  // What is this link for? (and is the meeting on yet)
  useEffect(() => {
    let alive = true
    const load = () => guestApi.info(token).then((r) => {
      if (!alive) return
      setTitle(r.title); setLive(r.live)
      setStep((s) => (s.kind === 'loading' ? { kind: 'name' } : s))
    }).catch((e) => alive && setStep({ kind: 'bad', message: errText(e) }))
    void load()
    // Before it starts, look again every few seconds.
    const t = window.setInterval(() => { if (!live) void load() }, 5000)
    return () => { alive = false; window.clearInterval(t) }
  }, [token, live])

  // Waiting to be let in.
  useEffect(() => {
    if (step.kind !== 'waiting') return
    const t = window.setInterval(async () => {
      try {
        const r = await guestApi.status(token)
        if (r.status === 'admitted' && r.callId && r.conversationId && r.me) setStep({ kind: 'call', callId: r.callId, conversationId: r.conversationId, video: r.video ?? true, me: r.me, name: r.name ?? name })
        else if (r.status === 'denied') setStep({ kind: 'denied' })
        else if (r.status === 'ended') setStep({ kind: 'done', message: 'The meeting has ended.' })
        else if (r.status === 'none') setStep({ kind: 'name' })
      } catch { /* keep waiting */ }
    }, 2000)
    return () => window.clearInterval(t)
  }, [step.kind, token, name])

  async function knock() {
    const n = name.trim()
    if (n.length < 2) { setError('Type your name'); return }
    setBusy(true); setError(null)
    try {
      try { localStorage.setItem(NAME_KEY, n) } catch { /* fine */ }
      const r = await guestApi.knock(token, n)
      setTitle(r.title)
      setStep({ kind: 'waiting' }) // the waiting room checks every 2 seconds (also when already let in)
    } catch (e) {
      setError(errText(e))
    } finally { setBusy(false) }
  }

  if (step.kind === 'call') return <GuestCall {...step} title={title} onEnd={(message) => setStep({ kind: 'done', message })} />

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 p-4 text-white">
      <div className="w-full max-w-md animate-scale-in rounded-card bg-card p-6 text-ink shadow-overlay">
        <div className="mb-4 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-body-lg font-bold">PulseTrack</span>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">Guest</span>
        </div>
        {step.kind === 'loading' ? <p className="flex items-center gap-2 text-body-md text-ink-muted"><Loader2 size={16} className="animate-spin" /> Opening the meeting…</p>
          : step.kind === 'bad' ? <><h1 className="text-h3 font-bold">This link does not work</h1><p className="mt-1 text-body-md text-ink-muted">{step.message}</p></>
          : step.kind === 'done' ? <><h1 className="text-h3 font-bold">Thanks for joining</h1><p className="mt-1 text-body-md text-ink-muted">{step.message}</p></>
          : step.kind === 'denied' ? <><h1 className="text-h3 font-bold">You were not let in</h1><p className="mt-1 text-body-md text-ink-muted">The people in the meeting did not let you in this time. You can ask again.</p><button type="button" onClick={() => setStep({ kind: 'name' })} className="mt-4 rounded-btn bg-primary px-4 py-2 font-semibold text-white">Ask again</button></>
          : step.kind === 'waiting' ? (
            <>
              <h1 className="text-h3 font-bold">{title}</h1>
              <div className="mt-4 flex items-center gap-3 rounded-btn bg-primary/5 p-3">
                <Loader2 size={20} className="shrink-0 animate-spin text-primary" />
                <p className="text-body-md">Waiting for someone in the meeting to let you in…</p>
              </div>
              <p className="mt-3 text-body-sm text-ink-muted">Keep this page open. When you are let in, allow your microphone (and camera) if the browser asks.</p>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void knock() }}>
              <p className="text-body-sm text-ink-muted">You are invited to</p>
              <h1 className="text-h3 font-bold">{title}</h1>
              {!live && <p className="mt-3 flex items-center gap-2 rounded-btn bg-amber-50 px-3 py-2 text-body-sm text-amber-800"><Loader2 size={14} className="animate-spin" /> The meeting has not started yet. This page checks again by itself.</p>}
              <label className="mt-4 block text-body-sm font-semibold">Your name
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Sara Khan" className="mt-1 h-11 w-full rounded-btn border border-line px-3 text-body-md focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
              </label>
              {error && <p className="mt-2 text-body-sm text-danger">{error}</p>}
              <button type="submit" disabled={busy || !live} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-primary font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 size={16} className="animate-spin" />} Ask to join
              </button>
              <p className="mt-3 text-center text-[12px] text-ink-muted">You will show as "{name.trim() || 'Your name'} (Guest)". You only see this call.</p>
            </form>
          )}
      </div>
    </div>
  )
}

function GuestCall({ callId, conversationId, video, me, name, title, onEnd }: { callId: string; conversationId: string; video: boolean; me: string; name: string; title: string; onEnd: (message: string) => void }) {
  const [snap, setSnap] = useState<CallSnapshot | null>(null)
  const engine = useRef<CallEngine | null>(null)
  useEffect(() => {
    // Only the current connection may update the screen (an old one that is closing says "ended").
    const e: CallEngine = new CallEngine(callId, conversationId, video, (s) => { if (engine.current === e) setSnap({ ...s }) })
    engine.current = e
    void e.start()
    const bye = () => { void e.leave() }
    window.addEventListener('pagehide', bye)
    return () => { window.removeEventListener('pagehide', bye); if (engine.current === e) engine.current = null; void e.leave() }
  }, [callId, conversationId, video])
  useEffect(() => {
    if (snap?.status === 'ended') onEnd('The meeting has ended.')
  }, [snap?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const speaking = useSpeaking(snap ? [{ id: me, stream: snap.localStream, on: snap.mic }, ...snap.peers.map((p) => ({ id: p.userId, stream: p.stream, on: p.mic }))] : [])

  if (!snap) return <div className="flex min-h-full items-center justify-center bg-slate-950 text-white"><Loader2 className="animate-spin" /></div>
  const meTile: Tile = { key: 'me', id: me, name: 'You', avatarName: name, stream: snap.localStream, mic: snap.mic, hand: false, showVideo: snap.cam && hasVideo(snap.localStream), mirror: true, local: true, state: 'connected', speaking: speaking.has(me) }
  const tiles: Tile[] = [...snap.peers.map((p) => ({ key: p.userId, id: p.userId, name: p.name, stream: p.stream, mic: p.mic, hand: p.hand, showVideo: (p.cam || p.screen) && hasVideo(p.stream), mirror: false, local: false, state: p.state, screen: p.screen, stuck: p.stuck, speaking: speaking.has(p.userId) })), meTile]
  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white">
      {snap.peers.map((p) => <PeerAudio key={p.userId} stream={p.stream} />)}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-lg font-semibold">{title}</p>
          <p className="flex items-center gap-2 text-body-sm text-slate-300"><Users size={13} /> {snap.peers.length + 1} <span className="rounded bg-white/10 px-1.5 text-[11px]">You are a guest</span></p>
        </div>
      </div>
      {snap.error && <p className="mx-4 mb-2 rounded-btn bg-warning/20 px-3 py-2 text-body-sm text-amber-100">{snap.error}</p>}
      <div className="relative min-h-0 flex-1 px-4 pb-2">
        {snap.status === 'connecting'
          ? <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300"><Loader2 size={28} className="animate-spin" /> Allow the microphone{video ? ' and camera' : ''} if your browser asks.</div>
          : (
            <div className={cn('grid h-full gap-2', gridFor(tiles.length))}>
              {tiles.map((t) => <div key={t.key} className="min-h-0 overflow-hidden rounded-card bg-slate-800"><TileView tile={t} /></div>)}
            </div>
          )}
        {snap.captions.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 px-6">
            {snap.captions.slice(-3).map((c) => <p key={c.id} className="max-w-3xl rounded bg-black/75 px-3 py-1 text-center text-body-md"><b className="text-sky-300">{c.name}:</b> <span dir="auto">{c.text}</span></p>)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-3 px-4 pb-5 pt-2">
        <CtrlButton on={snap.mic} onClick={() => engine.current?.toggleMic()} label={snap.mic ? 'Mute microphone' : 'Unmute microphone'} icon={snap.mic ? <Mic size={20} /> : <MicOff size={20} />} />
        <CtrlButton on={snap.cam} onClick={() => { void engine.current?.toggleCam() }} label={snap.cam ? 'Turn camera off' : 'Turn camera on'} icon={snap.cam ? <Video size={20} /> : <VideoOff size={20} />} />
        <LeaveButton onClick={() => { void engine.current?.leave().finally(() => onEnd('You left the meeting.')) }} />
      </div>
    </div>
  )
}
