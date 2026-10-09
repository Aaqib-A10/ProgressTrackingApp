import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { app, prisma, auth, seedWorld, type SeededWorld } from './helpers'
import { resetCalls } from '../lib/pm/calls'
import { generateNotes, parseNotes } from '../lib/pm/notes'
import { occurrences, runMeetingReminders } from '../lib/pm/meetings'

// Meetings + calendar, and the in-call extras: add people, reactions, captions,
// AI note taker, chunked recordings, chat message reactions, "In a call" presence.

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  resetCalls()
})
afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.ANTHROPIC_API_KEY
  await prisma.$disconnect()
})

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

describe('meetings', () => {
  let meetingId = ''
  let convId = ''

  it('schedules a meeting: invites people, creates the meeting chat, notifies them', async () => {
    const r = await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({
      title: 'Weekly sync', agenda: 'Numbers\nBlockers', startsAt: inHours(2), endsAt: inHours(2.5), attendeeIds: [w.itadMember.id, w.leadgenLead.id],
    }).expect(201)
    meetingId = r.body.meeting.id
    convId = r.body.meeting.conversationId
    expect(r.body.meeting.isOrganizer).toBe(true)
    expect(r.body.meeting.attendees.map((a: { id: string }) => a.id).sort()).toEqual([w.itadMember.id, w.leadgenLead.id].sort())
    const members = await prisma.chatMember.findMany({ where: { conversationId: convId } })
    expect(members).toHaveLength(3)
    const n = await prisma.notification.findMany({ where: { userId: w.itadMember.id, type: 'MEETING' } })
    expect(n[0].title).toContain('added you to a meeting')
    expect(n[0].link).toBe(`/app/meetings/${meetingId}`)
  })

  it('validates times and people', async () => {
    await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({ title: 'x', startsAt: inHours(3), endsAt: inHours(2) }).expect(422)
    await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({ title: 'x', startsAt: inHours(1), endsAt: inHours(14) }).expect(422)
    await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({ title: 'x', startsAt: inHours(1), endsAt: inHours(2), attendeeIds: ['nope'] }).expect(422)
  })

  it('shows on the calendar of the organizer and attendees only', async () => {
    const mine = await request(app).get('/api/meetings').query({ from: inHours(-1), to: inHours(24) }).set(...auth(w.itadMember)).expect(200)
    expect(mine.body.meetings.map((m: { id: string }) => m.id)).toContain(meetingId)
    const other = await request(app).get('/api/meetings').query({ from: inHours(-1), to: inHours(24) }).set(...auth(w.inventoryMember)).expect(200)
    expect(other.body.meetings).toHaveLength(0)
  })

  it('RSVP updates my response and tells the organizer', async () => {
    const r = await request(app).post(`/api/meetings/${meetingId}/respond`).set(...auth(w.itadMember)).send({ response: 'ACCEPTED' }).expect(200)
    expect(r.body.meeting.myResponse).toBe('ACCEPTED')
    const n = await prisma.notification.findFirst({ where: { userId: w.itadLead.id, type: 'MEETING' }, orderBy: { createdAt: 'desc' } })
    expect(n?.title).toContain('accepted')
    await request(app).post(`/api/meetings/${meetingId}/respond`).set(...auth(w.inventoryMember)).send({ response: 'ACCEPTED' }).expect(403)
  })

  it('anyone with the link can open it and join (adds them to the meeting and its chat)', async () => {
    const view = await request(app).get(`/api/meetings/${meetingId}`).set(...auth(w.inventoryMember)).expect(200)
    expect(view.body.isAttendee).toBe(false)
    await request(app).post(`/api/meetings/${meetingId}/join`).set(...auth(w.inventoryMember)).expect(200)
    expect(await prisma.chatMember.count({ where: { conversationId: convId, userId: w.inventoryMember.id } })).toBe(1)
    const again = await request(app).get(`/api/meetings/${meetingId}`).set(...auth(w.inventoryMember)).expect(200)
    expect(again.body.isAttendee).toBe(true)
  })

  it('only the organizer can change it; moving it re-arms the reminder and tells people', async () => {
    await request(app).patch(`/api/meetings/${meetingId}`).set(...auth(w.itadMember)).send({ title: 'Hacked' }).expect(403)
    await prisma.meeting.update({ where: { id: meetingId }, data: { reminderSentAt: new Date() } })
    const r = await request(app).patch(`/api/meetings/${meetingId}`).set(...auth(w.itadLead)).send({
      title: 'Weekly sync (moved)', startsAt: inHours(3), endsAt: inHours(3.5), attendeeIds: [w.itadMember.id, w.inventoryMember.id],
    }).expect(200)
    expect(r.body.meeting.title).toBe('Weekly sync (moved)')
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })
    expect(row.reminderSentAt).toBeNull()
    // leadgenLead was removed: out of the meeting and its chat
    expect(await prisma.meetingAttendee.count({ where: { meetingId, userId: w.leadgenLead.id } })).toBe(0)
    expect(await prisma.chatMember.count({ where: { conversationId: convId, userId: w.leadgenLead.id } })).toBe(0)
    const moved = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, title: { startsWith: 'Meeting moved' } } })
    expect(moved).not.toBeNull()
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convId } })).name).toBe('Weekly sync (moved)')
  })

  it('sends the 10 minute reminder once', async () => {
    await prisma.meeting.update({ where: { id: meetingId }, data: { startsAt: new Date(Date.now() + 5 * 60_000), endsAt: new Date(Date.now() + 35 * 60_000) } })
    expect(await runMeetingReminders()).toBe(1)
    expect(await runMeetingReminders()).toBe(0)
    const n = await prisma.notification.findFirst({ where: { userId: w.itadMember.id, title: { startsWith: 'Starts in' } } })
    expect(n?.link).toBe(`/app/meetings/${meetingId}`)
  })

  it('downloads an .ics calendar file', async () => {
    const r = await request(app).get(`/api/meetings/${meetingId}/ics`).set(...auth(w.itadMember)).expect(200)
    expect(r.headers['content-type']).toContain('text/calendar')
    expect(r.text).toContain('BEGIN:VEVENT')
    expect(r.text).toContain('SUMMARY:Weekly sync (moved)')
  })

  it('repeating meetings: weekdays skip the weekend; cancelling the rest of a series', async () => {
    const sat = new Date('2030-06-01T09:00:00Z') // a Saturday
    const days = occurrences(sat, 'weekdays', 5).map((d) => d.getUTCDay())
    expect(days.every((d) => d >= 1 && d <= 5)).toBe(true)
    const r = await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({
      title: 'Standup', startsAt: inHours(20), endsAt: inHours(20.25), attendeeIds: [w.itadMember.id], repeat: 'daily', repeatCount: 4,
    }).expect(201)
    expect(r.body.count).toBe(4)
    const series = await prisma.meeting.findMany({ where: { seriesId: r.body.meeting.seriesId }, orderBy: { startsAt: 'asc' } })
    expect(new Set(series.map((s) => s.conversationId)).size).toBe(1) // one chat for the series
    await request(app).post(`/api/meetings/${series[1].id}/cancel`).set(...auth(w.itadLead)).send({ series: true }).expect(200)
    const left = await prisma.meeting.findMany({ where: { seriesId: r.body.meeting.seriesId, cancelledAt: null } })
    expect(left.map((m) => m.id)).toEqual([series[0].id])
  })

  it('a call started in the meeting chat belongs to the meeting', async () => {
    await prisma.meeting.update({ where: { id: meetingId }, data: { startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 30 * 60_000) } })
    const s = await request(app).post(`/api/chat/conversations/${convId}/calls`).set(...auth(w.itadLead)).send({ video: true }).expect(201)
    const call = await prisma.chatCall.findUniqueOrThrow({ where: { id: s.body.call.id } })
    expect(call.meetingId).toBe(meetingId)
    const d = await request(app).get(`/api/meetings/${meetingId}`).set(...auth(w.itadMember)).expect(200)
    expect(d.body.meeting.live.callId).toBe(s.body.call.id)
    await request(app).post(`/api/chat/calls/${s.body.call.id}/join`).set(...auth(w.itadLead)).send({}).expect(200)
    await request(app).post(`/api/chat/calls/${s.body.call.id}/leave`).set(...auth(w.itadLead)).expect(200)
  })
})

