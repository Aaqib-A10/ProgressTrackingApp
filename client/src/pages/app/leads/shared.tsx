import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Ban, CheckCircle2, Info } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { apiErrorText } from '../../../lib/api'
import { leadsApi, type Fact, type LeadRow, type LeadsMeta, type MetaBusiness, type PipelineStatus, type Warning } from '../../../lib/leadsApi'

/** Small parts shared by the Lead Management screens. */

// ------------------------------------------------------------------ meta (the businesses I work in)

const MetaCtx = createContext<{ meta: LeadsMeta | null; error: string; reload: () => void } | null>(null)
let cached: LeadsMeta | null = null

export function LeadsMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<LeadsMeta | null>(cached)
  const [error, setError] = useState('')
  const reload = useCallback(() => { leadsApi.meta().then((m) => { cached = m; setMeta(m); setError('') }).catch((e) => setError(apiErrorText(e, 'Lead Management is not available'))) }, [])
  useEffect(() => { reload() }, [reload])
  return <MetaCtx.Provider value={{ meta, error, reload }}>{children}</MetaCtx.Provider>
}
export function useLeadsMeta() {
  const v = useContext(MetaCtx)
  if (!v) throw new Error('useLeadsMeta outside LeadsMetaProvider')
  return v
}

/** The business the screens work in: ?business= in the address, else the last one used, else the first. */
export function useBusiness(): { business: MetaBusiness | null; businesses: MetaBusiness[]; setBusiness: (id: string) => void; all: boolean } {
  const { meta } = useLeadsMeta()
  const [params, setParams] = useSearchParams()
  const list = useMemo(() => (meta?.businesses ?? []).filter((b) => b.isActive || b.myRole), [meta])
  const fromUrl = params.get('business')
  let remembered: string | null = null
  try { remembered = localStorage.getItem('leads.business') } catch { /* private window */ }
  const id = fromUrl ?? (list.length === 1 ? list[0].id : remembered && list.some((b) => b.id === remembered) ? remembered : list.length ? list[0].id : null)
  const business = list.find((b) => b.id === id) ?? null
  const setBusiness = (next: string) => {
    setParams((p) => { const q = new URLSearchParams(p); if (next) q.set('business', next); else q.delete('business'); q.delete('page'); return q })
    try { localStorage.setItem('leads.business', next) } catch { /* ignore */ }
  }
  return { business, businesses: list, setBusiness, all: fromUrl === 'all' }
}

export function BusinessPicker({ allowAll }: { allowAll?: boolean }) {
  const { business, businesses, setBusiness, all } = useBusiness()
  if (businesses.length < 2 && !allowAll) return null
  return (
    <Select value={all ? 'all' : business?.id ?? ''} onChange={(e) => setBusiness(e.target.value)} aria-label="Business" className="min-w-[180px]">
      {allowAll && <option value="all">All businesses</option>}
      {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}{b.kind === 'CMR' && !/cmr/i.test(b.name) ? ' · CMR flow' : ''}</option>)}
    </Select>
  )
}

// ------------------------------------------------------------------ bits

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('h-9 rounded-btn border border-line bg-card px-2.5 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:opacity-60', className)}>{children}</select>
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return <span className="mb-1.5 block text-body-sm font-medium text-ink">{children}{hint && <span className="ml-1 font-normal text-ink-faint">{hint}</span>}</span>
}

export function StatusPill({ status, pipeline, label, size = 'md' }: { status: string; pipeline?: PipelineStatus[]; label?: string; size?: 'sm' | 'md' }) {
  const st = pipeline?.find((s) => s.key === status)
  const color = st?.color ?? '#64748B'
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold', size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-[12px]')} style={{ background: `${color}1a`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{label ?? st?.label ?? status}
    </span>
  )
}

/** The five facts as five dots (CMR). */
export function FactsMeter({ facts, size = 'md' }: { facts: Fact[]; size?: 'sm' | 'md' }) {
  if (!facts.length) return null
  const done = facts.filter((f) => f.done).length
  return (
    <span className="inline-flex items-center gap-1" title={facts.map((f) => `${f.done ? '✓' : '○'} ${f.label}`).join('\n')} aria-label={`${done} of 5 facts`}>
      {facts.map((f) => <span key={f.key} className={cn('rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2', f.done ? 'bg-success' : 'bg-line-strong')} />)}
      <span className={cn('ml-1 tabular-nums text-ink-muted', size === 'sm' ? 'text-[11px]' : 'text-body-sm')}>{done}/5</span>
    </span>
  )
}

export function WarningList({ warnings, compact }: { warnings: Warning[]; compact?: boolean }) {
  if (!warnings.length) return null
  return (
    <ul className={cn('space-y-1.5', compact && 'space-y-1')}>
      {warnings.map((w) => (
        <li key={w.key} className={cn('flex items-start gap-2 rounded-btn px-3 py-2 text-body-sm', w.level === 'stop' ? 'bg-danger/10 text-danger' : w.level === 'warn' ? 'bg-warning/10 text-amber-800 dark:text-amber-300' : 'bg-primary/[0.06] text-ink')}>
          {w.level === 'stop' ? <Ban size={15} className="mt-0.5 shrink-0" /> : w.level === 'warn' ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : <Info size={15} className="mt-0.5 shrink-0 text-primary" />}
          <span>{w.text}</span>
        </li>
      ))}
    </ul>
  )
}

export const initials = (n: string) => n.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
}

export function PageHeader({ title, hint, back, actions, children }: { title: string; hint?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link to={back.to} className="text-body-sm text-ink-muted hover:text-ink">← {back.label}</Link>}
        <h1 className="text-headline-lg text-ink">{title}</h1>
        {hint && <p className="mt-0.5 text-body-md text-ink-muted">{hint}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Tile({ label, value, color, hint, active, onClick, icon }: { label: string; value: number | string; color: string; hint?: ReactNode; active?: boolean; onClick?: () => void; icon?: ReactNode }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('group relative overflow-hidden rounded-card border bg-card p-4 text-left shadow-xs transition-all', onClick && 'hover:-translate-y-0.5 hover:shadow-md', active ? 'border-primary ring-2 ring-primary/20' : 'border-line')}>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-body-sm font-medium text-ink-muted">{label}</span>
        {icon && <span className="rounded-md p-1" style={{ background: `${color}1a`, color }}>{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] font-bold tabular-nums leading-none text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-[11.5px] text-ink-faint">{hint}</div>}
    </Tag>
  )
}

export function Done({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 text-body-sm', ok ? 'text-success' : 'text-ink-faint')}>{ok ? <CheckCircle2 size={14} /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-line-strong" />}{children}</span>
}

/** Flat lead number for a CMR lead: the segment, state and SDR in one line. */
export const leadMetaLine = (l: LeadRow) => [l.industry, l.state, l.assignee?.name ? `SDR ${l.assignee.name}` : 'Unassigned'].filter(Boolean).join(' · ')

export const DATE_RANGES: { key: string; label: string }[] = [
  { key: 'all', label: 'All Time' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' }, { key: 'last_month', label: 'Last Month' }, { key: 'custom', label: 'Custom' },
]
