import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { INVENTORY_CATEGORIES, stockStatus } from '../lib/inventory'
import { notifyStockAssigned } from '../lib/notify'

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

type Me = Awaited<ReturnType<typeof loadUser>>

/** Caller is an Inventory member (or Super Admin). */
function isInventory(me: Me): boolean {
  return me.department?.type === 'INVENTORY' || me.role === 'SUPER_ADMIN'
}

/** Caller can add/edit items + assign (Inventory Team Lead or Super Admin). */
function canManage(me: Me): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'INVENTORY')
}

/** Resolve the Inventory department for the caller, or null if not allowed. */
async function inventoryDept(me: Me) {
  if (me.department?.type === 'INVENTORY') return me.department
  if (me.role === 'SUPER_ADMIN') return prisma.department.findUnique({ where: { type: 'INVENTORY' } })
  return null
}

function inventoryMembers(departmentId: string) {
  return prisma.user.findMany({
    where: { departmentId, role: { in: ['MEMBER', 'TEAM_LEAD'] }, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

type ItemRow = Prisma.InventoryItemGetPayload<{ include: { createdBy: { select: { id: true; name: true } } } }>

function serializeItem(i: ItemRow) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    active: i.active,
    quantity: i.quantity,
    price: i.price != null ? Number(i.price) : null,
    previousPrice: i.previousPrice != null ? Number(i.previousPrice) : null,
    lowStockAt: i.lowStockAt,
    sku: i.sku ?? '',
    unit: i.unit ?? '',
    location: i.location ?? '',
    notes: i.notes ?? '',
    status: stockStatus(i.quantity, i.lowStockAt),
    createdBy: i.createdBy ? { id: i.createdBy.id, name: i.createdBy.name } : null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  }
}

type MovementRow = Prisma.InventoryMovementGetPayload<{
  include: {
    item: { select: { id: true; name: true; category: true } }
    requestedBy: { select: { id: true; name: true } }
    assignedTo: { select: { id: true; name: true } }
  }
}>

const movementInclude = {
  item: { select: { id: true, name: true, category: true } },
  requestedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.InventoryMovementInclude

function serializeMovement(m: MovementRow) {
  return {
    id: m.id,
    item: m.item ? { id: m.item.id, name: m.item.name, category: m.item.category } : null,
    type: m.type,
    quantity: m.quantity,
    status: m.status,
    requestedBy: m.requestedBy ? { id: m.requestedBy.id, name: m.requestedBy.name } : null,
    requestedByName: m.requestedByName ?? '',
    note: m.note ?? '',
    assignee: m.assignedTo ? { id: m.assignedTo.id, name: m.assignedTo.name } : null,
    requestedAt: m.requestedAt.toISOString(),
    assignedAt: m.assignedAt ? m.assignedAt.toISOString() : null,
    resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
  }
}

// ============================ Items ============================

/** GET /api/inventory/items?category= — the shared item list. */
export async function listItems(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isInventory(me)) { res.status(403).json({ error: 'Not an Inventory member' }); return }
  const dept = await inventoryDept(me)
  if (!dept) { res.status(500).json({ error: 'Inventory department missing' }); return }

  const category = typeof req.query.category === 'string' ? req.query.category : undefined
  const where: Prisma.InventoryItemWhereInput = { departmentId: dept.id }
  if (category && (INVENTORY_CATEGORIES as readonly string[]).includes(category)) where.category = category

  const [items, members] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ name: 'asc' }],
    }),
    inventoryMembers(dept.id),
  ])
  res.json({ items: items.map(serializeItem), members, canManage: canManage(me), categories: INVENTORY_CATEGORIES })
}

const itemCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(INVENTORY_CATEGORIES),
  quantity: z.number().int().min(0).default(0),
  price: z.number().min(0).max(9_999_999).nullable().optional(),
  lowStockAt: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  sku: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  location: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(),
})

/** POST /api/inventory/items — add an item (Team Lead / Super Admin). */
export async function createItem(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can add items' }); return }
  const dept = await inventoryDept(me)
  if (!dept) { res.status(500).json({ error: 'Inventory department missing' }); return }
  const parsed = itemCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = parsed.data
  const item = await prisma.inventoryItem.create({
    data: {
      departmentId: dept.id,
      name: v.name,
      category: v.category,
      quantity: v.quantity,
      price: v.price ?? null,
      lowStockAt: v.lowStockAt,
      active: v.active,
      sku: v.sku || null,
      unit: v.unit || null,
      location: v.location || null,
      notes: v.notes || null,
      createdById: me.id,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'InventoryItem', entityId: item.id, action: 'CREATE', after: { name: item.name, category: item.category, quantity: item.quantity } },
  })
  res.status(201).json({ item: serializeItem(item) })
}

const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  quantity: z.number().int().min(0).optional(),
  price: z.number().min(0).max(9_999_999).nullable().optional(),
  lowStockAt: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  sku: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  location: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(),
})

