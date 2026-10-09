import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { app, prisma, auth, seedWorld, type SeededWorld } from './helpers'
import { resetCalls } from '../lib/pm/calls'
import { generateNotes, parseNotes } from '../lib/pm/notes'
import { occurrences, runMeetingReminders } from '../lib/pm/meetings'
import { splitTranscript } from '../lib/pm/notes'
import { waitForCall, resetStt } from '../lib/pm/stt'
import { transcribeAudio } from '../lib/pm/groq'

// Meetings + calendar, and the in-call extras: add people, reactions, captions,
// AI note taker, chunked recordings, chat message reactions, "In a call" presence.

let w: SeededWorld
beforeAll(async () => {
  w = await seedWorld()
  resetCalls()
  delete process.env.GROQ_API_KEY // never call the real Groq from tests
  process.env.NOTES_DELAY_MS = '0'
  process.env.GROQ_STT_MIN_GAP_MS = '0'
})
afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.ANTHROPIC_API_KEY
  await prisma.$disconnect()
})

/** "Try again" writes the notes in the background; wait until they are done. */
async function notesWhenDone(callId: string, who: Parameters<typeof auth>[0]) {
  for (let i = 0; i < 100; i++) {
    const r = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(who)).expect(200)
    if (r.body.status !== 'pending') return r
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error('notes never finished')
}

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
    await request(app).post(`/api/chat/calls/${callId}/notes/retry`).set(...auth(w.itadLead)).expect(202)
    const n = await notesWhenDone(callId, w.itadMember)
    expect(n.body.status).toBe('ready')
    expect(n.body.notes.actionItems[0]).toMatchObject({ owner: 'Leadgen Lead', task: 'Send county list', due: 'tomorrow' })
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

