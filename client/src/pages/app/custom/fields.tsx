import { ExternalLink } from 'lucide-react'
import { cn } from '../../../lib/cn'
import type { CustomField } from '../../../lib/customApi'

/** Inputs and display for the fields of a block of the company's own (Department Studio, part C). */

export const fieldCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:bg-slate-50'

export function FieldInput({ f, value, onChange, people, disabled }: { f: CustomField; value: unknown; onChange: (v: unknown) => void; people: { id: string; name: string }[]; disabled?: boolean }) {
  const id = `f-${f.key}`
  const label = <span className="mb-1 block text-body-sm font-semibold text-ink">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
  const str = value == null ? '' : String(value)
  switch (f.type) {
    case 'longtext':
      return <label htmlFor={id} className="block">{label}<textarea id={id} disabled={disabled} rows={4} maxLength={5000} value={str} onChange={(e) => onChange(e.target.value)} className={cn(fieldCls, 'h-auto py-2')} /></label>
    case 'number':
      return <label htmlFor={id} className="block">{label}<input id={id} disabled={disabled} type="number" step="any" value={str} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={fieldCls} /></label>
    case 'date':
      return <label htmlFor={id} className="block">{label}<input id={id} disabled={disabled} type="date" value={str} onChange={(e) => onChange(e.target.value || null)} className={fieldCls} /></label>
    case 'select':
      return <label htmlFor={id} className="block">{label}<select id={id} disabled={disabled} value={str} onChange={(e) => onChange(e.target.value || null)} className={fieldCls}><option value="">—</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
    case 'checkbox':
      return <label htmlFor={id} className="flex items-center gap-2 pt-6 text-body-md text-ink"><input id={id} disabled={disabled} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />{f.label}</label>
    case 'person':
      return <label htmlFor={id} className="block">{label}<select id={id} disabled={disabled} value={str} onChange={(e) => onChange(e.target.value || null)} className={fieldCls}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    case 'url':
      return <label htmlFor={id} className="block">{label}<input id={id} disabled={disabled} type="url" maxLength={500} placeholder="https://" value={str} onChange={(e) => onChange(e.target.value)} className={fieldCls} /></label>
    default:
      return <label htmlFor={id} className="block">{label}<input id={id} disabled={disabled} maxLength={500} value={str} onChange={(e) => onChange(e.target.value)} className={fieldCls} /></label>
  }
}

/** A value as text (for search, CSV and sorting). */
export function valueText(f: CustomField, v: unknown, people: { id: string; name: string }[]): string {
  if (v == null || v === '') return ''
  if (f.type === 'checkbox') return v === true ? 'Yes' : 'No'
  if (f.type === 'person') return people.find((p) => p.id === v)?.name ?? ''
  if (f.type === 'date') return new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return String(v)
}

/** A value for the table and the board. */
export function FieldValue({ f, v, people, color }: { f: CustomField; v: unknown; people: { id: string; name: string }[]; color?: string }) {
  if (v == null || v === '') return <span className="text-ink-faint">—</span>
  if (f.type === 'select') return <span className="inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${color ?? '#6366F1'}1a`, color: color ?? '#6366F1' }}>{String(v)}</span>
  if (f.type === 'url') return <a href={String(v)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-[220px] items-center gap-1 truncate text-primary underline">{String(v).replace(/^https?:\/\//, '')}<ExternalLink size={11} className="shrink-0" /></a>
  if (f.type === 'longtext') return <span className="line-clamp-2 whitespace-pre-wrap break-words">{String(v)}</span>
  if (f.type === 'number') return <span className="tabular-nums">{Number(v).toLocaleString()}</span>
  return <span>{valueText(f, v, people)}</span>
}
