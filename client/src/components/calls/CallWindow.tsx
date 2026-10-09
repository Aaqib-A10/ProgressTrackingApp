import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions, CircleDot, Hand, Link2, Loader2, WifiOff, Maximize2, MessageSquare, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, PhoneOff, Pin, PinOff, Search,
  Smile, Sparkles, Square, UserPlus, Users, Video, VideoOff, WandSparkles, X, Ban, Droplets,
} from 'lucide-react'
import type { PeerView } from '../../lib/callEngine'
import { chatApi, type ChatUser } from '../../lib/chatApi'
import { recordingSupported } from '../../lib/callRecorder'
import { SPEECH_LANGS, speechSupported } from '../../lib/transcriber'
import { PersonAvatar } from '../projects/pmUi'
import { ChatThread } from '../chat/ChatThread'
import { cn } from '../../lib/cn'
import { BACKGROUNDS, FILTERS, bgThumb, effectsOn, effectsSupported, preloadEffects, type EffectsSettings } from '../../lib/videoEffects'
import { useCalls, type CallPanel } from './CallProvider'

const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🙏']

/** The call itself: a full-screen meeting view, or a small floating card while you keep working. */
export function CallWindow() {
  const ctx = useCalls()
  const [dismissErr, setDismissErr] = useState<string | null>(null)
  const [reactOpen, setReactOpen] = useState(false)
  // A person pinned to the big view (click a tile). Screen shares are shown big on their own.
  const [pinned, setPinned] = useState<string | null>(null)
  const speaking = useSpeaking(ctx?.call ? [{ id: ctx.meId, stream: ctx.call.localStream, on: ctx.call.mic }, ...ctx.call.peers.map((p) => ({ id: p.userId, stream: p.stream, on: p.mic }))] : [])
  // Keys in the full meeting view: Esc closes a side panel, then shrinks the meeting to
  // the corner (never hangs up). M mute, V camera, H hand. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ctx?.call || ctx.minimized || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'escape') {
        if (ctx.panel) ctx.setPanel(null)
        else ctx.setMinimized(true)
      } else if (k === 'm') ctx.toggleMic()
      else if (k === 'v') ctx.toggleCam()
      else if (k === 'h') ctx.toggleHand()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])
  if (!ctx?.call) return null
  const { call, meta, minimized } = ctx

  const title = meta?.title ?? 'Call'
  const timer = <CallTimer since={call.connectedAt} />
  const connecting = call.status === 'connecting'
  const alone = call.status === 'live' && call.peers.length === 0
  const declinedNames = call.declined.map((id) => meta?.members.find((m) => m.id === id)?.name).filter(Boolean) as string[]
  const waitingText = connecting ? 'Connecting…' : meta?.isDirect ? (call.hadPeers ? 'Call ended' : `Calling ${title}…`) : call.invited.length ? 'Calling…' : 'Waiting for others to join…'
  const fxSupported = effectsSupportedOnce()
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
  const sharer = call.peers.find((p) => p.screen && hasVideo(p.stream))
  const myName = meta?.members.find((m) => m.id === ctx.meId)?.name ?? 'You'
  const meTile: Tile = { key: 'me', id: ctx.meId, name: 'You', avatarName: myName, stream: call.localStream, mic: call.mic, hand: call.hand, showVideo: (call.cam || call.screen) && hasVideo(call.localStream), mirror: call.cam && !call.screen, local: true, state: 'connected' }
  const peerTiles: Tile[] = call.peers.map((p) => ({ key: p.userId, id: p.userId, name: p.name, stream: p.stream, mic: p.mic, hand: p.hand, showVideo: (p.cam || p.screen) && hasVideo(p.stream), mirror: false, local: false, state: p.state, screen: p.screen, stuck: p.stuck, speaking: speaking.has(p.userId) }))
  meTile.speaking = speaking.has(ctx.meId)
  const stuckNames = call.peers.filter((p) => p.stuck).map((p) => p.name)
  const err = call.error && call.error !== dismissErr ? call.error : null
  const recordingBy = [...(call.rec ? ['You'] : []), ...call.peers.filter((p) => p.rec).map((p) => p.name)]
  const recBusy = ctx.recState === 'starting' || ctx.recState === 'saving'
  const handsUp = call.peers.filter((p) => p.hand).length + (call.hand ? 1 : 0)
  const togglePanel = (p: CallPanel) => ctx.setPanel(ctx.panel === p ? null : p)
  const allTiles = [...peerTiles, meTile]
  // Big view: the pinned person if still here, else whoever shares their screen.
  const focus = (pinned ? allTiles.find((t) => t.id === pinned) : undefined) ?? (sharer ? peerTiles.find((t) => t.id === sharer.userId) : undefined)
  const togglePin = (id: string) => setPinned((p) => (p === id ? null : id))
  const pinnable = allTiles.length > 1

  const badges = (
    <>
      {recordingBy.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Rec</span>}
      {call.noteTaker && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white"><Sparkles size={11} /> AI notes</span>}
    </>
  )

  return (
    <>
      {/* Remote audio always plays, whether the window is big or small. */}
      {call.peers.map((p) => <PeerAudio key={p.userId} stream={p.stream} />)}
      <style>{'@keyframes pt-float-up{0%{transform:translateY(0) scale(.6);opacity:0}12%{transform:translateY(-20px) scale(1.1);opacity:1}100%{transform:translateY(-260px) scale(1);opacity:0}}'}</style>

      {minimized ? (
        <div className="fixed bottom-4 left-4 z-[60] w-[min(300px,calc(100vw-2rem))] animate-scale-in overflow-hidden rounded-card bg-slate-900 text-white shadow-overlay" role="dialog" aria-label={`Call with ${title}`}>
          <button type="button" onClick={() => ctx.setMinimized(false)} className="block w-full text-left" title="Open the call">
            <div className="relative aspect-video bg-slate-800">
              <TileView tile={sharer ? peerTiles.find((t) => t.id === sharer.userId)! : peerTiles[0] ?? meTile} compact />
              <span className="absolute right-2 top-2 rounded bg-black/50 p-1"><Maximize2 size={14} /></span>
              <span className="absolute left-2 top-2 flex gap-1">{badges}</span>
            </div>
          </button>
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold">{title}</p>
              <p className="text-[11px] text-slate-300">{alone || connecting ? waitingText : <>{timer} · {call.peers.length + 1} in call</>}</p>
            </div>
            <CtrlButton small on={call.mic} onClick={ctx.toggleMic} label={call.mic ? 'Mute microphone' : 'Unmute microphone'} icon={call.mic ? <Mic size={16} /> : <MicOff size={16} />} />
            <LeaveButton small onClick={ctx.leave} />
          </div>
        </div>
      ) : (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label={`Call with ${title}`}>
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-body-lg font-semibold">{title} {badges}</p>
              <p className="flex items-center gap-2 text-body-sm text-slate-300">
                {call.video ? <Video size={13} /> : <Mic size={13} />}
                {alone || connecting ? waitingText : timer}
                <span className="inline-flex items-center gap-1"><Users size={13} /> {call.peers.length + 1}</span>
                {handsUp > 0 && <span className="inline-flex items-center gap-1 text-amber-300"><Hand size={13} /> {handsUp}</span>}
                {call.guest && <span className="rounded bg-white/10 px-1.5 text-[11px]">Guest</span>}
              </p>
            </div>
            <button type="button" onClick={() => ctx.setMinimized(true)} className="inline-flex items-center gap-1.5 rounded-btn px-3 py-2 text-body-sm text-slate-200 hover:bg-white/10" title="Keep working while the call continues (Esc)">
              <Minimize2 size={16} /> <span className="hidden sm:inline">Minimise</span>
            </button>
          </div>

          {stuckNames.length > 0 && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-btn bg-danger/20 px-3 py-2 text-body-sm text-red-100">
              <WifiOff size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>{stuckNames.join(', ')}</b> {stuckNames.length === 1 ? 'cannot' : 'cannot'} connect yet. {call.relay
                  ? 'Still trying another route. If it stays like this, ask them to leave and join again.'
                  : 'Their internet does not allow a direct call. The admin needs to switch on the call relay on the server (free, a few minutes).'}
              </span>
            </div>
          )}
          {err && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-btn bg-warning/20 px-3 py-2 text-body-sm text-amber-100">
              <span className="flex-1">{err}</span>
              <button type="button" onClick={() => setDismissErr(call.error)} aria-label="Dismiss"><X size={15} /></button>
            </div>
          )}

          {/* Stage + side panel */}
          <div className="flex min-h-0 flex-1 gap-3 px-4 pb-2">
            <div className="relative min-h-0 min-w-0 flex-1">
              {connecting ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300"><Loader2 size={28} className="animate-spin" /> Allow the microphone{call.video ? ' and camera' : ''} if your browser asks.</div>
              ) : alone ? (
                <div className="flex h-full flex-col items-center justify-center gap-4">
                  <div className="aspect-video w-full max-w-xl overflow-hidden rounded-card bg-slate-800"><TileView tile={meTile} /></div>
                  <p className="text-body-md text-slate-300">{waitingText}</p>
                  {declinedNames.length > 0 && !meta?.isDirect && <p className="text-body-sm text-slate-400">{declinedNames.join(', ')} declined</p>}
                  <button type="button" onClick={() => ctx.setPanel('people')} className="inline-flex items-center gap-1.5 rounded-btn bg-white/10 px-3 py-1.5 text-body-sm font-semibold hover:bg-white/20"><UserPlus size={15} /> Add people</button>
                </div>
              ) : focus ? (
                <div className="flex h-full flex-col gap-2">
                  <div className="min-h-0 flex-1 animate-fade-in overflow-hidden rounded-card bg-slate-800"><TileView key={focus.key} tile={focus} contain={focus.screen} pin={pinnable ? { on: pinned === focus.id, toggle: () => togglePin(focus.id) } : undefined} /></div>
                  <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
                    {allTiles.filter((t) => t.id !== focus.id).map((t) => <div key={t.key} className="aspect-video h-full shrink-0 overflow-hidden rounded-card bg-slate-800"><TileView tile={t} compact pin={{ on: false, toggle: () => togglePin(t.id) }} /></div>)}
                  </div>
                </div>
              ) : (
                <div className={cn('grid h-full gap-2', gridFor(allTiles.length))}>
                  {allTiles.map((t) => <div key={t.key} className="min-h-0 overflow-hidden rounded-card bg-slate-800 transition-shadow"><TileView tile={t} pin={pinnable ? { on: false, toggle: () => togglePin(t.id) } : undefined} /></div>)}
                </div>
              )}

              {/* Live captions */}
              {ctx.captionsOn && call.noteTaker && call.captions.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 px-6">
                  {call.captions.slice(-3).map((c) => (
                    <p key={c.id} className="max-w-3xl rounded bg-black/75 px-3 py-1 text-center text-body-md leading-snug">
                      <b className="text-sky-300">{c.userId === ctx.meId ? 'You' : c.name}:</b> <span dir="auto">{c.text}</span>
                    </p>
                  ))}
                </div>
              )}

              {/* Floating reactions */}
              <div className="pointer-events-none absolute bottom-12 left-6 h-0 w-40">
                {ctx.reactions.map((r, i) => (
                  <div key={r.at} className="absolute bottom-0 flex flex-col items-center" style={{ left: (i * 37) % 120, animation: 'pt-float-up 3.4s ease-out forwards' }}>
                    <span className="text-4xl">{r.emoji}</span>
                    <span className="rounded bg-black/60 px-1.5 text-[11px]">{r.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {ctx.panel && (
              <aside className="flex w-[min(360px,40vw)] shrink-0 flex-col overflow-hidden rounded-card bg-card text-ink">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <span className="flex-1 text-body-md font-semibold">{ctx.panel === 'people' ? 'People' : ctx.panel === 'chat' ? 'Meeting chat' : ctx.panel === 'effects' ? 'Backgrounds and filters' : 'AI notes'}</span>
                  <button type="button" onClick={() => ctx.setPanel(null)} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Close panel"><X size={16} /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {ctx.panel === 'people' && <PeoplePanel />}
                  {ctx.panel === 'chat' && (call.guest
                    ? <p className="p-4 text-body-sm text-ink-muted">You were added to this call, so its chat is private to the people in that conversation.</p>
                    : <ChatThread conversationId={call.conversationId} meId={ctx.meId} compact hideCallButtons />)}
                  {ctx.panel === 'notes' && <NotesPanel />}
                  {ctx.panel === 'effects' && <EffectsPanel meTile={meTile} />}
                </div>
              </aside>
            )}
          </div>

          {/* Controls */}
          <div className="relative flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-5 pt-2 sm:gap-3">
            <CtrlButton on={call.mic} onClick={ctx.toggleMic} label={call.mic ? 'Mute microphone (M)' : 'Unmute microphone (M)'} icon={call.mic ? <Mic size={20} /> : <MicOff size={20} />} />
            <CtrlButton on={call.cam} onClick={ctx.toggleCam} label={call.cam ? 'Turn camera off (V)' : 'Turn camera on (V)'} icon={call.cam ? <Video size={20} /> : <VideoOff size={20} />} />
            {fxSupported && <CtrlButton on active={ctx.panel === 'effects' || effectsOn(call.effects)} onClick={() => { preloadEffects(); togglePanel('effects') }} label="Backgrounds and filters" icon={<WandSparkles size={20} />} />}
            {canShare && <CtrlButton on={!call.screen} active={call.screen} onClick={ctx.toggleScreen} label={call.screen ? 'Stop sharing your screen' : 'Share your screen'} icon={call.screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />} />}
            <CtrlButton on active={call.hand} onClick={ctx.toggleHand} label={call.hand ? 'Lower your hand (H)' : 'Raise your hand (H)'} icon={<Hand size={20} />} />
            <div className="relative">
              <CtrlButton on onClick={() => setReactOpen((v) => !v)} label="React" icon={<Smile size={20} />} />
              {reactOpen && (
                <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-full bg-slate-800 p-1.5 shadow-overlay">
                  {REACTIONS.map((e) => <button key={e} type="button" onClick={() => { ctx.react(e); setReactOpen(false) }} className="rounded-full p-1.5 text-2xl transition-transform hover:scale-125 hover:bg-white/10" aria-label={`React ${e}`}>{e}</button>)}
                </div>
              )}
            </div>
            {recordingSupported() && (
              <CtrlButton
                on
                active={call.rec}
                danger={call.rec}
                disabled={recBusy}
                onClick={() => (call.rec ? ctx.stopRecording() : ctx.startRecording())}
                label={ctx.recState === 'saving' ? 'Saving the recording…' : call.rec ? 'Stop recording' : 'Record this call'}
                icon={recBusy ? <Loader2 size={20} className="animate-spin" /> : call.rec ? <Square size={18} /> : <CircleDot size={20} />}
              />
            )}
            <span className="mx-1 hidden h-8 w-px bg-white/15 sm:block" />
            <CtrlButton on active={ctx.panel === 'people'} onClick={() => togglePanel('people')} label="People and add people" icon={<Users size={20} />} badge={call.invited.length || undefined} />
            <CtrlButton on active={ctx.panel === 'chat'} onClick={() => togglePanel('chat')} label="Meeting chat" icon={<MessageSquare size={20} />} />
            <CtrlButton on active={ctx.panel === 'notes' || call.noteTaker} onClick={() => togglePanel('notes')} label="AI note taker" icon={<Sparkles size={20} />} />
            {call.noteTaker && <CtrlButton on active={ctx.captionsOn} onClick={() => ctx.setCaptionsOn(!ctx.captionsOn)} label={ctx.captionsOn ? 'Hide live captions' : 'Show live captions'} icon={<Captions size={20} />} />}
            <span className="mx-1 hidden h-8 w-px bg-white/15 sm:block" />
            <LeaveButton onClick={ctx.leave} />
          </div>
        </div>
      )}
    </>
  )
}

