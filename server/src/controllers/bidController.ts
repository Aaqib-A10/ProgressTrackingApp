import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'

/**
 * ITAD Bid Tracker. agentId is auto-mapped to the submitting user. Access:
 *  - Member: only their own bids.
 *  - Team Lead (ITAD): every bid in the ITAD department (team-wide aggregation).
 *  - Super Admin: all bids.
 * awardedPrice is required whenever status = WON.
 */

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

type Me = Awaited<ReturnType<typeof loadUser>>

function isItad(me: Me): boolean {
  return me.department?.type === 'ITAD' || me.role === 'SUPER_ADMIN'
}
function isLead(me: Me): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'ITAD')
}

type BidRow = Prisma.BidGetPayload<{ include: { agent: { select: { id: true; name: true } } } }>

function serialize(b: BidRow) {
  return {
    id: b.id,
    number: b.number,
    title: b.title,
    company: b.company,
    type: b.type,
    district: b.district ?? '',
    agentId: b.agentId,
    agentName: b.agent?.name ?? '—',
    status: b.status,
    dueDate: b.dueDate.toISOString(),
    reminderSet: b.reminderSet,
    submissionType: b.submissionType,
    priceQuoted: b.priceQuoted,
    awardedPrice: b.awardedPrice,
    bidBond: b.bidBond,
    bidBondAmount: b.bidBondAmount,
    createdAt: b.createdAt.toISOString(),
  }
}

/** Which bids the caller may see, as a Prisma where-filter. */
async function scopeFilter(me: Me): Promise<Prisma.BidWhereInput> {
  if (me.role === 'SUPER_ADMIN') return {}
  if (me.role === 'TEAM_LEAD') {
    const dept = me.department ?? (await prisma.department.findUnique({ where: { type: 'ITAD' } }))
    return { departmentId: dept?.id }
  }
  return { agentId: me.id }
}

/** GET /api/itad/bids — scoped list (due date asc) + status summary cards. */
export async function listBids(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isItad(me)) {
    res.status(403).json({ error: 'ITAD access only' })
    return
  }
  const where = await scopeFilter(me)
  const bids = await prisma.bid.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }],
    include: { agent: { select: { id: true, name: true } } },
  })
  // Summary cards: counts per status + total awarded value for Won.
  const summary = {
    active: bids.filter((b) => b.status === 'ACTIVE').length,
    submitted: bids.filter((b) => b.status === 'SUBMITTED').length,
    won: bids.filter((b) => b.status === 'WON').length,
    lost: bids.filter((b) => b.status === 'LOST').length,
    wonValue: bids.filter((b) => b.status === 'WON').reduce((s, b) => s + (b.awardedPrice ?? 0), 0),
  }
  res.json({ bids: bids.map(serialize), summary, canManageTeam: isLead(me) })
}

const priceField = z.number().nonnegative().nullable().optional()

const createSchema = z.object({
  title: z.string().trim().min(1, 'Bid title is required').max(300),
  company: z.string().trim().min(1, 'Company is required').max(200),
  type: z.enum(['RFQ', 'RFP', 'BID', 'PO']),
  district: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUBMITTED', 'WON', 'LOST']).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().min(1)),
  reminderSet: z.boolean().optional(),
  submissionType: z.enum(['PHYSICAL', 'EMAIL', 'PORTAL']).nullable().optional(),
  priceQuoted: priceField,
  awardedPrice: priceField,
  bidBond: z.boolean().optional(),
  bidBondAmount: priceField,
})

