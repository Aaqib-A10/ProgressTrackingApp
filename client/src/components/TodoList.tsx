import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, CalendarDays } from 'lucide-react'
import { listTodos, createTodo, updateTodo, deleteTodo, type Todo } from '../lib/todosApi'
import { useToast } from './ui/Toast'
import { cn } from '../lib/cn'

function errMsg(e: unknown, fallback: string): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : fallback
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Personal, private to-do list. `limit` caps how many rows render (dashboard card). */
export function TodoList({ limit, onCountChange }: { limit?: number; onCountChange?: (open: number) => void }) {
  const { addToast } = useToast()
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    listTodos()
      .then((r) => setTodos(r.todos))
      .catch(() => setTodos([]))
  }, [])

  useEffect(() => {
    if (todos && onCountChange) onCountChange(todos.filter((t) => !t.done).length)
  }, [todos, onCountChange])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    try {
      const { todo } = await createTodo({ title: title.trim(), dueDate: due || null })
      setTodos((prev) => [todo, ...(prev ?? [])])
      setTitle('')
      setDue('')
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not add item.') })
    } finally {
      setAdding(false)
    }
  }

  async function toggle(t: Todo) {
    // optimistic
    setTodos((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
    try {
      const { todo } = await updateTodo(t.id, { done: !t.done })
      setTodos((prev) => (prev ?? []).map((x) => (x.id === t.id ? todo : x)))
    } catch (err) {
      setTodos((prev) => (prev ?? []).map((x) => (x.id === t.id ? t : x)))
      addToast({ type: 'error', message: errMsg(err, 'Could not update item.') })
    }
  }

  async function remove(t: Todo) {
    setTodos((prev) => (prev ?? []).filter((x) => x.id !== t.id))
    try {
      await deleteTodo(t.id)
    } catch (err) {
      setTodos((prev) => [t, ...(prev ?? [])])
      addToast({ type: 'error', message: errMsg(err, 'Could not delete item.') })
    }
  }

  if (!todos) return <p className="py-4 text-body-sm text-ink-muted">Loading…</p>

  const sorted = [...todos].sort((a, b) => Number(a.done) - Number(b.done))
  const shown = limit ? sorted.slice(0, limit) : sorted
  const hiddenDone = limit ? sorted.length - shown.length : 0

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="h-9 min-w-0 flex-1 rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm text-ink focus:border-primary focus:outline-none"
          title="Optional due date"
        />
        <button
          type="submit"
          disabled={adding || !title.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-btn bg-primary px-3 text-body-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <Plus size={16} /> Add
        </button>
      </form>

      {shown.length === 0 ? (
        <p className="py-3 text-body-sm text-ink-muted">Nothing here yet. Add your first task above.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((t) => (
            <li key={t.id} className="group flex items-center gap-3 rounded-btn px-2 py-1.5 hover:bg-slate-50">
              <button
                type="button"
                onClick={() => toggle(t)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                  t.done ? 'border-success bg-success text-white' : 'border-line hover:border-primary',
                )}
                aria-label={t.done ? 'Mark not done' : 'Mark done'}
              >
                {t.done && <Check size={13} />}
              </button>
              <span className={cn('min-w-0 flex-1 truncate text-body-md', t.done ? 'text-ink-muted line-through' : 'text-ink')}>
                {t.title}
              </span>
              {t.dueDate && (
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 text-body-sm',
                    !t.done && t.dueDate < todayISO() ? 'font-semibold text-danger' : 'text-ink-muted',
                  )}
                >
                  <CalendarDays size={12} /> {t.dueDate}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(t)}
                className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {hiddenDone > 0 && <p className="text-body-sm text-ink-muted">+{hiddenDone} more</p>}
    </div>
  )
}
