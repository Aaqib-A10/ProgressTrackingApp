import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { callsApi, leaveOnUnload, type ActiveCall } from '../../lib/callsApi'
import { CallEngine, type CallSnapshot, type Reaction } from '../../lib/callEngine'
import { CallRecorder, type RecorderState } from '../../lib/callRecorder'
import { Transcriber, getSpeechLang, setSpeechLang as saveSpeechLang, type TranscriberState } from '../../lib/transcriber'
import { chatApi } from '../../lib/chatApi'
import { errMsg } from '../../lib/projectsApi'
import * as desktop from '../../lib/desktopAlerts'
import { useToast } from '../ui/Toast'
import { CallWindow } from './CallWindow'
import { IncomingCalls } from './IncomingCalls'

/**
 * Voice / video calls for the whole app: keeps the one call this tab is in, watches
 * for calls starting in my conversations (incoming-call banner + soft ring), and
 * shows the call window on every page so people can keep working during a meeting.
 */

export interface CallMeta { title: string; isDirect: boolean; members: { id: string; name: string }[] }

interface CallsContextValue {
  meId: string
  call: CallSnapshot | null
  meta: CallMeta | null
  active: ActiveCall[]
  minimized: boolean
  setMinimized: (v: boolean) => void
  startCall: (conversationId: string, video: boolean) => Promise<void>
  joinCall: (callId: string, conversationId: string, video: boolean) => Promise<void>
  decline: (call: ActiveCall) => void
  leave: () => void
  toggleMic: () => void
  toggleCam: () => void
  toggleScreen: () => void
  toggleHand: () => void
  react: (emoji: string) => void
  reactions: Reaction[]
  invite: (userIds: string[]) => Promise<void>
  /** Recording */
  recState: RecorderState
  startRecording: () => void
  stopRecording: () => void
  /** AI note taker + captions */
  setNoteTaker: (on: boolean) => Promise<void>
  transcriber: TranscriberState
  speechLang: string
  setSpeechLang: (code: string) => void
  captionsOn: boolean
  setCaptionsOn: (v: boolean) => void
  panel: CallPanel
  setPanel: (p: CallPanel) => void
}

export type CallPanel = 'people' | 'chat' | 'notes' | null

const CallsContext = createContext<CallsContextValue | null>(null)

/** Null outside the app shell (e.g. a page rendered on its own), so callers can hide call buttons. */
export function useCalls(): CallsContextValue | null {
  return useContext(CallsContext)
}

const RING_TIMEOUT_MS = 60_000

