import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { actsAs } from '../lib/acting'

/**
 * ITAD Bid Tracker. agentId is auto-mapped to the submitting user. Access:
 *  - Member: only their own bids.
 *  - Team Lead (ITAD): every bid in the ITAD department (team-wide aggregation).
 *  - Super Admin: all bids.
 * awardedPrice is required whenever status = WON. A CONTRACT deal (won and signed as a contract) has no awarded
 * price: its contract value is the deal's totalAmount, which is required, with optional contract start and end dates.
 */

const DECIDED = ['WON', 'LOST', 'CONTRACT'] as const
const isDecided = (s: string) => (DECIDED as readonly string[]).includes(s)
/** A YYYY-MM-DD (or full ISO) date for a date-only column, or null when empty or not a date. */
function dayOnly(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

type Me = Awaited<ReturnType<typeof loadUser>>

function isItad(me: Me): boolean {
  return actsAs(me, 'ITAD') || me.role === 'SUPER_ADMIN'
}
function isLead(me: Me): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && actsAs(me, 'ITAD'))
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
    // Decimal columns → plain numbers for the JSON API (Prisma.Decimal serializes as a string).
    priceQuoted: b.priceQuoted?.toNumber() ?? null,
    awardedPrice: b.awardedPrice?.toNumber() ?? null,
    bidBond: b.bidBond,
    bidBondAmount: b.bidBondAmount?.toNumber() ?? null,
    totalAmount: b.totalAmount?.toNumber() ?? null,
    contractStart: b.contractStart ? b.contractStart.toISOString().slice(0, 10) : null,
    contractEnd: b.contractEnd ? b.contractEnd.toISOString().slice(0, 10) : null,
    closedDate: b.closedDate ? b.closedDate.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  }
}

/** Which bids the caller may see, as a Prisma where-filter. */
async function scopeFilter(me: Me): Promise<Prisma.BidWhereInput> {
  if (me.role === 'SUPER_ADMIN') return {}
  if (me.role === 'TEAM_LEAD') {
    const dept = me.department ?? (await prisma.department.findFirst({ where: { type: 'ITAD' } }))
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
    contract: bids.filter((b) => b.status === 'CONTRACT').length,
    wonValue: bids.filter((b) => b.status === 'WON').reduce((s, b) => s + (b.awardedPrice?.toNumber() ?? 0), 0),
    // The deals' full dollar figures (Total amount): every deal, and the won ones.
    totalValue: bids.reduce((s, b) => s + (b.totalAmount?.toNumber() ?? 0), 0),
    wonTotal: bids.filter((b) => b.status === 'WON').reduce((s, b) => s + (b.totalAmount?.toNumber() ?? 0), 0),
    contractValue: bids.filter((b) => b.status === 'CONTRACT').reduce((s, b) => s + (b.totalAmount?.toNumber() ?? 0), 0),
    // Each status card's money: the Total amount of its deals (a contract's value).
    amounts: Object.fromEntries((['ACTIVE', 'SUBMITTED', 'WON', 'LOST', 'CONTRACT'] as const).map((st) => [st, bids.filter((b) => b.status === st).reduce((s, b) => s + (b.totalAmount?.toNumber() ?? 0), 0)])),
  }
  res.json({ bids: bids.map(serialize), summary, canManageTeam: isLead(me) })
}

const priceField = z.number().nonnegative().nullable().optional()

const createSchema = z.object({
  title: z.string().trim().min(1, 'Bid title is required').max(300),
  company: z.string().trim().min(1, 'Company is required').max(200),
  type: z.enum(['RFQ', 'RFP', 'BID', 'PO']),
  district: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUBMITTED', 'WON', 'LOST', 'CONTRACT']).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().min(1)),
  reminderSet: z.boolean().optional(),
  submissionType: z.enum(['PHYSICAL', 'EMAIL', 'PORTAL']).nullable().optional(),
  priceQuoted: priceField,
  awardedPrice: priceField,
  bidBond: z.boolean().optional(),
  bidBondAmount: priceField,
  totalAmount: z.number().nonnegative().max(999_999_999_999).nullable().optional(),
  contractStart: z.string().nullable().optional(),
  contractEnd: z.string().nullable().optional(),
  closedDate: z.string().nullable().optional(),
})

