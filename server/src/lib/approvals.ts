import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { dbDateFromString } from './time'

/**
 * One approvals engine (plan 2026-11, 2.1). A person asks for something (an expense, a purchase, leave, anything
 * else); the company's rule for that kind says who must approve it, in order; each approver decides in turn; the
 * first "no" ends it. Approved leave is put on the attendance calendar, so every leave-aware number already counts it.
 *
 * The older requests (work from home, a forgotten check-in, more time on a ticket) keep their own screens; the
 * Requests page lists what waits on a person from all of them in one place.
 */

export const APPROVAL_KINDS = ['EXPENSE', 'PURCHASE', 'LEAVE', 'OTHER'] as const
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]
export const LEAVE_KINDS = ['ANNUAL', 'SICK', 'CASUAL', 'UNPAID'] as const
export type LeaveKind = (typeof LEAVE_KINDS)[number]
/** The kinds of leave that have a yearly number of days. */
export const COUNTED_LEAVE = ['ANNUAL', 'SICK', 'CASUAL'] as const

export const KIND_LABEL: Record<ApprovalKind, string> = { EXPENSE: 'Expense', PURCHASE: 'Purchase', LEAVE: 'Leave', OTHER: 'Request' }
const LEAVE_LABEL: Record<string, string> = { ANNUAL: 'Annual leave', SICK: 'Sick leave', CASUAL: 'Casual leave', UNPAID: 'Unpaid leave' }

type Person = { id: string; role: string; departmentId: string | null }

/** With no rule, the requester's team lead decides (an admin when there is no lead). */
export const DEFAULT_CHAIN = ['LEAD']

/** The approvers for this kind and amount: the matching rule with the highest "from" amount wins. */
export async function chainFor(kind: string, amount: number | null): Promise<string[]> {
  const rules = await prisma.approvalRule.findMany({ where: { kind } })
  const fits = rules
    .filter((r) => r.chain.length && (r.minAmount === null || (amount !== null && Number(r.minAmount) <= amount)))
    .sort((a, b) => Number(b.minAmount ?? -1) - Number(a.minAmount ?? -1))
  return fits[0]?.chain ?? DEFAULT_CHAIN
}

const active = { isActive: true, status: 'ACTIVE' as const }

/** The people who may decide a step: never the requester themself. */
export async function approversOf(approver: string, requester: Person): Promise<string[]> {
  const admins = async () => (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', ...active, id: { not: requester.id } }, select: { id: true } })).map((u) => u.id)
  if (approver === 'ADMIN') return admins()
  if (approver === 'LEAD') {
    if (requester.departmentId && requester.role !== 'SUPER_ADMIN') {
      const leads = await prisma.user.findMany({ where: { role: 'TEAM_LEAD', departmentId: requester.departmentId, ...active, id: { not: requester.id } }, select: { id: true } })
      if (leads.length) return leads.map((l) => l.id)
    }
    return admins()
  }
  if (approver === requester.id) return []
  const one = await prisma.user.findFirst({ where: { id: approver, ...active }, select: { id: true } })
  return one ? [one.id] : []
}

export const REQUEST_INCLUDE = {
  requester: { select: { id: true, name: true, role: true, departmentId: true } },
  steps: { orderBy: { position: 'asc' as const }, include: { decidedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.ApprovalRequestInclude
export type FullRequest = Prisma.ApprovalRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** One line saying what is asked ("Expense: Taxi to the airport, USD 40.00"). */
export function requestLine(r: { kind: string; title: string; amount: Prisma.Decimal | number | null; currency: string; days: string[]; leaveKind: string | null }): string {
  if (r.kind === 'LEAVE') return `${LEAVE_LABEL[r.leaveKind ?? ''] ?? 'Leave'}: ${r.days.length} day${r.days.length === 1 ? '' : 's'} (${r.days[0]}${r.days.length > 1 ? ` to ${r.days[r.days.length - 1]}` : ''})`
  return `${KIND_LABEL[r.kind as ApprovalKind] ?? 'Request'}: ${r.title}${r.amount !== null ? `, ${money(Number(r.amount), r.currency)}` : ''}`
}

/**
 * Move the request to its next step. A step nobody can decide (no lead, no other admin) is skipped; when no step is
 * left the request is approved. Returns the request as it now stands.
 */
export async function advance(requestId: string): Promise<FullRequest> {
  for (;;) {
    const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE })
    if (r.status !== 'PENDING') return r
    if (r.steps.some((s) => s.status === 'PENDING')) return r
    const next = r.steps.find((s) => s.status === 'WAITING')
    if (!next) {
      await prisma.approvalRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', decidedAt: new Date() } })
      await onApproved(r)
      return prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE })
    }
    const who = await approversOf(next.approver, r.requester)
    if (!who.length) {
      await prisma.approvalStep.update({ where: { id: next.id }, data: { status: 'SKIPPED', note: 'Nobody else could decide this step.', decidedAt: new Date() } })
      continue
    }
    await prisma.approvalStep.update({ where: { id: next.id }, data: { status: 'PENDING' } })
    await prisma.notification.createMany({
      data: who.map((userId) => ({ userId, actorId: r.requesterId, type: 'APPROVAL_REQUESTED' as const, title: `${r.requester.name} asks for your approval`, body: requestLine(r).slice(0, 200), link: `/app/requests?open=${r.id}`, entityType: 'ApprovalRequest', entityId: r.id })),
    })
    return prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE })
  }
}

