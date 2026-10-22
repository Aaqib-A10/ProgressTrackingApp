import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, ChevronsUp, Minus } from 'lucide-react'
// (Arrow icons stay in PRIORITY_META for menus that list priorities.)
import type { ColumnCategory, PersonRef, PmPriority, PmRole } from '../../lib/projectsApi'
import { cn } from '../../lib/cn'
import { avatarUrl, useAvatarIndex } from '../../lib/avatars'

// Small shared pieces for the Projects screens (cards, drawer, lists).

export const PRIORITY_META: Record<PmPriority, { label: string; cls: string; icon: JSX.Element }> = {
  LOW: { label: 'Low', cls: 'text-slate-500', icon: <ArrowDown size={14} /> },
  MEDIUM: { label: 'Medium', cls: 'text-primary', icon: <Minus size={14} /> },
  HIGH: { label: 'High', cls: 'text-warning', icon: <ArrowUp size={14} /> },
  URGENT: { label: 'Urgent', cls: 'text-danger', icon: <ChevronsUp size={14} /> },
}
export const PRIORITIES: PmPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

export const ROLE_META: Record<PmRole, string> = { ADMIN: 'Project admin', MEMBER: 'Member', VIEWER: 'Viewer' }

export const CATEGORY_LABEL: Record<ColumnCategory, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' }

export const SWATCHES = ['#4F46E5', '#14B8A6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9', '#EC4899', '#64748B', '#16A34A', '#2563EB', '#B45309']

/** Linear-style priority: signal bars (low 1, medium 2, high 3) and a red square for urgent. */
export function PriorityGlyph({ priority, size = 14 }: { priority: PmPriority; size?: number }) {
  if (priority === 'URGENT') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="text-danger">
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
        <rect x="7.1" y="4" width="1.8" height="5.2" rx="0.9" fill="white" />
        <rect x="7.1" y="10.6" width="1.8" height="1.8" rx="0.9" fill="white" />
      </svg>
    )
  }
  const on = priority === 'HIGH' ? 3 : priority === 'MEDIUM' ? 2 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 4.5} y={10 - i * 3.5} width="3" height={4 + i * 3.5} rx="1" fill="currentColor" className={i < on ? 'text-ink-muted' : 'text-slate-300'} />
      ))}
    </svg>
  )
}

export function PriorityIcon({ priority, withLabel }: { priority: PmPriority; withLabel?: boolean }) {
  const m = PRIORITY_META[priority]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium', priority === 'URGENT' ? 'text-danger' : 'text-ink-muted')} title={`${m.label} priority`} aria-label={`${m.label} priority`}>
      <PriorityGlyph priority={priority} />
      {withLabel && m.label}
    </span>
  )
}

/**
 * Linear-style status circle for a board column: dashed for backlog, empty for to do,
 * half for in progress, three quarters for review, a slash for blocked, a tick for done.
 */
export function StatusIcon({ name, category, color, size = 14 }: { name: string; category: ColumnCategory; color?: string | null; size?: number }) {
  const n = name.toLowerCase()
  const c = color ?? (category === 'DONE' ? 'rgb(var(--success))' : category === 'IN_PROGRESS' ? 'rgb(var(--warning))' : 'rgb(var(--ink-faint))')
  const ring = <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.6" strokeDasharray={n.includes('backlog') ? '2.2 2.2' : undefined} />
  let inner: JSX.Element | null = null
  if (category === 'DONE') inner = <><circle cx="8" cy="8" r="6.8" fill={c} /><path d="M5.3 8.2l1.8 1.8 3.6-3.8" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>
  else if (n.includes('block')) inner = <path d="M4.3 11.7l7.4-7.4" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
  else if (n.includes('review')) inner = <path d="M8 8V3.6A4.4 4.4 0 1 1 3.6 8z" fill={c} />
  else if (category === 'IN_PROGRESS') inner = <path d="M8 8V3.6a4.4 4.4 0 0 1 0 8.8z" fill={c} />
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {category !== 'DONE' && ring}
      {inner}
    </svg>
  )
}

const AVATAR_COLORS = ['#4F46E5', '#0EA5E9', '#14B8A6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#0891B2', '#B45309']
export function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export function PersonAvatar({ person, size = 24, ring, presence }: { person: PersonRef; size?: number; ring?: boolean; presence?: 'online' | 'away' | 'offline' | 'busy' }) {
  const c = colorFor(person.id)
  const url = avatarUrl(useAvatarIndex(), 'user', person.id)
  return (
    <span className="relative inline-flex shrink-0" title={person.name}>
      {url ? (
        <img src={url} alt={person.name} loading="lazy" className={cn('rounded-full bg-slate-100 object-cover', ring && 'ring-2 ring-card')} style={{ width: size, height: size }} />
      ) : (
        <span
          className={cn('inline-flex items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-card')}
          style={{ width: size, height: size, backgroundColor: c, fontSize: Math.max(9, Math.round(size * 0.4)) }}
        >
          {initialsOf(person.name)}
        </span>
      )}
      {presence && (
        <span
          className={cn('absolute -bottom-0 -right-0 rounded-full ring-2 ring-card', presence === 'online' ? 'bg-success' : presence === 'busy' ? 'bg-danger' : presence === 'away' ? 'bg-warning' : 'bg-slate-300')}
          style={{ width: Math.max(7, size * 0.3), height: Math.max(7, size * 0.3) }}
          aria-label={presence === 'busy' ? 'In a call' : presence}
        />
      )}
    </span>
  )
}

export function AvatarStack({ people, max = 3, size = 24 }: { people: PersonRef[]; max?: number; size?: number }) {
  if (!people.length) return <span className="text-body-sm text-ink-muted">Unassigned</span>
  const shown = people.slice(0, max)
  return (
    <span className="flex -space-x-1.5">
      {shown.map((p) => <PersonAvatar key={p.id} person={p} size={size} ring />)}
      {people.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-ink-muted ring-2 ring-card" style={{ width: size, height: size }}>
          +{people.length - max}
        </span>
      )}
    </span>
  )
}

/** "7 Oct, 6:00 PM" */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
export function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return fmtShort(iso)
}
export function fmtSpan(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

export type DueState = 'none' | 'normal' | 'soon' | 'overdue' | 'done'
export function dueState(dueAt: string | null, category: ColumnCategory, now = Date.now()): DueState {
  if (!dueAt) return 'none'
  if (category === 'DONE') return 'done'
  const t = new Date(dueAt).getTime()
  if (t < now) return 'overdue'
  if (t - now < 24 * 3600000) return 'soon'
  return 'normal'
}

export function DueChip({ dueAt, category, compact }: { dueAt: string | null; category: ColumnCategory; compact?: boolean }) {
  const st = dueState(dueAt, category)
  if (st === 'none') return null
  const cls = {
    normal: 'text-ink-muted border-line',
    soon: 'text-warning border-warning/30 bg-warning/[0.06]',
    overdue: 'text-danger border-danger/30 bg-danger/[0.06]',
    done: 'text-ink-faint border-line',
  }[st]
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums', cls)} title={`Due ${fmtDateTime(dueAt!)}`}>
      {st === 'overdue' ? <AlertTriangle size={11} /> : <CalendarClock size={11} />}
      {st === 'overdue' ? (compact ? `Overdue · ${fmtShort(dueAt!)}` : `Overdue · ${fmtShort(dueAt!)}`) : fmtShort(dueAt!)}
    </span>
  )
}

/** ISO instant → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null)

export const fieldCls = 'h-9 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink shadow-xs focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:bg-slate-50 disabled:text-ink-muted'

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

