import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { AttendanceDayRow, HistoryLabel } from '../../lib/attendanceApi'

/**
 * Period picker and status styles shared by My Attendance and the Team Lead's register:
 * Day / Week / Month / Range with previous and next, independent of the top bar.
 */

export type PeriodMode = 'DAY' | 'WEEK' | 'MONTH' | 'RANGE'
export interface Period { mode: PeriodMode; start: string; end: string }

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const todayIso = () => iso(new Date())
export const addDays = (s: string, n: number) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d) }

/** The period of `mode` that contains `date` (weeks start on Monday). */
export function periodFor(mode: PeriodMode, date: string, prev?: Period): Period {
  const d = parseIso(date)
  if (mode === 'DAY') return { mode, start: date, end: date }
  if (mode === 'WEEK') { const s = addDays(date, -((d.getDay() + 6) % 7)); return { mode, start: s, end: addDays(s, 6) } }
  if (mode === 'MONTH') return { mode, start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  return prev && prev.mode === 'RANGE' ? prev : { mode, start: addDays(date, -13), end: date }
}

export function shiftPeriod(p: Period, by: number): Period {
  if (p.mode === 'DAY') return periodFor('DAY', addDays(p.start, by))
  if (p.mode === 'WEEK') return periodFor('WEEK', addDays(p.start, 7 * by))
  if (p.mode === 'MONTH') { const d = parseIso(p.start); return periodFor('MONTH', iso(new Date(d.getFullYear(), d.getMonth() + by, 1))) }
  const len = Math.round((parseIso(p.end).getTime() - parseIso(p.start).getTime()) / 86400000) + 1
  return { mode: 'RANGE', start: addDays(p.start, len * by), end: addDays(p.end, len * by) }
}

export function periodLabel(p: Period): string {
  const s = parseIso(p.start)
  const e = parseIso(p.end)
  if (p.mode === 'DAY') return s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (p.mode === 'MONTH') return s.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const same = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${e.toLocaleDateString('en-US', same ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`
}

export function PeriodPicker({ value, onChange, modes = ['DAY', 'WEEK', 'MONTH', 'RANGE'], maxDays }: { value: Period; onChange: (p: Period) => void; modes?: PeriodMode[]; maxDays?: number }) {
  const label: Record<PeriodMode, string> = { DAY: 'Day', WEEK: 'Week', MONTH: 'Month', RANGE: 'Dates' }
  const today = todayIso()
  const isCurrent = value.start <= today && value.end >= today
  const input = 'h-8 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none'
  function setRange(start: string, end: string) {
    if (!start || !end) return
    if (end < start) [start, end] = [end, start]
    if (maxDays) { const len = (parseIso(end).getTime() - parseIso(start).getTime()) / 86400000 + 1; if (len > maxDays) end = addDays(start, maxDays - 1) }
    onChange({ mode: 'RANGE', start, end })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist">
        {modes.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={value.mode === m} onClick={() => onChange(periodFor(m, value.mode === 'RANGE' ? value.end : isCurrent ? today : value.start, value))}
            className={cn('h-8 rounded-md px-3.5 text-body-sm font-semibold', value.mode === m ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{label[m]}</button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(shiftPeriod(value, -1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Previous"><ChevronLeft size={18} /></button>
        {value.mode === 'RANGE' ? (
          <div className="flex items-center gap-1.5 text-body-sm text-ink-muted">
            <input type="date" value={value.start} onChange={(e) => setRange(e.target.value, value.end)} className={input} aria-label="From" />
            to
            <input type="date" value={value.end} onChange={(e) => setRange(value.start, e.target.value)} className={input} aria-label="To" />
          </div>
        ) : (
          <label className="relative min-w-[190px] cursor-pointer rounded-btn px-2 py-1 text-center text-body-lg font-semibold text-ink hover:bg-slate-100" title="Pick a date">
            {periodLabel(value)}
            <input type="date" value={value.start} onChange={(e) => e.target.value && onChange(periodFor(value.mode, e.target.value))} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        )}
        <button type="button" onClick={() => onChange(shiftPeriod(value, 1))} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label="Next"><ChevronRight size={18} /></button>
      </div>
      {!isCurrent && value.mode !== 'RANGE' && <button type="button" onClick={() => onChange(periodFor(value.mode, today))} className="h-8 rounded-btn px-2.5 text-body-sm font-semibold text-primary hover:bg-primary/5">Today</button>}
    </div>
  )
}

// ------------------------------------------------------------------ status styles

export const STATUS_STYLE: Record<HistoryLabel, { short: string; text: string; cell: string; dot: string }> = {
  PRESENT: { short: 'P', text: 'Present', cell: 'bg-success/5 border-success/25', dot: 'bg-success' },
  ABSENT: { short: 'A', text: 'Absent', cell: 'bg-danger/10 border-danger/30 text-danger', dot: 'bg-danger' },
  ON_LEAVE: { short: 'L', text: 'On leave', cell: 'bg-primary/10 border-primary/25 text-primary', dot: 'bg-primary' },
  OFF: { short: 'Off', text: 'Off', cell: 'bg-slate-100 border-line text-ink-muted', dot: 'bg-slate-400' },
  WFH: { short: 'WFH', text: 'Work from home', cell: 'bg-accent/10 border-accent/30 text-accent', dot: 'bg-accent' },
  HOLIDAY: { short: 'H', text: 'Holiday', cell: 'bg-accent/10 border-accent/30 text-accent', dot: 'bg-accent' },
  WEEKLY_OFF: { short: '–', text: 'Weekly off', cell: 'bg-slate-50 border-line text-ink-muted', dot: 'bg-slate-300' },
  NOT_YET: { short: '…', text: 'Not checked in yet', cell: 'bg-card border-dashed border-line text-ink-muted', dot: 'bg-slate-300' },
}

/** Words for the flags on a day, for tooltips and CSV. */
export function flagsOf(r: AttendanceDayRow): string[] {
  const f: string[] = []
  if (r.late) f.push('Late')
  if (r.earlyLeave) f.push('Left early')
  if (r.label === 'PRESENT' && r.completed) f.push('Full shift')
  if (r.label === 'PRESENT' && r.shortMin) f.push(`Short ${Math.floor(r.shortMin / 60)}h ${pad(r.shortMin % 60)}m`)
  if (r.label === 'PRESENT' && r.checkIn && !r.checkOut) f.push('Still working')
  if (r.wfh && r.label !== 'WFH') f.push('From home')
  if (r.overtimeMin) f.push(`Overtime ${Math.floor(r.overtimeMin / 60)}h ${pad(r.overtimeMin % 60)}m`)
  return f
}

export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [head.map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export const hm = (min: number | null | undefined) => (min == null ? '' : `${Math.floor(min / 60)}:${pad(min % 60)}`)
