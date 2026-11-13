import { useEffect, useState } from 'react'
import { answeredAsSomeoneElse, api } from './api'
import { isMobileOrTablet } from './device'
import { apiBase, sessionHeaders } from './session'
import { flagOn, refreshFlags, useFlags } from './flags'
import { useAuth } from './auth'

/**
 * Metra, the AI assistant (docs/metra/DESIGN.md): typed calls to /api/metra, the answer stream, and the
 * small shared state the launcher, the Ctrl+K bar and the full page use.
 */

export interface MetraSource { n: number; sourceType: string; sourceLabel: string; sourceId: string; title: string; snippet: string; link: string | null; occurredAt: string }
export type MetraActionState = 'PROPOSED' | 'DONE' | 'DISMISSED' | 'FAILED'
export interface MetraAction { id: string; tool: string; label: string; summary: string; args: Record<string, unknown>; state: MetraActionState; result?: string }
export type MetraFeedback = 'UP' | 'DOWN' | null

export type MetraRating = 'HELPS' | 'NEEDS_CHANGES'
/** Super Admin: what people said about Metra, and the answers they rated (the question and their note, not the answer). */
export interface MetraFeedbackList {
  general: { id: string; name: string; department: string | null; rating: MetraRating; text: string; handled: boolean; createdAt: string }[]
  answers: { id: string; name: string; department: string | null; feedback: 'UP' | 'DOWN'; note: string; question: string; tools: string[]; createdAt: string }[]
}

/** Super Admin: answers that went wrong in the last 14 days (which lookups ran and why one failed; never the question or answer). */
export interface MetraProblem {
  id: string; kind: 'ERROR' | 'LOOKUP_FAILED' | 'GAVE_UP' | 'NOT_HELPFUL'; name: string; department: string | null; createdAt: string
  error: string | null; model: string | null; latencyMs: number | null
  tools: { name: string; args: Record<string, unknown>; ok: boolean; ms: number | null; error: string | null }[]
}
export interface MetraProblemList { answers: number; total: number; problems: MetraProblem[]; since: string; answersSince: number }

export interface MetraAdmin {
  embed: { mode: string; model: string; reranker: string | boolean | null }
  index: { loaded: boolean; chunks: number }
  sources: { type: string; label: string; chunks: number; lastRunAt: string | null; lastError: string | null }[]
  usage: { answers: number; tokensIn: number; tokensOut: number }
  feedback: { UP?: number; DOWN?: number }
}
export type MetraStatus =
  | { enabled: false }
  | { enabled: true; llm: boolean; suggestions: string[]; sources: { type: string; label: string }[]; admin?: MetraAdmin }

export interface MetraConversation { id: string; title: string; pinned: boolean; updatedAt: string }
export interface MetraMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  sources: MetraSource[]
  actions: MetraAction[]
  feedback: MetraFeedback
  error: string | null
  createdAt: string
}

