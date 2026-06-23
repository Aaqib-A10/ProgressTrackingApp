import { api, ApiError } from './api'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export type AttachmentKind = 'ITAD' | 'LEAD_GEN'

export interface Attachment {
  id: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
  downloadUrl: string
}

/** Direct (cookie-authenticated) link the browser can hit to download a file. */
export function attachmentHref(id: string): string {
  return `${BASE_URL}/attachments/${id}/download`
}

export function listAttachments(kind: AttachmentKind, date?: string) {
  const qs = new URLSearchParams({ kind })
  if (date) qs.set('date', date)
  return api.get<{ attachments: Attachment[] }>(`/attachments?${qs.toString()}`)
}

/** Upload one file — the raw bytes are the request body. */
export async function uploadAttachment(kind: AttachmentKind, file: File, date?: string): Promise<Attachment> {
  const qs = new URLSearchParams({ kind, name: file.name })
  if (date) qs.set('date', date)
  const res = await fetch(`${BASE_URL}/attachments?${qs.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText)
    throw new ApiError(message || `Upload failed (${res.status})`, res.status)
  }
  return ((await res.json()) as { attachment: Attachment }).attachment
}

export function deleteAttachment(id: string) {
  return api.del<void>(`/attachments/${id}`)
}
