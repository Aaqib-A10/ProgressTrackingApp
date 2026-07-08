import { Card } from '../../components/ui/Card'
import { TodoList } from '../../components/TodoList'

/** Personal, private to-do list — /app/todo. */
export default function MyTodo() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">My To-Do</h1>
        <p className="mt-1 text-body-md text-ink-muted">Your personal checklist. Only you can see this.</p>
      </div>
      <Card>
        <TodoList />
      </Card>
    </div>
  )
}
