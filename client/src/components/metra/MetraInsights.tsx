import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, CalendarRange, Check, ExternalLink, Sparkles, Sun, X } from 'lucide-react'
import { metraApi, type MetraInsight } from '../../lib/metraApi'
import { cn } from '../../lib/cn'

type Brief = Extract<MetraInsight, { kind: 'BRIEF' }>
type NextStep = Extract<MetraInsight, { kind: 'NEXT_STEP' }>
type Alert = Extract<MetraInsight, { kind: 'ALERT' }>
type Weekly = Extract<MetraInsight, { kind: 'WEEKLY' }>

function dueText(due: string): string {
  const d = new Date(`${due}T00:00:00`)
  if (Number.isNaN(d.getTime())) return due
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * What Metra noticed for this person (above the suggestions): the shift brief, and the next steps whose day
 * has passed (a call back promised, not made yet). `focusId` puts one brief on top (the bell's link).
 */
export function MetraInsights({ onAsk, focusId, onNavigate, compact }: { onAsk: (q: string) => void; focusId?: string | null; onNavigate?: () => void; compact?: boolean }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<MetraInsight[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    metraApi.insights().then((xs) => { if (alive) setItems(xs) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [])
  const setState = useCallback(async (id: string, state: 'DONE' | 'DISMISSED') => {
    setBusy(id)
    try { await metraApi.setInsight(id, state); setItems((xs) => xs?.filter((x) => x.id !== id) ?? null) } catch { /* stays, can try again */ } finally { setBusy(null) }
  }, [])
  if (!items?.length) return null
  const briefs = items.filter((x): x is Brief => x.kind === 'BRIEF').sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : b.createdAt.localeCompare(a.createdAt)))
  const brief = briefs[0]
  const steps = items.filter((x): x is NextStep => x.kind === 'NEXT_STEP')
  const alerts = items.filter((x): x is Alert => x.kind === 'ALERT')
  const weekly = items.filter((x): x is Weekly => x.kind === 'WEEKLY').sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : b.createdAt.localeCompare(a.createdAt)))[0]
  return (
    <div className="w-full space-y-3 text-left">
      {alerts.length > 0 && (
        <section aria-label="Metra noticed" className="rounded-card border border-line bg-card shadow-card">
          <p className="flex items-center gap-1.5 border-b border-line px-3.5 py-2 text-body-sm font-semibold text-ink"><BellRing size={14} className="text-warning-ink" />Metra noticed <span className="font-normal text-ink-muted">({alerts.length})</span></p>
          <ul className="divide-y divide-line">
            {alerts.slice(0, compact ? 3 : 20).map((a) => (
              <li key={a.id} className="px-3.5 py-2.5">
                <p className="text-body-md font-medium text-ink">{a.title}</p>
                {a.payload?.text && <p className="mt-0.5 text-body-sm text-ink-muted">{a.payload.text}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.payload?.link && <SmallBtn onClick={() => { navigate(a.payload.link!); onNavigate?.() }}><ExternalLink size={12} />Open</SmallBtn>}
                  <SmallBtn onClick={() => onAsk(`${a.title}. What should I do about it?`)}><Sparkles size={12} />Ask Metra</SmallBtn>
                  <SmallBtn disabled={busy === a.id} onClick={() => void setState(a.id, 'DONE')}><Check size={12} />Done</SmallBtn>
                  <SmallBtn disabled={busy === a.id} onClick={() => void setState(a.id, 'DISMISSED')}>Dismiss</SmallBtn>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {weekly && (
        <section aria-label="Your week" className={cn('rounded-card border bg-card p-3.5 shadow-card', weekly.id === focusId ? 'border-primary/40 ring-2 ring-primary/15' : 'border-line')}>
          <div className="flex items-start gap-2">
            <CalendarRange size={16} className="mt-0.5 shrink-0 text-primary-ink" />
            <p className="min-w-0 flex-1 text-body-md font-semibold text-ink">{weekly.title || 'Your week'}</p>
            <button type="button" disabled={busy === weekly.id} onClick={() => void setState(weekly.id, 'DISMISSED')} className="rounded p-0.5 text-ink-faint hover:bg-slate-100 hover:text-ink disabled:opacity-50" aria-label="Dismiss the weekly summary" title="Dismiss"><X size={15} /></button>
          </div>
          <BriefText text={weekly.payload?.text ?? ''} />
        </section>
      )}
      {brief && (
        <section aria-label="Your brief" className={cn('rounded-card border bg-card p-3.5 shadow-card', brief.id === focusId ? 'border-primary/40 ring-2 ring-primary/15' : 'border-line')}>
          <div className="flex items-start gap-2">
            <Sun size={16} className="mt-0.5 shrink-0 text-warning-ink" />
            <p className="min-w-0 flex-1 text-body-md font-semibold text-ink">{brief.title || 'Your brief'}</p>
            <button type="button" disabled={busy === brief.id} onClick={() => void setState(brief.id, 'DISMISSED')} className="rounded p-0.5 text-ink-faint hover:bg-slate-100 hover:text-ink disabled:opacity-50" aria-label="Dismiss the brief" title="Dismiss"><X size={15} /></button>
          </div>
          <BriefText text={brief.payload?.text ?? ''} />
        </section>
      )}
      {steps.length > 0 && (
        <section aria-label="Next steps that passed" className="rounded-card border border-line bg-card shadow-card">
          <p className="border-b border-line px-3.5 py-2 text-body-sm font-semibold text-ink">Next steps that passed <span className="font-normal text-ink-muted">({steps.length})</span></p>
          <ul className="divide-y divide-line">
            {steps.slice(0, compact ? 4 : 20).map((s) => {
              const p = s.payload
              return (
                <li key={s.id} className="px-3.5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-body-md font-medium text-ink">{p.company || s.title}</span>
                    {p.status && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-ink-muted">{p.status}</span>}
                    {p.due && <span className="ml-auto text-[12px] text-danger-ink">Due {dueText(p.due)}</span>}
                  </div>
                  {p.said && <p className="mt-0.5 line-clamp-2 text-body-sm italic text-ink-muted">“{p.said}”</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.leadId && <SmallBtn onClick={() => { navigate(`/app/itad/dialer?lead=${encodeURIComponent(p.leadId)}`); onNavigate?.() }}><ExternalLink size={12} />Open lead</SmallBtn>}
                    <SmallBtn onClick={() => onAsk(`What should I say when I call back ${p.company || 'this lead'}?`)}><Sparkles size={12} />Ask Metra</SmallBtn>
                    <SmallBtn disabled={busy === s.id} onClick={() => void setState(s.id, 'DONE')}><Check size={12} />Done</SmallBtn>
                    <SmallBtn disabled={busy === s.id} onClick={() => void setState(s.id, 'DISMISSED')}>Dismiss</SmallBtn>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function SmallBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="inline-flex h-7 items-center gap-1 rounded-btn border border-line bg-card px-2 text-[12px] font-medium text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-50">{children}</button>
}

/** The brief is plain text with "- " bullets. */
function BriefText({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  return (
    <div className="mt-1.5 space-y-1 text-body-sm text-ink">
      {lines.map((l, i) => {
        const b = /^\s*[-*•]\s+(.*)$/.exec(l)
        return b
          ? <p key={i} className="flex gap-2"><span aria-hidden className="text-ink-faint">•</span><span>{b[1]}</span></p>
          : <p key={i} className="text-ink-muted">{l}</p>
      })}
    </div>
  )
}