describe('in-call extras', () => {
  let callId = ''
  let dmId = ''

  it('add people: a DM call rings an outsider as a guest who can join (no chat access)', async () => {
    resetCalls()
    const dm = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'DIRECT', userId: w.itadMember.id })
    dmId = dm.body.conversation.id
    const s = await request(app).post(`/api/chat/conversations/${dmId}/calls`).set(...auth(w.itadLead)).send({ video: true }).expect(201)
    callId = s.body.call.id
    await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.itadLead)).send({}).expect(200)
    // outsider cannot see it yet
    await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.leadgenLead)).send({}).expect(404)
    await request(app).post(`/api/chat/calls/${callId}/invite`).set(...auth(w.itadMember)).send({ userIds: [w.leadgenLead.id] }).expect(409) // must be in the call
    await request(app).post(`/api/chat/calls/${callId}/invite`).set(...auth(w.itadLead)).send({ userIds: [w.leadgenLead.id] }).expect(200)
    const act = await request(app).get('/api/chat/calls/active').set(...auth(w.leadgenLead)).expect(200)
    const card = act.body.calls.find((c: { id: string }) => c.id === callId)
    expect(card).toMatchObject({ ringing: true, guest: true })
    expect(card.invitedBy).toBeTruthy()
    const j = await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.leadgenLead)).send({}).expect(200)
    expect(j.body.guest).toBe(true)
    expect(await prisma.chatMember.count({ where: { conversationId: dmId, userId: w.leadgenLead.id } })).toBe(0)
  })

  it('"In a call" shows as busy presence', async () => {
    const c = await request(app).get(`/api/chat/conversations/${dmId}`).set(...auth(w.itadMember)).expect(200)
    const lead = c.body.conversation.members.find((m: { id: string }) => m.id === w.itadLead.id)
    expect(lead.presence).toBe('busy')
  })

  it('reactions, raised hands and live captions reach everyone', async () => {
    await request(app).post(`/api/chat/calls/${callId}/react`).set(...auth(w.itadLead)).send({ emoji: '👏' }).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/react`).set(...auth(w.itadLead)).send({ emoji: '💣' }).expect(422)
    await request(app).post(`/api/chat/calls/${callId}/state`).set(...auth(w.leadgenLead)).send({ hand: true }).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.itadLead)).send({ text: 'hello every', final: false }).expect(200)
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.leadgenLead)).expect(200)
    expect(p.body.signals.find((s: { kind: string }) => s.kind === 'react').data.emoji).toBe('👏')
    expect(p.body.captions[0]).toMatchObject({ text: 'hello every', final: false })
    const p2 = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadLead)).expect(200)
    expect(p2.body.participants.find((x: { userId: string }) => x.userId === w.leadgenLead.id).hand).toBe(true)
  })

  it('AI note taker: only final lines are kept while it is on; no API key = transcript only', async () => {
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.itadLead)).send({ text: 'before notes', final: true }).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadLead)).send({ on: true }).expect(200)
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.leadgenLead)).expect(200)
    expect(p.body.noteTaker).toBe(true)
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.itadLead)).send({ text: 'We will ship the RTI pages on Friday.', final: true }).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.leadgenLead)).send({ text: 'I will send the county list tomorrow.', final: true }).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.leadgenLead)).send({ text: 'interim words', final: false }).expect(200)
    expect(await prisma.callTranscriptLine.count({ where: { callId } })).toBe(2)
    delete process.env.ANTHROPIC_API_KEY
    await request(app).post(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadLead)).send({ on: false }).expect(200)
    await new Promise((r) => setTimeout(r, 300))
    const n = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadMember)).expect(200)
    expect(n.body.status).toBe('no-ai')
    expect(n.body.transcript.map((l: { text: string }) => l.text)).toEqual(['We will ship the RTI pages on Friday.', 'I will send the county list tomorrow.'])
    // the guest was in the call, so they can read the notes too; a stranger cannot
    await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.leadgenLead)).expect(200)
    await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.inventoryMember)).expect(404)
    // the notes card was posted in the chat
    const msgs = await request(app).get(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.itadMember)).expect(200)
    expect(msgs.body.messages.some((m: { notes: { callId: string } | null }) => m.notes?.callId === callId)).toBe(true)
  })

  it('with an API key the summary, decisions and action items are written', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const answer = { summary: 'RTI pages ship Friday.', keyPoints: ['Pages nearly done'], decisions: ['Ship Friday'], actionItems: [{ owner: 'Leadgen Lead', task: 'Send county list', due: 'tomorrow' }], openQuestions: [] }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(answer) + '\n```' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await request(app).post(`/api/chat/calls/${callId}/notes/retry`).set(...auth(w.itadLead)).expect(200)
    const n = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadMember)).expect(200)
    expect(n.body.status).toBe('ready')
    expect(n.body.notes.actionItems[0]).toEqual({ owner: 'Leadgen Lead', task: 'Send county list', due: 'tomorrow' })
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(sent.messages[0].content).toContain('I will send the county list tomorrow.')
    // only one notes card in the chat even after "Try again"
    expect(await prisma.chatMessage.count({ where: { notesCallId: callId } })).toBe(1)
    vi.unstubAllGlobals()
    expect(() => parseNotes('no json here')).toThrow()
  })

  it('a failing AI call is reported, not thrown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('overloaded', { status: 529 })))
    await generateNotes(callId, { force: true })
    const row = await prisma.chatCall.findUniqueOrThrow({ where: { id: callId } })
    expect(row.notesStatus).toBe('failed')
    vi.unstubAllGlobals()
  })

  it('recordings upload in pieces, in order, and land in the chat as a playable video', async () => {
    const s = await request(app).post(`/api/chat/calls/${callId}/recordings`).set(...auth(w.itadLead)).send({ mime: 'video/webm;codecs=vp8,opus' }).expect(201)
    const recId = s.body.recording.id
    await request(app).post(`/api/chat/recordings/${recId}/chunk`).query({ index: 1 }).set(...auth(w.itadLead)).set('Content-Type', 'application/octet-stream').send(Buffer.from('BBBB')).expect(409)
    await request(app).post(`/api/chat/recordings/${recId}/chunk`).query({ index: 0 }).set(...auth(w.itadLead)).set('Content-Type', 'application/octet-stream').send(Buffer.from('AAAA')).expect(200)
    await request(app).post(`/api/chat/recordings/${recId}/chunk`).query({ index: 0 }).set(...auth(w.itadLead)).set('Content-Type', 'application/octet-stream').send(Buffer.from('AAAA')).expect(200) // retry is ignored
    await request(app).post(`/api/chat/recordings/${recId}/chunk`).query({ index: 1 }).set(...auth(w.itadLead)).set('Content-Type', 'application/octet-stream').send(Buffer.from('BBBB')).expect(200)
    await request(app).post(`/api/chat/recordings/${recId}/chunk`).query({ index: 2 }).set(...auth(w.itadMember)).set('Content-Type', 'application/octet-stream').send(Buffer.from('CC')).expect(404) // not yours
    const f = await request(app).post(`/api/chat/recordings/${recId}/finish`).set(...auth(w.itadLead)).send({ durationSec: 95 }).expect(200)
    const file = await request(app).get(`/api/chat/files/${f.body.messageId}`).query({ inline: 1 }).set(...auth(w.itadMember)).expect(200)
    expect(file.headers['content-type']).toContain('video/webm')
    expect(file.headers['content-disposition']).toContain('inline')
    expect(Buffer.from(file.body).toString()).toBe('AAAABBBB')
    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: f.body.messageId } })
    expect(row.body).toBe('Call recording · 2 min')
    await request(app).post(`/api/chat/recordings/${recId}/finish`).set(...auth(w.itadLead)).send({}).expect(409)
  })

  it('emoji reactions on chat messages toggle and refresh open chats', async () => {
    const since = new Date(Date.now() - 1000).toISOString()
    const m = await request(app).post(`/api/chat/conversations/${dmId}/messages`).set(...auth(w.itadMember)).send({ body: 'Pages are live' }).expect(201)
    const r1 = await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.itadLead)).send({ emoji: '🎉' }).expect(200)
    expect(r1.body.message.reactions).toEqual([{ emoji: '🎉', userIds: [w.itadLead.id] }])
    const poll = await request(app).get(`/api/chat/conversations/${dmId}/messages`).query({ after: 999999999, changedSince: since }).set(...auth(w.itadMember)).expect(200)
    expect(poll.body.changed.some((x: { id: string }) => x.id === m.body.message.id)).toBe(true)
    const r2 = await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.itadLead)).send({ emoji: '🎉' }).expect(200)
    expect(r2.body.message.reactions).toEqual([])
    await request(app).post(`/api/chat/messages/${m.body.message.id}/react`).set(...auth(w.inventoryMember)).send({ emoji: '🎉' }).expect(404)
  })
})
