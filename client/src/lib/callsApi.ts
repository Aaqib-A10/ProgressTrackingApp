import { api } from './api'

export interface CallParticipant { userId: string; name: string; mic: boolean; cam: boolean; screen: boolean; joinedAt: string }
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
}
export interface CallSignal { id: number; from: string; kind: 'offer' | 'answer' | 'ice' | 'bye' | 'state'; data: unknown }
export interface JoinResponse { callId: string; video: boolean; conversationId: string; me: string; others: CallParticipant[]; iceServers: RTCIceServer[] }

export const callsApi = {
  start: (conversationId: string, video: boolean) => api.post<{ call: { id: string; video: boolean; conversationId: string }; existing: boolean }>(`/chat/conversations/${conversationId}/calls`, { video }),
  active: () => api.get<{ calls: ActiveCall[] }>('/chat/calls/active'),
  join: (callId: string, media: { mic: boolean; cam: boolean }) => api.post<JoinResponse>(`/chat/calls/${callId}/join`, media),
  signal: (callId: string, to: string, kind: 'offer' | 'answer' | 'ice', data: unknown) => api.post<{ ok: boolean }>(`/chat/calls/${callId}/signal`, { to, kind, data }),
  poll: (callId: string) => api.get<{ ended: boolean; removed?: boolean; participants: CallParticipant[]; signals: CallSignal[]; declined?: string[] }>(`/chat/calls/${callId}/poll`),
  state: (callId: string, s: { mic?: boolean; cam?: boolean; screen?: boolean }) => api.post(`/chat/calls/${callId}/state`, s),
  leave: (callId: string) => api.post(`/chat/calls/${callId}/leave`),
  decline: (callId: string) => api.post(`/chat/calls/${callId}/decline`),
}

/** Leave even while the page is closing (cookie auth, so a beacon works). */
export function leaveOnUnload(callId: string): void {
  const base = import.meta.env.VITE_API_URL ?? '/api'
  try { navigator.sendBeacon?.(`${base}/chat/calls/${callId}/leave`) } catch { /* ignore */ }
}
