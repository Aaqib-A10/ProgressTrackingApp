import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Plus, Tag, X } from 'lucide-react'
import type { Label, PersonRef } from '../../lib/projectsApi'
import { PersonAvatar } from './pmUi'
import { cn } from '../../lib/cn'

/** Click-outside popover shell used by the pickers. */
export function Popover({ trigger, children, align = 'left', width = 'w-64', disabled }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => !disabled && setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className={cn('absolute z-50 mt-1 animate-scale-in overflow-hidden rounded-card border border-line bg-card shadow-overlay', width, align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Multi-select of project members (assignees). */
export function PeoplePicker({ people, value, onChange, disabled, placeholder = 'Unassigned' }: { people: PersonRef[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('')
  const selected = people.filter((p) => value.includes(p.id))
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Popover
      disabled={disabled}
      trigger={(open) => (
        <button type="button" disabled={disabled} className={cn('flex min-h-10 w-full items-center gap-2 rounded-btn border bg-card px-2.5 py-1.5 text-left text-body-md', open ? 'border-primary ring-4 ring-primary/10' : 'border-line', disabled && 'cursor-not-allowed bg-slate-50')}>
          {selected.length === 0 ? <span className="flex-1 text-ink-muted">{placeholder}</span> : (
            <span className="flex flex-1 flex-wrap gap-1">
              {selected.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 text-body-sm text-ink">
                  <PersonAvatar person={p} size={18} />{p.name}
                </span>
              ))}
            </span>
          )}
          {!disabled && <ChevronDown size={15} className="shrink-0 text-ink-muted" />}
        </button>
      )}
    >
      {() => (
        <div>
          <div className="border-b border-line p-2"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="h-8 w-full rounded-btn border border-line px-2 text-body-sm focus:border-primary focus:outline-none" /></div>
          <ul className="max-h-60 overflow-y-auto p-1">
            {list.map((p) => {
              const on = value.includes(p.id)
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-body-md hover:bg-slate-50">
                    <PersonAvatar person={p} size={22} />
                    <span className="flex-1 truncate">{p.name}</span>
                    {on && <Check size={15} className="text-primary" />}
                  </button>
                </li>
              )
            })}
            {list.length === 0 && <li className="px-2 py-3 text-body-sm text-ink-muted">Nobody matches. Only project members can be assigned.</li>}
          </ul>
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="w-full border-t border-line px-3 py-2 text-left text-body-sm text-ink-muted hover:bg-slate-50">Clear</button>}
        </div>
      )}
    </Popover>
  )
}

/** Multi-select of project labels, with inline "create label". */
export function LabelPicker({ labels, value, onChange, onCreate, disabled }: { labels: Label[]; value: string[]; onChange: (ids: string[]) => void; onCreate?: (name: string) => Promise<Label | null>; disabled?: boolean }) {
  const [q, setQ] = useState('')
  const selected = labels.filter((l) => value.includes(l.id))
  const list = labels.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()))
  const exact = labels.some((l) => l.name.toLowerCase() === q.trim().toLowerCase())
  return (
    <Popover
      disabled={disabled}
      trigger={(open) => (
        <button type="button" disabled={disabled} className={cn('flex min-h-10 w-full items-center gap-2 rounded-btn border bg-card px-2.5 py-1.5 text-left text-body-md', open ? 'border-primary ring-4 ring-primary/10' : 'border-line', disabled && 'cursor-not-allowed bg-slate-50')}>
          {selected.length === 0 ? <span className="flex flex-1 items-center gap-1.5 text-ink-muted"><Tag size={14} /> No labels</span> : (
            <span className="flex flex-1 flex-wrap gap-1">{selected.map((l) => <LabelChip key={l.id} label={l} />)}</span>
          )}
          {!disabled && <ChevronDown size={15} className="shrink-0 text-ink-muted" />}
        </button>
      )}
    >
      {() => (
        <div>
          <div className="border-b border-line p-2"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or create" className="h-8 w-full rounded-btn border border-line px-2 text-body-sm focus:border-primary focus:outline-none" /></div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {list.map((l) => {
              const on = value.includes(l.id)
              return (
                <li key={l.id}>
                  <button type="button" onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])} className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left hover:bg-slate-50">
                    <LabelChip label={l} />
                    <span className="flex-1" />
                    {on && <Check size={15} className="text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {onCreate && q.trim() && !exact && (
            <button
              type="button"
              onClick={async () => { const l = await onCreate(q.trim()); if (l) { onChange([...value, l.id]); setQ('') } }}
              className="flex w-full items-center gap-1.5 border-t border-line px-3 py-2 text-left text-body-sm font-medium text-primary hover:bg-slate-50"
            >
              <Plus size={14} /> Create label "{q.trim()}"
            </button>
          )}
        </div>
      )}
    </Popover>
  )
}

export function LabelChip({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${label.color}1f`, color: label.color }}>
      {label.name}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${label.name}`}><X size={11} /></button>}
    </span>
  )
}
