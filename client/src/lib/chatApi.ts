import { api, ApiError } from './api'

export type Presence = 'online' | 'away' | 'offline' | 'busy'
export type ConversationType = 'DIRECT' | 'GROUP' | 'PROJECT'

export interface ConversationListItem {
  id: string
  type: ConversationType
  title: string
  projectKey: string | null
  color: string | null
  archived: boolean
  memberCount: number
  other: { id: string; name: string; presence: Presence } | null
  lastMessage: { body: string; userName: string; createdAt: string; mine: boolean } | null
  lastMessageAt: string
  unread: number
  muted: boolean
  mutedUntil: string | null
}

export interface ConversationDetail {
  id: string
  type: ConversationType
  title: string
  name: string | null
  project: { key: string; name: string; color: string } | null
  canManage: boolean
  canChangePicture?: boolean
  muted: boolean
  mutedUntil: string | null
  members: { id: string; name: string; email: string; isAdmin: boolean; presence: Presence; lastReadSeq: number }[]
}

export interface ChatMessage {
  id: string
  seq: number
  conversationId: string
  user: { id: string; name: string }
  body: string
  deleted: boolean
  mentions: string[]
  replyTo: { id: string; userName: string; body: string } | null
  task: { code: string; title: string; projectKey: string; projectName: string; color: string; status: string; done: boolean; dueAt: string | null; overdue: boolean } | null
  file: { name: string | null; size: number | null; mime: string | null; url: string } | null
  call: { id: string; video: boolean; active: boolean; startedAt: string; endedAt: string | null; durationSec: number | null; joinedCount: number } | null
  /** "Meeting notes are ready" card. */
  notes: { callId: string } | null
  reactions: { emoji: string; userIds: string[] }[]
  editedAt: string | null
  createdAt: string
}

export interface MessagesResponse {
  messages: ChatMessage[]
  changed: ChatMessage[]
  hasMore: boolean
  typing: string[]
  reads: { userId: string; lastReadSeq: number }[]
  serverTime: string
}

export interface ChatUser { id: string; name: string; email: string; department: string | null; presence: Presence }