// ---------- side panels ----------

let fxSupportedCache: boolean | null = null
function effectsSupportedOnce(): boolean {
  if (fxSupportedCache === null) fxSupportedCache = effectsSupported()
  return fxSupportedCache
}

/** Pick a background (blur or a picture) and a colour filter, with a live preview of yourself. */
function EffectsPanel({ meTile }: { meTile: Tile }) {
  const ctx = useCalls()!
  const call = ctx.call!
  const s = call.effects
  const set = (next: EffectsSettings) => ctx.setEffects(next)
  const loading = call.effectsState === 'loading'
  const sameBg = (b: EffectsSettings['bg']) => JSON.stringify(b) === JSON.stringify(s.bg)
  const tile = (key: string, active: boolean, onClick: () => void, label: string, body: React.ReactNode) => (
    <button key={key} type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active} className={cn('group relative aspect-video overflow-hidden rounded-btn border-2 transition-all hover:scale-[1.03]', active ? 'border-primary shadow-card' : 'border-transparent hover:border-line')}>
      {body}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-0.5 pt-3 text-left text-[10px] font-semibold text-white">{label}</span>
    </button>
  )
  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      <div className="relative aspect-video overflow-hidden rounded-card bg-slate-800">
        {call.cam ? <TileView tile={{ ...meTile, name: 'Preview', hand: false, speaking: false }} compact /> : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
            <VideoOff size={22} className="text-slate-300" />
            <p className="text-body-sm text-slate-200">Your camera is off</p>
            <button type="button" onClick={ctx.toggleCam} className="rounded-btn bg-white/15 px-3 py-1 text-body-sm font-semibold hover:bg-white/25">Turn camera on</button>
          </div>
        )}
        {loading && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white"><Loader2 size={11} className="animate-spin" /> Getting it ready…</span>}
      </div>

      <section>
        <h4 className="mb-1.5 text-body-sm font-semibold text-ink">Background</h4>
        <div className="grid grid-cols-3 gap-2">
          {tile('none', s.bg.kind === 'none', () => set({ ...s, bg: { kind: 'none' } }), 'None', <span className="flex h-full w-full items-center justify-center bg-slate-100 text-ink-muted"><Ban size={20} /></span>)}
          {tile('blur-light', sameBg({ kind: 'blur', strength: 'light' }), () => set({ ...s, bg: { kind: 'blur', strength: 'light' } }), 'Slight blur', <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-200 to-indigo-200 text-indigo-700"><Droplets size={18} /></span>)}
          {tile('blur-strong', sameBg({ kind: 'blur', strength: 'strong' }), () => set({ ...s, bg: { kind: 'blur', strength: 'strong' } }), 'Blur', <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-300 to-violet-400 text-white"><Droplets size={22} /></span>)}
          {BACKGROUNDS.map((b) => tile(b.id, sameBg({ kind: 'image', id: b.id }), () => set({ ...s, bg: { kind: 'image', id: b.id } }), b.name, <img src={bgThumb(b.id)} alt="" loading="lazy" className="h-full w-full object-cover" />))}
        </div>
      </section>

      <section>
        <h4 className="mb-1.5 text-body-sm font-semibold text-ink">Filter</h4>
        <div className="grid grid-cols-4 gap-2">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => set({ ...s, filter: f.id })} aria-pressed={s.filter === f.id} className={cn('flex flex-col items-center gap-1 rounded-btn border-2 p-1 transition-all hover:scale-[1.04]', s.filter === f.id ? 'border-primary bg-primary/5' : 'border-transparent hover:border-line')}>
              <span className="block aspect-square w-full overflow-hidden rounded-full bg-cover bg-center" style={{ backgroundImage: `url(${bgThumb('lounge')})`, filter: f.css || undefined }} />
              <span className="text-center text-[10px] font-semibold leading-tight text-ink">{f.name}</span>
            </button>
          ))}
        </div>
      </section>
      <p className="text-[11px] leading-snug text-ink-muted">Everyone in the call sees it, and it stays on for your next calls. It all happens on your computer: your camera is not sent anywhere else.</p>
    </div>
  )
}

