import { useEffect, useRef, useState } from 'react'
import { Loader2, Maximize2, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, PhoneOff, Users, Video, VideoOff, X } from 'lucide-react'
import type { PeerView } from '../../lib/callEngine'
import { PersonAvatar } from '../projects/pmUi'
import { cn } from '../../lib/cn'
import { useCalls } from './CallProvider'

/** The call itself: a full-screen meeting view, or a small floating card while you keep working. */
export function CallWindow() {
  const ctx = useCalls()
  const [now, setNow] = useState(Date.now())
  const [dismissErr, setDismissErr] = useState<string | null>(null)
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  // Esc shrinks the meeting to the corner instead of hanging up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ctx && !ctx.minimized) ctx.setMinimized(true) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])
  if (!ctx?.call) return null
  const { call, meta, minimized } = ctx

  const title = meta?.title ?? 'Call'
  const timer = fmtTimer(now - (call.connectedAt ?? now))
  const connecting = call.status === 'connecting'
  const alone = call.status === 'live' && call.peers.length === 0
  const declinedNames = call.declined.map((id) => meta?.members.find((m) => m.id === id)?.name).filter(Boolean) as string[]
  const waitingText = connecting ? 'Connecting…' : meta?.isDirect ? (call.hadPeers ? 'Call ended' : `Calling ${title}…`) : 'Waiting for others to join…'
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
  const sharer = call.peers.find((p) => p.screen && hasVideo(p.stream))
  const myName = meta?.members.find((m) => m.id === ctx.meId)?.name ?? 'You'
  const meTile: Tile = { key: 'me', name: 'You', avatarName: myName, stream: call.localStream, mic: call.mic, showVideo: (call.cam || call.screen) && hasVideo(call.localStream), mirror: call.cam && !call.screen, local: true, state: 'connected', id: ctx.meId }
  const peerTiles: Tile[] = call.peers.map((p) => ({ key: p.userId, id: p.userId, name: p.name, stream: p.stream, mic: p.mic, showVideo: (p.cam || p.screen) && hasVideo(p.stream), mirror: false, local: false, state: p.state, screen: p.screen }))
  const err = call.error && call.error !== dismissErr ? call.error : null

  const controls = (small: boolean) => (
    <div className={cn('flex items-center justify-center', small ? 'gap-1.5' : 'gap-3')}>
      <CtrlButton small={small} on={call.mic} onClick={ctx.toggleMic} label={call.mic ? 'Mute microphone' : 'Unmute microphone'} icon={call.mic ? <Mic size={small ? 16 : 20} /> : <MicOff size={small ? 16 : 20} />} />
      {!small && <CtrlButton on={call.cam} onClick={ctx.toggleCam} label={call.cam ? 'Turn camera off' : 'Turn camera on'} icon={call.cam ? <Video size={20} /> : <VideoOff size={20} />} />}
      {!small && canShare && <CtrlButton on={!call.screen} active={call.screen} onClick={ctx.toggleScreen} label={call.screen ? 'Stop sharing your screen' : 'Share your screen'} icon={call.screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />} />}
      <button type="button" onClick={ctx.leave} className={cn('inline-flex items-center justify-center gap-2 rounded-full bg-danger font-semibold text-white hover:bg-danger/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-danger/40', small ? 'h-9 w-9' : 'h-12 px-5')} aria-label="Leave call" title="Leave call">
        <PhoneOff size={small ? 16 : 20} />{!small && <span className="hidden sm:inline">Leave</span>}
      </button>
    </div>
  )

  return (
    <>
      {/* Remote audio always plays, whether the window is big or small. */}
      {call.peers.map((p) => <PeerAudio key={p.userId} stream={p.stream} />)}

      {minimized ? (
        <div className="fixed bottom-4 left-4 z-[60] w-[min(300px,calc(100vw-2rem))] animate-scale-in overflow-hidden rounded-card bg-slate-900 text-white shadow-overlay" role="dialog" aria-label={`Call with ${title}`}>
          <button type="button" onClick={() => ctx.setMinimized(false)} className="block w-full text-left" title="Open the call">
            <div className="relative aspect-video bg-slate-800">
              <TileView tile={sharer ? peerTiles.find((t) => t.id === sharer.userId)! : peerTiles[0] ?? meTile} compact />
              <span className="absolute right-2 top-2 rounded bg-black/50 p-1"><Maximize2 size={14} /></span>
            </div>
          </button>
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold">{title}</p>
              <p className="text-[11px] text-slate-300">{alone || connecting ? waitingText : `${timer} · ${call.peers.length + 1} in call`}</p>
            </div>
            {controls(true)}
          </div>
        </div>
      ) : (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label={`Call with ${title}`}>
          <div className="flex shrink-0 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-lg font-semibold">{title}</p>
              <p className="flex items-center gap-2 text-body-sm text-slate-300">
                {call.video ? <Video size={13} /> : <Mic size={13} />}
                {alone || connecting ? waitingText : timer}
                <span className="inline-flex items-center gap-1"><Users size={13} /> {call.peers.length + 1}</span>
              </p>
            </div>
            <button type="button" onClick={() => ctx.setMinimized(true)} className="inline-flex items-center gap-1.5 rounded-btn px-3 py-2 text-body-sm text-slate-200 hover:bg-white/10" title="Keep working while the call continues (Esc)">
              <Minimize2 size={16} /> <span className="hidden sm:inline">Minimise</span>
            </button>
          </div>

          {err && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-btn bg-warning/20 px-3 py-2 text-body-sm text-amber-100">
              <span className="flex-1">{err}</span>
              <button type="button" onClick={() => setDismissErr(call.error)} aria-label="Dismiss"><X size={15} /></button>
            </div>
          )}

          <div className="min-h-0 flex-1 px-4 pb-2">
            {connecting ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300"><Loader2 size={28} className="animate-spin" /> Allow the microphone{call.video ? ' and camera' : ''} if your browser asks.</div>
            ) : alone ? (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <div className="aspect-video w-full max-w-xl overflow-hidden rounded-card bg-slate-800"><TileView tile={meTile} /></div>
                <p className="text-body-md text-slate-300">{waitingText}</p>
                {declinedNames.length > 0 && !meta?.isDirect && <p className="text-body-sm text-slate-400">{declinedNames.join(', ')} declined</p>}
              </div>
            ) : sharer ? (
              <div className="flex h-full flex-col gap-2">
                <div className="min-h-0 flex-1 overflow-hidden rounded-card bg-slate-800"><TileView tile={peerTiles.find((t) => t.id === sharer.userId)!} contain /></div>
                <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
                  {[meTile, ...peerTiles.filter((t) => t.id !== sharer.userId)].map((t) => <div key={t.key} className="aspect-video h-full shrink-0 overflow-hidden rounded-card bg-slate-800"><TileView tile={t} compact /></div>)}
                </div>
              </div>
            ) : (
              <div className={cn('grid h-full gap-2', gridFor(peerTiles.length + 1))}>
                {[...peerTiles, meTile].map((t) => <div key={t.key} className="min-h-0 overflow-hidden rounded-card bg-slate-800"><TileView tile={t} /></div>)}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 pb-5 pt-2">{controls(false)}</div>
        </div>
      )}
    </>
  )
}