export const chatApi = {
  conversations: () => api.get<{ conversations: ConversationListItem[] }>('/chat/conversations'),
  conversation: (id: string) => api.get<{ conversation: ConversationDetail }>(`/chat/conversations/${id}`),
  openDirect: (userId: string) => api.post<{ conversation: { id: string } }>('/chat/conversations', { type: 'DIRECT', userId }),
  createGroup: (name: string, userIds: string[]) => api.post<{ conversation: { id: string } }>('/chat/conversations', { type: 'GROUP', name, userIds }),
  updateGroup: (id: string, body: { name?: string; addUserIds?: string[]; removeUserIds?: string[] }) => api.patch(`/chat/conversations/${id}`, body),
  leave: (id: string) => api.post(`/chat/conversations/${id}/leave`),
  projectChannel: (key: string) => api.get<{ conversation: { id: string } }>(`/chat/projects/${encodeURIComponent(key)}`),
  messages: (id: string, q: { after?: number; before?: number; changedSince?: string; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([a, b]) => [a, String(b)]))
    return api.get<MessagesResponse>(`/chat/conversations/${id}/messages?${p}`)
  },
  send: (id: string, body: string, opts: { replyToId?: string | null; mentions?: string[] } = {}) => api.post<{ message: ChatMessage }>(`/chat/conversations/${id}/messages`, { body, ...opts }),
  sendFile: (id: string, file: File, caption = '') =>
    api.postRaw<{ message: ChatMessage }>(`/chat/conversations/${id}/files?name=${encodeURIComponent(file.name)}&caption=${encodeURIComponent(caption)}`, file, file.type || 'application/octet-stream'),
  edit: (messageId: string, body: string) => api.patch<{ message: ChatMessage }>(`/chat/messages/${messageId}`, { body }),
  remove: (messageId: string) => api.del(`/chat/messages/${messageId}`),
  read: (id: string, seq: number) => api.post<{ lastReadSeq: number }>(`/chat/conversations/${id}/read`, { seq }),
  mute: (id: string, until: string | null) => api.post(`/chat/conversations/${id}/mute`, { until }),
  typing: (id: string, typing: boolean) => api.post(`/chat/conversations/${id}/typing`, { typing }),
  react: (messageId: string, emoji: string) => api.post<{ message: ChatMessage }>(`/chat/messages/${messageId}/react`, { emoji }),
  unread: () => api.get<{ total: number; conversations: number; latest?: { id: string; conversationId: string; from: string; text: string; where: string | null; isDirect: boolean; isCall?: boolean } | null }>('/chat/unread'),
  users: (q = '') => api.get<{ users: ChatUser[] }>(`/chat/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  search: (q: string, conversationId?: string) => api.get<{ results: { id: string; seq: number; conversationId: string; conversationName: string | null; userName: string; body: string; createdAt: string }[] }>(`/chat/search?q=${encodeURIComponent(q)}${conversationId ? `&conversationId=${conversationId}` : ''}`),
}

export const MAX_FILE_BYTES = 500 * 1024 * 1024

/**
 * Send one file to a chat in pieces (big videos too). Calls onProgress with 0..1.
 * A piece that fails is tried again a few times; if the network refuses big pieces
 * (413), it starts again with small (512 KB) pieces. Stop it with the returned cancel().
 */
export function uploadChatFile(conversationId: string, file: File, caption: string, onProgress: (p: number) => void): { done: Promise<ChatMessage>; cancel: () => void } {
  let cancelled = false
  let uploadId: string | null = null
  const done = (async () => {
    const start = await api.post<{ uploadId: string; pieceSize: number }>(`/chat/conversations/${conversationId}/uploads`, { name: file.name, mime: file.type, size: file.size })
    uploadId = start.uploadId
    const piece = start.pieceSize
    let offset = 0
    let index = 0
    onProgress(0)
    while (offset < file.size) {
      if (cancelled) throw new Error('cancelled')
      const blob = file.slice(offset, offset + piece)
      let attempt = 0
      for (;;) {
        try {
          await api.postRaw(`/chat/uploads/${uploadId}/piece?index=${index}`, blob)
          break
        } catch (e) {
          if (cancelled) throw new Error('cancelled')
          if (e instanceof ApiError && e.status === 413) throw Object.assign(new Error('smaller'), { smaller: true })
          if (e instanceof ApiError && e.status < 500 && e.status !== 408 && e.status !== 429) throw e
          if (++attempt >= 4) throw e
          await new Promise((ok) => setTimeout(ok, 1500 * attempt))
        }
      }
      offset += blob.size
      index++
      onProgress(offset / file.size)
    }
    if (cancelled) throw new Error('cancelled')
    const r = await api.post<{ message: ChatMessage }>(`/chat/uploads/${uploadId}/finish`, { caption })
    return r.message
  })()
  // A piece was too big for the network: start again with small pieces.
  const run: Promise<ChatMessage> = done.catch(async (e) => {
    if (!(e as { smaller?: boolean }).smaller) {
      // Failed or stopped: free the half-sent file on the server straight away.
      if (uploadId) void api.del(`/chat/uploads/${uploadId}`).catch(() => undefined)
      throw e
    }
    if (uploadId) void api.del(`/chat/uploads/${uploadId}`).catch(() => undefined)
    return smallPieces(conversationId, file, caption, onProgress, () => cancelled)
  })
  return {
    done: run,
    cancel: () => { cancelled = true; if (uploadId) void api.del(`/chat/uploads/${uploadId}`).catch(() => undefined) },
  }
}

async function smallPieces(conversationId: string, file: File, caption: string, onProgress: (p: number) => void, isCancelled: () => boolean): Promise<ChatMessage> {
  const piece = 512 * 1024
  const start = await api.post<{ uploadId: string }>(`/chat/conversations/${conversationId}/uploads`, { name: file.name, mime: file.type, size: file.size })
  for (let offset = 0, index = 0; offset < file.size; offset += piece, index++) {
    if (isCancelled()) { void api.del(`/chat/uploads/${start.uploadId}`).catch(() => undefined); throw new Error('cancelled') }
    await api.postRaw(`/chat/uploads/${start.uploadId}/piece?index=${index}`, file.slice(offset, offset + piece))
    onProgress(Math.min(1, (offset + piece) / file.size))
  }
  return (await api.post<{ message: ChatMessage }>(`/chat/uploads/${start.uploadId}/finish`, { caption })).message
}

/** Fire a callback on an interval while the tab is visible (and once on focus). */
export function visiblePoll(fn: () => void, ms: number): () => void {
  let timer: number | undefined
  const start = () => {
    stop()
    timer = window.setInterval(() => { if (document.visibilityState === 'visible') fn() }, ms)
  }
  const stop = () => { if (timer) window.clearInterval(timer) }
  const onVis = () => { if (document.visibilityState === 'visible') fn() }
  document.addEventListener('visibilitychange', onVis)
  start()
  return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
}
