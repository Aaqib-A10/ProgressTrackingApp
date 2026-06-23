import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { getContentList, createTask, updateTask, type ContentItem, type TaskStatus, type ContentType } from '../../../lib/marketingApi'

const STATUS_OPTS: TaskStatus[] = ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED']
const STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
}
const TYPE_LABEL: Record<ContentType, string> = {
  BLOG: 'Blog',
  LANDING_PAGE: 'Landing Page',
  SOCIAL_COPY: 'Social Copy',
  VIDEO_SCRIPT: 'Video Script',
  EMAIL: 'Email',
  OTHER: 'Other',
}

export default function ContentActivity() {
  const { addToast } = useToast()
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    getContentList()
      .then((res) => setItems(res.items))
      .catch(() => addToast({ type: 'error', message: 'Could not load content.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  function changeStatus(id: string, status: TaskStatus) {
    const prev = items
    setItems((it) => it.map((i) => (i.id === id ? { ...i, status } : i)))
    updateTask(id, { status })
      .then((res) => setItems((it) => it.map((i) => (i.id === id ? { ...i, status: res.task.status, publishedDate: res.task.publishedDate } : i))))
      .catch(() => {
        setItems(prev)
        addToast({ type: 'error', message: 'Could not update status.' })
      })
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const { task } = await createTask({ title, discipline: 'CONTENT' })
      setItems((it) => [{ id: task.id, title: task.title, status: task.status, contentType: task.contentType, wordCount: task.wordCount, wordTarget: task.wordTarget, dueDate: task.dueDate, publishedDate: task.publishedDate, assignee: task.assignee }, ...it])
      setTitle('')
      setModalOpen(false)
      addToast({ type: 'success', message: 'Content piece added.' })
    } catch {
      addToast({ type: 'error', message: 'Could not create.' })
    }
  }

  const columns: Column<ContentItem>[] = [
    { key: 'title', header: 'Content Piece', render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: 'type', header: 'Type', render: (r) => (r.contentType ? TYPE_LABEL[r.contentType] : '—') },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <select
          value={r.status}
          onChange={(e) => changeStatus(r.id, e.target.value as TaskStatus)}
          className="rounded-btn border border-line bg-card px-2 py-1 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {STATUS_OPTS.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      ),
    },
    { key: 'words', header: 'Words', align: 'right', render: (r) => (r.wordTarget ? `${r.wordCount ?? 0}/${r.wordTarget}` : '—') },
    { key: 'dueDate', header: 'Due', align: 'right', render: (r) => r.dueDate ?? '—' },
    { key: 'publishedDate', header: 'Published', align: 'right', render: (r) => r.publishedDate ?? '—' },
    { key: 'assignee', header: 'Owner', render: (r) => r.assignee?.name ?? '—' },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg text-ink">Content Pipeline</h1>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>New Content</Button>
      </div>

      <Card flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={items} getRowId={(r) => r.id} emptyMessage="No content pieces yet." />
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Content Piece"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={create}>Add</Button>
          </>
        }
      >
        <form onSubmit={create}>
          <TextField label="Title" placeholder="e.g. Blog: 2026 outbound trends" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </form>
      </Modal>
    </div>
  )
}
