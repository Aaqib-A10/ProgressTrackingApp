import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorText } from '../../lib/api'
import { metraApi, streamChat, MetraHttpError, type MetraAction, type MetraFeedback, type MetraMessage } from '../../lib/metraApi'

/** A message on screen: the stored one, plus what only the screen needs while an answer streams in. */
export interface ChatMessage extends MetraMessage {
  /** Stable React key (the server id is not known until `meta` arrives). */
  key: string
  /** The answer is still coming. */
  pending?: boolean
  /** "Searching your Metriq records" while no text has arrived yet. */
  statusText?: string
  /** The question this answer is for (Retry asks it again). */
  question?: string
  /** The AI model is busy: the server tries again at `until` (ms), `total` seconds after it said so. */
  queue?: { until: number; total: number }
}

/** "The AI model is busy, trying again in 12 s" → 12. */
export function queuedSeconds(status: string): number | null {
  const m = /busy[^\d]*(\d+)\s*s/i.exec(status)
  return m ? Number(m[1]) : null
}

let seq = 0
const localKey = () => `local-${Date.now().toString(36)}-${(seq++).toString(36)}`

function blank(role: 'USER' | 'ASSISTANT', content: string): ChatMessage {
  return { key: localKey(), id: '', role, content, sources: [], actions: [], feedback: null, error: null, createdAt: new Date().toISOString() }
}

export interface UseMetraChat {
  conversationId: string | null
  title: string | null
  messages: ChatMessage[]
  loading: boolean
  loadError: string | null
  streaming: boolean
  send: (text: string) => void
  stop: () => void
  retry: (key: string) => void
  open: (id: string | null) => void
  newChat: () => void
  /** 👍/👎 on an answer; `note` says what was wrong (sent with a 👎). */
  setFeedback: (key: string, f: MetraFeedback, note?: string) => void
  decide: (key: string, actionId: string, decision: 'confirm' | 'dismiss') => Promise<void>
  busyActions: Set<string>
  /** The answer being written now waits for the AI model (busy). */
  queued: ChatMessage['queue'] | null
}

/**
 * One Metra conversation on screen: loads it, asks (streaming the answer in), stops, retries, and keeps 👍/👎 and
 * action cards in step with the server. Used by the side panel and the full page alike.
 */
