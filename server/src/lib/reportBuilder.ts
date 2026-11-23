import { DateTime } from 'luxon'
import { prisma } from './prisma'
import { companyTz } from './time'

/**
 * The report builder (plan 2026-11, 2.7): pick what to count, how to split it and the dates, and get a table and a
 * chart. Six sources that every company has. Admins see the whole company; a team lead sees their own team's
 * people. Rows are read with a cap and grouped here, so a report can never ask the database for something odd.
 */

export interface SourceDef { key: string; label: string; measures: { key: string; label: string; money?: boolean }[]; groups: { key: string; label: string }[] }

const TIME_GROUPS = [{ key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }]

export const SOURCES: SourceDef[] = [
  { key: 'tasks', label: 'Tasks', measures: [{ key: 'count', label: 'Tasks made' }, { key: 'done', label: 'Tasks finished' }, { key: 'overdue', label: 'Overdue now' }, { key: 'hours', label: 'Hours logged' }], groups: [{ key: 'person', label: 'Person' }, { key: 'project', label: 'Project' }, { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' }, ...TIME_GROUPS] },
  { key: 'attendance', label: 'Attendance', measures: [{ key: 'count', label: 'Days checked in' }, { key: 'hours', label: 'Hours at work' }], groups: [{ key: 'person', label: 'Person' }, { key: 'department', label: 'Team' }, { key: 'day', label: 'Day' }, ...TIME_GROUPS] },
  { key: 'leads', label: 'Leads', measures: [{ key: 'count', label: 'Leads' }, { key: 'value', label: 'Value', money: true }], groups: [{ key: 'status', label: 'Status' }, { key: 'source', label: 'Source' }, { key: 'person', label: 'Person' }, { key: 'business', label: 'Lead business' }, ...TIME_GROUPS] },
  { key: 'deals', label: 'Deals', measures: [{ key: 'count', label: 'Deals' }, { key: 'value', label: 'Total amount', money: true }], groups: [{ key: 'status', label: 'Status' }, { key: 'person', label: 'Person' }, { key: 'type', label: 'Type' }, ...TIME_GROUPS] },
  { key: 'requests', label: 'Requests', measures: [{ key: 'count', label: 'Requests' }, { key: 'value', label: 'Amount', money: true }], groups: [{ key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }, { key: 'person', label: 'Person' }, ...TIME_GROUPS] },
  { key: 'invoices', label: 'Invoices', measures: [{ key: 'count', label: 'Invoices' }, { key: 'value', label: 'Total', money: true }], groups: [{ key: 'status', label: 'Status' }, { key: 'customer', label: 'Customer' }, ...TIME_GROUPS] },
]

export const RANGES = ['7d', '30d', '90d', 'month', 'year'] as const
export type RangeKey = (typeof RANGES)[number]

export interface ReportSpec { source: string; measure: string; groupBy: string; range: RangeKey; chart?: string }
export interface ReportResult { rows: { label: string; value: number }[]; total: number; money: boolean; from: string; to: string; capped: boolean }
export interface Viewer { id: string; role: string; departmentId: string | null }

export class ReportError extends Error { constructor(public status: number, message: string) { super(message) } }

const CAP = 20000
const title = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : 'Not set')

/** The dates a range covers, on the company's clock. */
export function rangeDates(range: RangeKey, now = new Date()): { from: Date; to: Date } {
  const end = DateTime.fromJSDate(now).setZone(companyTz())
  const start = range === 'month' ? end.startOf('month') : range === 'year' ? end.startOf('year') : end.minus({ days: Number(range.slice(0, -1)) - 1 }).startOf('day')
  return { from: start.toJSDate(), to: end.toJSDate() }
}

export async function runReport(spec: ReportSpec, viewer: Viewer, now = new Date()): Promise<ReportResult> {
  const src = SOURCES.find((s) => s.key === spec.source)
  if (!src) throw new ReportError(400, 'Pick what the report is about.')
  const measure = src.measures.find((m) => m.key === spec.measure)
  const group = src.groups.find((g) => g.key === spec.groupBy)
  if (!measure || !group) throw new ReportError(400, 'Pick what to count and how to split it.')
  if (!RANGES.includes(spec.range)) throw new ReportError(400, 'Pick the dates.')
  if (viewer.role !== 'SUPER_ADMIN' && viewer.role !== 'TEAM_LEAD') throw new ReportError(403, 'Reports are built by team leads and admins.')

  const { from, to } = rangeDates(spec.range, now)
  const zone = companyTz()
  // A team lead's report covers the people of their own team.
  const team = viewer.role === 'SUPER_ADMIN' ? null : (await prisma.user.findMany({ where: { departmentId: viewer.departmentId ?? '__none__' }, select: { id: true } })).map((u) => u.id)
  const mine = team ? { in: team } : undefined
  const bucket = (d: Date) => {
    const t = DateTime.fromJSDate(d).setZone(zone)
    return spec.groupBy === 'day' ? t.toISODate()! : spec.groupBy === 'week' ? `Week of ${t.startOf('week').toFormat('LLL d')}` : t.toFormat('LLL yyyy')
  }
  const sortKey = (d: Date) => DateTime.fromJSDate(d).setZone(zone).startOf(spec.groupBy === 'day' ? 'day' : spec.groupBy === 'week' ? 'week' : 'month').toMillis()
  const timed = ['day', 'week', 'month'].includes(spec.groupBy)

  const acc = new Map<string, { value: number; order: number }>()
  const add = (label: string, value: number, order = 0) => { const a = acc.get(label); if (a) a.value += value; else acc.set(label, { value, order }) }
  let read = 0

  if (src.key === 'tasks') {
    const hours = spec.measure === 'hours'
    type Spent = { minutes: number; userId: string; user: { name: string } }
    const rows = await prisma.pmTask.findMany({
      where: { deletedAt: null, ...(spec.measure === 'done' ? { completedAt: { gte: from, lte: to } } : spec.measure === 'overdue' ? { isOverdue: true, completedAt: null } : { createdAt: { gte: from, lte: to } }), ...(mine ? { assignees: { some: { userId: mine } } } : {}) },
      select: { createdAt: true, completedAt: true, priority: true, column: { select: { name: true } }, project: { select: { name: true } }, assignees: { select: { userId: true, user: { select: { name: true } } } }, timeEntries: { where: hours ? {} : { id: '__none__' }, select: { minutes: true, userId: true, user: { select: { name: true } } } } },
      take: CAP,
    })
    read = rows.length
    for (const r of rows) {
      const at = spec.measure === 'done' ? r.completedAt ?? r.createdAt : r.createdAt
      if (spec.groupBy === 'person') {
        if (hours) { for (const e of (r.timeEntries as Spent[]).filter((e) => !team || team.includes(e.userId))) add(e.user.name, e.minutes / 60); continue }
        const people = r.assignees.filter((a) => !team || team.includes(a.userId))
        if (!people.length) add('Nobody', 1)
        for (const a of people) add(a.user.name, 1)
        continue
      }
      const v = hours ? (r.timeEntries as Spent[]).reduce((s, e) => s + e.minutes, 0) / 60 : 1
      if (timed) add(bucket(at), v, sortKey(at))
      else add(spec.groupBy === 'project' ? r.project.name : spec.groupBy === 'status' ? r.column.name : title(r.priority), v)
    }
  } else if (src.key === 'attendance') {
    const day = (d: Date) => new Date(`${DateTime.fromJSDate(d).setZone(zone).toISODate()}T00:00:00.000Z`)
    const rows = await prisma.attendanceDay.findMany({ where: { date: { gte: day(from), lte: day(to) }, checkInAt: { not: null }, ...(mine ? { userId: mine } : {}) }, select: { date: true, checkInAt: true, checkOutAt: true, user: { select: { name: true, department: { select: { name: true } } } } }, take: CAP })
    read = rows.length
    for (const r of rows) {
      const v = spec.measure === 'hours' ? (r.checkOutAt && r.checkInAt ? Math.max(0, r.checkOutAt.getTime() - r.checkInAt.getTime()) / 3600_000 : 0) : 1
      // Attendance days are plain dates: read them as they are written.
      const at = new Date(`${r.date.toISOString().slice(0, 10)}T12:00:00.000Z`)
      if (timed) add(spec.groupBy === 'day' ? r.date.toISOString().slice(0, 10) : bucket(at), v, sortKey(at))
      else add(spec.groupBy === 'person' ? r.user.name : r.user.department?.name ?? 'No team', v)
    }
  } else if (src.key === 'leads') {
    const rows = await prisma.lead.findMany({ where: { createdAt: { gte: from, lte: to }, ...(mine ? { assigneeId: mine } : {}) }, select: { createdAt: true, status: true, source: true, value: true, assignee: { select: { name: true } }, business: { select: { name: true } } }, take: CAP })
    read = rows.length
    for (const r of rows) {
      const v = spec.measure === 'value' ? r.value ?? 0 : 1
      if (timed) add(bucket(r.createdAt), v, sortKey(r.createdAt))
      else add(spec.groupBy === 'status' ? title(r.status) : spec.groupBy === 'source' ? title(r.source) : spec.groupBy === 'person' ? r.assignee?.name ?? 'Nobody' : r.business.name, v)
    }
  } else if (src.key === 'deals') {
    const rows = await prisma.bid.findMany({ where: { createdAt: { gte: from, lte: to }, ...(mine ? { agentId: mine } : {}) }, select: { createdAt: true, status: true, type: true, totalAmount: true, agent: { select: { name: true } } }, take: CAP })
    read = rows.length
    for (const r of rows) {
      const v = spec.measure === 'value' ? Number(r.totalAmount ?? 0) : 1
      if (timed) add(bucket(r.createdAt), v, sortKey(r.createdAt))
      else add(spec.groupBy === 'status' ? title(r.status) : spec.groupBy === 'person' ? r.agent.name : r.type, v)
    }
  } else if (src.key === 'requests') {
    const rows = await prisma.approvalRequest.findMany({ where: { createdAt: { gte: from, lte: to }, ...(mine ? { requesterId: mine } : {}) }, select: { createdAt: true, kind: true, status: true, amount: true, requester: { select: { name: true } } }, take: CAP })
    read = rows.length
    for (const r of rows) {
      const v = spec.measure === 'value' ? Number(r.amount ?? 0) : 1
      if (timed) add(bucket(r.createdAt), v, sortKey(r.createdAt))
      else add(spec.groupBy === 'kind' ? title(r.kind) : spec.groupBy === 'status' ? title(r.status) : r.requester.name, v)
    }
  } else {
    const day = (d: Date) => new Date(`${DateTime.fromJSDate(d).setZone(zone).toISODate()}T00:00:00.000Z`)
    const rows = await prisma.salesDoc.findMany({ where: { kind: 'INVOICE', issueDate: { gte: day(from), lte: day(to) }, ...(mine ? { createdById: mine } : {}) }, select: { issueDate: true, status: true, customerName: true, total: true }, take: CAP })
    read = rows.length
    for (const r of rows) {
      const v = spec.measure === 'value' ? Number(r.total) : 1
      const at = new Date(`${r.issueDate.toISOString().slice(0, 10)}T12:00:00.000Z`)
      if (timed) add(bucket(at), v, sortKey(at))
      else add(spec.groupBy === 'status' ? title(r.status) : r.customerName, v)
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100
  const rows = [...acc.entries()].map(([label, a]) => ({ label, value: round(a.value), order: a.order }))
  rows.sort((a, b) => (timed ? a.order - b.order : b.value - a.value || a.label.localeCompare(b.label)))
  return {
    rows: rows.slice(0, 200).map(({ label, value }) => ({ label, value })),
    total: round(rows.reduce((s, r) => s + r.value, 0)),
    money: !!measure.money,
    from: DateTime.fromJSDate(from).setZone(zone).toISODate()!,
    to: DateTime.fromJSDate(to).setZone(zone).toISODate()!,
    capped: read >= CAP,
  }
}
