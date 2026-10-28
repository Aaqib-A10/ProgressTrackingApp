import { api } from './api'

// The Help button (erp, step 0): complaints and questions to Metriq support.
export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_COMPANY' | 'RESOLVED'
export interface MyTicket {
  id: string; number: number; subject: string; body: string; status: SupportStatus; createdAt: string; updatedAt: string
  messages: { id: string; fromOwner: boolean; authorName: string; body: string; createdAt: string }[]
}
export const getSupportStatus = () => api.get<{ enabled: boolean }>('/support/status')
export const sendSupport = (input: { subject: string; body: string; pageUrl?: string; userAgent?: string }) =>
  api.post<{ ticket: { id: string; number: number } }>('/support', input)
export const getMyTickets = () => api.get<{ tickets: MyTicket[] }>('/support/mine')
export const replyMyTicket = (id: string, body: string) => api.post<{ ok: true }>(`/support/mine/${id}/reply`, { body })
export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = { OPEN: 'Sent', IN_PROGRESS: 'Support is on it', WAITING_ON_COMPANY: 'Waiting for your answer', RESOLVED: 'Solved' }
