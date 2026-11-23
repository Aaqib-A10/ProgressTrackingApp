import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Repeat, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { dayLabel, errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * Project settings, "Repeating tasks": a task that appears on the board by itself every day, week or month
 * (a weekly report, a monthly check). People who manage the project set them.
 */

interface Recurrence { id: string; title: string; description: string; priority: string; assigneeIds: string[]; every: 'DAILY' | 'WEEKLY' | 'MONTHLY'; onDay: number | null; dueInDays: number; nextOn: string; active: boolean }
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const when = (r: Recurrence) => (r.every === 'DAILY' ? 'Every day' : r.every === 'WEEKLY' ? `Every ${WEEKDAYS[(r.onDay ?? 1) - 1]}` : `Day ${r.onDay} of every month`)

export function Recurrences({ projectKey, members }: { projectKey: string; members: { id: string; name: string; isActive: boolean }[] }) {
  const { addToast } = useToast()
  const [rows, setRows] = useState<Recurrence[] | null>(null)
  const [title, setTitle] = useState('')
  const [every, setEvery] = useState<Recurrence['every']>('WEEKLY')
  const [onDay, setOnDay] = useState(1)
  const [assignee, setAssignee] = useState('')
  const [dueInDays, setDueInDays] = useState('1')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { api.get<{ recurrences: Recurrence[] }>(`/projects/${projectKey}/recurrences`).then((r) => setRows(r.recurrences)).catch(() => setRows([])) }, [projectKey])
  useEffect(load, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/projects/${projectKey}/recurrences`, { title: title.trim(), every, onDay: every === 'DAILY' ? null : onDay, assigneeIds: assignee ? [assignee] : [], dueInDays: Number(dueInDays) || 0 })
      setTitle('')
      load()
      addToast({ type: 'success', message: 'Repeating task added.' })
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not add it.') }) } finally { setBusy(false) }
  }
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? 'someone who left the project'

  return (
    <div className="space-y-5">
      <Card title="Repeating tasks" subtitle="Each one puts a new task on the board on its day. The tasks it already made stay when you remove it.">
        {rows === null ? <p className="text-body-md text-ink-muted">Loading...</p> : rows.length === 0 ? <EmptyState compact icon={<Repeat size={20} />} title="No repeating tasks yet" hint="Add one below: a weekly report, a monthly check, a daily inbox sweep." /> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-md font-medium text-ink">{r.title}</p>
                  <p className="text-body-sm text-ink-muted">{when(r)}{r.assigneeIds.length ? `, for ${r.assigneeIds.map(name).join(', ')}` : ''}. Due {r.dueInDays === 0 ? 'the same day' : `${r.dueInDays} day${r.dueInDays === 1 ? '' : 's'} later`}. {r.active ? `Next: ${dayLabel(r.nextOn)}.` : 'Paused.'}</p>
                </div>
                <Toggle checked={r.active} onChange={(v) => api.patch(`/projects/recurrences/${r.id}`, { active: v }).then(load).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not change it.') }))} label={r.active ? 'On' : 'Paused'} />
                <button type="button" onClick={() => { if (window.confirm(`Remove the repeating task "${r.title}"? The tasks it already made stay.`)) api.del(`/projects/recurrences/${r.id}`).then(load).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not remove it.') })) }} className="rounded-btn p-2 text-ink-faint hover:bg-slate-100 hover:text-danger" aria-label={`Remove ${r.title}`}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add a repeating task">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2 lg:col-span-2"><label className={labelCls} htmlFor="rec-title">Task</label><input id="rec-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Send the weekly report" className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="rec-every">How often</label><select id="rec-every" value={every} onChange={(e) => { setEvery(e.target.value as Recurrence['every']); setOnDay(1) }} className={inputCls}><option value="DAILY">Every day</option><option value="WEEKLY">Every week</option><option value="MONTHLY">Every month</option></select></div>
          {every === 'WEEKLY' && <div><label className={labelCls} htmlFor="rec-day">On</label><select id="rec-day" value={onDay} onChange={(e) => setOnDay(Number(e.target.value))} className={inputCls}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>}
          {every === 'MONTHLY' && <div><label className={labelCls} htmlFor="rec-day">Day of the month</label><select id="rec-day" value={onDay} onChange={(e) => setOnDay(Number(e.target.value))} className={inputCls}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></div>}
          <div><label className={labelCls} htmlFor="rec-who">Give it to</label><select id="rec-who" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls}><option value="">Nobody yet</option>{members.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label className={labelCls} htmlFor="rec-due">Due after (days)</label><input id="rec-due" type="number" min="0" max="60" value={dueInDays} onChange={(e) => setDueInDays(e.target.value)} className={inputCls} /></div>
          <div className="flex items-end"><Button type="submit" disabled={busy}>Add</Button></div>
        </form>
      </Card>
    </div>
  )
}
