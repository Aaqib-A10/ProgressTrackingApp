import { api } from './api'

export interface Todo {
  id: string
  title: string
  done: boolean
  dueDate: string | null
  order: number
  completedAt: string | null
  createdAt: string
}

export const listTodos = () => api.get<{ todos: Todo[] }>('/todos')
export const createTodo = (input: { title: string; dueDate?: string | null }) =>
  api.post<{ todo: Todo }>('/todos', input)
export const updateTodo = (id: string, input: { title?: string; done?: boolean; dueDate?: string | null }) =>
  api.patch<{ todo: Todo }>(`/todos/${id}`, input)
export const deleteTodo = (id: string) => api.del<void>(`/todos/${id}`)
