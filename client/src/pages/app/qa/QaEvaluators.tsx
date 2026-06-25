import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { Badge } from '../../../components/ui/Badge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { ROLE_LABEL, type Role } from '../../../lib/types'
import { fromNow } from '../../../lib/datetime'
import { listQaEvaluators, type QaEvaluatorRow } from '../../../lib/qaApi'

export default function QaEvaluators() {
  const { addToast } = useToast()
  const [rows, setRows] = useState<QaEvaluatorRow[] | null>(null)

  useEffect(() => {
    listQaEvaluators()
      .then((r) => setRows(r.evaluators))
      .catch(() => { setRows([]); addToast({ type: 'error', message: 'Could not load the QA team.' }) })
  }, [addToast])

  const totalDone = rows ? rows.reduce((s, r) => s + r.completed, 0) : 0

  const columns: Column<QaEvaluatorRow>[] = [
    { key: 'name', header: 'Evaluator', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'role', header: 'Role', render: (r) => <Badge tone={r.role === 'QA_LEAD' ? 'primary' : 'neutral'}>{ROLE_LABEL[r.role as Role] ?? r.role}</Badge> },
    { key: 'completed', header: 'Evaluations done', align: 'right', render: (r) => r.completed },
    { key: 'avg', header: 'Avg score given', align: 'right', render: (r) => (r.avgScoreGiven !== null ? `${r.avgScoreGiven}%` : '—') },
    { key: 'last', header: 'Last activity', align: 'right', render: (r) => (r.lastActivity ? fromNow(r.lastActivity) : '—') },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">QA Team</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Your QA evaluators and their productivity.</p>
      </div>

      {rows === null ? (
        <div className="text-body-md text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Evaluators" value={rows.length} icon={<UserCheck size={16} />} />
            <StatCard label="Evaluations completed" value={totalDone} />
            <StatCard label="Active this week" value={rows.filter((r) => r.lastActivity && Date.now() - new Date(r.lastActivity).getTime() < 7 * 864e5).length} />
          </div>

          <Card title="QA team" flush>
            <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} emptyMessage="No QA evaluators yet — invite one in Admin → Users (Role = QA)." />
          </Card>
        </>
      )}
    </div>
  )
}