/** PATCH /api/inventory/items/:id — edit item / toggle active / adjust quantity or price. */
export async function updateItem(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can edit items' }); return }
  const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return }
  const parsed = itemUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = parsed.data

  const data: Prisma.InventoryItemUpdateInput = {}
  if (v.name !== undefined) data.name = v.name
  if (v.category !== undefined) data.category = v.category
  if (v.quantity !== undefined) data.quantity = v.quantity
  if (v.price !== undefined) {
    // Changing the price pushes the current price into previousPrice ("last price"),
    // which is what the Price column shows.
    const currentPrice = existing.price != null ? Number(existing.price) : null
    if (v.price !== currentPrice) {
      data.price = v.price
      data.previousPrice = currentPrice
    }
  }
  if (v.lowStockAt !== undefined) data.lowStockAt = v.lowStockAt
  if (v.active !== undefined) data.active = v.active
  if (v.sku !== undefined) data.sku = v.sku || null
  if (v.unit !== undefined) data.unit = v.unit || null
  if (v.location !== undefined) data.location = v.location || null
  if (v.notes !== undefined) data.notes = v.notes || null

  const item = await prisma.inventoryItem.update({
    where: { id: existing.id },
    data,
    include: { createdBy: { select: { id: true, name: true } } },
  })
  await prisma.auditLog.create({
    data: {
      userId: me.id,
      entityType: 'InventoryItem',
      entityId: item.id,
      action: 'UPDATE',
      before: { name: existing.name, category: existing.category, active: existing.active, quantity: existing.quantity, price: existing.price != null ? Number(existing.price) : null },
      after: { name: item.name, category: item.category, active: item.active, quantity: item.quantity, price: item.price != null ? Number(item.price) : null },
    },
  })
  res.json({ item: serializeItem(item) })
}

/** DELETE /api/inventory/items/:id — remove an item (and its movements, cascade). */
export async function deleteItem(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can delete items' }); return }
  const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return }
  await prisma.inventoryItem.delete({ where: { id: existing.id } })
  await prisma.auditLog.create({
    data: { userId: me.id, entityType: 'InventoryItem', entityId: existing.id, action: 'DELETE', before: { name: existing.name } },
  })
  res.json({ ok: true })
}

/** GET /api/inventory/items/:id/activity — merged timeline: movements + field-edit audit. */
export async function itemActivity(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isInventory(me)) { res.status(403).json({ error: 'Not an Inventory member' }); return }
  const item = await prisma.inventoryItem.findUnique({
    where: { id: req.params.id },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!item) { res.status(404).json({ error: 'Item not found' }); return }

  const [movements, audits] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { itemId: item.id }, include: movementInclude, orderBy: { requestedAt: 'desc' } }),
    prisma.auditLog.findMany({ where: { entityType: 'InventoryItem', entityId: item.id }, orderBy: { createdAt: 'desc' } }),
  ])

  // Names for audit-log actors.
  const actorIds = [...new Set(audits.map((a) => a.userId).filter((x): x is string => !!x))]
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : []
  const actorName = new Map(actors.map((a) => [a.id, a.name]))

  res.json({
    item: serializeItem(item),
    movements: movements.map(serializeMovement),
    audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      before: a.before ?? null,
      after: a.after ?? null,
      actor: a.userId ? { id: a.userId, name: actorName.get(a.userId) ?? 'Unknown' } : null,
      createdAt: a.createdAt.toISOString(),
    })),
  })
}

// ============================ Movements (stock-in / stock-out requests) ============================

const movementCreateSchema = z.object({
  itemId: z.string().min(1),
  type: z.enum(['STOCK_IN', 'STOCK_OUT']),
  quantity: z.number().int().min(1).max(1_000_000),
  requestedByName: z.string().trim().max(120).optional(),
  note: z.string().max(1000).optional(),
})

/** POST /api/inventory/movements — any Inventory member logs a stock-in / stock-out request. */
export async function createMovement(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isInventory(me)) { res.status(403).json({ error: 'Not an Inventory member' }); return }
  const parsed = movementCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const v = parsed.data
  const item = await prisma.inventoryItem.findUnique({ where: { id: v.itemId } })
  if (!item) { res.status(404).json({ error: 'Item not found' }); return }

  const m = await prisma.inventoryMovement.create({
    data: {
      itemId: v.itemId,
      type: v.type,
      quantity: v.quantity,
      requestedById: me.id,
      requestedByName: v.requestedByName || null,
      note: v.note || null,
    },
    include: movementInclude,
  })
  res.status(201).json({ movement: serializeMovement(m) })
}

const movementAssignSchema = z.object({ assignedToId: z.string().min(1) })

/** PATCH /api/inventory/movements/:id/assign — lead assigns an agent to fulfill it. */
export async function assignMovement(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can assign' }); return }
  const parsed = movementAssignSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }); return }
  const existing = await prisma.inventoryMovement.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Request not found' }); return }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') { res.status(400).json({ error: 'Request already closed' }); return }

  const m = await prisma.inventoryMovement.update({
    where: { id: existing.id },
    data: { assignedToId: parsed.data.assignedToId, assignedById: me.id, assignedAt: new Date(), status: 'ASSIGNED' },
    include: movementInclude,
  })
  await notifyStockAssigned({ recipientId: m.assignedToId!, actorId: me.id, itemName: m.item?.name ?? 'an item', type: m.type }).catch(() => {})
  res.json({ movement: serializeMovement(m) })
}