/** Approved: tell the requester; leave goes on the attendance calendar. */
async function onApproved(r: FullRequest): Promise<void> {
  if (r.kind === 'LEAVE') {
    const note = `${LEAVE_LABEL[r.leaveKind ?? ''] ?? 'Leave'} (request #${r.number})`
    for (const d of r.days) {
      const date = dbDateFromString(d)
      await prisma.leaveDay.upsert({ where: { userId_date: { userId: r.requesterId, date } }, update: { type: 'ON_LEAVE', note }, create: { userId: r.requesterId, date, type: 'ON_LEAVE', note } })
    }
  }
  await prisma.notification.create({ data: { userId: r.requesterId, type: 'APPROVAL_DECIDED', title: 'Your request was approved', body: requestLine(r).slice(0, 200), link: `/app/requests?open=${r.id}`, entityType: 'ApprovalRequest', entityId: r.id } })
}

/** May `me` decide the step that is waiting now? */
export async function canDecideNow(r: FullRequest, meId: string): Promise<boolean> {
  if (r.status !== 'PENDING') return false
  const step = r.steps.find((s) => s.status === 'PENDING')
  if (!step) return false
  return (await approversOf(step.approver, r.requester)).includes(meId)
}

/** Decide the waiting step. A "no" ends the request; a "yes" moves it on. */
export async function decide(r: FullRequest, me: { id: string; name: string }, approve: boolean, note: string | null): Promise<FullRequest> {
  const step = r.steps.find((s) => s.status === 'PENDING')!
  // Only the step still waiting is decided: two approvers pressing at once make one decision.
  const done = await prisma.approvalStep.updateMany({ where: { id: step.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me.id, note, decidedAt: new Date() } })
  if (!done.count) return prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include: REQUEST_INCLUDE })
  // The other approvers of this step have nothing left to do.
  await prisma.notification.updateMany({ where: { type: 'APPROVAL_REQUESTED', entityType: 'ApprovalRequest', entityId: r.id, readAt: null }, data: { readAt: new Date() } })
  if (!approve) {
    await prisma.approvalRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedAt: new Date() } })
    await prisma.notification.create({ data: { userId: r.requesterId, actorId: me.id, type: 'APPROVAL_DECIDED', title: `${me.name} did not approve your request`, body: `${requestLine(r)}${note ? `. "${note}"` : ''}`.slice(0, 300), link: `/app/requests?open=${r.id}`, entityType: 'ApprovalRequest', entityId: r.id } })
    return prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include: REQUEST_INCLUDE })
  }
  return advance(r.id)
}

// ------------------------------------------------------------------ leave balances

export type LeaveNumbers = Record<(typeof COUNTED_LEAVE)[number], { allowed: number | null; used: number; waiting: number; left: number | null }> & { UNPAID: { used: number; waiting: number } }

/** The company's days per year, when it has set them. */
export async function leaveDefaults(companyId: string): Promise<Partial<Record<string, number>>> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { leaveAllowances: true } })
  const v = c?.leaveAllowances
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}
}

/**
 * A person's leave for a year: days allowed (their own number, else the company's, else not set), days used
 * (approved requests) and days waiting on a decision. A day counts in the year it falls in.
 */
export async function leaveBalance(user: { id: string; companyId: string }, year: number): Promise<LeaveNumbers> {
  const [defaults, own, requests] = await Promise.all([
    leaveDefaults(user.companyId),
    prisma.leaveAllowance.findMany({ where: { userId: user.id, year } }),
    prisma.approvalRequest.findMany({ where: { requesterId: user.id, kind: 'LEAVE', status: { in: ['PENDING', 'APPROVED'] } }, select: { status: true, days: true, leaveKind: true } }),
  ])
  const count = (kind: string, status: string) => requests.filter((r) => r.leaveKind === kind && r.status === status).reduce((n, r) => n + r.days.filter((d) => d.startsWith(`${year}-`)).length, 0)
  const out = { UNPAID: { used: count('UNPAID', 'APPROVED'), waiting: count('UNPAID', 'PENDING') } } as LeaveNumbers
  for (const k of COUNTED_LEAVE) {
    const mine = own.find((a) => a.kind === k)?.days
    const allowed = mine ?? (typeof defaults[k] === 'number' ? defaults[k]! : null)
    const used = count(k, 'APPROVED')
    out[k] = { allowed, used, waiting: count(k, 'PENDING'), left: allowed === null ? null : Math.max(0, allowed - used) }
  }
  return out
}
