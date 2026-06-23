import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarClock, CheckCircle2, Circle } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { getCalendar, DISCIPLINE_META, type CalendarEvent } from '../../../lib/marketingApi'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ym(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function EditorialCalendar() {
  const { addToast } = useToast()
  const [month, setMonth] = useState(() => ym(new Date()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCalendar(month)
      .then((res) => setEvents(res.events))
      .catch(() => addToast({ type: 'error', message: 'Could not load calendar.' }))
      .finally(() => setLoading(false))
  }, [month, addToast])

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [events])

  const [year, mon] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, mon - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const leading = first.getUTCDay()
  const cells: (string | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  function shift(delta: number) {
    setMonth(ym(new Date(Date.UTC(year, mon - 1 + delta, 1))))
  }

  const typeIcon = { published: <CheckCircle2 size={11} />, scheduled: <CalendarClock size={11} />, due: <Circle size={11} /> }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Editorial Calendar</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Scheduled vs published across SEO, Social & Content</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></Button>
          <span className="min-w-[140px] text-center text-body-md font-semibold text-ink">{monthLabel}</span>
          <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></Button>
        </div>
      </div>

      <Card flush>
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-label-md uppercase text-ink-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => (
            <div key={i} className="min-h-[96px] border-b border-r border-line/70 p-1.5 last:border-r-0">
              {date && (
                <>
                  <div className="mb-1 text-body-sm font-medium text-ink-muted">{Number(date.slice(-2))}</div>
                  <div className="space-y-1">
                    {(byDate.get(date) ?? []).map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: `${DISCIPLINE_META[e.discipline].color}1a`, color: DISCIPLINE_META[e.discipline].color }}
                        title={`${e.title} (${e.type})`}
                      >
                        {typeIcon[e.type]}
                        <span className="truncate">{e.title}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-4 text-body-sm text-ink-muted">
        <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-success" /> Published</span>
        <span className="flex items-center gap-1"><CalendarClock size={13} className="text-primary" /> Scheduled</span>
        <span className="flex items-center gap-1"><Circle size={13} /> Due</span>
        {loading && <span>Loading…</span>}
      </div>
    </div>
  )
}