describe('note taker with Groq (mocked)', () => {
  type Req = { url: string; body: unknown }
  const calls: Req[] = []
  function mockGroq(opts: { sttText?: string; sttLang?: string; urduText?: string; notes?: object; segments?: { text: string; no_speech_prob: number; avg_logprob: number }[] } = {}) {
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: unknown }) => {
      calls.push({ url: String(url), body: init?.body })
      if (String(url).includes('/audio/')) {
        const asUrdu = (init?.body as FormData).get('language') === 'ur' && opts.urduText
        const text = asUrdu ? opts.urduText! : opts.sttText ?? ''
        return new Response(JSON.stringify({ text, language: asUrdu ? 'urdu' : opts.sttLang ?? 'english', segments: opts.segments ?? [{ text, no_speech_prob: 0.01, avg_logprob: -0.2 }] }), { status: 200 })
      }
      const model = JSON.parse(String(init?.body ?? '{}')).model
      if (model === 'openai/gpt-oss-20b') return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ roman: 'hum jumma ko pages bhej denge', en: 'We will send the pages on Friday.' }) } }] }), { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(opts.notes ?? { summary: 'S', keyPoints: [], decisions: [], actionItems: [], openQuestions: [] }) } }] }), { status: 200 })
    }))
  }
  let convId = ''
  let callId = ''

  it('a scheduled meeting with auto notes starts its call with the note taker on', async () => {
    resetCalls(); resetStt()
    process.env.GROQ_API_KEY = 'gsk_test'
    const r = await request(app).post('/api/meetings').set(...auth(w.itadLead)).send({ title: 'RTI sync', startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: inHours(1), attendeeIds: [w.itadMember.id] }).expect(201)
    expect(r.body.meeting.autoNotes).toBe(true)
    convId = r.body.meeting.conversationId
    const s = await request(app).post(`/api/chat/conversations/${convId}/calls`).set(...auth(w.itadLead)).send({ video: true }).expect(201)
    callId = s.body.call.id
    const j = await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.itadLead)).send({}).expect(200)
    expect(j.body.noteTaker).toBe(true)
    expect(j.body.sttMode).toBe('server')
    expect(j.body.noteRecorder).toBe(w.itadLead.id) // the person who started the meeting records
    await request(app).post(`/api/chat/calls/${callId}/join`).set(...auth(w.itadMember)).send({}).expect(200)
  })

  it('pieces of each person\'s speech are transcribed on the server with their name, as spoken', async () => {
    mockGroq({ sttText: 'We will ship the county pages on Friday.' })
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ mode: 'mixed', durationMs: 20000 }).set(...auth(w.itadLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 1)).expect(200)
    await waitForCall(callId, 5000)
    expect(calls).toHaveLength(1) // English: one pass, nothing translated
    expect(calls[0].url).toContain('/audio/transcriptions')
    const form = calls[0].body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBeNull() // Whisper picks the language
    expect(form.get('prompt')).toBeNull() // no vocabulary prompt: Whisper parrots it on unclear sound
    mockGroq({ sttText: 'I will send the list tomorrow.' })
    // Only the recording browser (the one that started the notes) sends audio, labelled per person.
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ mode: 'en', speaker: w.itadMember.id }).set(...auth(w.itadMember)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 2)).expect(409)
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ mode: 'en', speaker: w.leadgenLead.id }).set(...auth(w.itadLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 2)).expect(409) // not in the call
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ mode: 'en', speaker: w.itadMember.id }).set(...auth(w.itadLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 2)).expect(200)
    await waitForCall(callId, 5000)
    expect(calls[0].url).toContain('/audio/transcriptions')
    expect((calls[0].body as FormData).get('language')).toBe('en')
    const lines = await prisma.callTranscriptLine.findMany({ where: { callId }, orderBy: { at: 'asc' } })
    expect(lines.map((l) => [l.speakerName, l.text])).toEqual([['itad lead', 'We will ship the county pages on Friday.'], ['itad member', 'I will send the list tomorrow.']])
    // and they show as captions
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadMember)).expect(200)
    expect(p.body.captions.some((c: { text: string; final: boolean }) => c.final && c.text.includes('county pages'))).toBe(true)
  })

  it('Urdu that Whisper writes in Hindi letters is written again in Urdu script', async () => {
    mockGroq({ sttText: 'हम शुक्रवार को पेज भेज देंगे', sttLang: 'hindi', urduText: 'ہم جمعہ کو پیجز بھیج دیں گے' })
    expect(await transcribeAudio(Buffer.alloc(100), { mode: 'mixed' })).toBe('ہم جمعہ کو پیجز بھیج دیں گے')
    expect(calls).toHaveLength(2)
    expect((calls[1].body as FormData).get('model')).toBe('whisper-large-v3')
    expect((calls[1].body as FormData).get('language')).toBe('ur')
    vi.unstubAllGlobals()
  })

  it('a line said in Urdu is kept as said, and written in Roman Urdu and English; the caption is Roman Urdu', async () => {
    mockGroq({ sttText: 'ہم جمعہ کو پیجز بھیج دیں گے', sttLang: 'urdu' })
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ mode: 'mixed', speaker: w.itadMember.id }).set(...auth(w.itadLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 4)).expect(200)
    await waitForCall(callId, 5000)
    const { waitForCall: waitTranslate } = await import('../lib/pm/translate')
    await waitTranslate(callId, 5000)
    const line = await prisma.callTranscriptLine.findFirstOrThrow({ where: { callId, text: 'ہم جمعہ کو پیجز بھیج دیں گے' } })
    expect(line.speakerName).toBe('itad member')
    expect(line.textEn).toBe('We will send the pages on Friday.')
    expect(line.textRoman).toBe('hum jumma ko pages bhej denge')
    const p = await request(app).get(`/api/chat/calls/${callId}/poll`).set(...auth(w.itadMember)).expect(200)
    expect(p.body.captions.some((c: { text: string }) => c.text === 'hum jumma ko pages bhej denge')).toBe(true)
    await prisma.callTranscriptLine.delete({ where: { id: line.id } })
    vi.unstubAllGlobals()
  })

  it('in Groq mode, the browser\'s own recognition is only used for captions (no duplicate lines)', async () => {
    await request(app).post(`/api/chat/calls/${callId}/transcript`).set(...auth(w.itadLead)).send({ text: 'browser words', final: true }).expect(200)
    expect(await prisma.callTranscriptLine.count({ where: { callId, text: 'browser words' } })).toBe(0)
  })

  it('silence and Whisper "hallucinations" are dropped', async () => {
    mockGroq({ segments: [{ text: 'Thank you.', no_speech_prob: 0.1, avg_logprob: -0.3 }, { text: 'random noise words', no_speech_prob: 0.9, avg_logprob: -1.2 }] })
    expect(await transcribeAudio(Buffer.alloc(100), { mode: 'en' })).toBe('')
  })

  it('outsiders cannot send audio; the last piece is still taken shortly after the call ends', async () => {
    await request(app).post(`/api/chat/calls/${callId}/audio`).set(...auth(w.leadgenLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 1)).expect(410)
    const notes = { summary: 'Pages ship Friday.', keyPoints: [], decisions: ['Ship Friday'], actionItems: [{ owner: 'ITAD Member', task: 'Send the list', due: 'tomorrow' }], openQuestions: [] }
    mockGroq({ sttText: 'Last words before leaving.', notes })
    await request(app).post(`/api/chat/calls/${callId}/leave`).set(...auth(w.itadMember)).expect(200)
    await request(app).post(`/api/chat/calls/${callId}/leave`).set(...auth(w.itadLead)).expect(200) // call ends
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ speaker: w.itadMember.id }).set(...auth(w.itadMember)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 3)).expect(409) // not the recorder
    await request(app).post(`/api/chat/calls/${callId}/audio`).query({ speaker: w.itadMember.id }).set(...auth(w.itadLead)).set('Content-Type', 'audio/webm').send(Buffer.alloc(4000, 3)).expect(200)
    await waitForCall(callId, 5000)
    expect(await prisma.callTranscriptLine.count({ where: { callId } })).toBe(3)
  })

  it('notes are written with the Groq model after the last pieces are in; action items link to tasks', async () => {
    const { generateNotes } = await import('../lib/pm/notes')
    await generateNotes(callId)
    const chat = calls.find((c) => c.url.includes('/chat/completions'))!
    const body = JSON.parse(String(chat.body))
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.messages[1].content).toContain('Last words before leaving.')
    const n = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadMember)).expect(200)
    expect(n.body.status).toBe('ready')
    expect(n.body.provider).toBe('groq')
    // turn the action item into a task and remember it
    await request(app).post('/api/projects').set(...auth(w.superAdmin)).send({ name: 'RTI', key: 'rti', members: [{ userId: w.itadLead.id, role: 'ADMIN' }, { userId: w.itadMember.id, role: 'MEMBER' }] }).expect(201)
    const task = await request(app).post('/api/projects/RTI/tasks').set(...auth(w.itadLead)).send({ title: 'Send the list', assigneeIds: [w.itadMember.id] }).expect(201)
    const code = task.body.task.code
    await request(app).patch(`/api/chat/calls/${callId}/notes/action-items/0`).set(...auth(w.itadMember)).send({ taskCode: code }).expect(200)
    const again = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadMember)).expect(200)
    expect(again.body.notes.actionItems[0].taskCode).toBe(code)
    await request(app).patch(`/api/chat/calls/${callId}/notes/action-items/0`).set(...auth(w.itadMember)).send({ taskCode: 'NOPE-1' }).expect(422)
    expect(n.body.notes.language).toBe('roman') // Roman Urdu by default
    expect(JSON.parse(String(chat.body)).messages[0].content).toContain('Roman Urdu')
    // "Try again" in Urdu keeps the task already made from that action item
    mockGroq({ notes: { summary: 'پیجز جمعہ کو جائیں گے۔', keyPoints: [], decisions: [], actionItems: [{ owner: 'ITAD Member', task: 'Send the list', due: 'tomorrow' }], openQuestions: [] } })
    await request(app).post(`/api/chat/calls/${callId}/notes/retry`).set(...auth(w.itadMember)).send({ lang: 'ur' }).expect(202)
    await notesWhenDone(callId, w.itadMember)
    const sys = JSON.parse(String(calls.find((c) => c.url.includes('/chat/completions'))!.body)).messages[0].content
    expect(sys).toContain('Urdu script')
    const third = await request(app).get(`/api/chat/calls/${callId}/notes`).set(...auth(w.itadMember)).expect(200)
    expect(third.body.notes.language).toBe('ur')
    expect(third.body.notes.actionItems[0].taskCode).toBe(code)
    vi.unstubAllGlobals()
  })

  it('notes language follows the meeting', async () => {
    const { detectLanguage } = await import('../lib/pm/notes')
    expect(detectLanguage('ہم جمعہ کو پیجز بھیج دیں گے۔ RTI کی لسٹ کل تک')).toBe('ur')
    expect(detectLanguage('We will ship the pages, theek hai')).toBe('en')
  })

  it('long transcripts are split at line breaks for the free tier', () => {
    const text = Array.from({ length: 100 }, (_, i) => `[0:${i}] A: ${'word '.repeat(40)}`).join('\n')
    const parts = splitTranscript(text, 2000)
    expect(parts.length).toBeGreaterThan(5)
    expect(parts.every((p) => p.length <= 2000)).toBe(true)
    expect(parts.join('\n')).toBe(text)
  })
})


