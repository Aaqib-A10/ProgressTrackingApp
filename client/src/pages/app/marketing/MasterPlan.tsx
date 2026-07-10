import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { RadialGauge } from '../../../components/charts/RadialGauge'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import {
  listBrands,
  getPlan,
  addPlanItem,
  updatePlanItem,
  deletePlanItem,
  PLAN_STATUSES,
  type Brand,
  type PlanItem,
  type PlanItemStatus,
} from '../../../lib/marketingApi'

const sel =
  'h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10'
const TASK_TYPES = ['Strategy & Planning', 'Website Content', 'Social Media', 'SEO', 'Content', 'Other']

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const toneOf = (s: PlanItemStatus) => PLAN_STATUSES.find((x) => x.key === s)?.tone ?? 'neutral'

export default function MasterPlan() {
  const { addToast } = useToast()
  const [month, setMonth] = useState(thisMonth())
  const [brands, setBrands] = useState<Brand[]>([])
  const [items, setItems] = useState<PlanItem[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, pct: 0 })
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)

  // add form
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState(TASK_TYPES[0])
  const [projectId, setProjectId] = useState('') // '' = General
  const [stakeholder, setStakeholder] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [documentLink, setDocumentLink] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listBrands().then((r) => setBrands(r.brands)).catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    getPlan(month)
      .then((r) => {
        setItems(r.items)
        setProgress(r.progress)
        setCanEdit(r.canEdit)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load plan.' }))
      .finally(() => setLoading(false))
  }, [month, addToast])
  useEffect(() => {
    load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await addPlanItem({
        month,
        title: title.trim(),
        taskType,
        brandId: projectId || null,
        stakeholder: stakeholder.trim() || null,
        plannedDate: plannedDate || null,
        documentLink: documentLink.trim() || null,
      })
      setTitle('')
      setStakeholder('')
      setPlannedDate('')
      setDocumentLink('')
      addToast({ type: 'success', message: 'Task added.' })
      load()
    } catch {
      addToast({ type: 'error', message: 'Could not add task.' })
    } finally {
      setSaving(false)
    }
  }

  function changeStatus(item: PlanItem, status: PlanItemStatus) {
    const prev = items
    setItems((its) => its.map((x) => (x.id === item.id ? { ...x, status } : x)))
    updatePlanItem(item.id, { status })
      .then(() => load())
      .catch(() => {
        setItems(prev)
        addToast({ type: 'error', message: 'Update failed.' })
      })
  }

  async function remove(item: PlanItem) {
    const prev = items
    setItems((its) => its.filter((x) => x.id !== item.id))
    try {
      await deletePlanItem(item.id)
      load()
    } catch {
      setItems(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  const columns: Column<PlanItem>[] = [
    { key: 'title', header: 'Task', render: (i) => <span className="font-medium text-ink">{i.title}</span> },
    { key: 'type', header: 'Type', render: (i) => i.taskType ?? '—' },
    { key: 'project', header: 'Project', render: (i) => i.brand?.name ?? 'General' },
    { key: 'stakeholder', header: 'Stakeholder', render: (i) => i.owner?.name ?? i.stakeholder ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (i) =>
        canEdit ? (
          <select className={sel} value={i.status} onChange={(e) => changeStatus(i, e.target.value as PlanItemStatus)}>
            {PLAN_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <Badge tone={toneOf(i.status)}>{PLAN_STATUSES.find((s) => s.key === i.status)?.label}</Badge>
        ),
    },
    { key: 'planned', header: 'Planned', render: (i) => i.plannedDate ?? '—' },
    { key: 'completion', header: 'Completed', render: (i) => i.completionDate ?? '—' },
    {
      key: 'doc',
      header: 'Doc',
      render: (i) =>
        i.documentLink ? (
          i.documentLink.startsWith('http') ? (
            <a href={i.documentLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Link
            </a>
          ) : (
            <span className="text-ink-muted" title={i.documentLink}>
              📄
            </span>
          )
        ) : (
          '—'
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (i: PlanItem) => (
              <button onClick={() => remove(i)} className="text-ink-muted hover:text-danger" title="Delete">
                <Trash2 size={16} />
              </button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Master Plan</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">The content lead's monthly plan and its progress.</p>
        </div>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Month</label>
          <input type="month" className="h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-6">
          <RadialGauge value={progress.total ? progress.pct / 100 : 0} label="Complete" color="#22C55E" />
          <div>
            <p className="text-headline-md font-semibold text-ink">
              {progress.done} / {progress.total} tasks done
            </p>
            <p className="mt-1 text-body-md text-ink-muted">{progress.total === 0 ? 'No tasks planned yet for this month.' : `${progress.pct}% of the ${month} plan complete.`}</p>
          </div>
        </div>
      </Card>

      {canEdit && (
        <Card title="Add task">
          <form onSubmit={add} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TextField label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Audience Personas Creation" />
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
              <select className={`${sel} h-10 w-full`} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                {TASK_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Project</label>
              <select className={`${sel} h-10 w-full`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">General</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <TextField label="Stakeholder" value={stakeholder} onChange={(e) => setStakeholder(e.target.value)} placeholder="Owner name" />
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Planned date</label>
              <input type="date" className={`${sel} h-10 w-full`} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-3">
              <TextField label="Document link" value={documentLink} onChange={(e) => setDocumentLink(e.target.value)} placeholder="URL or file name" />
              <Button type="submit" disabled={saving} leadingIcon={<Plus size={16} />}>
                Add
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Tasks — ${month}`} flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={items} getRowId={(i) => i.id} emptyMessage="No tasks in this month's plan yet." />
        )}
      </Card>
    </div>
  )
}