interface Tile { avatarName?: string; key: string; id: string; name: string; stream: MediaStream; mic: boolean; showVideo: boolean; mirror: boolean; local: boolean; state: PeerView['state']; screen?: boolean }

function TileView({ tile, compact, contain }: { tile: Tile; compact?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const videoId = tile.stream.getVideoTracks()[0]?.id ?? ''
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== tile.stream) el.srcObject = tile.stream
    void el.play().catch(() => undefined)
  }, [tile.stream, videoId, tile.showVideo])
  const connecting = !tile.local && tile.state !== 'connected'
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Video is always muted here; sound comes from the hidden <audio> per person. */}
      <video ref={ref} autoPlay playsInline muted className={cn('h-full w-full', contain || tile.screen ? 'object-contain' : 'object-cover', tile.mirror && '-scale-x-100', !tile.showVideo && 'hidden')} />
      {!tile.showVideo && <PersonAvatar person={{ id: tile.id, name: tile.avatarName ?? tile.name }} size={compact ? 44 : 84} />}
      <span className={cn('absolute bottom-2 left-2 inline-flex max-w-[85%] items-center gap-1 rounded bg-black/55 px-2 py-0.5 font-medium', compact ? 'text-[11px]' : 'text-body-sm')}>
        {!tile.mic && <MicOff size={compact ? 11 : 13} className="shrink-0 text-danger" />}
        <span className="truncate">{tile.name}{tile.screen ? ' (sharing screen)' : ''}</span>
      </span>
      {connecting && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-black/55 px-2 py-0.5 text-[11px]"><Loader2 size={11} className="animate-spin" /> {tile.state === 'failed' ? 'Reconnecting…' : 'Connecting…'}</span>}
    </div>
  )
}

function PeerAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  const n = stream.getAudioTracks().length
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => undefined)
  }, [stream, n])
  return <audio ref={ref} autoPlay className="hidden" />
}

function CtrlButton({ on, active, onClick, label, icon, small }: { on: boolean; active?: boolean; onClick: () => void; label: string; icon: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={!on}
      className={cn(
        'inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30',
        small ? 'h-9 w-9' : 'h-12 w-12',
        active ? 'bg-primary text-white' : on ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-slate-900 hover:bg-slate-200',
      )}
    >
      {icon}
    </button>
  )
}

function hasVideo(s: MediaStream): boolean {
  return s.getVideoTracks().some((t) => t.readyState === 'live')
}

function gridFor(n: number): string {
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'
  if (n <= 4) return 'grid-cols-2 grid-rows-2'
  return 'grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2'
}

function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
