import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'
import { companyTz } from './time'
import { visibleProjectIds } from './pm/access'

/**
 * "What everyone is working on" (dashboard, 24 Nov 2026). A team's dashboard counted only its department's own
 * numbers (tasks published, blogs, social posts), so a marketer who builds the website, makes videos or designs showed
 * nothing at all. This gathers each person's real work from every place it is kept, whatever their department:
 *   - project tasks (Projects): in progress now, finished in the period, still to do, overdue;
 *   - their to-dos (My To-Do): in progress, done in the period (another person's private to-dos are never shown, the
 *     same rule as the team to-do view, controllers/workLogController.ts teamWorkLog);
 *   - marketing items (the Marketing board): in progress or in review, published in the period;
 *   - time logged on tasks (when the company uses time on tasks).
 *
 * Who is shown: a member sees themself; a team lead their department (themself included); a sub-department lead their
 * sub-department; a Super Admin everyone. A project task's title shows only to a viewer who may open its project
 * (anyone else sees "a task in another project"), the same rule as the Projects screens.
 */

export type WorkKind = 'task' | 'todo' | 'marketing'
export interface WorkItem { kind: WorkKind; title: string; where: string | null; at: string; link: string | null; overdue?: boolean }
export interface PersonWork {
  id: string
  name: string
  role: Role
  department: string | null
  avatarAt: string | null
  doing: WorkItem[]
  done: { total: number; tasks: number; todos: number; marketing: number; recent: WorkItem[] }
  open: number
  overdue: number
  minutes: number
  lastActive: string | null
}
export interface TeamWork { range: { startDate: string; endDate: string }; scope: 'me' | 'team' | 'company'; people: PersonWork[] }

export interface WorkViewer { id: string; role: Role; departmentId: string | null; subDepartmentId: string | null }

const HIDDEN = 'A task in another project'
/** To-dos another person may see: not private, not cancelled, not made by a follow-up rule (as the team to-do view). */
const SHARED_TODO = { private: false, cancelledAt: null, OR: [{ autoReason: null }, { autoReason: { not: 'FOLLOW_UP_RULE' } }] }

async function peopleFor(v: WorkViewer): Promise<{ scope: TeamWork['scope']; users: { id: string; name: string; role: Role; avatarAt: Date | null; department: { name: string } | null }[] }> {
  const select = { id: true, name: true, role: true, avatarAt: true, department: { select: { name: true } } } as const
  const active = { isActive: true, status: 'ACTIVE' as const }
  if (v.role === 'SUPER_ADMIN') return { scope: 'company', users: await prisma.user.findMany({ where: active, select, orderBy: { name: 'asc' }, take: 300 }) }
  if (v.role === 'TEAM_LEAD' && v.departmentId) return { scope: 'team', users: await prisma.user.findMany({ where: { ...active, departmentId: v.departmentId }, select, orderBy: { name: 'asc' } }) }
  if (v.role === 'SUB_DEPT_LEAD' && v.subDepartmentId) return { scope: 'team', users: await prisma.user.findMany({ where: { ...active, subDepartmentId: v.subDepartmentId }, select, orderBy: { name: 'asc' } }) }
  return { scope: 'me', users: await prisma.user.findMany({ where: { id: v.id }, select }) }
}