function parseDue(input: string): Date | null {
  const d = new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/** POST /api/itad/bids — create a bid; agent is always the caller. */
export async function createBid(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isItad(me)) {
    res.status(403).json({ error: 'ITAD access only' })
    return
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const due = parseDue(v.dueDate)
  if (!due) {
    res.status(400).json({ error: 'A valid due date is required' })
    return
  }
  if (v.status === 'WON' && (v.awardedPrice == null || v.awardedPrice <= 0)) {
    res.status(400).json({ error: 'Awarded price is required to mark a bid as Won' })
    return
  }
  const deptId = me.department?.id ?? (await prisma.department.findUnique({ where: { type: 'ITAD' } }))?.id ?? null
  const bid = await prisma.bid.create({
    data: {
      title: v.title,
      company: v.company,
      type: v.type,
      district: v.district || null,
      agentId: me.id,
      departmentId: deptId,
      status: v.status ?? 'ACTIVE',
      dueDate: due,
      reminderSet: v.reminderSet ?? false,
      submissionType: v.submissionType ?? null,
      priceQuoted: v.priceQuoted ?? null,
      // Awarded price applies to a decided bid — Won (our price) or Lost (winning price).
      awardedPrice: v.status === 'WON' || v.status === 'LOST' ? v.awardedPrice ?? null : null,
      bidBond: v.bidBond ?? false,
      // Bond amount only kept when a bid bond applies.
      bidBondAmount: v.bidBond ? v.bidBondAmount ?? null : null,
    },
    include: { agent: { select: { id: true, name: true } } },
  })
  res.status(201).json({ bid: serialize(bid) })
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['RFQ', 'RFP', 'BID', 'PO']).optional(),
  district: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUBMITTED', 'WON', 'LOST']).optional(),
  dueDate: z.string().min(1).optional(),
  reminderSet: z.boolean().optional(),
  submissionType: z.enum(['PHYSICAL', 'EMAIL', 'PORTAL']).nullable().optional(),
  priceQuoted: priceField,
  awardedPrice: priceField,
  bidBond: z.boolean().optional(),
  bidBondAmount: priceField,
})

/** PATCH /api/itad/bids/:id — edit or change status. Owner, or ITAD lead/admin. */
export async function updateBid(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isItad(me)) {
    res.status(403).json({ error: 'ITAD access only' })
    return
  }
  const existing = await prisma.bid.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Bid not found' })
    return
  }
  if (existing.agentId !== me.id && !isLead(me)) {
    res.status(403).json({ error: 'You can only edit your own bids' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const nextStatus = v.status ?? existing.status
  // Awarded price is mandatory whenever the bid ends up Won.
  const nextAwarded = v.awardedPrice !== undefined ? v.awardedPrice : existing.awardedPrice
  if (nextStatus === 'WON' && (nextAwarded == null || nextAwarded <= 0)) {
    res.status(400).json({ error: 'Awarded price is required to mark a bid as Won' })
    return
  }

  const data: Prisma.BidUpdateInput = {}
  if (v.title !== undefined) data.title = v.title
  if (v.company !== undefined) data.company = v.company
  if (v.type !== undefined) data.type = v.type
  if (v.district !== undefined) data.district = v.district || null
  if (v.status !== undefined) data.status = v.status
  if (v.reminderSet !== undefined) data.reminderSet = v.reminderSet
  if (v.submissionType !== undefined) data.submissionType = v.submissionType
  if (v.priceQuoted !== undefined) data.priceQuoted = v.priceQuoted
  if (v.dueDate !== undefined) {
    const due = parseDue(v.dueDate)
    if (!due) {
      res.status(400).json({ error: 'A valid due date is required' })
      return
    }
    data.dueDate = due
  }
  // Keep awardedPrice consistent with status: kept for a decided bid (Won = our
  // price, Lost = the winning price), cleared while still Active/Submitted.
  if (nextStatus === 'WON' || nextStatus === 'LOST') data.awardedPrice = nextAwarded
  else data.awardedPrice = null

  // Bid bond: the amount is only kept while a bond applies.
  const nextBidBond = v.bidBond ?? existing.bidBond
  if (v.bidBond !== undefined) data.bidBond = v.bidBond
  if (!nextBidBond) data.bidBondAmount = null
  else if (v.bidBondAmount !== undefined) data.bidBondAmount = v.bidBondAmount

  const bid = await prisma.bid.update({
    where: { id: existing.id },
    data,
    include: { agent: { select: { id: true, name: true } } },
  })
  res.json({ bid: serialize(bid) })
}

/** DELETE /api/itad/bids/:id — owner, or ITAD lead/admin. */
export async function deleteBid(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isItad(me)) {
    res.status(403).json({ error: 'ITAD access only' })
    return
  }
  const existing = await prisma.bid.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Bid not found' })
    return
  }
  if (existing.agentId !== me.id && !isLead(me)) {
    res.status(403).json({ error: 'You can only delete your own bids' })
    return
  }
  await prisma.bid.delete({ where: { id: existing.id } })
  res.status(204).end()
}