export const metraApi = {
  status: () => api.get<MetraStatus>('/metra/status'),
  conversations: () => api.get<{ conversations: MetraConversation[] }>('/metra/conversations').then((r) => r.conversations),
  conversation: (id: string) => api.get<{ conversation: { id: string; title: string; pinned: boolean }; messages: MetraMessage[] }>(`/metra/conversations/${encodeURIComponent(id)}`),
  update: (id: string, body: { title?: string; pinned?: boolean }) => api.patch<{ ok: true }>(`/metra/conversations/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.del<{ ok: true }>(`/metra/conversations/${encodeURIComponent(id)}`),
  feedback: (messageId: string, feedback: MetraFeedback, note?: string) => api.post<{ ok: true }>(`/metra/messages/${encodeURIComponent(messageId)}/feedback`, { feedback, ...(note ? { note } : {}) }),
  decide: (messageId: string, actionId: string, decision: 'confirm' | 'dismiss', args?: Record<string, unknown>) =>
    api.post<{ action: MetraAction }>(`/metra/messages/${encodeURIComponent(messageId)}/actions/${encodeURIComponent(actionId)}`, { decision, ...(args ? { arguments: args } : {}) }).then((r) => r.action),
  reindex: () => api.post<{ ok: true }>('/metra/admin/reindex'),
  /** What the person thinks of Metra as a whole (the thumbs on an answer are `feedback` above). */
  sendFeedback: (rating: MetraRating, text?: string) => api.post<{ ok: true }>('/metra/feedback', { rating, ...(text?.trim() ? { text: text.trim() } : {}) }),
  adminFeedback: () => api.get<MetraFeedbackList>('/metra/admin/feedback'),
  adminProblems: () => api.get<MetraProblemList>('/metra/admin/problems'),
  setFeedbackHandled: (id: string, handled: boolean) => api.patch<{ ok: true }>(`/metra/admin/feedback/${encodeURIComponent(id)}`, { handled }),
  insights: () => api.get<{ insights: MetraInsight[] }>('/metra/insights').then((r) => r.insights ?? []),
  setInsight: (id: string, state: 'DONE' | 'DISMISSED' | 'NEW') => api.patch<{ ok: true }>(`/metra/insights/${encodeURIComponent(id)}`, { state }),
}

export interface MetraBriefPayload { text: string; facts?: unknown }
export interface MetraNextStepPayload { leadId: string; company: string; status: string; said: string; due: string; noteAt?: string }
export type MetraInsight =
  | { id: string; kind: 'BRIEF'; day: string; title: string; payload: MetraBriefPayload; createdAt: string }
  | { id: string; kind: 'NEXT_STEP'; day: string; title: string; payload: MetraNextStepPayload; createdAt: string }

// ------------------------------------------------------------------ the answer stream

export interface StreamHandlers {
  meta?: (m: { conversationId: string; messageId: string; title: string }) => void
  status?: (text: string) => void
  sources?: (s: MetraSource[]) => void
  delta?: (text: string) => void
  action?: (a: MetraAction) => void
  done?: (d: { messageId: string; content: string; sources: MetraSource[]; actions: MetraAction[]; latencyMs: number }) => void
  error?: (e: { error: string }) => void
}

/** A refusal before the stream starts (403 switched off, 503 no model, 429 too many, 400, 404): the server's words. */
export class MetraHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'MetraHttpError' }
}

/** Split one SSE block ("event: x\ndata: {...}") into its event name and parsed data. */
export function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message'
  const data: string[] = []
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    const i = line.indexOf(':')
    const field = i < 0 ? line : line.slice(0, i)
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  const text = data.join('\n')
  try { return { event, data: JSON.parse(text) } } catch { return { event, data: text } }
}

/**
 * POST /api/metra/chat and read the server-sent events as they come (a POST, so fetch + a stream reader, not
 * EventSource). Resolves when the stream ends; an abort (Stop) resolves quietly. Non-200 answers throw MetraHttpError.
 */
export async function streamChat(body: { conversationId?: string; message: string }, on: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/metra/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Client-Mobile': isMobileOrTablet() ? '1' : '0',
        'X-PT-Visible': typeof document !== 'undefined' && document.visibilityState === 'visible' ? '1' : '0',
        ...sessionHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (signal?.aborted) return
    throw new MetraHttpError('Could not reach Metriq. Check your connection and try again.', 0)
  }
  // Another account signed in from a second tab: this answer is theirs, not the account on screen. The page reloads.
  if (answeredAsSomeoneElse(res, '/metra/chat')) { void res.body?.cancel(); throw new MetraHttpError('The signed-in account changed in another tab. Reloading.', 409) }
  if (!res.ok || !res.body) {
    let msg = `Metra could not answer (${res.status}).`
    try { const j = (await res.json()) as { error?: string }; if (j?.error) msg = j.error } catch { /* keep the plain words */ }
    if (res.status === 401) msg = 'You are signed out. Sign in again to ask Metra.'
    throw new MetraHttpError(msg, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const dispatch = (block: string) => {
    const ev = parseSseBlock(block)
    if (!ev) return
    const d = ev.data as never
    switch (ev.event) {
      case 'meta': on.meta?.(d); break
      case 'status': on.status?.(String(ev.data)); break
      case 'sources': on.sources?.(Array.isArray(ev.data) ? (ev.data as MetraSource[]) : []); break
      case 'delta': on.delta?.(String(ev.data)); break
      case 'action': on.action?.(d); break
      case 'done': on.done?.(d); break
      case 'error': on.error?.(d); break
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let cut = buf.indexOf('\n\n')
      while (cut >= 0) {
        dispatch(buf.slice(0, cut))
        buf = buf.slice(cut + 2)
        cut = buf.indexOf('\n\n')
      }
    }
    buf += decoder.decode()
    if (buf.trim()) dispatch(buf)
  } catch {
    if (signal?.aborted) return
    throw new MetraHttpError('The answer was cut off. Try again.', 0)
  } finally {
    reader.releaseLock?.()
  }
}

// ------------------------------------------------------------------ shared state

let status: MetraStatus | null = null
let statusAt = 0
let statusUser: string | null = null
let statusLoading: Promise<MetraStatus | null> | null = null
const statusListeners = new Set<() => void>()

/** Read /metra/status (cached a few minutes; `force` reads it again, e.g. after a re-index). */
export function loadMetraStatus(force = false): Promise<MetraStatus | null> {
  if (!force && status && Date.now() - statusAt < 5 * 60_000) return Promise.resolve(status)
  if (statusLoading && !force) return statusLoading
  const forUser = statusUser
  statusLoading = metraApi.status()
    .then((s) => { if (forUser !== statusUser) return status; status = s; statusAt = Date.now(); return s })
    .catch(() => status)
    .finally(() => { statusLoading = null; statusListeners.forEach((f) => f()) })
  return statusLoading
}

/**
 * Whatever Metra keeps in the browser's memory belongs to one signed-in person. When someone else signs in on the
 * same page (no reload), it all starts empty: nothing of the first person can be shown to the second.
 */
export function metraUser(id: string | null | undefined): void {
  const u = id ?? null
  if (u === statusUser) return
  statusUser = u
  status = null
  statusAt = 0
  statusLoading = null
  statusListeners.forEach((f) => f())
}

/**
 * Metra for this person: null while unknown or switched off, else the status. Reads the switch first, so
 * nothing is asked of the server while Metra is off for the company.
 */
export function useMetraStatus(): MetraStatus | null {
  useFlags()
  const { user } = useAuth()
  const me = user?.id ?? null
  const on = flagOn('metra')
  const [, setN] = useState(0)
  useEffect(() => {
    const f = () => setN((x) => x + 1)
    statusListeners.add(f)
    void refreshFlags()
    return () => { statusListeners.delete(f) }
  }, [])
  useEffect(() => { metraUser(me); if (on) void loadMetraStatus() }, [on, me])
  return on && statusUser === me ? status : null
}

/** True when Metra can be shown: the switch is on and the server agrees. */
export const metraReady = (s: MetraStatus | null): s is Extract<MetraStatus, { enabled: true }> => !!s && s.enabled

// Open the panel from anywhere (Ctrl+K "Ask Metra", a button), optionally asking a question at once.
export const OPEN_METRA_EVENT = 'pt:open-metra'
export function openMetra(question?: string): void {
  window.dispatchEvent(new CustomEvent<{ question?: string }>(OPEN_METRA_EVENT, { detail: { question } }))
}
