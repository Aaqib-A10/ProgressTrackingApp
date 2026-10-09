import { useRef, useState } from 'react'
import { Camera, Hash, Loader2, Trash2, Users } from 'lucide-react'
import { avatarUrl, removeAvatar, uploadAvatar, useAvatarIndex, type AvatarKind } from '../../lib/avatars'
import { errMsg } from '../../lib/projectsApi'
import { useToast } from './Toast'
import { cn } from '../../lib/cn'

/** A project's picture, or its coloured square with the key. */
export function ProjectPicture({ project, size = 40, className }: { project: { key: string; color?: string | null }; size?: number; className?: string }) {
  const url = avatarUrl(useAvatarIndex(), 'project', project.key)
  if (url) return <img src={url} alt={project.key} loading="lazy" className={cn('shrink-0 rounded-btn bg-slate-100 object-cover', className)} style={{ width: size, height: size }} />
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-btn font-bold text-white', className)} style={{ width: size, height: size, backgroundColor: project.color ?? '#64748B', fontSize: Math.max(10, Math.round(size * 0.3)) }}>
      {project.key.slice(0, 3)}
    </span>
  )
}

/** Picture for a project channel or group chat (direct chats use the person's picture). */
export function ChatPicture({ type, conversationId, projectKey, color, size = 32 }: { type: string; conversationId: string; projectKey?: string | null; color?: string | null; size?: number }) {
  const idx = useAvatarIndex()
  const url = type === 'PROJECT' ? avatarUrl(idx, 'project', projectKey) : avatarUrl(idx, 'chat', conversationId)
  if (url) return <img src={url} alt="" loading="lazy" className="shrink-0 rounded-btn bg-slate-100 object-cover" style={{ width: size, height: size }} />
  return (
    <span className="flex shrink-0 items-center justify-center rounded-btn text-white" style={{ width: size, height: size, backgroundColor: color ?? '#64748B' }}>
      {type === 'PROJECT' ? <Hash size={Math.round(size * 0.47)} /> : <Users size={Math.round(size * 0.47)} />}
    </span>
  )
}

/**
 * Change / remove a picture. Shows the current one with a camera button over it.
 * The image is cropped to the middle square and shrunk in the browser before upload.
 */
export function PictureEditor({ kind, id, label, preview, canEdit = true, onChanged }: { kind: AvatarKind; id: string; label: string; preview: React.ReactNode; canEdit?: boolean; onChanged?: () => void }) {
  const { addToast } = useToast()
  const idx = useAvatarIndex()
  const has = !!avatarUrl(idx, kind, id)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    try {
      await uploadAvatar(kind, id, f)
      addToast({ type: 'success', message: `${label} updated` })
      onChanged?.()
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error && !('status' in e) ? e.message : errMsg(e, 'Could not upload the picture') })
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        {preview}
        {canEdit && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-card ring-2 ring-card hover:bg-primary/90 disabled:opacity-60" aria-label={`Change ${label.toLowerCase()}`} title={`Change ${label.toLowerCase()}`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          </button>
        )}
      </div>
      {canEdit && (
        <div className="space-y-1">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="block text-body-sm font-semibold text-primary hover:underline">{has ? 'Change picture' : 'Upload a picture'}</button>
          {has && (
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await removeAvatar(kind, id); addToast({ type: 'success', message: `${label} removed` }); onChanged?.() } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) } }} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-danger">
              <Trash2 size={13} /> Remove
            </button>
          )}
          <p className="text-[12px] text-ink-muted">JPG, PNG or WebP. It is cropped to a square.</p>
        </div>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
