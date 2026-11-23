import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { recordActivity } from '../lib/audit'
import { companyToday } from '../lib/time'
import { canDecide as canDecideOld } from './wfhRequestController'
import { APPROVAL_KINDS, LEAVE_KINDS, REQUEST_INCLUDE, advance, approversOf, canDecideNow, chainFor, decide, leaveBalance, requestLine, type FullRequest } from '../lib/approvals'

/**
 * Requests and approvals (plan 2026-11, 2.1): ask for an expense, a purchase, leave or anything else; the people
 * the company's rules name approve it in turn. lib/approvals.ts is the engine; this is who may see and do what.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const me = (req: AuthedRequest) => prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, departmentId: true, companyId: true } })
type Me = Awaited<ReturnType<typeof me>>

async function view(r: FullRequest, viewer: Me) {
  const step = r.steps.find((s) => s.status === 'PENDING')
  const waitingOn = step ? await prisma.user.findMany({ where: { id: { in: await approversOf(step.approver, r.requester) } }, select: { id: true, name: true } }) : []
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    title: r.title,
    details: r.details ?? '',
    amount: r.amount === null ? null : Number(r.amount),
    currency: r.currency,
    days: r.days,
    leaveKind: r.leaveKind,
    line: requestLine(r),
    status: r.status,
    requester: { id: r.requester.id, name: r.requester.name },
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    steps: r.steps.map((s) => ({ position: s.position, approver: s.approver, status: s.status, by: s.decidedBy?.name ?? null, note: s.note ?? '', decidedAt: s.decidedAt?.toISOString() ?? null })),
    waitingOn: waitingOn.map((u) => u.name),
    mine: r.requesterId === viewer.id,
    canDecide: waitingOn.some((u) => u.id === viewer.id),
    canCancel: r.requesterId === viewer.id && r.status === 'PENDING',
  }
}

/** Who may look at a request: its requester, anyone who decided or may decide it, the requester's lead, an admin. */
async function maySee(r: FullRequest, viewer: Me): Promise<boolean> {
  if (viewer.role === 'SUPER_ADMIN' || r.requesterId === viewer.id) return true
  if (viewer.role === 'TEAM_LEAD' && viewer.departmentId && viewer.departmentId === r.requester.departmentId) return true
  if (r.steps.some((s) => s.decidedById === viewer.id || s.approver === viewer.id)) return true
  return canDecideNow(r, viewer.id)
}

const createSchema = z.object({
  kind: z.enum(APPROVAL_KINDS),
  title: z.string().trim().max(160).optional(),
  details: z.string().trim().max(2000).optional(),
  amount: z.number().positive().max(1e11).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  days: z.array(z.string().regex(DATE)).max(60).optional(),
  leaveKind: z.enum(LEAVE_KINDS).optional(),
})

/** POST /api/approvals: ask for something. */
export async function createRequest(req: AuthedRequest, res: Response): Promise<void> {
  const p = createSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the request.' }); return }
  const d = p.data
  const who = await me(req)
  let days: string[] = []
  if (d.kind === 'LEAVE') {
    days = [...new Set(d.days ?? [])].sort()
    if (!days.length) { res.status(400).json({ error: 'Pick the days you want off.' }); return }
    if (!d.leaveKind) { res.status(400).json({ error: 'Pick the kind of leave.' }); return }
    const clash = await prisma.approvalRequest.findFirst({ where: { requesterId: who.id, kind: 'LEAVE', status: { in: ['PENDING', 'APPROVED'] }, days: { hasSome: days } }, select: { status: true } })
    if (clash) { res.status(409).json({ error: `You already have ${clash.status === 'PENDING' ? 'a waiting' : 'an approved'} leave request for some of these days.` }); return }
  } else {
    if (!d.title) { res.status(400).json({ error: 'Say what it is for.' }); return }
    if ((d.kind === 'EXPENSE' || d.kind === 'PURCHASE') && d.amount === undefined) { res.status(400).json({ error: 'Give the amount.' }); return }
  }
  const amount = d.kind === 'LEAVE' ? null : d.amount ?? null
  const chain = await chainFor(d.kind, amount)
  // Each company counts its own requests from 1. Two people asking in the same moment: the second tries the next number.
  let created: { id: string } | null = null
  for (let i = 0; i < 5 && !created; i++) {
    const last = await prisma.approvalRequest.aggregate({ _max: { number: true } })
    try {
      created = await prisma.approvalRequest.create({
    data: {
      number: (last._max.number ?? 0) + 1,
      kind: d.kind,
      title: d.kind === 'LEAVE' ? 'Leave' : d.title!,
      details: d.details || null,
      amount,
      currency: d.currency ?? 'USD',
      days,
      leaveKind: d.kind === 'LEAVE' ? d.leaveKind! : null,
      requesterId: who.id,
      steps: { create: chain.map((approver, position) => ({ approver, position })) },
    },
      })
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e
    }
  }
  if (!created) { res.status(409).json({ error: 'Could not give the request a number. Try again.' }); return }
  const r = await advance(created.id)
  await recordActivity(who.id, 'CREATE', 'ApprovalRequest', r.id, { after: { summary: `Asked: ${requestLine(r)}` } })
  res.status(201).json({ request: await view(r, who) })
}

