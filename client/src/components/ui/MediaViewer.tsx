import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface MediaItem {
  /** File address without ?inline (that one downloads). */
  href: string
  name: string
  kind: 'image' | 'video'
  size?: string
}

/**
 * Full-screen viewer for a picture or video sent in chat: it opens inside PulseTrack
 * instead of downloading. Download is a button on the side. Esc or a click on the
 * dark background closes it; a click on a picture zooms in and out.
 */
export function MediaViewer({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-body-md font-medium">{item.name}{item.size ? <span className="ml-2 text-body-sm text-white/60">{item.size}</span> : null}</span>
        {item.kind === 'image' && (
          <button type="button" onClick={() => setZoom((z) => !z)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label={zoom ? 'Fit to screen' : 'Actual size'} title={zoom ? 'Fit to screen' : 'Actual size'}>
            {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
          </button>
        )}
        <a href={item.href} className="inline-flex items-center gap-1.5 rounded-btn bg-white/10 px-3 py-1.5 text-body-sm font-semibold hover:bg-white/20" aria-label="Download">
          <Download size={16} /> Download
        </a>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close" title="Close (Esc)">
          <X size={20} />
        </button>
      </div>
      <div className={cn('flex min-h-0 flex-1 p-4', zoom ? 'overflow-auto' : 'items-center justify-center overflow-hidden')} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        {item.kind === 'image' ? (
          <img
            src={`${item.href}?inline=1`}
            alt={item.name}
            onClick={() => setZoom((z) => !z)}
            className={cn('select-none rounded', zoom ? 'm-auto max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain')}
          />
        ) : (
          <video src={`${item.href}?inline=1`} controls autoPlay className="max-h-full max-w-full rounded bg-black" />
        )}
      </div>
    </div>,
    document.body,
  )
}
