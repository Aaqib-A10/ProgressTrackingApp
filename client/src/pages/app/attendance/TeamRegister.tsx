import { Fragment, useEffect, useMemo, useState } from 'react'
import { Download, House, MessageSquare, Search } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { formatMinutes, getAttendanceRegister, type AttendanceDayRow, type RegisterMember, type RegisterResponse } from '../../../lib/attendanceApi'
import { PeriodPicker, periodFor, todayIso, parseIso, STATUS_STYLE, flagsOf, downloadCsv, hm, type Period } from '../../../components/attendance/period'

/**
 * The attendance register for Team Leads (their department) and Super Admins: every person x
 * every day of a day, week, month or date range, with check in and check out times, hours and
 * flags. Click a cell for the full detail. Export gives one row per person per day.
 */

export function TeamRegister({ department, groupByDept, onOpenPerson }: { department?: string; groupByDept: boolean; onOpenPerson: (userId: string) => void }) {
  const { addToast } = useToast()
  const [period, setPeriod] = useState<Period>(() => periodFor('WEEK', todayIso()))
  const [data, setData] = useState<RegisterResponse | null>(null)
  const [q, setQ] = useState('')
  const [cell, setCell] = useState<{ m: RegisterMember; r: AttendanceDayRow } | null>(null)

  useEffect(() => {
    let active = true
    setData(null)
    getAttendanceRegister(period.start, period.end, department)
      .then((r) => active && setData(r))
      .catch((e) => active && addToast({ type: 'error', message: (e as Error)?.message?.includes('two months') ? 'Pick two months or less.' : 'Could not load the register.' }))
    return () => { active = false }
  }, [period, department, addToast])

  const members = useMemo(() => {
    const list = (data?.members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
    return groupByDept ? [...list].sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)) : list
  }, [data, q, groupByDept])

  function exportCsv() {
    if (!data) return
    const rows: (string | number | null)[][] = []
    for (const m of members) data.dates.forEach((d, i) => {
      const r = m.cells[i]
      if (!r) return
      rows.push([m.name, m.department, d, parseIso(d).toLocaleDateString('en-US', { weekday: 'short' }), r.label === 'HOLIDAY' && r.offName ? r.offName : STATUS_STYLE[r.label].text, r.checkIn, r.checkOut, hm(r.workedMin), r.breakMin ? hm(r.breakMin) : '', r.overtimeMin ? hm(r.overtimeMin) : '', flagsOf(r).join(', '), r.note])
    })
    downloadCsv(`attendance-register-${data.start}-to-${data.end}.csv`, ['Name', 'Department', 'Date', 'Day', 'Status', 'Check in', 'Check out', 'Worked (h:mm)', 'Break (h:mm)', 'Overtime (h:mm)', 'Flags', 'Note'], rows)
  }

  const today = todayIso()
  const single = period.mode === 'DAY'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} maxDays={62} />
        <div className="ml-auto flex items-center gap-2">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-8 w-44 rounded-btn border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
          </label>
          <button type="button" onClick={exportCsv} disabled={!data} className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 text-body-sm text-ink hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {!data ? (
        <Card><p className="py-8 text-center text-body-md text-ink-muted">Loading the register…</p></Card>
      ) : members.length === 0 ? (
        <Card><p className="py-8 text-center text-body-md text-ink-muted">Nobody to show.</p></Card>
      ) : single ? (
        <DayTable members={members} groupByDept={groupByDept} onOpenPerson={onOpenPerson} onCell={(m, r) => setCell({ m, r })} />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 min-w-[170px] border-b border-line bg-card px-3 py-2 text-[11px] font-semibold uppercase text-ink-muted">Person</th>
                  {data.dates.map((d) => {
                    const dt = parseIso(d)
                    return (
                      <th key={d} className={cn('min-w-[64px] border-b border-line px-1 py-2 text-center font-semibold', d === today ? 'bg-primary/5 text-primary' : 'text-ink-muted', (dt.getDay() === 0 || dt.getDay() === 6) && d !== today && 'bg-slate-50')}>
                        <div className="text-[10px] uppercase">{dt.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <div className="text-body-sm text-ink">{dt.getDate()}</div>
                      </th>
                    )
                  })}
                  {['Present', 'Absent', 'Late', 'Left early', 'Hours', 'Avg in'].map((h) => <th key={h} className="whitespace-nowrap border-b border-l border-line bg-slate-50 px-2 py-2 text-right text-[11px] font-semibold uppercase text-ink-muted">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <Fragment key={m.userId}>
                    {groupByDept && (i === 0 || members[i - 1].department !== m.department) && (
                      <tr key={`g-${m.department}`}><td colSpan={data.dates.length + 7} className="sticky left-0 bg-slate-50 px-3 py-1.5 text-label-md font-semibold uppercase text-ink">{m.department}</td></tr>
                    )}
                    <tr key={m.userId} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 border-b border-line bg-card px-3 py-1.5">
                        <button type="button" onClick={() => onOpenPerson(m.userId)} className="block max-w-[160px] truncate text-left text-body-sm font-medium text-ink hover:underline">{m.name}</button>
                        <div className="text-[10px] text-ink-muted">{m.shift.startTime}–{m.shift.endTime}{m.hasOverride ? ' · custom' : ''}</div>
                      </td>
                      {m.cells.map((r, j) => <td key={data.dates[j]} className="border-b border-line p-0.5"><RegisterCell r={r} today={data.dates[j] === today} onClick={r ? () => setCell({ m, r }) : undefined} /></td>)}
                      <Tot v={m.totals.present} />
                      <Tot v={m.totals.absent} tone={m.totals.absent ? 'text-danger' : ''} />
                      <Tot v={m.totals.late} tone={m.totals.late ? 'text-warning' : ''} />
                      <Tot v={m.totals.leftEarly} tone={m.totals.leftEarly ? 'text-warning' : ''} />
                      <Tot v={formatMinutes(m.totals.workedMin)} />
                      <Tot v={m.totals.avgCheckIn ?? '—'} />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Legend />
        </Card>
      )}

      {cell && <CellDetail m={cell.m} r={cell.r} onClose={() => setCell(null)} onOpenPerson={() => { onOpenPerson(cell.m.userId); setCell(null) }} />}
    </div>
  )
}

function Tot({ v, tone }: { v: string | number; tone?: string }) {
  return <td className={cn('whitespace-nowrap border-b border-l border-line bg-slate-50/50 px-2 text-right text-body-sm font-semibold tabular-nums text-ink', tone)}>{v}</td>
}

/** One day for one person: in and out times when present, otherwise the status. */
function RegisterCell({ r, today, onClick }: { r: AttendanceDayRow | null; today: boolean; onClick?: () => void }) {
  if (!r) return <div className={cn('h-[46px] rounded', today && 'bg-primary/5')} />
  const st = STATUS_STYLE[r.label]
  const title = [st.text, r.checkIn && `In ${r.checkIn}`, r.checkOut && `Out ${r.checkOut}`, r.workedMin != null && `Worked ${formatMinutes(r.workedMin)}`, ...flagsOf(r)].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onClick} title={title} className={cn('relative flex h-[46px] w-full flex-col items-center justify-center rounded border tabular-nums leading-tight hover:ring-2 hover:ring-primary/30', st.cell, today && 'ring-1 ring-primary/40')}>
      {r.label === 'PRESENT' ? (
        <>
          <span className={cn('font-semibold', r.late ? 'text-warning' : 'text-ink')}>{r.checkIn}</span>
          <span className={cn(r.earlyLeave ? 'font-semibold text-warning' : 'text-ink-muted')}>{r.checkOut ?? '…'}</span>
        </>
      ) : (
        <span className="font-bold">{st.short}</span>
      )}
      {r.wfh && <House size={9} className="absolute right-0.5 top-0.5 text-accent" />}
      {r.note && <MessageSquare size={9} className="absolute bottom-0.5 right-0.5 text-primary" />}
    </button>
  )
}

