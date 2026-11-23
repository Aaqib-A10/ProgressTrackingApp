import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Hourglass, Link2, Play, Plus, Square, Timer, X } from 'lucide-react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { errMsg, minutesLabel } from '../../lib/biz'
import { cn } from '../../lib/cn'

/**
 * Two extras in the task window: "Waits on" (this task cannot really start until those are done) and "Time" (a
 * timer, or minutes typed in afterwards). Each loads on its own, so the task window opens as fast as before.
 */

interface Dep { linkId: string; id: string; code: string; title: string; status: string; done: boolean }
interface Deps { waitsOn: Dep[]; blocks: Dep[]; blocked: boolean }
interface Entry { id: string; user: string; mine: boolean; startedAt: string; minutes: number; note: string; running: boolean }
interface Time { entries: Entry[]; totalMinutes: number; running: string | null }

const secCls = 'flex items-center gap-1.5 text-[13px] font-semibold text-ink'
const fieldCls = 'h-8 rounded-md border border-line bg-card px-2.5 text-body-md text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15'

export function TaskExtras({ code, canEdit, onOpenTask }: { code: string; canEdit: boolean; onOpenTask?: (code: string) => void }) {
  return (
    <>
      <WaitsOn code={code} canEdit={canEdit} onOpenTask={onOpenTask} />
      <TimeOnTask code={code} canEdit={canEdit} />
    </>
  )
}

function WaitsOn({ code, canEdit, onOpenTask }: { code: string; canEdit: boolean; onOpenTask?: (code: string) => void }) {
  const { addToast } = useToast()
  const [deps, setDeps] = useState<Deps | null>(null)
  const [on, setOn] = useState('')
  const load = useCallback(() => { api.get<Deps>(`/projects/tasks/${code}/dependencies`).then(setDeps).catch(() => setDeps({ waitsOn: [], blocks: [], blocked: false })) }, [code])
  useEffect(load, [load])
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!on.trim()) return
    try { setDeps(await api.post<Deps>(`/projects/tasks/${code}/dependencies`, { on: on.trim() })); setOn('') } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not link the tasks.') }) }
  }
  const row = (d: Dep, removable: boolean) => (
    <li key={d.linkId} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', d.done ? 'bg-success' : 'bg-warning')} aria-hidden />
      <button type="button" onClick={() => onOpenTask?.(d.code)} className="shrink-0 text-body-sm font-medium tabular-nums text-primary-ink hover:underline">{d.code}</button>
      <span className={cn('min-w-0 flex-1 truncate text-body-md', d.done ? 'text-ink-muted line-through' : 'text-ink')}>{d.title}</span>
      <span className="shrink-0 text-body-sm text-ink-faint">{d.status}</span>
      {removable && canEdit && <button type="button" onClick={() => api.del(`/projects/dependencies/${d.linkId}`).then(load).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not remove the link.') }))} className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Stop waiting on ${d.code}`}><X size={14} className="text-ink-muted" /></button>}
    </li>
  )
  if (!deps) return null
  if (!canEdit && !deps.waitsOn.length && !deps.blocks.length) return null
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className={secCls}><Link2 size={14} />Waits on{deps.blocked && <span className="rounded-full bg-warning-muted px-1.5 text-[11px] font-medium text-warning-ink">not ready yet</span>}</h3>
      </div>
      {deps.waitsOn.length > 0 && <ul className="mb-1.5">{deps.waitsOn.map((d) => row(d, true))}</ul>}
      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <input value={on} onChange={(e) => setOn(e.target.value.toUpperCase())} placeholder="The code of the task it waits on, like RTI-12" aria-label="Task code this task waits on" className={cn(fieldCls, 'min-w-0 flex-1')} maxLength={20} />
          <Button size="sm" variant="secondary" type="submit" aria-label="Add the link"><Plus size={14} /></Button>
        </form>
      )}
      {deps.blocks.length > 0 && (<><p className="mt-2 text-body-sm text-ink-muted">Waiting on this task:</p><ul>{deps.blocks.map((d) => row(d, false))}</ul></>)}
    </section>
  )
}

function TimeOnTask({ code, canEdit }: { code: string; canEdit: boolean }) {
  const { addToast } = useToast()
  const [time, setTime] = useState<Time | null>(null)
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const load = useCallback(() => { api.get<Time>(`/projects/tasks/${code}/time`).then(setTime).catch(() => setTime({ entries: [], totalMinutes: 0, running: null })) }, [code])
  useEffect(load, [load])
  // While my timer runs here, the minute count moves.
  useEffect(() => { if (!time?.running) return; const t = window.setInterval(load, 60_000); return () => window.clearInterval(t) }, [time?.running, load])
  const act = (path: string, body?: Record<string, unknown>) => api.post<Time>(`/projects/tasks/${code}/${path}`, body).then(setTime).catch((e) => addToast({ type: 'error', message: errMsg(e, 'That did not work. Try again.') }))
  async function add(e: FormEvent) {
    e.preventDefault()
    const m = Number(minutes)
    if (!m || m < 1) { addToast({ type: 'error', message: 'Give the minutes.' }); return }
    await act('time', { minutes: Math.round(m), note: note.trim() || undefined })
    setMinutes(''); setNote('')
  }
  if (!time) return null
  if (!canEdit && !time.entries.length) return null
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className={secCls}><Timer size={14} />Time{time.totalMinutes > 0 && <span className="font-normal text-ink-faint">{minutesLabel(time.totalMinutes)}</span>}</h3>
        {canEdit && (time.running
          ? <Button size="sm" variant="secondary" leadingIcon={<Square size={13} />} onClick={() => void act('timer/stop', {})}>Stop my timer</Button>
          : <Button size="sm" variant="secondary" leadingIcon={<Play size={13} />} onClick={() => void act('timer/start')}>Start timer</Button>)}
      </div>
      {time.running && <p className="mb-1.5 flex items-center gap-1.5 text-body-sm text-success-ink"><Hourglass size={13} />Your timer is running on this task. Starting one on another task stops it here.</p>}
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input type="number" min="1" max="1440" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Minutes" aria-label="Minutes spent" className={cn(fieldCls, 'w-24')} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What on (optional)" aria-label="What the time was spent on" className={cn(fieldCls, 'min-w-0 flex-1')} maxLength={300} />
          <Button size="sm" variant="secondary" type="submit">Add time</Button>
        </form>
      )}
      {time.entries.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-body-sm text-primary-ink hover:underline" aria-expanded={open}>{open ? 'Hide' : 'Show'} the {time.entries.length} {time.entries.length === 1 ? 'entry' : 'entries'}</button>
          {open && (
            <ul className="mt-1 divide-y divide-line rounded-md border border-line">
              {time.entries.map((e) => (
                <li key={e.id} className="group flex items-center gap-2 px-2.5 py-1.5 text-body-sm">
                  <span className="w-20 shrink-0 tabular-nums text-ink">{minutesLabel(e.minutes)}</span>
                  <span className="shrink-0 text-ink-muted">{e.user}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{e.running ? 'running now' : e.note}</span>
                  <span className="shrink-0 text-ink-faint">{new Date(e.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {e.mine && !e.running && <button type="button" onClick={() => api.del(`/projects/time/${e.id}`).then(load).catch((er) => addToast({ type: 'error', message: errMsg(er, 'Could not remove it.') }))} className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Remove this entry"><X size={14} className="text-ink-muted" /></button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