/** PATCH /api/inventory/movements/:id/resolve — assignee or lead marks it done; applies quantity. */
export async function resolveMovement(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isInventory(me)) { res.status(403).json({ error: 'Not an Inventory member' }); return }
  const existing = await prisma.inventoryMovement.findUnique({ where: { id: req.params.id }, include: { item: true } })
  if (!existing) { res.status(404).json({ error: 'Request not found' }); return }
  if (!canManage(me) && existing.assignedToId !== me.id) { res.status(403).json({ error: 'Only the assignee or lead can resolve this' }); return }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') { res.status(400).json({ error: 'Request already closed' }); return }

  const before = existing.item.quantity
  const delta = existing.type === 'STOCK_IN' ? existing.quantity : -existing.quantity
  const after = Math.max(0, before + delta)

  const [m] = await prisma.$transaction([
    prisma.inventoryMovement.update({
      where: { id: existing.id },
      data: { status: 'COMPLETED', resolvedAt: new Date(), assignedToId: existing.assignedToId ?? me.id },
      include: movementInclude,
    }),
    prisma.inventoryItem.update({ where: { id: existing.itemId }, data: { quantity: after } }),
    prisma.auditLog.create({
      data: {
        userId: me.id,
        entityType: 'InventoryItem',
        entityId: existing.itemId,
        action: 'UPDATE',
        before: { quantity: before },
        after: { quantity: after, movement: existing.type, by: existing.quantity },
      },
    }),
  ])
  res.json({ movement: serializeMovement(m) })
}

const movementCancelSchema = z.object({}).optional()

/** PATCH /api/inventory/movements/:id/cancel — lead cancels an open request. */
export async function cancelMovement(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can cancel' }); return }
  movementCancelSchema.parse(req.body)
  const existing = await prisma.inventoryMovement.findUnique({ where: { id: req.params.id } })
  if (!existing) { res.status(404).json({ error: 'Request not found' }); return }
  if (existing.status === 'COMPLETED') { res.status(400).json({ error: 'Already completed' }); return }
  const m = await prisma.inventoryMovement.update({ where: { id: existing.id }, data: { status: 'CANCELLED', resolvedAt: new Date() }, include: movementInclude })
  res.json({ movement: serializeMovement(m) })
}

/** GET /api/inventory/requests?type=&status= — all stock-in/out requests across items. */
export async function listRequests(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isInventory(me)) { res.status(403).json({ error: 'Not an Inventory member' }); return }
  const dept = await inventoryDept(me)
  if (!dept) { res.status(500).json({ error: 'Inventory department missing' }); return }

  const type = typeof req.query.type === 'string' && ['STOCK_IN', 'STOCK_OUT'].includes(req.query.type) ? (req.query.type as 'STOCK_IN' | 'STOCK_OUT') : undefined
  const status = typeof req.query.status === 'string' && ['REQUESTED', 'ASSIGNED', 'COMPLETED', 'CANCELLED'].includes(req.query.status) ? (req.query.status as 'REQUESTED' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED') : undefined

  const [requests, members] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { item: { departmentId: dept.id }, ...(type ? { type } : {}), ...(status ? { status } : {}) },
      include: movementInclude,
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      take: 500,
    }),
    inventoryMembers(dept.id),
  ])
  res.json({ requests: requests.map(serializeMovement), members, canManage: canManage(me) })
}

/** GET /api/inventory/team — per-agent fulfillment stats (Team Lead / Super Admin). */
export async function teamView(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) { res.status(403).json({ error: 'Only the Inventory lead can view the team' }); return }
  const dept = await inventoryDept(me)
  if (!dept) { res.status(500).json({ error: 'Inventory department missing' }); return }

  const members = await inventoryMembers(dept.id)
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ['assignedToId', 'status'],
    where: { item: { departmentId: dept.id }, assignedToId: { not: null } },
    _count: { _all: true },
  })

  const agents = members.map((mem) => {
    const rows = grouped.filter((g) => g.assignedToId === mem.id)
    const completed = rows.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r._count._all, 0)
    const open = rows.filter((r) => r.status === 'ASSIGNED').reduce((s, r) => s + r._count._all, 0)
    return { id: mem.id, name: mem.name, completed, open }
  })

  const [itemCount, lowCount, openRequests] = await Promise.all([
    prisma.inventoryItem.count({ where: { departmentId: dept.id } }),
    prisma.inventoryItem.count({ where: { departmentId: dept.id, quantity: { lte: 0 } } }),
    prisma.inventoryMovement.count({ where: { item: { departmentId: dept.id }, status: { in: ['REQUESTED', 'ASSIGNED'] } } }),
  ])

  res.json({ agents, totals: { itemCount, outOfStock: lowCount, openRequests } })
}
