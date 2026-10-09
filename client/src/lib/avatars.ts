import { useSyncExternalStore } from 'react'
import { api } from './api'

/**
 * Who has a profile picture. One small list for the whole app (refreshed every few
 * minutes and right after an upload); everyone else keeps their coloured initials,
 * so the app never asks the server for pictures that do not exist.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api'

interface Index { users: Record<string, number>; projects: Record<string, number>; chats: Record<string, number> }
let index: Index = { users: {}, projects: {}, chats: {} }
let loaded = false
const subs = new Set<() => void>()
let timer: number | undefined

async function load(): Promise<void> {
  try {
    index = await api.get<Index>('/avatars')
    loaded = true
    subs.forEach((f) => f())
  } catch { /* not signed in yet / offline */ }
}

function subscribe(fn: () => void): () => void {
  subs.add(fn)
  if (!loaded && subs.size === 1) void load()
  if (!timer) timer = window.setInterval(() => { void load() }, 5 * 60_000)
  return () => { subs.delete(fn) }
}

export function refreshAvatars(): void {
  void load()
}

export function useAvatarIndex(): Index {
  return useSyncExternalStore(subscribe, () => index, () => index)
}

export type AvatarKind = 'user' | 'project' | 'chat'

export function avatarUrl(idx: Index, kind: AvatarKind, id: string | null | undefined): string | null {
  if (!id) return null
  const v = kind === 'user' ? idx.users[id] : kind === 'project' ? idx.projects[id] : idx.chats[id]
  return v ? `${BASE}/avatars/${kind}/${encodeURIComponent(id)}?v=${v}` : null
}

/** Crop the middle square of an image and shrink it to a 256px JPEG (done in the browser). */
export async function squareJpeg(file: File, size = 256): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file (JPG, PNG or WebP)')
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large (max 15 MB)')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new Error('Could not read that image'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not process the image'))), 'image/jpeg', 0.88))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function uploadAvatar(kind: AvatarKind, id: string, file: File): Promise<void> {
  const blob = await squareJpeg(file)
  await api.postRaw(`/avatars/${kind}/${encodeURIComponent(id)}`, blob, 'image/jpeg')
  await load()
}

export async function removeAvatar(kind: AvatarKind, id: string): Promise<void> {
  await api.del(`/avatars/${kind}/${encodeURIComponent(id)}`)
  await load()
}
