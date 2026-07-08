import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb } from '../lib/time'

/** A personal to-do is always private to its owner; every query is scoped by userId. */

function serialize(t: {
  id: string
  title: string
  done: boolean
  dueDate: Date | null
  order: number
  completedAt: Date | null
  createdAt: Date
}) {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate ? dateStringFromDb(t.dueDate) : null,
    order: t.order,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  }
}

/** GET /api/todos — the caller's own list (open first, then done). */
export async function listTodos(req: AuthedRequest, res: Response): Promise<void> {
  const items = await prisma.todoItem.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ done: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ todos: items.map(serialize) })
}

const dueField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(''))
  .nullable()
  .optional()

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  dueDate: dueField,
})

/** POST /api/todos — add an item to the caller's list. */
export async function createTodo(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  // New items sort to the top of the open list.
  const min = await prisma.todoItem.aggregate({ where: { userId: req.user!.id }, _min: { order: true } })
  const item = await prisma.todoItem.create({
    data: {
      userId: req.user!.id,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ? dbDateFromString(parsed.data.dueDate) : null,
      order: (min._min.order ?? 0) - 1,
    },
  })
  res.status(201).json({ todo: serialize(item) })
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  dueDate: dueField,
})

/** PATCH /api/todos/:id — edit, toggle done, or reschedule. Owner only. */
export async function updateTodo(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const existing = await prisma.todoItem.findFirst({ where: { id: req.params.id, userId: req.user!.id } })
  if (!existing) {
    res.status(404).json({ error: 'To-do not found' })
    return
  }
  const data: { title?: string; done?: boolean; completedAt?: Date | null; dueDate?: Date | null } = {}
  if (parsed.data.title !== undefined) data.title = parsed.data.title
  if (parsed.data.done !== undefined) {
    data.done = parsed.data.done
    data.completedAt = parsed.data.done ? new Date() : null
  }
  if (parsed.data.dueDate !== undefined) data.dueDate = parsed.data.dueDate ? dbDateFromString(parsed.data.dueDate) : null
  const item = await prisma.todoItem.update({ where: { id: existing.id }, data })
  res.json({ todo: serialize(item) })
}

/** DELETE /api/todos/:id — remove an item. Owner only. */
export async function deleteTodo(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await prisma.todoItem.findFirst({ where: { id: req.params.id, userId: req.user!.id } })
  if (!existing) {
    res.status(404).json({ error: 'To-do not found' })
    return
  }
  await prisma.todoItem.delete({ where: { id: existing.id } })
  res.status(204).end()
}