export function CallProvider({ meId, children }: { meId: string; children: ReactNode }) {
  const { addToast } = useToast()
  const engine = useRef<CallEngine | null>(null)
  const [call, setCall] = useState<CallSnapshot | null>(null)
  const [meta, setMeta] = useState<CallMeta | null>(null)
  const [active, setActive] = useState<ActiveCall[]>([])
  const [minimized, setMinimized] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const busy = useRef(false)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const recorder = useRef<CallRecorder | null>(null)
  const [recState, setRecState] = useState<RecorderState>('idle')
  const transcriber = useRef<Transcriber | null>(null)
  const [transcriberState, setTranscriberState] = useState<TranscriberState>('off')
  const [speechLang, setSpeechLangState] = useState(getSpeechLang)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [panel, setPanel] = useState<CallPanel>(null)
  const titleHint = useRef<string | null>(null)

  // ---- calls running in my conversations (poll; slower while the tab is hidden) ----
  const refreshActive = useCallback(async () => {
    try { setActive((await callsApi.active()).calls) } catch { /* offline for a moment */ }
  }, [])
  useEffect(() => {
    let t: number | undefined
    let alive = true
    const loop = async () => {
      await refreshActive()
      if (alive) t = window.setTimeout(loop, document.visibilityState === 'visible' ? 3000 : 5000)
    }
    void loop()
    const onVis = () => { if (document.visibilityState === 'visible') void refreshActive() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; window.clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [refreshActive])

  const loadMeta = useCallback((conversationId: string) => {
    chatApi.conversation(conversationId).then((r) => {
      setMeta({ title: r.conversation.title, isDirect: r.conversation.type === 'DIRECT', members: r.conversation.members.map((m) => ({ id: m.id, name: m.name })) })
    }).catch(() => {
      // Added to someone else's call (not in its chat): use the title from the ringing card.
      setMeta({ title: titleHint.current ?? 'Call', isDirect: false, members: [] })
    })
  }, [])

  const begin = useCallback(async (callId: string, conversationId: string, video: boolean) => {
    const e: CallEngine = new CallEngine(callId, conversationId, video, (s) => { if (engine.current === e) setCall(s) })
    e.onReaction = (r) => showReaction(r)
    engine.current = e
    setPanel(null)
    setCall(e.snapshot)
    setMinimized(false)
    setMeta(null)
    loadMeta(conversationId)
    await e.start()
    void refreshActive()
  }, [loadMeta, refreshActive])

  const startCall = useCallback(async (conversationId: string, video: boolean) => {
    if (busy.current) return
    if (engine.current) {
      if (engine.current.snapshot.conversationId === conversationId) { setMinimized(false); return }
      addToast({ type: 'error', message: 'You are already in a call. Leave it first.' })
      return
    }
    busy.current = true
    try {
      const r = await callsApi.start(conversationId, video)
      await begin(r.call.id, conversationId, r.existing ? video && r.call.video : video)
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not start the call') })
    } finally { busy.current = false }
  }, [addToast, begin])

  const joinCall = useCallback(async (callId: string, conversationId: string, video: boolean) => {
    if (busy.current) return
    if (engine.current?.snapshot.callId === callId) { setMinimized(false); return }
    busy.current = true
    setDismissed((d) => new Set(d).add(callId))
    try {
      // Answering another call hangs up the current one first.
      if (engine.current) await engine.current.leave()
      titleHint.current = active.find((c) => c.id === callId)?.title ?? null
      await begin(callId, conversationId, video)
    } finally { busy.current = false }
  }, [begin, active])

  const showReaction = useCallback((r: Reaction) => {
    const key = r.at + Math.random()
    const item = { ...r, at: key }
    setReactions((cur) => [...cur.slice(-14), item])
    window.setTimeout(() => setReactions((cur) => cur.filter((x) => x !== item)), 3500)
  }, [])

  const stopRecording = useCallback(() => {
    const r = recorder.current
    if (!r) return
    engine.current?.setRecording(false)
    void r.stop()
  }, [])

  const leave = useCallback(() => {
    const e = engine.current
    if (!e) return
    // A running recording keeps saving in the background after you leave.
    if (recorder.current?.recording) stopRecording()
    transcriber.current?.stop()
    void e.leave().then(() => refreshActive())
  }, [refreshActive, stopRecording])

  const startRecording = useCallback(() => {
    const e = engine.current
    if (!e || recorder.current?.recording) return
    const r = new CallRecorder(e.snapshot.callId, () => ({ mic: e.micTrack, remotes: e.remoteAudioTracks() }), (st, info) => {
      setRecState(st)
      if (st === 'recording') e.setRecording(true)
      if (st === 'idle' && info === 'saved') addToast({ type: 'success', message: 'Recording saved. Everyone in the chat can watch it.' })
      if (st === 'error') { addToast({ type: 'error', message: info ?? 'Recording failed' }); if (engine.current === e) e.setRecording(false) }
      if (st === 'idle' || st === 'error') { if (recorder.current === r) recorder.current = null }
    })
    recorder.current = r
    void r.start()
  }, [addToast])

  const setNoteTaker = useCallback(async (on: boolean) => {
    const e = engine.current
    if (!e) return
    try {
      await callsApi.setNotes(e.snapshot.callId, on)
      if (!on) addToast({ type: 'success', message: 'Writing the meeting notes. They will appear in the chat in a minute.' })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not change the note taker') }) }
  }, [addToast])

  const invite = useCallback(async (userIds: string[]) => {
    const e = engine.current
    if (!e) return
    try {
      const r = await callsApi.invite(e.snapshot.callId, userIds)
      addToast({ type: 'success', message: `Calling ${r.invited.map((u) => u.name.split(' ')[0]).join(', ')}…` })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not add them') }) }
  }, [addToast])

  // The note taker: my browser writes down what I say while it is on (and my mic is on).
  const noteOn = !!call && call.status === 'live' && call.noteTaker
  const micOn = !!call?.mic
  useEffect(() => {
    const e = engine.current
    if (!noteOn || !micOn || !e) { transcriber.current?.stop(); transcriber.current = null; return }
    const t = new Transcriber(e.snapshot.callId, speechLang, setTranscriberState)
    transcriber.current = t
    t.start()
    return () => { t.stop(); if (transcriber.current === t) transcriber.current = null }
  }, [noteOn, micOn, speechLang, call?.callId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!noteOn) setTranscriberState('off') }, [noteOn])

  // Tell me when someone raises a hand, starts recording, or turns the note taker on.
  const prev = useRef<{ hands: Set<string>; recs: Set<string>; notes: boolean } | null>(null)
  useEffect(() => {
    if (!call || call.status !== 'live') { prev.current = null; return }
    const hands = new Set(call.peers.filter((p) => p.hand).map((p) => p.userId))
    const recs = new Set(call.peers.filter((p) => p.rec).map((p) => p.userId))
    const p0 = prev.current
    if (p0) {
      for (const id of hands) if (!p0.hands.has(id)) addToast({ type: 'info', message: `✋ ${call.peers.find((x) => x.userId === id)?.name ?? 'Someone'} raised their hand` })
      for (const id of recs) if (!p0.recs.has(id)) addToast({ type: 'warning', message: `${call.peers.find((x) => x.userId === id)?.name ?? 'Someone'} started recording this call` })
      if (call.noteTaker && !p0.notes) addToast({ type: 'info', message: 'AI notes are on: what people say is being written down.' })
    }
    prev.current = { hands, recs, notes: call.noteTaker }
  }, [call, addToast])

  const decline = useCallback((c: ActiveCall) => {
    setDismissed((d) => new Set(d).add(c.id))
    void callsApi.decline(c.id).catch(() => undefined)
  }, [])

  // ---- when the call is over, close the window ----
  useEffect(() => {
    if (!call) return
    if (call.status !== 'error' && call.status !== 'ended') return
    if (call.status === 'error') addToast({ type: 'error', message: call.error ?? 'Could not join the call' })
    if (engine.current?.snapshot.callId === call.callId) engine.current = null
    setCall((cur) => (cur?.callId === call.callId ? null : cur))
    void refreshActive()
  }, [call, addToast, refreshActive])

  // ---- one-to-one calls end when the other person hangs up, declines or doesn't answer ----
  useEffect(() => {
    if (!call || call.status !== 'live' || !meta?.isDirect) return
    const otherId = meta.members.find((m) => m.id !== meId)?.id
    if (call.hadPeers && call.peers.length === 0) {
      addToast({ type: 'info', message: 'Call ended' })
      leave()
    } else if (!call.hadPeers && otherId && call.declined.includes(otherId)) {
      addToast({ type: 'info', message: `${meta.title} declined the call` })
      leave()
    }
  }, [call, meta, meId, addToast, leave])
  useEffect(() => {
    if (!call || call.status !== 'live' || !meta?.isDirect || call.hadPeers) return
    const left = RING_TIMEOUT_MS - (Date.now() - call.startedAt)
    const t = window.setTimeout(() => {
      if (engine.current && !engine.current.snapshot.hadPeers) {
        addToast({ type: 'info', message: `${meta.title} didn't answer` })
        leave()
      }
    }, Math.max(0, left))
    return () => window.clearTimeout(t)
  }, [call?.status, call?.hadPeers, call?.startedAt, meta, addToast, leave]) // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the tab or reloading leaves the call straight away (others see you go).
  useEffect(() => {
    const onHide = () => { const e = engine.current; if (e) leaveOnUnload(e.snapshot.callId) }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  // Signing out / leaving the app shell ends the call.
  useEffect(() => () => { void engine.current?.leave() }, [])

  const ringing = useMemo(
    () => active.filter((c) => c.ringing && !c.joined && !c.full && !dismissed.has(c.id) && c.id !== call?.callId),
    [active, dismissed, call?.callId],
  )

  // Desktop pop-up once per incoming call (only when PulseTrack isn't the window in front).
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const c of ringing) {
      if (announced.current.has(c.id)) continue
      announced.current.add(c.id)
      desktop.popup({
        kind: 'calls',
        sticky: true,
        title: c.isDirect ? `${c.startedBy.name} is calling you` : `${c.video ? 'Video' : 'Voice'} call in ${c.title}`,
        body: c.isDirect ? `${c.video ? 'Video' : 'Voice'} call · open PulseTrack to answer` : `${c.startedBy.name} started a call · open PulseTrack to join`,
        link: `/app/chat?c=${encodeURIComponent(c.conversationId)}`,
        tag: `call-${c.id}`,
      })
    }
  }, [ringing])

  const value: CallsContextValue = {
    meId,
    call,
    meta,
    active,
    minimized,
    setMinimized,
    startCall,
    joinCall,
    decline,
    leave,
    toggleMic: () => engine.current?.toggleMic(),
    toggleCam: () => { void engine.current?.toggleCam() },
    toggleScreen: () => { void engine.current?.toggleScreen() },
    toggleHand: () => engine.current?.toggleHand(),
    react: (emoji: string) => {
      engine.current?.react(emoji)
      showReaction({ emoji, name: 'You', from: meId, at: Date.now() })
    },
    reactions,
    invite,
    recState,
    startRecording,
    stopRecording,
    setNoteTaker,
    transcriber: transcriberState,
    speechLang,
    setSpeechLang: (code: string) => { saveSpeechLang(code); setSpeechLangState(code) },
    captionsOn,
    setCaptionsOn,
    panel,
    setPanel,
  }

  return (
    <CallsContext.Provider value={value}>
      {children}
      <IncomingCalls calls={ringing} inCall={!!call} onJoin={(c, video) => void joinCall(c.id, c.conversationId, video)} onDecline={decline} />
      {call && <CallWindow />}
    </CallsContext.Provider>
  )
}
