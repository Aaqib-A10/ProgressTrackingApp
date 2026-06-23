import { useEffect, useRef, useState } from 'react'
import { Upload, Download, Trash2, FileSpreadsheet, FileText, File as FileIcon, Loader2, Paperclip } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { ApiError } from '../lib/api'
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  attachmentHref,
  type Attachment,
  type AttachmentKind,
} from '../lib/attachmentsApi'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function FileGlyph({ name, mime }: { name: string; mime: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('spreadsheet') || mime.includes('csv')) {
    return <FileSpreadsheet size={18} className="text-success" />
  }
  if (['doc', 'docx', 'pdf', 'txt', 'rtf'].includes(ext) || mime.includes('word') || mime.includes('pdf')) {
    return <FileText size={18} className="text-primary" />
  }
  return <FileIcon size={18} className="text-ink-muted" />
}

export interface AttachmentsCardProps {
  kind: AttachmentKind
  /** Day the files belong to (defaults to today on the server). */
  date?: string
  disabled?: boolean
}

/** Daily-log file attachments — upload / list / download / remove. Used by ITAD & Lead Gen forms. */
export function AttachmentsCard({ kind, date, disabled }: AttachmentsCardProps) {
  const { addToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    listAttachments(kind, date)
      .then((r) => active && setFiles(r.attachments))
      .catch(() => active && setFiles([]))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [kind, date])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-picking the same file later
    if (!picked.length) return
    setBusy(true)
    for (const f of picked) {
      try {
        const att = await uploadAttachment(kind, f, date)
        setFiles((p) => [...p, att])
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : `Could not upload ${f.name}`
        addToast({ type: 'error', message: msg })
      }
    }
    setBusy(false)
  }

  async function remove(id: string) {
    const prev = files
    setFiles((p) => p.filter((f) => f.id !== id))
    try {
      await deleteAttachment(id)
    } catch {
      setFiles(prev)
      addToast({ type: 'error', message: 'Could not remove file.' })
    }
  }

  return (
    <Card
      title="Attachments"
      subtitle="Attach Excel, Word, PDF or other supporting files (max 25 MB each)"
      action={
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? 'Uploading…' : 'Add files'}
        </Button>
      }
    >
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} disabled={disabled} />

      {loading ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : files.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-bg py-8 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Paperclip size={22} className="text-ink-muted" />
          <span className="text-body-sm text-ink-muted">
            <span className="font-semibold text-primary">Click to upload</span> Excel, Word, PDF or other files
          </span>
        </button>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <FileGlyph name={f.originalName} mime={f.mimeType} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-ink">{f.originalName}</p>
                <p className="text-body-sm text-ink-muted">{formatBytes(f.size)}</p>
              </div>
              <a
                href={attachmentHref(f.id)}
                className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-slate-100 hover:text-primary"
                aria-label={`Download ${f.originalName}`}
              >
                <Download size={16} />
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-btn text-ink-muted hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove ${f.originalName}`}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
