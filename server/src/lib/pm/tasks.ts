import type { PmColumnCategory, PmProjectRole, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { evenRanks } from './rank'

/** Default board columns for every new project. */
export const DEFAULT_COLUMNS: { name: string; category: PmColumnCategory; isDefault?: boolean; color?: string }[] = [
  { name: 'Backlog', category: 'TODO', color: '#94A3B8' },
  { name: 'To Do', category: 'TODO', isDefault: true, color: '#64748B' },
  { name: 'In Progress', category: 'IN_PROGRESS', color: '#4F46E5' },
  { name: 'In Review', category: 'IN_PROGRESS', color: '#8B5CF6' },
  { name: 'Blocked', category: 'IN_PROGRESS', color: '#EF4444' },
  { name: 'Done', category: 'DONE', color: '#22C55E' },
]

/** Everything a board card needs, loaded in one query. */
export const CARD_INCLUDE = {
  assignees: { include: { user: { select: { id: true, name: true } } }, orderBy: { assignedAt: 'asc' } },
  labels: { include: { label: true } },
  createdBy: { select: { id: true, name: true } },
  column: { select: { id: true, name: true, category: true } },
  checklist: { select: { isDone: true } },
  _count: { select: { comments: { where: { deletedAt: null } }, attachments: true } },
} satisfies Prisma.PmTaskInclude

export type CardTask = Prisma.PmTaskGetPayload<{ include: typeof CARD_INCLUDE }>

export function serializeCard(t: CardTask) {
  return {
    id: t.id,
    code: t.code,
    title: t.title,
    columnId: t.columnId,
    status: t.column.name,
    category: t.column.category,
    position: t.position,
    priority: t.priority,
    startAt: t.startAt?.toISOString() ?? null,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    isOverdue: isTaskOverdue(t, t.column.category),
    createdBy: t.createdBy,
    assignees: t.assignees.map((a) => a.user),
    labels: t.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    counts: {
      comments: t._count.comments,
      attachments: t._count.attachments,
      checklistDone: t.checklist.filter((c) => c.isDone).length,
      checklistTotal: t.checklist.length,
    },
    updatedAt: t.updatedAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  }
}

/** Live overdue rule: has a due time in the past and is not in a DONE column. */
export function isTaskOverdue(t: { dueAt: Date | null; deletedAt?: Date | null }, category: PmColumnCategory, now = new Date()): boolean {
  return !!t.dueAt && t.dueAt.getTime() < now.getTime() && category !== 'DONE' && !t.deletedAt
}

export async function logActivity(
  taskId: string,
  userId: string | null,
  action: string,
  meta?: Prisma.InputJsonValue,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.pmActivity.create({ data: { taskId, userId, action, meta } })
}

/**
 * Re-evaluate a task's stored overdue flag right after an edit (due date change,
 * column move). Setting the flag TRUE is left to the deadline cron so the
 * "became overdue" alerts fire from one place; clearing it happens immediately.
 */
export async function clearOverdueIfResolved(taskId: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const t = await tx.pmTask.findUnique({ where: { id: taskId }, include: { column: { select: { category: true } } } })
  if (!t || !t.isOverdue) return
  if (!isTaskOverdue(t, t.column.category)) {
    await tx.pmTask.update({ where: { id: taskId }, data: { isOverdue: false, overdueSince: null, lastOverdueNotifiedAt: null } })
  }
}

/**
 * Create a project with its default columns, its # chat channel, and the creator
 * (plus any initial members) as members. Runs in one transaction.
 */
export async function createProjectWithDefaults(input: {
  name: string
  key: string
  description?: string | null
  color?: string
  ownerId: string
  members?: { userId: string; role: PmProjectRole }[]
}) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.pmProject.create({
      data: {
        name: input.name,
        key: input.key,
        description: input.description ?? null,
        color: input.color ?? '#4F46E5',
        ownerId: input.ownerId,
      },
    })
    await tx.pmColumn.createMany({
      data: DEFAULT_COLUMNS.map((c, i) => ({
        projectId: project.id,
        name: c.name,
        category: c.category,
        position: i,
        color: c.color ?? null,
        isDefault: !!c.isDefault,
      })),
    })
    const members = new Map<string, PmProjectRole>()
    members.set(input.ownerId, 'ADMIN')
    for (const m of input.members ?? []) if (!members.has(m.userId)) members.set(m.userId, m.role)
    await tx.pmProjectMember.createMany({
      data: [...members].map(([userId, role]) => ({ projectId: project.id, userId, role, addedById: input.ownerId })),
    })
    const conv = await tx.chatConversation.create({
      data: { type: 'PROJECT', projectId: project.id, name: project.name, createdById: input.ownerId },
    })
    await tx.chatMember.createMany({
      data: [...members.keys()].map((userId) => ({ conversationId: conv.id, userId, isAdmin: members.get(userId) === 'ADMIN' })),
    })
    return project
  })
}

/** Keep the project's # channel membership identical to the project membership. */
export async function syncProjectChannel(projectId: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const project = await tx.pmProject.findUnique({ where: { id: projectId }, include: { conversation: true, members: true } })
  if (!project) return
  let conv = project.conversation
  if (!conv) conv = await tx.chatConversation.create({ data: { type: 'PROJECT', projectId, name: project.name } })
  const want = new Map(project.members.map((m) => [m.userId, m.role === 'ADMIN']))
  const have = await tx.chatMember.findMany({ where: { conversationId: conv.id } })
  const haveIds = new Set(have.map((h) => h.userId))
  const toAdd = [...want.keys()].filter((id) => !haveIds.has(id))
  const toRemove = have.filter((h) => !want.has(h.userId)).map((h) => h.id)
  if (toAdd.length) await tx.chatMember.createMany({ data: toAdd.map((userId) => ({ conversationId: conv!.id, userId, isAdmin: !!want.get(userId) })), skipDuplicates: true })
  if (toRemove.length) await tx.chatMember.deleteMany({ where: { id: { in: toRemove } } })
  for (const h of have) {
    if (want.has(h.userId) && h.isAdmin !== want.get(h.userId)) await tx.chatMember.update({ where: { id: h.id }, data: { isAdmin: !!want.get(h.userId) } })
  }
  if (conv.name !== project.name) await tx.chatConversation.update({ where: { id: conv.id }, data: { name: project.name } })
}

/** Renumber every task in a column with even spacing (keeps current order). */
export async function rebalanceColumn(columnId: string): Promise<void> {
  const tasks = await prisma.pmTask.findMany({ where: { columnId, deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } })
  const ranks = evenRanks(tasks.length)
  await prisma.$transaction(tasks.map((t, i) => prisma.pmTask.update({ where: { id: t.id }, data: { position: ranks[i] } })))
}