/** GET /api/approvals?box=mine|waiting|all: my requests, what waits on me, or everything I may see. */
export async function listRequests(req: AuthedRequest, res: Response): Promise<void> {
  const who = await me(req)
  const box = String(req.query.box ?? 'mine')
  let where: Prisma.ApprovalRequestWhereInput
  if (box === 'waiting') where = { status: 'PENDING' }
  else if (box === 'all') {
    if (who.role === 'SUPER_ADMIN') where = {}
    else if (who.role === 'TEAM_LEAD' && who.departmentId) where = { OR: [{ requester: { departmentId: who.departmentId } }, { steps: { some: { decidedById: who.id } } }] }
    else where = { OR: [{ requesterId: who.id }, { steps: { some: { decidedById: who.id } } }] }
  } else where = { requesterId: who.id }
  const rows = await prisma.approvalRequest.findMany({ where, include: REQUEST_INCLUDE, orderBy: { createdAt: 'desc' }, take: 300 })
  const out = []
  for (const r of rows) {
    const v = await view(r, who)
    if (box === 'waiting' && !v.canDecide) continue
    out.push(v)
  }
  res.json({ requests: out })
}

/** GET /api/approvals/:id */
export async function getRequest(req: AuthedRequest, res: Response): Promise<void> {
  const who = await me(req)
  const r = await prisma.approvalRequest.findUnique({ where: { id: req.params.id }, include: REQUEST_INCLUDE })
  if (!r || !(await maySee(r, who))) { res.status(404).json({ error: 'Request not found' }); return }
  res.json({ request: await view(r, who) })
}

/** POST /api/approvals/:id/decide { approve, note } */
export async function decideRequest(req: AuthedRequest, res: Response): Promise<void> {
  const p = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Say approve or not.' }); return }
  const who = await me(req)
  const r = await prisma.approvalRequest.findUnique({ where: { id: req.params.id }, include: REQUEST_INCLUDE })
  if (!r || !(await maySee(r, who))) { res.status(404).json({ error: 'Request not found' }); return }
  if (r.status !== 'PENDING') { res.status(409).json({ error: 'This request was already decided.' }); return }
  if (!(await canDecideNow(r, who.id))) { res.status(403).json({ error: 'This request is not waiting on you.' }); return }
  if (!p.data.approve && !p.data.note) { res.status(400).json({ error: 'Say why, so the person knows.' }); return }
  const after = await decide(r, who, p.data.approve, p.data.note || null)
  await recordActivity(who.id, p.data.approve ? 'APPROVE' : 'REJECT', 'ApprovalRequest', r.id, { after: { summary: `${p.data.approve ? 'Approved' : 'Did not approve'} ${r.requester.name}'s request: ${requestLine(r)}` } })
  res.json({ request: await view(after, who) })
}

/** POST /api/approvals/:id/cancel: the requester takes a waiting request back. */
export async function cancelRequest(req: AuthedRequest, res: Response): Promise<void> {
  const who = await me(req)
  const done = await prisma.approvalRequest.updateMany({ where: { id: req.params.id, requesterId: who.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } })
  if (!done.count) { res.status(404).json({ error: 'There is no waiting request of yours with that number.' }); return }
  await prisma.approvalStep.updateMany({ where: { requestId: req.params.id, status: { in: ['PENDING', 'WAITING'] } }, data: { status: 'SKIPPED' } })
  await prisma.notification.updateMany({ where: { type: 'APPROVAL_REQUESTED', entityType: 'ApprovalRequest', entityId: req.params.id, readAt: null }, data: { readAt: new Date() } })
  const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.params.id }, include: REQUEST_INCLUDE })
  res.json({ request: await view(r, who) })
}

