import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { callsApi, leaveOnUnload, type ActiveCall } from '../../lib/callsApi'
import { CallEngine, type CallSnapshot } from '../../lib/callEngine'
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
}

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

  // ---- calls running in my conversations (poll; slower while the tab is hidden) ----
  const refreshActive = useCallback(async () => {
    try { setActive((await callsApi.active()).calls) } catch { /* offline for a moment */ }
  }, [])
  useEffect(() => {
    let t: number | undefined
    let alive = true
    const loop = async () => {
      await refreshActive()
      if (alive) t = window.setTimeout(loop, document.visibilityState === 'visible' ? 4000 : 10000)
    }
    void loop()
    const onVis = () => { if (document.visibilityState === 'visible') void refreshActive() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; window.clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [refreshActive])

  const loadMeta = useCallback((conversationId: string) => {
    chatApi.conversation(conversationId).then((r) => {
      setMeta({ title: r.conversation.title, isDirect: r.conversation.type === 'DIRECT', members: r.conversation.members.map((m) => ({ id: m.id, name: m.name })) })
    }).catch(() => undefined)
  }, [])

  const begin = useCallback(async (callId: string, conversationId: string, video: boolean) => {
    const e: CallEngine = new CallEngine(callId, conversationId, video, (s) => { if (engine.current === e) setCall(s) })
    engine.current = e
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
      await begin(callId, conversationId, video)
    } finally { busy.current = false }
  }, [begin])

  const leave = useCallback(() => {
    const e = engine.current
    if (!e) return
    void e.leave().then(() => refreshActive())
  }, [refreshActive])

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
        kind: 'chat',
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
  }

  return (
    <CallsContext.Provider value={value}>
      {children}
      <IncomingCalls calls={ringing} inCall={!!call} onJoin={(c, video) => void joinCall(c.id, c.conversationId, video)} onDecline={decline} />
      {call && <CallWindow />}
    </CallsContext.Provider>
  )
}
