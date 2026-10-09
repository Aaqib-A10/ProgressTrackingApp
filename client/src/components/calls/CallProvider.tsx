import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { callsApi, leaveOnUnload, type ActiveCall } from '../../lib/callsApi'
import { CallEngine, type CallSnapshot, type Reaction } from '../../lib/callEngine'
import { CallRecorder, type RecorderState } from '../../lib/callRecorder'
import { Transcriber, getSpeechLang, setSpeechLang as saveSpeechLang, speechSupported, type TranscriberState } from '../../lib/transcriber'
import { SpeechRecorder, serverSpeechSupported, type SpeechMode } from '../../lib/speechRecorder'
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
  muteOthers: (userId: string | '*') => void
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
  // AI notes: one recorder per person in the call (only in the recording browser).
  const recorders = useRef(new Map<string, { trackId: string; rec: SpeechRecorder }>())
  const [transcriberState, setTranscriberState] = useState<TranscriberState>('off')
  const [speechLang, setSpeechLangState] = useState(getSpeechLang)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [panel, setPanel] = useState<CallPanel>(null)
  const titleHint = useRef<string | null>(null)

  // ---- calls running in my conversations (poll; slower while the tab is hidden) ----
  const refreshActive = useCallback(async () => {
    try {
      const calls = (await callsApi.active()).calls
      // Same as before (the usual case): keep the old list so the app does not redraw every 3 seconds.
      setActive((cur) => (JSON.stringify(cur) === JSON.stringify(calls) ? cur : calls))
    } catch { /* offline for a moment */ }
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

  const begin = useCallback(async (callId: string, conversationId: string, video: boolean, muteOnJoin = false) => {
    const e: CallEngine = new CallEngine(callId, conversationId, video, (s) => { if (engine.current === e) setCall(s) }, { muteOnJoin })
    e.onReaction = (r) => showReaction(r)
    e.onMutedBy = (name) => addToast({ type: 'info', message: `${name} muted you. Click the microphone when you want to speak.` })
    if (muteOnJoin) addToast({ type: 'info', message: 'You joined muted so background noise does not interrupt. Click the microphone to speak.' })
    engine.current = e
    setPanel(null)
    setCall(e.snapshot)
    setMinimized(false)
    setMeta(null)
    loadMeta(conversationId)
    await e.start()
    void refreshActive()
  }, [loadMeta, refreshActive, addToast]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const card = active.find((c) => c.id === callId)
      titleHint.current = card?.title ?? null
      // Three or more people already talking: come in muted (like Teams does).
      await begin(callId, conversationId, video, (card?.participants.length ?? 0) >= 3)
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
    // Send everyone's last words for the notes.
    for (const r of recorders.current.values()) void r.rec.stop()
    recorders.current.clear()
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

  // The note taker.
  // Server mode (Groq): ONE browser (the one that turned the notes on; if they leave, the
  // person longest in the call) records every person's sound separately: my microphone
  // and each person's audio as it arrives in the call. Each piece is labelled with that
  // person and turned into text on the server, then into English. Nobody else records,
  // so a line is never written twice, and it works even if someone's own app is old,
  // muted or in the background.
  // Browser mode (no Groq key): each browser's own speech recognition writes its person's words.
  const noteOn = !!call && call.status === 'live' && call.noteTaker
  const micOn = !!call?.mic
  const serverStt = call?.sttMode === 'server'
  const iRecord = noteOn && serverStt && !!meId && call?.noteRecorder === meId && serverSpeechSupported()
  // Which sounds to record: me, plus everyone else who has an audio track (changes as people come and go).
  const recordKey = iRecord
    ? [`${meId}:${engine.current?.micTrack?.id ?? ''}`, ...(call?.peers ?? []).map((p) => `${p.userId}:${p.stream?.getAudioTracks()[0]?.id ?? ''}`)].join('|')
    : ''
  useEffect(() => {
    const e = engine.current
    const live = recorders.current
    const wanted = new Map<string, MediaStreamTrack>()
    if (iRecord && e) {
      if (e.micTrack && meId) wanted.set(meId, e.micTrack)
      for (const p of e.snapshot.peers) {
        const t = p.stream?.getAudioTracks()[0]
        if (t) wanted.set(p.userId, t)
      }
    }
    // Stop recorders for people who left (sends their last words) or whose sound changed.
    for (const [userId, r] of live) {
      if (wanted.get(userId)?.id !== r.trackId) { void r.rec.stop(); live.delete(userId) }
    }
    for (const [userId, track] of wanted) {
      if (live.has(userId)) continue
      const rec = new SpeechRecorder(e!.snapshot.callId, track, speechLang as SpeechMode, userId, (msg) => addToast({ type: 'warning', message: msg }))
      rec.start()
      live.set(userId, { trackId: track.id, rec })
    }
    if (iRecord) setTranscriberState('listening')
  }, [recordKey, speechLang]) // eslint-disable-line react-hooks/exhaustive-deps
  // Notes off, I am no longer the recorder, or the call ended: stop all (each sends its last piece).
  useEffect(() => {
    if (iRecord) return
    for (const r of recorders.current.values()) void r.rec.stop()
    recorders.current.clear()
  }, [iRecord])
  useEffect(() => () => { for (const r of recorders.current.values()) void r.rec.stop(); recorders.current.clear() }, [])

  // Browser mode only: this browser's speech recognition writes my words.
  useEffect(() => {
    const e = engine.current
    if (!noteOn || serverStt || !micOn || !e) return
    let t: Transcriber | null = null
    if (speechSupported()) {
      t = new Transcriber(e.snapshot.callId, speechLang, setTranscriberState, false)
      transcriber.current = t
      t.start()
    } else {
      setTranscriberState('unsupported')
    }
    return () => {
      t?.stop()
      if (transcriber.current === t) transcriber.current = null
    }
  }, [noteOn, micOn, speechLang, serverStt, call?.callId]) // eslint-disable-line react-hooks/exhaustive-deps
  // In server mode, everyone else just sees that notes are being taken.
  useEffect(() => { if (noteOn && serverStt && !iRecord) setTranscriberState('listening') }, [noteOn, serverStt, iRecord])
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
    muteOthers: (userId: string | '*') => {
      const e = engine.current
      if (!e) return
      void e.muteOthers(userId).then(() => addToast({ type: 'success', message: userId === '*' ? 'Everyone else is muted' : 'Muted' })).catch((err) => addToast({ type: 'error', message: errMsg(err) }))
    },
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