function parseDue(input: string): Date | null {
  const d = new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/**
 * The date a deal was decided. Kept only for Won/Lost bids: uses the supplied
 * date, else defaults to `now` (or the existing value on update). Cleared while
 * the bid is still Active/Submitted. Drives financial revenue + the date filter.
 */
function resolveClosedDate(status: string, supplied: string | null | undefined, existing: Date | null): Date | null {
  if (!isDecided(status)) return null
  if (supplied) return parseDue(supplied) ?? existing ?? new Date()
  return existing ?? new Date()
}

/**
 * A Contract deal needs its contract value (the Total amount) and keeps its optional start and end dates (the end not
 * before the start). Any other status keeps no contract dates.
 */
function contractFields(status: string, total: number | null, start: Date | null, end: Date | null): { start: Date | null; end: Date | null } | { error: string } {
  if (status !== 'CONTRACT') return { start: null, end: null }
  if (total == null || total <= 0) return { error: 'Contract value is required to mark a deal as Contract' }
  if (start && end && end < start) return { error: 'The contract cannot end before it starts' }
  return { start, end }
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
  const contract = contractFields(v.status ?? 'ACTIVE', v.totalAmount ?? null, dayOnly(v.contractStart), dayOnly(v.contractEnd))
  if ('error' in contract) {
    res.status(400).json({ error: contract.error })
    return
  }
  const deptId = me.department?.id ?? (await prisma.department.findFirst({ where: { type: 'ITAD' } }))?.id ?? null
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
      contractStart: contract.start,
      contractEnd: contract.end,
      closedDate: resolveClosedDate(v.status ?? 'ACTIVE', v.closedDate, null),
      bidBond: v.bidBond ?? false,
      // Bond amount only kept when a bid bond applies.
      bidBondAmount: v.bidBond ? v.bidBondAmount ?? null : null,
      totalAmount: v.totalAmount ?? null,
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
  status: z.enum(['ACTIVE', 'SUBMITTED', 'WON', 'LOST', 'CONTRACT']).optional(),
  dueDate: z.string().min(1).optional(),
  reminderSet: z.boolean().optional(),
  submissionType: z.enum(['PHYSICAL', 'EMAIL', 'PORTAL']).nullable().optional(),
  priceQuoted: priceField,
  awardedPrice: priceField,
  bidBond: z.boolean().optional(),
  bidBondAmount: priceField,
  totalAmount: z.number().nonnegative().max(999_999_999_999).nullable().optional(),
  contractStart: z.string().nullable().optional(),
  contractEnd: z.string().nullable().optional(),
  closedDate: z.string().nullable().optional(),
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
  const nextAwarded = v.awardedPrice !== undefined ? v.awardedPrice : (existing.awardedPrice?.toNumber() ?? null)
  if (nextStatus === 'WON' && (nextAwarded == null || nextAwarded <= 0)) {
    res.status(400).json({ error: 'Awarded price is required to mark a bid as Won' })
    return
  }

  const nextTotal = v.totalAmount !== undefined ? v.totalAmount : (existing.totalAmount?.toNumber() ?? null)
  const contract = contractFields(
    nextStatus,
    nextTotal,
    v.contractStart !== undefined ? dayOnly(v.contractStart) : existing.contractStart,
    v.contractEnd !== undefined ? dayOnly(v.contractEnd) : existing.contractEnd,
  )
  if ('error' in contract) {
    res.status(400).json({ error: contract.error })
    return
  }

  const data: Prisma.BidUpdateInput = {}
  data.contractStart = contract.start
  data.contractEnd = contract.end
  if (v.title !== undefined) data.title = v.title
  if (v.company !== undefined) data.company = v.company
  if (v.type !== undefined) data.type = v.type
  if (v.district !== undefined) data.district = v.district || null
  if (v.status !== undefined) data.status = v.status
  if (v.reminderSet !== undefined) data.reminderSet = v.reminderSet
  if (v.submissionType !== undefined) data.submissionType = v.submissionType
  if (v.priceQuoted !== undefined) data.priceQuoted = v.priceQuoted
  if (v.totalAmount !== undefined) data.totalAmount = v.totalAmount
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
  // closedDate tracks status the same way (set on decide, cleared on re-open).
  data.closedDate = resolveClosedDate(nextStatus, v.closedDate, existing.closedDate)

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

/**
 * GET /api/itad/bids/team-active — every deal the ITAD team is working on right now
 * (Active and Submitted), with who owns it, so two people never chase the same deal.
 * Everyone in ITAD sees this list; prices stay private to the owner and leads.
 */
export async function teamActiveBids(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isItad(me)) {
    res.status(403).json({ error: 'ITAD access only' })
    return
  }
  const dept = actsAs(me, 'ITAD') ? me.department : await prisma.department.findFirst({ where: { type: 'ITAD' } })
  const bids = await prisma.bid.findMany({
    where: { departmentId: dept?.id ?? '__none__', status: { in: ['ACTIVE', 'SUBMITTED'] } },
    orderBy: [{ dueDate: 'asc' }],
    select: { id: true, number: true, title: true, company: true, district: true, type: true, status: true, dueDate: true, createdAt: true, agentId: true, agent: { select: { name: true } } },
  })
  res.json({
    deals: bids.map((b) => ({
      id: b.id,
      number: b.number,
      title: b.title,
      company: b.company,
      district: b.district ?? '',
      type: b.type,
      status: b.status,
      dueDate: b.dueDate.toISOString(),
      createdAt: b.createdAt.toISOString(),
      agentId: b.agentId,
      agentName: b.agent?.name ?? '—',
      mine: b.agentId === me.id,
    })),
  })
}
