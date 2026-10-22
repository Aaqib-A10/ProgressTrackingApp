import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'

// Notes on a My To-Do item: the WhatsApp message from a manager that asked for it, with the
// source and who sent it. People can type their own sources; the item keeps its notes when moved.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

type U = SeededWorld['itadMember']
const add = (u: U, body: object) => request(app).post('/api/worklog').set(...auth(u)).send(body)
const note = (u: U, id: string, body: object) => request(app).post(`/api/worklog/${id}/notes`).set(...auth(u)).send(body)

describe('notes on a to-do', () => {
  it('adds a WhatsApp note with the sender, lists it with the item, edits and deletes it', async () => {
    const e = (await add(w.inventoryMember, { period: 'DAY', date: '2026-10-22', title: 'Relist the Dell laptops' }).expect(201)).body.entry
    expect(e.notes).toEqual([])
    const n = await note(w.inventoryMember, e.id, { body: 'Please relist all Latitude 5420 at the new price', source: 'whatsapp', sender: 'Nasir' }).expect(201)
    expect(n.body.note).toMatchObject({ source: 'WhatsApp', sender: 'Nasir', body: 'Please relist all Latitude 5420 at the new price' })

    const r = await request(app).get('/api/worklog?from=2026-10-01&to=2026-10-31').set(...auth(w.inventoryMember)).expect(200)
    const row = r.body.entries.find((x: { id: string }) => x.id === e.id)
    expect(row.notes).toHaveLength(1)
    expect(row.notes[0].source).toBe('WhatsApp')

    const u = await request(app).patch(`/api/worklog/notes/${n.body.note.id}`).set(...auth(w.inventoryMember)).send({ body: 'Relist at 289', sender: '' }).expect(200)
    expect(u.body.note).toMatchObject({ body: 'Relist at 289', sender: null, source: 'WhatsApp' })

    // Moving the item to tomorrow keeps its notes.
    const c = await request(app).post(`/api/worklog/${e.id}/carry`).set(...auth(w.inventoryMember)).expect(200)
    expect(c.body.entry.notes).toHaveLength(1)

    await request(app).delete(`/api/worklog/notes/${n.body.note.id}`).set(...auth(w.inventoryMember)).expect(204)
    const after = await request(app).get('/api/worklog?from=2026-10-01&to=2026-10-31').set(...auth(w.inventoryMember)).expect(200)
    expect(after.body.entries.find((x: { id: string }) => x.id === e.id).notes).toEqual([])
  })

  it('own sources are remembered, in the spelling first used, after the starting ones', async () => {
    const e = (await add(w.inventoryMember, { period: 'DAY', date: '2026-10-23', title: 'Check returns' }).expect(201)).body.entry
    await note(w.inventoryMember, e.id, { body: 'Customer asked for a refund', source: 'Amazon messages' }).expect(201)
    const again = await note(w.inventoryMember, e.id, { body: 'Second message', source: 'amazon MESSAGES' }).expect(201)
    expect(again.body.note.source).toBe('Amazon messages')
    const s = await request(app).get('/api/worklog/note-sources').set(...auth(w.inventoryMember)).expect(200)
    expect(s.body.sources.slice(0, 6)).toEqual(['WhatsApp', 'Email', 'Call', 'Teams', 'Meeting', 'In person'])
    expect(s.body.sources.filter((x: string) => x === 'Amazon messages')).toHaveLength(1)
    // Someone else's sources are their own.
    const other = await request(app).get('/api/worklog/note-sources').set(...auth(w.itadMember)).expect(200)
    expect(other.body.sources).not.toContain('Amazon messages')
  })

  it('only the owner adds or changes notes; their Team Lead reads them; a note needs text', async () => {
    const e = (await add(w.inventoryMember, { period: 'DAY', date: '2026-10-24', title: 'Pack the pallet' }).expect(201)).body.entry
    await note(w.inventoryMember, e.id, { body: '   ' }).expect(400)
    const n = (await note(w.inventoryMember, e.id, { body: 'From the call with the warehouse', source: 'Call' }).expect(201)).body.note
    await note(w.inventoryLead, e.id, { body: 'hijack' }).expect(404)
    await request(app).patch(`/api/worklog/notes/${n.id}`).set(...auth(w.inventoryLead)).send({ body: 'x' }).expect(404)
    await request(app).delete(`/api/worklog/notes/${n.id}`).set(...auth(w.itadMember)).expect(404)
    const lead = await request(app).get(`/api/worklog?from=2026-10-01&to=2026-10-31&userId=${w.inventoryMember.id}`).set(...auth(w.inventoryLead)).expect(200)
    expect(lead.body.entries.find((x: { id: string }) => x.id === e.id).notes[0].body).toBe('From the call with the warehouse')
    // Deleting the item deletes its notes.
    await request(app).delete(`/api/worklog/${e.id}`).set(...auth(w.inventoryMember)).expect(204)
    expect(await prisma.workLogNote.count({ where: { id: n.id } })).toBe(0)
  })
})
