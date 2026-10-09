import { api } from './api'
import type { Presence } from './chatApi'

export type MeetingResponse = 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'
export type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekly'

export interface Meeting {
  id: string
  title: string
  agenda: string
  startsAt: string
  endsAt: string
  organizer: { id: string; name: string; presence: Presence }
  isOrganizer: boolean
  myResponse: MeetingResponse | 'ORGANIZER' | null
  attendees: { id: string; name: string; response: MeetingResponse; presence: Presence }[]
  conversationId: string
  project: { key: string; name: string; color: string } | null
  seriesId: string | null
  repeat: string | null
  autoNotes: boolean
  cancelled: boolean
  link: string
  live: { callId: string; video: boolean; participants: { userId: string; name: string }[] } | null
}

export interface MeetingCall {
  id: string
  startedAt: string
  endedAt: string | null
  durationSec: number | null
  joinedCount: number
  notes: string | null
  recordings: { id: string; url: string | null; durationSec: number | null; size: number }[]
}

export interface MeetingInput {
  title: string
  agenda: string
  startsAt: string
  endsAt: string
  attendeeIds: string[]
  projectKey?: string | null
  repeat?: RepeatKind
  repeatCount?: number
  autoNotes?: boolean
}

export const meetingsApi = {
  list: (from: Date, to: Date) => api.get<{ meetings: Meeting[] }>(`/meetings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  get: (id: string) => api.get<{ meeting: Meeting; isAttendee: boolean; calls: MeetingCall[]; series: { id: string; startsAt: string }[] }>(`/meetings/${id}`),
  create: (body: MeetingInput) => api.post<{ meeting: Meeting; count: number }>('/meetings', body),
  update: (id: string, body: Partial<MeetingInput> & { series?: boolean }) => api.patch<{ meeting: Meeting }>(`/meetings/${id}`, body),
  cancel: (id: string, series = false) => api.post<{ cancelled: number }>(`/meetings/${id}/cancel`, { series }),
  respond: (id: string, response: Exclude<MeetingResponse, 'PENDING'>, series = false) => api.post<{ meeting: Meeting }>(`/meetings/${id}/respond`, { response, series }),
  join: (id: string) => api.post<{ meeting: Meeting }>(`/meetings/${id}/join`),
  icsUrl: (id: string) => `${import.meta.env.VITE_API_URL ?? '/api'}/meetings/${id}/ics`,
}

/** "Fri 10 Oct" */
export const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
/** "3:00 PM" */
export const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export const fmtRange = (a: string, b: string) => {
  const x = new Date(a)
  const y = new Date(b)
  return x.toDateString() === y.toDateString() ? `${fmtDay(x)}, ${fmtTime(x)} to ${fmtTime(y)}` : `${fmtDay(x)}, ${fmtTime(x)} to ${fmtDay(y)}, ${fmtTime(y)}`
}
