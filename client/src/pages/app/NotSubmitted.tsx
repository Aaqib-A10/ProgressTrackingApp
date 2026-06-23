import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { getNotSubmitted, type NotSubmittedGroup } from '../../lib/notificationsApi'

export default function NotSubmitted() {
  const { addToast } = useToast()
  const [groups, setGroups] = useState<NotSubmittedGroup[] | null>(null)

  useEffect(() => {
    let active = true
    getNotSubmitted()
      .then((r) => active && setGroups(r.groups))
      .catch(() => {
        if (active) {
          setGroups([])
          addToast({ type: 'error', message: 'Could not load submission status.' })
        }
      })
    return () => {
      active = false
    }
  }, [addToast])

  const total = groups?.reduce((n, g) => n + g.members.length, 0) ?? 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-danger/10 text-danger">
          <AlertTriangle size={20} />
        </span>
        <div>
          <h1 className="text-headline-lg text-ink">Not submitted today</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            {groups === null ? 'Checking…' : total === 0 ? 'Everyone is up to date.' : `${total} team member${total > 1 ? 's' : ''} haven’t logged progress yet.`}
          </p>
        </div>
      </div>

      {groups === null ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : total === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 size={28} className="text-success" />
            <p className="text-body-md text-ink-muted">All team members have submitted today.</p>
          </div>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.department} flush>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-headline-md text-ink">{g.label}</h2>
              <Badge tone="danger">{g.members.length} pending</Badge>
            </div>
            <ul className="divide-y divide-line">
              {g.members.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/app/members/${m.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-body-sm font-semibold text-primary">
                      {initials(m.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-md font-medium text-ink">{m.name}</p>
                      <p className="truncate text-body-sm text-ink-muted">{m.email}</p>
                    </div>
                    {m.subDepartment && <Badge tone="neutral">{m.subDepartment}</Badge>}
                    <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
