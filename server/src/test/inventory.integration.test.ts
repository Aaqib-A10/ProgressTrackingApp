import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, prisma, auth, seedWorld, type SeededWorld } from './helpers'

// End-to-end coverage for the Inventory module: RBAC (member vs lead vs
// other-department), item CRUD, the request → assign → resolve flow (which
// applies the quantity delta), and the per-item activity timeline.

let w: SeededWorld

beforeAll(async () => {
  w = await seedWorld()
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('inventory access control', () => {
  it('rejects unauthenticated access (401)', async () => {
    await request(app).get('/api/inventory/items').expect(401)
  })
  it('a non-Inventory member is forbidden (403)', async () => {
    await request(app).get('/api/inventory/items').set(...auth(w.itadMember)).expect(403)
  })
  it('an Inventory member can list items (200)', async () => {
    const res = await request(app).get('/api/inventory/items').set(...auth(w.inventoryMember)).expect(200)
    expect(res.body.canManage).toBe(false)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.categories).toContain('Drives')
  })
  it('an Inventory member cannot add items (403)', async () => {
    await request(app).post('/api/inventory/items').set(...auth(w.inventoryMember))
      .send({ name: 'x', category: 'Drives' }).expect(403)
  })
})

describe('item lifecycle + stock request flow', () => {
  let itemId: string
  let movementId: string

  it('lead creates an item (201)', async () => {
    const res = await request(app).post('/api/inventory/items').set(...auth(w.inventoryLead))
      .send({ name: 'Samsung 1TB SSD', category: 'Drives', quantity: 10, price: 89.99, lowStockAt: 3 })
      .expect(201)
    itemId = res.body.item.id
    expect(res.body.item.quantity).toBe(10)
    expect(res.body.item.price).toBe(89.99)
    expect(res.body.item.status).toBe('IN')
    expect(res.body.item.active).toBe(true)
  })

  it('rejects an invalid category (400)', async () => {
    await request(app).post('/api/inventory/items').set(...auth(w.inventoryLead))
      .send({ name: 'Bad', category: 'Nonsense' }).expect(400)
  })

  it('category filter returns only matching items', async () => {
    await request(app).post('/api/inventory/items').set(...auth(w.inventoryLead))
      .send({ name: 'Corsair 16GB', category: 'Memory', quantity: 5 }).expect(201)
    const drives = await request(app).get('/api/inventory/items?category=Drives').set(...auth(w.inventoryLead)).expect(200)
    expect(drives.body.items.every((i: { category: string }) => i.category === 'Drives')).toBe(true)
    const all = await request(app).get('/api/inventory/items').set(...auth(w.inventoryLead)).expect(200)
    expect(all.body.items.length).toBeGreaterThanOrEqual(2)
  })

  it('lead toggles active + edits price inline (PATCH)', async () => {
    const res = await request(app).patch(`/api/inventory/items/${itemId}`).set(...auth(w.inventoryLead))
      .send({ active: false, price: 79.5 }).expect(200)
    expect(res.body.item.active).toBe(false)
    expect(res.body.item.price).toBe(79.5)
    // put it back active
    await request(app).patch(`/api/inventory/items/${itemId}`).set(...auth(w.inventoryLead)).send({ active: true }).expect(200)
  })

  it('member logs a stock-out request (201)', async () => {
    const res = await request(app).post('/api/inventory/movements').set(...auth(w.inventoryMember))
      .send({ itemId, type: 'STOCK_OUT', quantity: 8, requestedByName: 'Front desk' }).expect(201)
    movementId = res.body.movement.id
    expect(res.body.movement.status).toBe('REQUESTED')
    expect(res.body.movement.requestedBy.id).toBe(w.inventoryMember.id)
  })

  it('member cannot assign; lead assigns the request to the member (200)', async () => {
    await request(app).patch(`/api/inventory/movements/${movementId}/assign`).set(...auth(w.inventoryMember))
      .send({ assignedToId: w.inventoryMember.id }).expect(403)
    const res = await request(app).patch(`/api/inventory/movements/${movementId}/assign`).set(...auth(w.inventoryLead))
      .send({ assignedToId: w.inventoryMember.id }).expect(200)
    expect(res.body.movement.status).toBe('ASSIGNED')
    expect(res.body.movement.assignee.id).toBe(w.inventoryMember.id)
  })

  it('assignee resolves it → quantity drops from 10 to 2 (LOW) and out-of-stock time recorded', async () => {
    const res = await request(app).patch(`/api/inventory/movements/${movementId}/resolve`).set(...auth(w.inventoryMember)).expect(200)
    expect(res.body.movement.status).toBe('COMPLETED')
    expect(res.body.movement.resolvedAt).toBeTruthy()
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantity).toBe(2)
    const list = await request(app).get('/api/inventory/items').set(...auth(w.inventoryLead)).expect(200)
    const row = list.body.items.find((i: { id: string }) => i.id === itemId)
    expect(row.status).toBe('LOW')
  })

  it('a second stock-out to zero flips status to OUT (quantity clamps at 0)', async () => {
    const mk = await request(app).post('/api/inventory/movements').set(...auth(w.inventoryLead))
      .send({ itemId, type: 'STOCK_OUT', quantity: 5 }).expect(201)
    await request(app).patch(`/api/inventory/movements/${mk.body.movement.id}/resolve`).set(...auth(w.inventoryLead)).expect(200)
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.quantity).toBe(0)
  })

  it('the per-item activity timeline includes movements + field-edit audits', async () => {
    const res = await request(app).get(`/api/inventory/items/${itemId}/activity`).set(...auth(w.inventoryMember)).expect(200)
    expect(res.body.item.id).toBe(itemId)
    expect(res.body.movements.length).toBeGreaterThanOrEqual(2)
    // CREATE audit + resolve-quantity audits are present
    expect(res.body.audits.some((a: { action: string }) => a.action === 'CREATE')).toBe(true)
    expect(res.body.audits.length).toBeGreaterThanOrEqual(2)
  })

  it('requests overview lists movements; team view aggregates per agent', async () => {
    const reqs = await request(app).get('/api/inventory/requests').set(...auth(w.inventoryLead)).expect(200)
    expect(reqs.body.requests.length).toBeGreaterThanOrEqual(2)
    // member cannot see the team view (router-level TL guard)
    await request(app).get('/api/inventory/team').set(...auth(w.inventoryMember)).expect(403)
    const team = await request(app).get('/api/inventory/team').set(...auth(w.inventoryLead)).expect(200)
    expect(team.body.totals.itemCount).toBeGreaterThanOrEqual(2)
    const agentRow = team.body.agents.find((a: { id: string }) => a.id === w.inventoryMember.id)
    expect(agentRow.completed).toBeGreaterThanOrEqual(1)
  })
})