describe('profile pictures', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 7)])

  it('people change their own picture (not someone else\'s); everyone can see it', async () => {
    await request(app).post(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.itadMember)).set('Content-Type', 'image/jpeg').send(jpeg).expect(200)
    await request(app).post(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.itadLead)).set('Content-Type', 'image/jpeg').send(jpeg).expect(403)
    await request(app).post(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.itadMember)).set('Content-Type', 'image/png').send(png).expect(415)
    const idx = await request(app).get('/api/avatars').set(...auth(w.leadgenLead)).expect(200)
    expect(idx.body.users[w.itadMember.id]).toBeGreaterThan(0)
    const f = await request(app).get(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.leadgenLead)).expect(200)
    expect(f.headers['content-type']).toContain('image/jpeg')
    await request(app).delete(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.itadMember)).expect(204)
    await request(app).get(`/api/avatars/user/${w.itadMember.id}`).set(...auth(w.leadgenLead)).expect(404)
  })

  it('project pictures: project admins only; shown for the project channel too', async () => {
    await request(app).post('/api/avatars/project/rti').set(...auth(w.itadMember)).set('Content-Type', 'image/jpeg').send(jpeg).expect(403)
    await request(app).post('/api/avatars/project/rti').set(...auth(w.itadLead)).set('Content-Type', 'image/jpeg').send(jpeg).expect(200)
    const idx = await request(app).get('/api/avatars').set(...auth(w.itadMember)).expect(200)
    expect(idx.body.projects.RTI).toBeGreaterThan(0)
    const ch = await request(app).get('/api/chat/projects/RTI').set(...auth(w.itadLead)).expect(200)
    const c = await request(app).get(`/api/chat/conversations/${ch.body.conversation.id}`).set(...auth(w.itadLead)).expect(200)
    expect(c.body.conversation.canChangePicture).toBe(true)
    const c2 = await request(app).get(`/api/chat/conversations/${ch.body.conversation.id}`).set(...auth(w.itadMember)).expect(200)
    expect(c2.body.conversation.canChangePicture).toBe(false)
  })

  it('group pictures: group admins only', async () => {
    const g = await request(app).post('/api/chat/conversations').set(...auth(w.itadLead)).send({ type: 'GROUP', name: 'Web team', userIds: [w.itadMember.id] }).expect(201)
    await request(app).post(`/api/avatars/chat/${g.body.conversation.id}`).set(...auth(w.itadMember)).set('Content-Type', 'image/jpeg').send(jpeg).expect(403)
    await request(app).post(`/api/avatars/chat/${g.body.conversation.id}`).set(...auth(w.itadLead)).set('Content-Type', 'image/jpeg').send(jpeg).expect(200)
    const idx = await request(app).get('/api/avatars').set(...auth(w.itadMember)).expect(200)
    expect(idx.body.chats[g.body.conversation.id]).toBeGreaterThan(0)
  })
})
