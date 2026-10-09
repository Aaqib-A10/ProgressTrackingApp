import { api } from './api'

export interface CallParticipant { userId: string; name: string; mic: boolean; cam: boolean; screen: boolean; hand?: boolean; rec?: boolean; joinedAt: string }
export interface Caption { id: number; userId: string; name: string; text: string; final: boolean }
export interface ActiveCall {
  id: string
  conversationId: string
  title: string
  isDirect: boolean
  video: boolean
  startedBy: { id: string; name: string }
  startedAt: string
  participants: CallParticipant[]
  joined: boolean
  ringing: boolean
  full: boolean
  invitedBy?: string | null
  guest?: boolean
  meetingId?: string | null
}
export interface CallSignal { id: number; from: string; kind: 'offer' | 'answer' | 'ice' | 'bye' | 'state' | 'react'; data: unknown }
export interface JoinResponse { callId: string; video: boolean; conversationId: string; me: string; others: CallParticipant[]; iceServers: RTCIceServer[]; guest?: boolean; noteTaker?: boolean; meetingId?: string | null; isDirect?: boolean; sttMode?: 'server' | 'browser' }
export interface PollResponse { ended: boolean; removed?: boolean; participants: CallParticipant[]; signals: CallSignal[]; declined?: string[]; noteTaker?: boolean; captions?: Caption[]; invited?: string[] }

export interface MeetingNotesData { summary: string; keyPoints: string[]; decisions: string[]; actionItems: { owner: string | null; task: string; due: string | null; dueDate?: string | null; taskCode?: string | null }[]; openQuestions: string[] }
export interface CallNotesResponse {
  call: { id: string; startedAt: string; endedAt: string | null; video: boolean; title: string; meetingId: string | null; conversationId: string }
  status: 'none' | 'recording' | 'pending' | 'ready' | 'failed' | 'empty' | 'no-ai'
  notes: MeetingNotesData | null
  error: string | null
  provider: 'groq' | 'anthropic' | null
  piecesLeft: number
  transcript: { id: string; userId: string; speaker: string; text: string; at: string; offsetSec: number }[]
  transcriptText: string
  recordings: { id: string; messageId: string | null; size: number; durationSec: number | null; url: string | null; createdAt: string }[]
}

export const callsApi = {
  start: (conversationId: string, video: boolean) => api.post<{ call: { id: string; video: boolean; conversationId: string }; existing: boolean }>(`/chat/conversations/${conversationId}/calls`, { video }),
  active: () => api.get<{ calls: ActiveCall[] }>('/chat/calls/active'),
  join: (callId: string, media: { mic: boolean; cam: boolean }) => api.post<JoinResponse>(`/chat/calls/${callId}/join`, media),
  signal: (callId: string, to: string, kind: 'offer' | 'answer' | 'ice', data: unknown) => api.post<{ ok: boolean }>(`/chat/calls/${callId}/signal`, { to, kind, data }),
  poll: (callId: string) => api.get<PollResponse>(`/chat/calls/${callId}/poll`),
  state: (callId: string, s: { mic?: boolean; cam?: boolean; screen?: boolean; hand?: boolean; rec?: boolean }) => api.post(`/chat/calls/${callId}/state`, s),
  invite: (callId: string, userIds: string[]) => api.post<{ invited: { id: string; name: string }[] }>(`/chat/calls/${callId}/invite`, { userIds }),
  react: (callId: string, emoji: string) => api.post(`/chat/calls/${callId}/react`, { emoji }),
  setNotes: (callId: string, on: boolean) => api.post<{ noteTaker: boolean }>(`/chat/calls/${callId}/notes`, { on }),
  notes: (callId: string) => api.get<CallNotesResponse>(`/chat/calls/${callId}/notes`),
  retryNotes: (callId: string) => api.post(`/chat/calls/${callId}/notes/retry`),
  transcript: (callId: string, text: string, final: boolean) => api.post(`/chat/calls/${callId}/transcript`, { text, final }),
  audio: (callId: string, blob: Blob, mode: string, durationMs: number) => api.postRaw<{ ok: boolean }>(`/chat/calls/${callId}/audio?mode=${mode}&durationMs=${Math.round(durationMs)}`, blob, blob.type || 'audio/webm'),
  linkActionItem: (callId: string, index: number, taskCode: string) => api.patch(`/chat/calls/${callId}/notes/action-items/${index}`, { taskCode }),
  startRecording: (callId: string, mime: string) => api.post<{ recording: { id: string } }>(`/chat/calls/${callId}/recordings`, { mime }),
  recordingChunk: (recId: string, index: number, blob: Blob) => api.postRaw<{ ok: boolean }>(`/chat/recordings/${recId}/chunk?index=${index}`, blob, 'application/octet-stream'),
  finishRecording: (recId: string, durationSec: number) => api.post<{ ok: boolean; messageId?: string }>(`/chat/recordings/${recId}/finish`, { durationSec }),
  leave: (callId: string) => api.post(`/chat/calls/${callId}/leave`),
  decline: (callId: string) => api.post(`/chat/calls/${callId}/decline`),
}

/** Leave even while the page is closing (cookie auth, so a beacon works). */
export function leaveOnUnload(callId: string): void {
  const base = import.meta.env.VITE_API_URL ?? '/api'
  try { navigator.sendBeacon?.(`${base}/chat/calls/${callId}/leave`) } catch { /* ignore */ }
}