let usersCache: ChatUser[] | null = null

function PeoplePanel() {
  const ctx = useCalls()!
  const call = ctx.call!
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<ChatUser[]>(usersCache ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!usersCache) chatApi.users().then((r) => { usersCache = r.users; setUsers(r.users) }).catch(() => undefined) }, [])
  const inCall = new Set([ctx.meId, ...call.peers.map((p) => p.userId)])
  const ringing = new Set(call.invited)
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    return users.filter((u) => !inCall.has(u.id) && (!t || u.name.toLowerCase().includes(t) || (u.department ?? '').toLowerCase().includes(t))).slice(0, 30)
  }, [q, users, call.peers.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? 'Someone'
  const people = [
    { id: ctx.meId, name: 'You', mic: call.mic, hand: call.hand, rec: call.rec },
    ...call.peers.map((p) => ({ id: p.userId, name: p.name, mic: p.mic, hand: p.hand, rec: p.rec })),
  ].sort((a, b) => Number(b.hand) - Number(a.hand))

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">In this call ({people.length})</p>
          {call.peers.some((p) => p.mic) && <button type="button" onClick={() => ctx.muteOthers('*')} className="inline-flex items-center gap-1 rounded-btn border border-line px-2 py-0.5 text-[12px] font-semibold text-ink hover:bg-slate-50"><MicOff size={12} /> Mute everyone else</button>}
        </div>
        <ul className="space-y-1.5">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-body-sm">
              <PersonAvatar person={{ id: p.id, name: p.id === ctx.meId ? (ctx.meta?.members.find((m) => m.id === ctx.meId)?.name ?? 'You') : p.name }} size={26} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {p.hand && <Hand size={14} className="text-amber-500" aria-label="Hand raised" />}
              {p.rec && <CircleDot size={14} className="text-danger" aria-label="Recording" />}
              {p.id !== ctx.meId && p.mic
                ? <button type="button" onClick={() => ctx.muteOthers(p.id)} className="inline-flex items-center gap-1 rounded-btn px-1.5 py-0.5 text-[12px] text-ink-muted hover:bg-slate-100 hover:text-danger" title={`Mute ${p.name}`}><Mic size={14} /> Mute</button>
                : p.mic ? <Mic size={14} className="text-ink-muted" /> : <MicOff size={14} className="text-danger" />}
            </li>
          ))}
          {[...ringing].map((id) => (
            <li key={id} className="flex items-center gap-2 text-body-sm text-ink-muted">
              <PersonAvatar person={{ id, name: name(id) }} size={26} />
              <span className="min-w-0 flex-1 truncate">{name(id)}</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><Loader2 size={11} className="animate-spin" /> Ringing</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {call.meetingId && (
          <button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/app/meetings/${call.meetingId}`).then(() => setCopied(true)) }} className="mb-3 inline-flex items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50">
            <Link2 size={14} /> {copied ? 'Link copied' : 'Copy meeting link'}
          </button>
        )}
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"><UserPlus size={13} /> Add people</p>
        <label className="mb-2 flex items-center gap-2 rounded-btn border border-line px-2 py-1.5 focus-within:border-primary">
          <Search size={14} className="text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or team" className="min-w-0 flex-1 bg-transparent text-body-sm focus:outline-none" aria-label="Search people to add" />
        </label>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {matches.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                disabled={busy === u.id || ringing.has(u.id)}
                onClick={async () => { setBusy(u.id); await ctx.invite([u.id]); setBusy(null) }}
                className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-body-sm hover:bg-slate-50 disabled:opacity-60"
              >
                <PersonAvatar person={u} size={26} presence={u.presence} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{u.name}</span>{u.department && <span className="block truncate text-[11px] text-ink-muted">{u.department}</span>}</span>
                <span className="shrink-0 text-[12px] font-semibold text-primary">{ringing.has(u.id) ? 'Ringing' : busy === u.id ? '…' : 'Call'}</span>
              </button>
            </li>
          ))}
          {!matches.length && <li className="py-6 text-center text-body-sm text-ink-muted">No one found</li>}
        </ul>
      </div>
    </div>
  )
}

function NotesPanel() {
  const ctx = useCalls()!
  const call = ctx.call!
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<{ id: number; name: string; text: string }[]>([])
  // Keep the finished sentences we have seen as a running transcript.
  useEffect(() => {
    const fin = call.captions.filter((c) => c.final)
    if (!fin.length) return
    setLines((cur) => {
      const seen = new Set(cur.map((l) => l.id))
      const add = fin.filter((c) => !seen.has(c.id)).map((c) => ({ id: c.id, name: c.userId === ctx.meId ? 'You' : c.name, text: c.text }))
      return add.length ? [...cur, ...add].slice(-200) : cur
    })
  }, [call.captions, ctx.meId])
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [lines.length])
  const toggle = async (on: boolean) => { setBusy(true); await ctx.setNoteTaker(on); setBusy(false) }

  return (
    <div className="flex h-full flex-col p-3 text-body-sm">
      {!call.noteTaker ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-ink"><Sparkles size={16} className="mt-0.5 shrink-0 text-primary" /> The AI note taker writes down what everyone says. When you stop it or the call ends, you get a summary, decisions and action items in the chat.</p>
          <p className="text-ink-muted">Everyone in the call sees that notes are on. {call.sttMode === 'server' ? "Everyone's voice is written down with their name, in Roman Urdu (English stays English). The notes come in Roman Urdu; you can switch them to English or Urdu." : "Each person's own browser turns their voice into text (works in Chrome and Edge)."}</p>
          <LangPicker />
          <button type="button" disabled={busy} onClick={() => void toggle(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-3 py-2 font-semibold text-white hover:bg-primary/90 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Start AI notes
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 space-y-2">
            <p className="flex items-center gap-2 font-semibold text-primary"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> AI notes are on</p>
            <TranscriberStatus />
            <LangPicker />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-btn bg-slate-50 p-2">
            {lines.length === 0 && <p className="py-6 text-center text-ink-muted">Listening… speech appears here.</p>}
            {lines.map((l) => <p key={l.id}><b className="text-primary">{l.name}:</b> <span dir="auto">{l.text}</span></p>)}
            <div ref={endRef} />
          </div>
          <button type="button" disabled={busy} onClick={() => void toggle(false)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-btn border border-line px-3 py-2 font-semibold text-ink hover:bg-slate-50 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} />} Stop and write the notes
          </button>
        </>
      )}
    </div>
  )
}

function TranscriberStatus() {
  const ctx = useCalls()!
  const call = ctx.call!
  if (!call.mic) return <p className="text-ink-muted">Your microphone is muted, so nothing of yours is being written down.</p>
  if (call.sttMode === 'server') return <p className="text-ink-muted">Your speech is being written down. Lines appear here a few seconds after you finish a sentence.</p>
  if (!speechSupported()) return <p className="rounded-btn bg-warning/15 px-2 py-1.5 text-amber-800">Your browser cannot turn speech into text, so your words are not in the notes. Use Chrome or Edge.</p>
  if (ctx.transcriber === 'blocked') return <p className="rounded-btn bg-danger/10 px-2 py-1.5 text-danger">Speech-to-text was blocked. Allow the microphone for this site and try again.</p>
  if (ctx.transcriber === 'error') return <p className="text-amber-700">Speech-to-text hiccupped; it keeps retrying.</p>
  return <p className="text-ink-muted">Your speech is being written down.</p>
}

function LangPicker() {
  const ctx = useCalls()!
  return (
    <label className="flex flex-col gap-1 text-ink-muted">
      I speak
      <select value={ctx.speechLang} onChange={(e) => ctx.setSpeechLang(e.target.value)} className="w-full rounded-btn border border-line bg-card px-2 py-1 text-ink">
        {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  )
}

// ---------- tiles ----------

interface Tile { avatarName?: string; key: string; id: string; name: string; stream: MediaStream; mic: boolean; hand: boolean; showVideo: boolean; mirror: boolean; local: boolean; state: PeerView['state']; screen?: boolean; stuck?: boolean; speaking?: boolean }

function TileView({ tile, compact, contain, pin }: { tile: Tile; compact?: boolean; contain?: boolean; pin?: { on: boolean; toggle: () => void } }) {
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
    <div
      className={cn('group relative flex h-full w-full items-center justify-center', pin && 'cursor-pointer', tile.hand ? 'ring-4 ring-inset ring-amber-400' : tile.speaking && 'ring-4 ring-inset ring-success')}
      onClick={pin?.toggle}
      title={pin ? (pin.on ? 'Click to unpin' : `Click to show ${tile.name} big`) : undefined}
    >
      {/* Video is always muted here; sound comes from the hidden <audio> per person. */}
      <video ref={ref} autoPlay playsInline muted className={cn('h-full w-full', contain || tile.screen ? 'object-contain' : 'object-cover', tile.mirror && '-scale-x-100', !tile.showVideo && 'hidden')} />
      {!tile.showVideo && <PersonAvatar person={{ id: tile.id, name: tile.avatarName ?? tile.name }} size={compact ? 44 : 84} />}
      <span className={cn('absolute bottom-2 left-2 inline-flex max-w-[85%] items-center gap-1 rounded bg-black/55 px-2 py-0.5 font-medium', compact ? 'text-[11px]' : 'text-body-sm')}>
        {!tile.mic && <MicOff size={compact ? 11 : 13} className="shrink-0 text-danger" />}
        <span className="truncate">{tile.name}{tile.screen ? ' (sharing screen)' : ''}</span>
      </span>
      {tile.hand && <span className="absolute left-2 top-2 rounded-full bg-amber-400 p-1.5 text-slate-900" aria-label="Hand raised"><Hand size={compact ? 12 : 16} /></span>}
      {connecting && !tile.stuck && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-black/55 px-2 py-0.5 text-[11px]"><Loader2 size={11} className="animate-spin" /> {tile.state === 'failed' ? 'Reconnecting…' : 'Connecting…'}</span>}
      {pin && !connecting && !tile.stuck && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); pin.toggle() }}
          className={cn('absolute right-2 top-2 rounded-full bg-black/55 p-1.5 transition-opacity hover:bg-black/75 focus-visible:opacity-100', pin.on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
          aria-label={pin.on ? `Unpin ${tile.name}` : `Pin ${tile.name}`}
        >
          {pin.on ? <PinOff size={compact ? 12 : 15} /> : <Pin size={compact ? 12 : 15} />}
        </button>
      )}
      {tile.stuck && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-danger/90 px-2 py-0.5 text-[11px] font-semibold"><WifiOff size={11} /> Can't connect</span>}
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
    // Joined from a notification (no click on the page yet): the browser may block sound
    // until the first tap or key press, so try again then.
    el.play().catch(() => {
      const retry = () => { void el.play().catch(() => undefined) }
      document.addEventListener('pointerdown', retry, { once: true })
      document.addEventListener('keydown', retry, { once: true })
    })
  }, [stream, n])
  return <audio ref={ref} autoPlay className="hidden" />
}

function CtrlButton({ on, active, danger, disabled, onClick, label, icon, small, badge }: { on: boolean; active?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; label: string; icon: React.ReactNode; small?: boolean; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active ?? !on}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:opacity-60',
        small ? 'h-9 w-9' : 'h-12 w-12',
        danger ? 'bg-danger text-white hover:bg-danger/90' : active ? 'bg-primary text-white' : on ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-slate-900 hover:bg-slate-200',
      )}
    >
      {icon}
      {badge ? <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-amber-400 px-1 text-[11px] font-bold leading-[18px] text-slate-900">{badge}</span> : null}
    </button>
  )
}

function LeaveButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center justify-center gap-2 rounded-full bg-danger font-semibold text-white hover:bg-danger/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-danger/40', small ? 'h-9 w-9' : 'h-12 px-5')} aria-label="Leave call" title="Leave call">
      <PhoneOff size={small ? 16 : 20} />{!small && <span className="hidden sm:inline">Leave</span>}
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
  if (n <= 6) return 'grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2'
  return 'grid-cols-3 grid-rows-3'
}

/** The running call time. Its own little component, so only this text redraws every second. */
function CallTimer({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  return <>{fmtTimer(now - (since ?? now))}</>
}

function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Who is talking right now (green outline), from the sound level of each person. */
function useSpeaking(list: { id: string; stream: MediaStream; on: boolean }[]): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  const ctxRef = useRef<AudioContext | null>(null)
  const nodes = useRef(new Map<string, { trackId: string; analyser: AnalyserNode; src: MediaStreamAudioSourceNode; level: number }>())
  const listRef = useRef(list)
  listRef.current = list
  const key = list.map((x) => `${x.id}:${x.stream.getAudioTracks()[0]?.id ?? ''}`).join('|')
  useEffect(() => {
    if (!ctxRef.current) {
      try { ctxRef.current = new AudioContext() } catch { return }
    }
    const ac = ctxRef.current
    const wanted = new Set<string>()
    for (const x of listRef.current) {
      const t = x.stream.getAudioTracks()[0]
      if (!t) continue
      wanted.add(x.id)
      const have = nodes.current.get(x.id)
      if (have?.trackId === t.id) continue
      have?.src.disconnect()
      const src = ac.createMediaStreamSource(new MediaStream([t]))
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      nodes.current.set(x.id, { trackId: t.id, analyser, src, level: 0 })
    }
    for (const [id, n] of nodes.current) if (!wanted.has(id)) { n.src.disconnect(); nodes.current.delete(id) }
  }, [key])
  useEffect(() => {
    const buf = new Float32Array(512)
    const t = window.setInterval(() => {
      void ctxRef.current?.resume().catch(() => undefined)
      const next = new Set<string>()
      for (const x of listRef.current) {
        const n = nodes.current.get(x.id)
        if (!n || !x.on) continue
        n.analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        // Smooth it so the outline does not flicker between words.
        n.level = Math.max(Math.sqrt(sum / buf.length), n.level * 0.8)
        if (n.level > 0.03) next.add(x.id)
      }
      setSpeaking((cur) => (cur.size === next.size && [...next].every((id) => cur.has(id)) ? cur : next))
    }, 200)
    return () => {
      window.clearInterval(t)
    }
  }, [])
  useEffect(() => () => { void ctxRef.current?.close().catch(() => undefined) }, [])
  return speaking
}

