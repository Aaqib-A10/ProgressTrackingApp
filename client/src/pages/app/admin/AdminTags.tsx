import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import type { Department } from '../../../lib/types'
import { listTags, createTag, updateTag, type AdminTag } from '../../../lib/adminApi'
import { useAuth } from '../../../lib/auth'

const TAG_DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'LEAD_GEN', label: 'Lead Generation' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'ITAD', label: 'ITAD' },
  { value: 'ECOMMERCE', label: 'Ecommerce' },
]
/** Tag kinds each department uses. */
const CLASSIC: { value: AdminTag['type']; label: string }[] = [{ value: 'VERTICAL', label: 'Vertical' }, { value: 'PLATFORM', label: 'Platform' }, { value: 'CAMPAIGN', label: 'Campaign' }, { value: 'DATA_SOURCE', label: 'Data Source' }]
const TYPES_FOR: Record<string, { value: AdminTag['type']; label: string }[]> = {
  LEAD_GEN: CLASSIC,
  MARKETING: CLASSIC,
  ITAD: CLASSIC,
  ECOMMERCE: [{ value: 'MARKETPLACE', label: 'Marketplace' }, { value: 'TASK_TYPE', label: 'Task Type' }],
}

const sel = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function AdminTags() {
  const { addToast } = useToast()
  const { user } = useAuth()
  // A team lead adds tags for their own department only; the Super Admin picks any.
  const depts = user?.role === 'SUPER_ADMIN' ? TAG_DEPARTMENTS : TAG_DEPARTMENTS.filter((d) => d.value === user?.department)
  const [tags, setTags] = useState<AdminTag[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<Department>(depts[0]?.value ?? 'LEAD_GEN')
  const [type, setType] = useState<AdminTag['type']>(TYPES_FOR[depts[0]?.value ?? 'LEAD_GEN']?.[0]?.value ?? 'VERTICAL')
  const typeOptions = TYPES_FOR[department] ?? []

  useEffect(() => {
    let active = true
    listTags()
      .then((r) => active && setTags(r.tags))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load tags.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [addToast])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const { tag } = await createTag({ name, type, department })
      setTags((ts) => (ts.some((t) => t.id === tag.id) ? ts.map((t) => (t.id === tag.id ? tag : t)) : [...ts, tag]))
      setName('')
      addToast({ type: 'success', message: 'Tag saved.' })
    } catch {
      addToast({ type: 'error', message: 'Could not add tag.' })
    }
  }

  function toggle(t: AdminTag) {
    const prev = tags
    setTags((ts) => ts.map((x) => (x.id === t.id ? { ...x, isActive: !x.isActive } : x)))
    updateTag(t.id, { isActive: !t.isActive }).catch(() => {
      setTags(prev)
      addToast({ type: 'error', message: 'Update failed.' })
    })
  }

  const columns: Column<AdminTag>[] = [
    { key: 'name', header: 'Name', render: (t) => <span className="font-medium text-ink">{t.name}</span> },
    { key: 'type', header: 'Type', render: (t) => t.type.replace('_', ' ').toLowerCase() },
    { key: 'department', header: 'Department', render: (t) => (t.department ? t.department.replace('_', ' ') : '—') },
    { key: 'active', header: 'Active', render: (t) => <button onClick={() => toggle(t)}><Badge tone={t.isActive ? 'success' : 'neutral'} dot>{t.isActive ? 'Active' : 'Hidden'}</Badge></button> },
  ]

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <h1 className="text-headline-lg text-ink">Tag Management</h1>
      <Card title="Add Tag" subtitle="The lists your team picks from in its daily log">
        <form onSubmit={add} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Healthcare" />
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
            <select className={sel} value={type} onChange={(e) => setType(e.target.value as AdminTag['type'])}>
              {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Department</label>
            <select className={sel} value={department} disabled={depts.length < 2} onChange={(e) => { const d = e.target.value as Department; setDepartment(d); setType(TYPES_FOR[d]?.[0]?.value ?? 'VERTICAL') }}>
              {depts.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <Button type="submit" leadingIcon={<Plus size={16} />}>Add</Button>
        </form>
      </Card>
      <Card title="Tags" flush>
        {loading ? <div className="p-5 text-body-md text-ink-muted">Loading…</div> : <DataTable columns={columns} rows={tags} getRowId={(t) => t.id} emptyMessage="No tags yet." />}
      </Card>
    </div>
  )
}
