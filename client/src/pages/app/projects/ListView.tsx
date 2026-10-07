import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { AvatarStack, DueChip, PRIORITIES, PRIORITY_META, PriorityIcon, fmtAgo } from '../../../components/projects/pmUi'
import { errMsg, projectsApi, type BoardColumn, type PmPriority, type ProjectMember, type TaskCard } from '../../../lib/projectsApi'
import { cn } from '../../../lib/cn'

type SortKey = 'code' | 'title' | 'status' | 'assignee' | 'priority' | 'due' | 'updated'
const PRI_RANK: Record<PmPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** Sortable table of the project's tasks with bulk actions for project admins. */
export function ListView({ projectKey, tasks, columns, members, canManage, onOpen, onChanged }: {
  projectKey: string
  tasks: TaskCard[]
  columns: BoardColumn[]
  members: ProjectMember[]
  canManage: boolean
  onOpen: (code: string) => void
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'due', dir: 1 })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const colPos = useMemo(() => new Map(columns.map((c) => [c.id, c.position])), [columns])

  const rows = useMemo(() => {
    const v = (t: TaskCard): string | number => {
      switch (sort.key) {
        case 'code': return Number(t.code.split('-')[1])
        case 'title': return t.title.toLowerCase()
        case 'status': return colPos.get(t.columnId) ?? 0
        case 'assignee': return t.assignees[0]?.name.toLowerCase() ?? '~'
        case 'priority': return PRI_RANK[t.priority]
        case 'due': return t.dueAt ? new Date(t.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        case 'updated': return -new Date(t.updatedAt).getTime()
      }
    }
    return [...tasks].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * sort.dir)
  }, [tasks, sort, colPos])

  const toggleAll = () => setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  async function bulk(body: { columnId?: string; priority?: PmPriority; assigneeId?: string | null; delete?: boolean }) {
    try {
      const r = await projectsApi.bulk(projectKey, { taskIds: [...sel], ...body })
      addToast({ type: 'success', message: `Updated ${r.updated} task${r.updated === 1 ? '' : 's'}` })
      setSel(new Set())
      onChanged()
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) }
  }

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cn('px-3 py-2 text-left', className)}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 text-label-md uppercase text-ink-muted hover:text-ink">
        {children}{sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-2">
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-primary/30 bg-primary/5 px-3 py-2 text-body-sm">
          <b className="text-ink">{sel.size} selected</b>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ columnId: e.target.value }); e.target.value = '' }} className="h-8 rounded-btn border border-line bg-card px-2" aria-label="Move selected to">
            <option value="">Move to…</option>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ priority: e.target.value as PmPriority }); e.target.value = '' }} className="h-8 rounded-btn border border-line bg-card px-2" aria-label="Set priority">
            <option value="">Priority…</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ assigneeId: e.target.value === '__none' ? null : e.target.value }); e.target.value = '' }} className="h-8 rounded-btn border border-line bg-card px-2" aria-label="Assign selected">
            <option value="">Assign to…</option>
            <option value="__none">Nobody</option>
            {members.filter((m) => m.role !== 'VIEWER').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button size="sm" variant="danger" leadingIcon={<Trash2 size={14} />} onClick={() => { if (window.confirm(`Delete ${sel.size} task(s)?`)) bulk({ delete: true }) }}>Delete</Button>
          <button type="button" className="ml-auto text-ink-muted hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="overflow-x-auto rounded-card border border-line bg-card shadow-card">
        <table className="w-full min-w-[760px] text-body-md">
          <thead className="sticky top-0 border-b border-line bg-slate-50">
            <tr>
              {canManage && <th className="w-8 px-3"><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} className="h-4 w-4 accent-primary" aria-label="Select all" /></th>}
              <Th k="code" className="w-24">Task</Th>
              <Th k="title">Title</Th>
              <Th k="status">Status</Th>
              <Th k="assignee">Assignee</Th>
              <Th k="priority">Priority</Th>
              <Th k="due">Due</Th>
              <Th k="updated">Updated</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t, i) => (
              <tr key={t.id} className={cn('cursor-pointer hover:bg-primary/5', i % 2 === 1 && 'bg-slate-50/50')} onClick={() => onOpen(t.code)}>
                {canManage && (
                  <td className="px-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })} className="h-4 w-4 accent-primary" aria-label={`Select ${t.code}`} />
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-body-sm text-ink-muted">{t.code}</td>
                <td className="max-w-[340px] truncate px-3 py-2 font-medium text-ink">{t.title}</td>
                <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-body-sm text-ink">{t.status}</span></td>
                <td className="px-3 py-2"><AvatarStack people={t.assignees} max={3} size={22} /></td>
                <td className="px-3 py-2"><PriorityIcon priority={t.priority} withLabel /></td>
                <td className="px-3 py-2">{t.dueAt ? <DueChip dueAt={t.dueAt} category={t.category} /> : <span className="text-body-sm text-ink-muted">None</span>}</td>
                <td className="px-3 py-2 text-body-sm text-ink-muted">{fmtAgo(t.updatedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-body-md text-ink-muted">No tasks match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
