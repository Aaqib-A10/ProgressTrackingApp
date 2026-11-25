import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { dataTint } from '../../../theme/css'
import { cn } from '../../../lib/cn'
import type { LeadTag } from '../../../lib/leadsApi'
import { useLeadsMeta } from './shared'

/**
 * Lead tags (25 Nov 2026): each business makes its own list (Wholesale, Retail, Distributor...) with a colour, in
 * Lead Settings → Tags. Leads keep the labels; these pieces show them in the list's colours and let people pick them.
 */

/** Colours a new tag gets in turn (mirrors the server's TAG_COLORS); the person can change it. */
export const TAG_COLORS = ['#4F46E5', '#0EA5E9', '#14B8A6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
/** A tag that is not on the business's list (an older lead, an import) shows grey. */
const OFF_LIST = '#64748B'

export const sameTag = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const tagColor = (list: LeadTag[] | undefined, label: string) => list?.find((t) => sameTag(t.label, label))?.color ?? OFF_LIST

/** The tag list of a lead's business, from the Leads meta (for screens that show leads of several businesses). */
export function useTagList(businessId: string | null | undefined): LeadTag[] {
  const { meta } = useLeadsMeta()
  return meta?.businesses.find((b) => b.id === businessId)?.tagList ?? []
}

export function TagChip({ label, color, onRemove, className }: { label: string; color: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', className)} style={dataTint(color, 0.14)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
      {onRemove && <button type="button" className="-mr-0.5 rounded-full opacity-60 hover:opacity-100" onClick={onRemove} aria-label={`Remove ${label}`}><X size={11} /></button>}
    </span>
  )
}

/** A lead's tags as coloured chips; `max` shows the first few and "+2" for the rest. */
export function TagChips({ tags, list, max, className }: { tags: string[]; list: LeadTag[] | undefined; max?: number; className?: string }) {
  if (!tags.length) return null
  const shown = max ? tags.slice(0, max) : tags
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {shown.map((t) => <TagChip key={t} label={t} color={tagColor(list, t)} />)}
      {tags.length > shown.length && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted dark:bg-white/10" title={tags.slice(shown.length).join(', ')}>+{tags.length - shown.length}</span>}
    </span>
  )
}

/**
 * Picking a lead's tags: click a tag of the business's list to put it on or take it off. `canAdd` also lets the
 * person type a new one (a manager, or anyone while the business has no list yet, as before tags had a list).
 */
export function TagPicker({ value, onChange, list, canAdd, hint }: { value: string[]; onChange: (v: string[]) => void; list: LeadTag[]; canAdd: boolean; hint?: string }) {
  const [text, setText] = useState('')
  const has = (t: string) => value.some((v) => sameTag(v, t))
  const toggle = (t: string) => onChange(has(t) ? value.filter((v) => !sameTag(v, t)) : [...value, t])
  const add = () => {
    const t = text.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!t) return
    const onList = list.find((x) => sameTag(x.label, t))
    if (!has(t)) onChange([...value, onList?.label ?? t])
    setText('')
  }
  // Tags the lead has that are not on the list (older leads, an import) stay, and can be taken off.
  const offList = value.filter((v) => !list.some((t) => sameTag(t.label, v)))
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((t) => {
          const on = has(t.label)
          return (
            <button key={t.label} type="button" aria-pressed={on} onClick={() => toggle(t.label)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-body-sm font-semibold transition-colors', on ? 'border-transparent' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink')}
              style={on ? dataTint(t.color, 0.16) : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: t.color, opacity: on ? 1 : 0.55 }} />{t.label}
            </button>
          )
        })}
        {offList.map((t) => <TagChip key={t} label={t} color={OFF_LIST} className="py-1 text-body-sm" onRemove={() => toggle(t)} />)}
        {!list.length && !offList.length && !canAdd && <span className="text-body-sm text-ink-faint">No tags yet.</span>}
      </div>
      {canAdd && (
        <div className="mt-2 flex max-w-sm items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} maxLength={40}
            placeholder={list.length ? 'New tag' : 'Add a tag, e.g. Wholesale'} aria-label="New tag"
            className="h-8 min-w-0 flex-1 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none" />
          <button type="button" disabled={!text.trim()} onClick={add} className="inline-flex h-8 items-center gap-1 rounded-btn px-2 text-body-sm font-semibold text-primary-ink hover:bg-primary/5 disabled:opacity-40"><Plus size={14} />Add</button>
        </div>
      )}
      {hint && <p className="mt-1.5 text-[11.5px] text-ink-muted">{hint}</p>}
    </div>
  )
}