/** Day mode: one row per person with every detail of that day. */
function DayTable({ members, groupByDept, onOpenPerson, onCell }: { members: RegisterMember[]; groupByDept: boolean; onOpenPerson: (id: string) => void; onCell: (m: RegisterMember, r: AttendanceDayRow) => void }) {
  const order: Record<string, number> = { PRESENT: 0, NOT_YET: 1, ABSENT: 2, ON_LEAVE: 3, WFH: 3, OFF: 4, HOLIDAY: 5, WEEKLY_OFF: 6 }
  const rows = groupByDept ? members : [...members].sort((a, b) => (order[a.cells[0]?.label ?? 'X'] ?? 9) - (order[b.cells[0]?.label ?? 'X'] ?? 9) || (a.cells[0]?.checkIn ?? '99').localeCompare(b.cells[0]?.checkIn ?? '99'))
  const counts = (l: string) => members.filter((m) => m.cells[0]?.label === l).length
  return (
    <Card flush>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3 text-body-sm">
        <Badge tone="success" dot>{counts('PRESENT')} present</Badge>
        <Badge tone="neutral" dot>{counts('NOT_YET')} not in yet</Badge>
        <Badge tone="danger" dot>{counts('ABSENT')} absent</Badge>
        <Badge tone="primary" dot>{counts('ON_LEAVE') + counts('OFF')} on leave</Badge>
        <Badge tone="warning" dot>{members.filter((m) => m.cells[0]?.late).length} late</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="text-[11px] uppercase text-ink-muted">
            <tr className="border-b border-line">{['Person', 'Status', 'Check in', 'Check out', 'Worked', 'Break', 'Overtime', 'Flags'].map((h, i) => <th key={h} className={cn('px-3 py-2 font-semibold', i >= 2 && i <= 6 && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m, i) => {
              const r = m.cells[0]
              return (
                <Fragment key={m.userId}>
                  {groupByDept && (i === 0 || rows[i - 1].department !== m.department) && <tr key={`g-${m.department}`}><td colSpan={8} className="bg-slate-50 px-3 py-1.5 text-label-md font-semibold uppercase text-ink">{m.department}</td></tr>}
                  <tr key={m.userId} onClick={() => r && onCell(m, r)} className="cursor-pointer hover:bg-slate-50/60">
                    <td className="px-3 py-2"><button type="button" onClick={(e) => { e.stopPropagation(); onOpenPerson(m.userId) }} className="font-medium text-ink hover:underline">{m.name}</button><div className="text-[11px] text-ink-muted">{m.shift.startTime}–{m.shift.endTime}</div></td>
                    <td className="px-3">{r ? <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[r.label].cell)}>{r.label === 'HOLIDAY' && r.offName ? r.offName : STATUS_STYLE[r.label].text}{r.wfh && <House size={10} />}</span> : '—'}</td>
                    <td className={cn('px-3 text-right tabular-nums', r?.late && 'font-semibold text-warning')}>{r?.checkIn ?? '—'}</td>
                    <td className={cn('px-3 text-right tabular-nums', r?.earlyLeave && 'font-semibold text-warning')}>{r?.checkOut ?? (r?.checkIn ? 'Working' : '—')}</td>
                    <td className="px-3 text-right tabular-nums">{formatMinutes(r?.workedMin)}</td>
                    <td className="px-3 text-right tabular-nums">{r?.breakMin ? formatMinutes(r.breakMin) : '—'}</td>
                    <td className="px-3 text-right tabular-nums">{r?.overtimeMin ? formatMinutes(r.overtimeMin) : '—'}</td>
                    <td className="px-3 text-ink-muted">{r ? flagsOf(r).join(', ') : ''}</td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink-muted">
      <span>Each box: check in on top, check out below.</span>
      <span className="font-semibold text-warning">Amber = late in or left early</span>
      {(['ABSENT', 'ON_LEAVE', 'WEEKLY_OFF', 'HOLIDAY', 'NOT_YET'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1"><b>{STATUS_STYLE[k].short}</b> {STATUS_STYLE[k].text}</span>)}
      <span className="inline-flex items-center gap-1"><House size={11} className="text-accent" /> from home</span>
      <span className="inline-flex items-center gap-1"><MessageSquare size={11} className="text-primary" /> lead note</span>
    </div>
  )
}

function CellDetail({ m, r, onClose, onOpenPerson }: { m: RegisterMember; r: AttendanceDayRow; onClose: () => void; onOpenPerson: () => void }) {
  const st = STATUS_STYLE[r.label]
  const line = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-0"><span className="text-ink-muted">{k}</span><span className="font-medium tabular-nums text-ink">{v}</span></div>
  return (
    <Modal open onClose={onClose} title={`${m.name}, ${parseIso(r.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
      footer={<button type="button" onClick={onOpenPerson} className="rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50">Open {m.name.split(' ')[0]}'s attendance to edit</button>}>
      <div className="text-body-sm">
        {line('Status', r.label === 'HOLIDAY' && r.offName ? r.offName : st.text)}
        {line('Shift', `${m.shift.startTime} to ${m.shift.endTime}`)}
        {line('Check in', <span className={r.late ? 'text-warning' : ''}>{r.checkIn ?? '—'}{r.late ? ' (late)' : ''}</span>)}
        {line('Check out', <span className={r.earlyLeave ? 'text-warning' : ''}>{r.checkOut ?? (r.checkIn ? 'Still working' : '—')}{r.earlyLeave ? ' (left early)' : ''}</span>)}
        {line('Worked', formatMinutes(r.workedMin))}
        {line('Break', r.breakMin ? formatMinutes(r.breakMin) : '—')}
        {line('Overtime', r.overtimeMin ? formatMinutes(r.overtimeMin) : '—')}
        {line('Flags', flagsOf(r).join(', ') || '—')}
        {r.note && line('Note', r.note)}
      </div>
    </Modal>
  )
}
