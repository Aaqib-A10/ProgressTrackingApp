import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'

/**
 * AI meeting notes.
 *
 * While the note taker is on, each person's browser turns their own microphone into
 * text and sends finished sentences here (CallTranscriptLine), so every line already
 * has the right speaker name. When the call ends (or someone presses "Stop notes"),
 * the transcript is summarised with the Claude API into: summary, key points,
 * decisions, action items (owner, task, due) and open questions.
 *
 * Needs ANTHROPIC_API_KEY in server/.env. Without it the transcript is still kept and
 * shown, the summary part just says it is not set up. ANTHROPIC_MODEL picks the model.
 */

export interface MeetingNotes {
  summary: string
  keyPoints: string[]
  decisions: string[]
  actionItems: { owner: string | null; task: string; due: string | null }[]
  openQuestions: string[]
}

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_TRANSCRIPT_CHARS = 180_000

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function transcriptText(startedAt: Date, lines: { speakerName: string; text: string; at: Date }[]): string {
  let out = lines.map((l) => `[${clock(l.at.getTime() - startedAt.getTime())}] ${l.speakerName}: ${l.text}`).join('\n')
  if (out.length > MAX_TRANSCRIPT_CHARS) out = out.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[transcript cut here because it is very long]'
  return out
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 30) : []
}

/** Pull the JSON object out of the model's answer (tolerates ```json fences). */
export function parseNotes(text: string): MeetingNotes {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI answer had no notes in it')
  const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const items = Array.isArray(j.actionItems) ? j.actionItems : []
  return {
    summary: String(j.summary ?? '').trim(),
    keyPoints: asStrings(j.keyPoints),
    decisions: asStrings(j.decisions),
    actionItems: items.slice(0, 40).map((a) => {
      const o = (a ?? {}) as Record<string, unknown>
      return { owner: o.owner ? String(o.owner) : null, task: String(o.task ?? '').trim(), due: o.due ? String(o.due) : null }
    }).filter((a) => a.task),
    openQuestions: asStrings(j.openQuestions),
  }
}

async function askClaude(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no-key')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      system:
        'You write meeting notes for a busy team. Be accurate: only include what was actually said in the transcript. ' +
        'The transcript was produced by speech recognition, so fix obvious recognition mistakes silently. ' +
        'People may speak English, Urdu or a mix; always write the notes in clear, simple English. ' +
        'Answer with one JSON object and nothing else.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const j = (await r.json()) as { content?: { type: string; text?: string }[] }
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
}

function buildPrompt(ctx: { title: string; agenda: string; people: string[]; transcript: string }): string {
  return `Meeting: ${ctx.title}
${ctx.agenda ? `Agenda:\n${ctx.agenda}\n` : ''}People in the call: ${ctx.people.join(', ') || 'unknown'}

Transcript (time from the start of the call, speaker, words):
${ctx.transcript}

Return JSON with exactly these keys:
{
  "summary": "3 to 6 sentences: what the meeting was about and where things landed",
  "keyPoints": ["the main points discussed, one short sentence each"],
  "decisions": ["each decision that was clearly made"],
  "actionItems": [{ "owner": "person's name or null", "task": "what they will do", "due": "when, as said in the meeting, or null" }],
  "openQuestions": ["questions left unanswered or things to follow up"]
}
Use empty arrays when there is nothing for a key.`
}

/**
 * Write the notes for a call (once). Safe to call again: only runs when the call
 * has no notes yet, or when `force` is set (the "Try again" button).
 */
export async function generateNotes(callId: string, opts: { force?: boolean } = {}): Promise<void> {
  const claim = await prisma.chatCall.updateMany({
    where: opts.force ? { id: callId } : { id: callId, notesStatus: null },
    data: { notesStatus: 'pending' },
  })
  if (!claim.count) return
  const call = await prisma.chatCall.findUnique({
    where: { id: callId },
    include: {
      transcript: { orderBy: { at: 'asc' } },
      conversation: { select: { id: true, name: true, type: true } },
      meeting: { select: { title: true, agenda: true } },
    },
  })
  if (!call) return
  if (!call.transcript.length) {
    await prisma.chatCall.update({ where: { id: callId }, data: { notesStatus: 'empty', notes: Prisma.DbNull } })
    return
  }
  const people = [...new Set(call.transcript.map((l) => l.speakerName))]
  const title = call.meeting?.title ?? call.conversation.name ?? 'Call'
  let status = 'ready'
  let notes: MeetingNotes | { error: string } | null = null
  try {
    const answer = await askClaude(buildPrompt({ title, agenda: call.meeting?.agenda ?? '', people, transcript: transcriptText(call.startedAt, call.transcript) }))
    notes = parseNotes(answer)
  } catch (e) {
    const msg = (e as Error).message
    status = msg === 'no-key' ? 'no-ai' : 'failed'
    notes = status === 'failed' ? { error: msg.slice(0, 300) } : null
    if (status === 'failed') {
      // eslint-disable-next-line no-console
      console.error('[notes] summary failed:', msg)
    }
  }
  await prisma.chatCall.update({ where: { id: callId }, data: { notesStatus: status, notes: notes ? (notes as unknown as Prisma.InputJsonValue) : Prisma.DbNull } })
  // Post the notes card in the chat once (not again on "Try again").
  const already = await prisma.chatMessage.findFirst({ where: { notesCallId: callId }, select: { id: true } })
  if (!already) {
    const summary = notes && 'summary' in notes ? notes.summary : ''
    await prisma.chatMessage.create({
      data: {
        conversationId: call.conversationId,
        userId: call.startedById,
        body: summary ? `Meeting notes: ${summary.length > 160 ? summary.slice(0, 159) + '…' : summary}` : 'Meeting transcript is ready',
        notesCallId: callId,
        mentions: [],
      },
    })
    await prisma.chatConversation.update({ where: { id: call.conversationId }, data: { lastMessageAt: new Date() } })
  }
}