export async function teamWork(v: WorkViewer, startDate: string, endDate: string, now = new Date()): Promise<TeamWork> {
  const zone = companyTz()
  const from = DateTime.fromISO(startDate, { zone }).startOf('day').toJSDate()
  const to = DateTime.fromISO(endDate, { zone }).endOf('day').toJSDate()
  const { scope, users } = await peopleFor(v)
  const ids = users.map((u) => u.id)
  if (!ids.length) return { range: { startDate, endDate }, scope, people: [] }
  const others = ids.filter((id) => id !== v.id)
  // My own to-dos all count; another person's only when they are shared.
  const todoOf = { OR: [{ userId: v.id }, { userId: { in: others }, ...SHARED_TODO }] }
  const mine = { assignees: { some: { userId: { in: ids } } } }
  const taskSelect = { id: true, title: true, projectId: true, dueAt: true, isOverdue: true, updatedAt: true, completedAt: true, project: { select: { name: true, key: true } }, assignees: { select: { userId: true } } } as const

  const [canSee, doingTasks, doneTasks, openTasks, doingTodos, doneTodos, doingMkt, doneMkt, time] = await Promise.all([
    visibleProjectIds({ id: v.id, role: v.role }, true).then((x) => new Set(x)),
    prisma.pmTask.findMany({ where: { ...mine, deletedAt: null, column: { category: 'IN_PROGRESS' } }, select: taskSelect, orderBy: { updatedAt: 'desc' }, take: 1500 }),
    prisma.pmTask.findMany({ where: { ...mine, deletedAt: null, completedAt: { gte: from, lte: to } }, select: taskSelect, orderBy: { completedAt: 'desc' }, take: 3000 }),
    prisma.pmTask.findMany({ where: { ...mine, deletedAt: null, column: { category: { not: 'DONE' } } }, select: { isOverdue: true, dueAt: true, assignees: { select: { userId: true } } }, take: 5000 }),
    prisma.workLogEntry.findMany({ where: { AND: [todoOf, { status: 'IN_PROGRESS' }] }, select: { userId: true, title: true, updatedAt: true, dueAt: true }, orderBy: { updatedAt: 'desc' }, take: 1500 }),
    prisma.workLogEntry.findMany({ where: { AND: [todoOf, { status: 'DONE', doneAt: { gte: from, lte: to } }] }, select: { userId: true, title: true, doneAt: true }, orderBy: { doneAt: 'desc' }, take: 3000 }),
    prisma.marketingTask.findMany({ where: { assigneeId: { in: ids }, status: { in: ['IN_PROGRESS', 'IN_REVIEW'] } }, select: { assigneeId: true, title: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 1500 }),
    prisma.marketingTask.findMany({ where: { assigneeId: { in: ids }, completedAt: { gte: from, lte: to } }, select: { assigneeId: true, title: true, completedAt: true }, orderBy: { completedAt: 'desc' }, take: 3000 }),
    prisma.pmTimeEntry.groupBy({ by: ['userId'], where: { userId: { in: ids }, startedAt: { gte: from, lte: to } }, _sum: { minutes: true } }),
  ])

  const shown = (t: { projectId: string; title: string; project: { name: string; key: string } }) => (canSee.has(t.projectId) ? { title: t.title, where: t.project.name, link: `/app/projects/${encodeURIComponent(t.project.key)}` } : { title: HIDDEN, where: null, link: null })
  const iso = (d: Date | null) => (d ? d.toISOString() : '')
  const byPerson = new Map<string, PersonWork>(users.map((u) => [u.id, {
    id: u.id, name: u.name, role: u.role, department: u.department?.name ?? null, avatarAt: u.avatarAt ? u.avatarAt.toISOString() : null,
    doing: [], done: { total: 0, tasks: 0, todos: 0, marketing: 0, recent: [] }, open: 0, overdue: 0, minutes: 0, lastActive: null,
  }]))
  const touch = (p: PersonWork, at: string) => { if (at && (!p.lastActive || at > p.lastActive)) p.lastActive = at }
  const isLate = (due: Date | null) => !!due && due < now

  for (const t of doingTasks) for (const a of t.assignees) {
    const p = byPerson.get(a.userId); if (!p) continue
    p.doing.push({ kind: 'task', ...shown(t), at: iso(t.updatedAt), overdue: t.isOverdue || isLate(t.dueAt) }); touch(p, iso(t.updatedAt))
  }
  for (const t of doingTodos) { const p = byPerson.get(t.userId); if (!p) continue; p.doing.push({ kind: 'todo', title: t.title, where: 'To-do', at: iso(t.updatedAt), link: t.userId === v.id ? '/app/todo' : null, overdue: isLate(t.dueAt) }); touch(p, iso(t.updatedAt)) }
  for (const t of doingMkt) { const p = t.assigneeId ? byPerson.get(t.assigneeId) : undefined; if (!p) continue; p.doing.push({ kind: 'marketing', title: t.title, where: t.status === 'IN_REVIEW' ? 'Marketing, in review' : 'Marketing', at: iso(t.updatedAt), link: null }); touch(p, iso(t.updatedAt)) }

  for (const t of doneTasks) for (const a of t.assignees) {
    const p = byPerson.get(a.userId); if (!p) continue
    p.done.tasks++; p.done.recent.push({ kind: 'task', ...shown(t), at: iso(t.completedAt) }); touch(p, iso(t.completedAt))
  }
  for (const t of doneTodos) { const p = byPerson.get(t.userId); if (!p) continue; p.done.todos++; p.done.recent.push({ kind: 'todo', title: t.title, where: 'To-do', at: iso(t.doneAt), link: t.userId === v.id ? '/app/todo' : null }); touch(p, iso(t.doneAt)) }
  for (const t of doneMkt) { const p = t.assigneeId ? byPerson.get(t.assigneeId) : undefined; if (!p) continue; p.done.marketing++; p.done.recent.push({ kind: 'marketing', title: t.title, where: 'Marketing, published', at: iso(t.completedAt), link: null }); touch(p, iso(t.completedAt)) }

  for (const t of openTasks) for (const a of t.assignees) {
    const p = byPerson.get(a.userId); if (!p) continue
    p.open++; if (t.isOverdue || isLate(t.dueAt)) p.overdue++
  }
  for (const r of time) { const p = byPerson.get(r.userId); if (p) p.minutes = r._sum.minutes ?? 0 }

  const people = [...byPerson.values()].map((p) => {
    p.doing.sort((a, b) => b.at.localeCompare(a.at)); p.doing = p.doing.slice(0, 6)
    p.done.total = p.done.tasks + p.done.todos + p.done.marketing
    p.done.recent.sort((a, b) => b.at.localeCompare(a.at)); p.done.recent = p.done.recent.slice(0, 6)
    return p
  })
  // The busiest first: most finished, then most in progress; quiet people last, by name.
  people.sort((a, b) => b.done.total - a.done.total || b.doing.length - a.doing.length || a.name.localeCompare(b.name))
  return { range: { startDate, endDate }, scope, people }
}
