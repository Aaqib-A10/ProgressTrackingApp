import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { runNoteReminderTick } from '../controllers/notesController'
import { runAsCompany } from '../lib/tenancy'

// Notes: private sticky notes, shared to read or to edit, @mentions, reminders. Nobody else sees a note.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

const post = (who: SeededWorld[keyof SeededWorld], body: object) => request(app).post('/api/notes').set(...auth(who)).send(body)
const list = async (who: SeededWorld[keyof SeededWorld]) => (await request(app).get('/api/notes').set(...auth(who)).expect(200)).body.notes as { id: string; access: string; title: string }[]

describe('notes', () => {
  it('a note is private to its owner, and checked', async () => {
    await post(w.itadMember, {}).expect(400)
    await post(w.itadMember, { title: 'x', color: 'neon' }).expect(400)
    const n = (await post(w.itadMember, { title: 'Call DHL', body: 'Ask for the 3 PM slot', tags: ['#Shipping', 'urgent'], color: 'green' }).expect(201)).body.note
    expect(n).toMatchObject({ title: 'Call DHL', color: 'green', tags: ['shipping', 'urgent'], access: 'owner', pinned: false, archived: false })
    expect((await list(w.itadMember)).map((x) => x.id)).toContain(n.id)
    expect((await list(w.itadLead)).map((x) => x.id)).not.toContain(n.id)
    expect((await list(w.superAdmin)).map((x) => x.id)).not.toContain(n.id) // not even a Super Admin
    await request(app).get(`/api/notes/${n.id}`).set(...auth(w.itadLead)).expect(404)
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadLead)).send({ title: 'mine now' }).expect(404)
    await request(app).delete(`/api/notes/${n.id}`).set(...auth(w.itadLead)).expect(404)
    // A checklist note.
    const c = (await post(w.itadMember, { title: 'Today', items: [{ id: 'a', text: 'Relist Dell', done: false }, { id: 'b', text: 'Ship returns', done: true }] }).expect(201)).body.note
    expect(c.items).toHaveLength(2)
  })

  it('shared to read or to edit: each can do what they were given, and is told', async () => {
    const n = (await post(w.itadMember, { title: 'Team plan', body: 'Monday: returns', shares: [{ userId: w.itadLead.id, canEdit: true }, { userId: w.leadgenMember.id, canEdit: false }] }).expect(201)).body.note
    expect(n.shares).toHaveLength(2)
    expect(await prisma.notification.count({ where: { type: 'NOTE_SHARED', entityId: n.id } })).toBe(2)
    // The editor changes the words, not the owner's settings.
    const ed = (await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadLead)).send({ body: 'Monday: returns and relisting' }).expect(200)).body.note
    expect(ed).toMatchObject({ body: 'Monday: returns and relisting', access: 'edit', editedBy: { id: w.itadLead.id } })
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadLead)).send({ pinned: true }).expect(403)
    await request(app).put(`/api/notes/${n.id}/shares`).set(...auth(w.itadLead)).send({ shares: [] }).expect(403)
    // The reader only reads.
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.leadgenMember)).send({ body: 'no' }).expect(403)
    expect((await list(w.leadgenMember)).find((x) => x.id === n.id)?.access).toBe('view')
    // The reader takes it off their own list: the note stays for the others.
    await request(app).delete(`/api/notes/${n.id}`).set(...auth(w.leadgenMember)).expect(204)
    expect((await list(w.leadgenMember)).map((x) => x.id)).not.toContain(n.id)
    expect((await list(w.itadLead)).map((x) => x.id)).toContain(n.id)
    // The owner takes the editor off: gone for them.
    await request(app).put(`/api/notes/${n.id}/shares`).set(...auth(w.itadMember)).send({ shares: [] }).expect(200)
    expect((await list(w.itadLead)).map((x) => x.id)).not.toContain(n.id)
    // The owner deletes it.
    await request(app).delete(`/api/notes/${n.id}`).set(...auth(w.itadMember)).expect(204)
    expect(await prisma.note.count({ where: { id: n.id } })).toBe(0)
  })

  it('an @mention lets the person read the note and tells them once', async () => {
    const n = (await post(w.itadMember, { body: '@Lead please check the pallet count', mentions: [w.itadLead.id] }).expect(201)).body.note
    expect(n.mentions).toEqual([w.itadLead.id])
    expect((await list(w.itadLead)).find((x) => x.id === n.id)?.access).toBe('view')
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadMember)).send({ body: '@Lead please check it today', mentions: [w.itadLead.id] }).expect(200)
    expect(await prisma.notification.count({ where: { type: 'NOTE_MENTION', entityId: n.id, userId: w.itadLead.id } })).toBe(1)
  })

  it('a reminder tells the owner once when its time comes, and again after a new time', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString()
    const n = (await post(w.itadMember, { title: 'Renew the domain', remindAt: soon }).expect(201)).body.note
    const later = new Date(Date.now() + 120_000)
    const count = () => prisma.notification.count({ where: { type: 'NOTE_REMINDER', entityId: n.id, userId: w.itadMember.id } })
    await runAsCompany('company-1', () => runNoteReminderTick(new Date(Date.now() - 1000)))
    expect(await count()).toBe(0) // not yet
    await runAsCompany('company-1', () => runNoteReminderTick(later))
    await runAsCompany('company-1', () => runNoteReminderTick(later))
    expect(await count()).toBe(1)
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadMember)).send({ remindAt: new Date(Date.now() + 90_000).toISOString() }).expect(200)
    await runAsCompany('company-1', () => runNoteReminderTick(later))
    expect(await count()).toBe(2)
    // Only the owner sets a reminder, pins or archives.
    await request(app).patch(`/api/notes/${n.id}`).set(...auth(w.itadMember)).send({ pinned: true, archived: true }).expect(200)
  })
})