/**
 * GET /api/approvals/inbox: everything that waits on me, from every kind of request, with where to decide it.
 * The older kinds (work from home, a forgotten check-in, more time on a ticket) keep their own screens.
 */
export async function inbox(req: AuthedRequest, res: Response): Promise<void> {
  const who = await me(req)
  const pending = await prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, include: REQUEST_INCLUDE, take: 300 })
  let requests = 0
  for (const r of pending) if (await canDecideNow(r, who.id)) requests++
  const owner = { select: { id: true, role: true, departmentId: true } }
  const [wfh, fixes, extensions] = await Promise.all([
    prisma.wfhRequest.findMany({ where: { status: 'PENDING' }, select: { user: owner }, take: 300 }),
    prisma.attendanceFixRequest.findMany({ where: { status: 'PENDING' }, select: { user: owner }, take: 300 }),
    who.role === 'SUPER_ADMIN'
      ? prisma.pmExtensionRequest.count({ where: { status: 'PENDING' } })
      : prisma.pmExtensionRequest.count({ where: { status: 'PENDING', task: { OR: [{ createdById: who.id }, { project: { members: { some: { userId: who.id, role: 'ADMIN' } } } }] } } }),
  ])
  res.json({
    inbox: [
      { key: 'requests', label: 'Expenses, purchases and leave', count: requests, link: '/app/requests?box=waiting' },
      { key: 'wfh', label: 'Work from home', count: wfh.filter((x) => canDecideOld(who, x.user)).length, link: '/app/attendance/team?wfh=1' },
      { key: 'fixes', label: 'Forgotten check-ins', count: fixes.filter((x) => canDecideOld(who, x.user)).length, link: '/app/attendance/team?fixes=1' },
      { key: 'extensions', label: 'More time on a task', count: extensions, link: '/app/projects' },
    ],
  })
}

// ------------------------------------------------------------------ rules (admins)

const ruleSchema = z.object({
  rules: z.array(z.object({
    kind: z.enum(APPROVAL_KINDS),
    minAmount: z.number().min(0).max(1e11).nullable(),
    chain: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  })).max(40),
})

/** GET /api/approvals/rules: who approves what (everyone may read it; admins change it). */
export async function listRules(_req: AuthedRequest, res: Response): Promise<void> {
  const rules = await prisma.approvalRule.findMany({ orderBy: [{ kind: 'asc' }, { minAmount: 'asc' }] })
  const ids = [...new Set(rules.flatMap((r) => r.chain).filter((c) => c !== 'LEAD' && c !== 'ADMIN'))]
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  res.json({ rules: rules.map((r) => ({ id: r.id, kind: r.kind, minAmount: r.minAmount === null ? null : Number(r.minAmount), chain: r.chain })), people })
}

/** PUT /api/approvals/rules { rules }: replace the company's rules. Admins only. */
export async function saveRules(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only an admin sets who approves what.' }); return }
  const p = ruleSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Check the rules: each needs a kind and at least one approver.' }); return }
  const ids = [...new Set(p.data.rules.flatMap((r) => r.chain).filter((c) => c !== 'LEAD' && c !== 'ADMIN'))]
  const known = await prisma.user.count({ where: { id: { in: ids }, isActive: true } })
  if (known !== ids.length) { res.status(400).json({ error: 'One of the approvers is not an active person in your company.' }); return }
  await prisma.$transaction([
    prisma.approvalRule.deleteMany({}),
    ...p.data.rules.map((r) => prisma.approvalRule.create({ data: { kind: r.kind, minAmount: r.minAmount, chain: r.chain } })),
  ])
  await recordActivity(req.user!.id, 'UPDATE', 'ApprovalRule', 'rules', { after: { summary: `Changed who approves requests (${p.data.rules.length} rule${p.data.rules.length === 1 ? '' : 's'})` } })
  await listRules(req, res)
}

/** GET /api/approvals/leave-balance: my leave for this year. */
export async function myLeaveBalance(req: AuthedRequest, res: Response): Promise<void> {
  const year = Number(companyToday().slice(0, 4))
  res.json({ year, balance: await leaveBalance({ id: req.user!.id, companyId: req.user!.companyId }, year) })
}
