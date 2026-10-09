import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions, CircleDot, Hand, Link2, Loader2, Maximize2, MessageSquare, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, PhoneOff, Search,
  Smile, Sparkles, Square, UserPlus, Users, Video, VideoOff, X,
} from 'lucide-react'
import type { PeerView } from '../../lib/callEngine'
import { chatApi, type ChatUser } from '../../lib/chatApi'
import { recordingSupported } from '../../lib/callRecorder'
import { SPEECH_LANGS, speechSupported } from '../../lib/transcriber'
import { PersonAvatar } from '../projects/pmUi'
import { ChatThread } from '../chat/ChatThread'
import { cn } from '../../lib/cn'
import { useCalls, type CallPanel } from './CallProvider'

const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🙏']

/** The call itself: a full-screen meeting view, or a small floating card while you keep working. */
export function CallWindow() {
  const ctx = useCalls()
  const [now, setNow] = useState(Date.now())
  const [dismissErr, setDismissErr] = useState<string | null>(null)
  const [reactOpen, setReactOpen] = useState(false)
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  // Esc closes a side panel, then shrinks the meeting to the corner (never hangs up).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ctx || ctx.minimized) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (ctx.panel) ctx.setPanel(null)
      else ctx.setMinimized(true)
    }
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
  const waitingText = connecting ? 'Connecting…' : meta?.isDirect ? (call.hadPeers ? 'Call ended' : `Calling ${title}…`) : call.invited.length ? 'Calling…' : 'Waiting for others to join…'
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
  const sharer = call.peers.find((p) => p.screen && hasVideo(p.stream))
  const myName = meta?.members.find((m) => m.id === ctx.meId)?.name ?? 'You'
  const meTile: Tile = { key: 'me', id: ctx.meId, name: 'You', avatarName: myName, stream: call.localStream, mic: call.mic, hand: call.hand, showVideo: (call.cam || call.screen) && hasVideo(call.localStream), mirror: call.cam && !call.screen, local: true, state: 'connected' }
  const peerTiles: Tile[] = call.peers.map((p) => ({ key: p.userId, id: p.userId, name: p.name, stream: p.stream, mic: p.mic, hand: p.hand, showVideo: (p.cam || p.screen) && hasVideo(p.stream), mirror: false, local: false, state: p.state, screen: p.screen }))
  const err = call.error && call.error !== dismissErr ? call.error : null
  const recordingBy = [...(call.rec ? ['You'] : []), ...call.peers.filter((p) => p.rec).map((p) => p.name)]
  const recBusy = ctx.recState === 'starting' || ctx.recState === 'saving'
  const handsUp = call.peers.filter((p) => p.hand).length + (call.hand ? 1 : 0)
  const togglePanel = (p: CallPanel) => ctx.setPanel(ctx.panel === p ? null : p)

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
              <p className="text-[11px] text-slate-300">{alone || connecting ? waitingText : `${timer} · ${call.peers.length + 1} in call`}</p>
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

              {/* Live captions */}
              {ctx.captionsOn && call.noteTaker && call.captions.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 px-6">
                  {call.captions.slice(-3).map((c) => (
                    <p key={c.id} className="max-w-3xl rounded bg-black/75 px-3 py-1 text-center text-body-md leading-snug">
                      <b className="text-sky-300">{c.userId === ctx.meId ? 'You' : c.name}:</b> {c.text}
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
                  <span className="flex-1 text-body-md font-semibold">{ctx.panel === 'people' ? 'People' : ctx.panel === 'chat' ? 'Meeting chat' : 'AI notes'}</span>
                  <button type="button" onClick={() => ctx.setPanel(null)} className="rounded p-1 text-ink-muted hover:bg-slate-100" aria-label="Close panel"><X size={16} /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {ctx.panel === 'people' && <PeoplePanel />}
                  {ctx.panel === 'chat' && (call.guest
                    ? <p className="p-4 text-body-sm text-ink-muted">You were added to this call, so its chat is private to the people in that conversation.</p>
                    : <ChatThread conversationId={call.conversationId} meId={ctx.meId} compact hideCallButtons />)}
                  {ctx.panel === 'notes' && <NotesPanel />}
                </div>
              </aside>
            )}
          </div>

          {/* Controls */}
          <div className="relative flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-5 pt-2 sm:gap-3">
            <CtrlButton on={call.mic} onClick={ctx.toggleMic} label={call.mic ? 'Mute microphone' : 'Unmute microphone'} icon={call.mic ? <Mic size={20} /> : <MicOff size={20} />} />
            <CtrlButton on={call.cam} onClick={ctx.toggleCam} label={call.cam ? 'Turn camera off' : 'Turn camera on'} icon={call.cam ? <Video size={20} /> : <VideoOff size={20} />} />
            {canShare && <CtrlButton on={!call.screen} active={call.screen} onClick={ctx.toggleScreen} label={call.screen ? 'Stop sharing your screen' : 'Share your screen'} icon={call.screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />} />}
            <CtrlButton on active={call.hand} onClick={ctx.toggleHand} label={call.hand ? 'Lower your hand' : 'Raise your hand'} icon={<Hand size={20} />} />
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
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">In this call ({people.length})</p>
        <ul className="space-y-1.5">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-body-sm">
              <PersonAvatar person={{ id: p.id, name: p.id === ctx.meId ? (ctx.meta?.members.find((m) => m.id === ctx.meId)?.name ?? 'You') : p.name }} size={26} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {p.hand && <Hand size={14} className="text-amber-500" aria-label="Hand raised" />}
              {p.rec && <CircleDot size={14} className="text-danger" aria-label="Recording" />}
              {p.mic ? <Mic size={14} className="text-ink-muted" /> : <MicOff size={14} className="text-danger" />}
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
          <p className="text-ink-muted">Everyone in the call sees that notes are on. {call.sttMode === 'server' ? "Each person's microphone is turned into text with their name, and Urdu or mixed speech is written in English." : "Each person's own browser turns their voice into text (works in Chrome and Edge)."}</p>
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
            {lines.map((l) => <p key={l.id}><b className="text-primary">{l.name}:</b> {l.text}</p>)}
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

interface Tile { avatarName?: string; key: string; id: string; name: string; stream: MediaStream; mic: boolean; hand: boolean; showVideo: boolean; mirror: boolean; local: boolean; state: PeerView['state']; screen?: boolean }

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
    <div className={cn('relative flex h-full w-full items-center justify-center', tile.hand && 'ring-4 ring-inset ring-amber-400')}>
      {/* Video is always muted here; sound comes from the hidden <audio> per person. */}
      <video ref={ref} autoPlay playsInline muted className={cn('h-full w-full', contain || tile.screen ? 'object-contain' : 'object-cover', tile.mirror && '-scale-x-100', !tile.showVideo && 'hidden')} />
      {!tile.showVideo && <PersonAvatar person={{ id: tile.id, name: tile.avatarName ?? tile.name }} size={compact ? 44 : 84} />}
      <span className={cn('absolute bottom-2 left-2 inline-flex max-w-[85%] items-center gap-1 rounded bg-black/55 px-2 py-0.5 font-medium', compact ? 'text-[11px]' : 'text-body-sm')}>
        {!tile.mic && <MicOff size={compact ? 11 : 13} className="shrink-0 text-danger" />}
        <span className="truncate">{tile.name}{tile.screen ? ' (sharing screen)' : ''}</span>
      </span>
      {tile.hand && <span className="absolute left-2 top-2 rounded-full bg-amber-400 p-1.5 text-slate-900" aria-label="Hand raised"><Hand size={compact ? 12 : 16} /></span>}
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

function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
