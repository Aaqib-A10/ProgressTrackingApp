import { api } from './api'
import type { Role } from './types'

export type Sentiment = 'PRAISE' | 'NEUTRAL' | 'IMPROVEMENT'

export interface FeedbackParticipant {
  id: string
  name: string
  email: string
  role: Role
}

/** Summary row for a feedback thread (list views). */
export interface FeedbackThread {
  id: string
  title: string | null
  body: string
  sentiment: Sentiment
  author: FeedbackParticipant
  recipient: FeedbackParticipant
  replyCount: number
  unread: boolean
  createdAt: string
  updatedAt: string
}

export interface FeedbackReply {
  id: string
  body: string
  author: FeedbackParticipant
  createdAt: string
}

/** Full thread with replies (detail view). */
export interface FeedbackDetail {
  id: string
  title: string | null
  body: string
  sentiment: Sentiment
  author: FeedbackParticipant
  recipient: FeedbackParticipant
  createdAt: string
  replies: FeedbackReply[]
}

export interface CreateFeedbackInput {
  recipientId: string
  title?: string
  body: string
  sentiment: Sentiment
}

/** Threads where the current user participates. */
export function listFeedback() {
  return api.get<{ feedback: FeedbackThread[] }>('/feedback')
}

/** Count of unread feedback threads — for the sidebar badge. */
export function getUnreadFeedbackCount() {
  return api.get<{ count: number }>('/feedback/unread-count')
}

/** Threads about a specific member (lead/admin/self). */
export function listMemberFeedback(recipientId: string) {
  return api.get<{ feedback: FeedbackThread[] }>(`/feedback?recipientId=${recipientId}`)
}

export function getFeedbackThread(id: string) {
  return api.get<FeedbackDetail>(`/feedback/${id}`)
}

export function createFeedback(input: CreateFeedbackInput) {
  return api.post<{ feedback: FeedbackThread }>('/feedback', input)
}

export function replyToFeedback(id: string, body: string) {
  return api.post<{ reply: FeedbackReply }>(`/feedback/${id}/replies`, { body })
}