export function useMetraChat(opts: { onConversation?: (id: string, title: string) => void; onAnswered?: () => void } = {}): UseMetraChat {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [busyActions, setBusyActions] = useState<Set<string>>(new Set())
  const convRef = useRef<string | null>(null)
  const ctlRef = useRef<AbortController | null>(null)
  const loadSeq = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => () => ctlRef.current?.abort(), [])

  const patch = useCallback((key: string, f: (m: ChatMessage) => ChatMessage) => {
    setMessages((ms) => ms.map((m) => (m.key === key ? f(m) : m)))
  }, [])

  const open = useCallback((id: string | null) => {
    ctlRef.current?.abort()
    const n = ++loadSeq.current
    convRef.current = id
    setConversationId(id)
    setLoadError(null)
    if (!id) { setMessages([]); setTitle(null); setLoading(false); return }
    setLoading(true)
    metraApi.conversation(id)
      .then((r) => {
        if (n !== loadSeq.current) return
        setTitle(r.conversation.title)
        setMessages(r.messages.map((m) => ({ ...m, key: m.id, sources: Array.isArray(m.sources) ? m.sources : [], actions: Array.isArray(m.actions) ? m.actions : [] })))
      })
      .catch((e) => { if (n === loadSeq.current) { setMessages([]); setLoadError(apiErrorText(e, 'Could not open this conversation.')) } })
      .finally(() => { if (n === loadSeq.current) setLoading(false) })
  }, [])

  const newChat = useCallback(() => open(null), [open])

  const stop = useCallback(() => { ctlRef.current?.abort() }, [])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text || ctlRef.current) return
    const user = blank('USER', text)
    const answer: ChatMessage = { ...blank('ASSISTANT', ''), pending: true, statusText: 'Thinking', question: text }
    setMessages((ms) => [...ms, user, answer])
    const ctl = new AbortController()
    ctlRef.current = ctl
    setStreaming(true)
    const key = answer.key
    let gotText = false
    streamChat({ conversationId: convRef.current ?? undefined, message: text }, {
      meta: (m) => {
        if (ctl.signal.aborted) return
        patch(key, (x) => ({ ...x, id: m.messageId }))
        if (convRef.current !== m.conversationId) {
          convRef.current = m.conversationId
          setConversationId(m.conversationId)
          setTitle(m.title)
          optsRef.current.onConversation?.(m.conversationId, m.title)
        }
      },
      status: (s) => {
        const n = queuedSeconds(s)
        patch(key, (x) => ({ ...x, statusText: s, queue: n != null ? { until: Date.now() + n * 1000, total: n } : undefined }))
      },
      sources: (s) => patch(key, (x) => ({ ...x, sources: s })),
      delta: (t) => { gotText = true; patch(key, (x) => ({ ...x, queue: undefined, content: x.content + t })) },
      action: (a) => patch(key, (x) => ({ ...x, actions: [...x.actions.filter((y) => y.id !== a.id), a] })),
      done: (d) => patch(key, (x) => ({ ...x, id: d.messageId || x.id, content: d.content, sources: d.sources ?? x.sources, actions: d.actions ?? x.actions, pending: false, statusText: undefined, queue: undefined })),
      error: (e) => patch(key, (x) => ({ ...x, pending: false, statusText: undefined, queue: undefined, error: e.error || 'Metra could not answer just now. Try again.' })),
    }, ctl.signal)
      .catch((e) => {
        const msg = e instanceof MetraHttpError ? e.message : 'Metra could not answer just now. Try again.'
        patch(key, (x) => ({ ...x, pending: false, statusText: undefined, queue: undefined, error: msg }))
      })
      .finally(() => {
        if (ctl.signal.aborted) patch(key, (x) => (x.pending ? { ...x, pending: false, statusText: undefined, queue: undefined, error: x.content || gotText ? null : 'Stopped.' } : x))
        else patch(key, (x) => (x.pending ? { ...x, pending: false, statusText: undefined, queue: undefined, error: x.content ? null : 'The answer was cut off. Try again.' } : x))
        if (ctlRef.current === ctl) ctlRef.current = null
        setStreaming(false)
        optsRef.current.onAnswered?.()
      })
  }, [patch])

  const retry = useCallback((key: string) => {
    const ms = messagesRef.current
    const i = ms.findIndex((m) => m.key === key)
    if (i < 0 || ctlRef.current) return
    const question = ms[i].question ?? (ms[i - 1]?.role === 'USER' ? ms[i - 1].content : '')
    if (!question) return
    // Ask again: the failed pair leaves the screen, the new one takes its place.
    setMessages((xs) => xs.filter((m, j) => j !== i && !(j === i - 1 && m.role === 'USER')))
    send(question)
  }, [send])

  const setFeedback = useCallback((key: string, f: MetraFeedback, note?: string) => {
    const m = messagesRef.current.find((x) => x.key === key)
    if (!m?.id) return
    const before = m.feedback
    patch(key, (x) => ({ ...x, feedback: f }))
    metraApi.feedback(m.id, f, note).catch(() => patch(key, (x) => ({ ...x, feedback: before })))
  }, [patch])

  const decide = useCallback(async (key: string, actionId: string, decision: 'confirm' | 'dismiss') => {
    const m = messagesRef.current.find((x) => x.key === key)
    if (!m?.id) return
    setBusyActions((s) => new Set(s).add(actionId))
    try {
      const card = await metraApi.decide(m.id, actionId, decision)
      patch(key, (x) => ({ ...x, actions: x.actions.map((a) => (a.id === actionId ? card : a)) }))
    } catch (e) {
      const msg = apiErrorText(e, 'Could not do that just now. Try again.')
      patch(key, (x) => ({ ...x, actions: x.actions.map((a): MetraAction => (a.id === actionId ? { ...a, result: msg } : a)) }))
    } finally {
      setBusyActions((s) => { const n = new Set(s); n.delete(actionId); return n })
    }
  }, [patch])

  const lastMsg = messages[messages.length - 1]
  const queued = lastMsg?.pending && lastMsg.queue ? lastMsg.queue : null
  return { conversationId, title, messages, loading, loadError, streaming, send, stop, retry, open, newChat, setFeedback, decide, busyActions, queued }
}
