import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { chatJson, groqEnabled } from './groq'
import * as Stt from './stt'

/**
 * AI meeting notes.
 *
 * While the note taker is on, each person's own microphone is turned into text with the
 * right speaker name (CallTranscriptLine): with GROQ_API_KEY set, on the server with Groq
 * Whisper (see stt.ts); otherwise by the browser's built-in speech recognition. When the
 * call ends (or someone presses "Stop notes"), the transcript is summarised into:
 * summary, key points, decisions, action items (owner, task, due) and open questions.
 *
 * Writer: Groq (GROQ_API_KEY, free tier) first, else Claude (ANTHROPIC_API_KEY). With
 * neither, the transcript is still kept and shown. Long meetings are summarised in parts
 * and then combined, so they fit the free tier's per-minute token limit.
 */

export interface ActionItem { owner: string | null; task: string; due: string | null; dueDate?: string | null; taskCode?: string | null }

export interface MeetingNotes {
  summary: string
  keyPoints: string[]
  decisions: string[]
  actionItems: ActionItem[]
  openQuestions: string[]
}

/** Which AI writes the notes (null = none set up). */
export function notesProvider(): 'groq' | 'anthropic' | null {
  if (groqEnabled()) return 'groq'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  return null
}

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_TRANSCRIPT_CHARS = 400_000

const SYSTEM =
  'You write meeting notes for a busy team. Be accurate: only include what was actually said in the transcript, and never add anything that was not said. ' +
  'The transcript comes from speech recognition in an office: it can contain lines that are side talk from people nearby, background voices, ' +
  'misheard words or sentences that make no sense in the meeting. Leave all of those out. ' +
  'Only note work that the people in the meeting discussed with each other: tasks, projects, clients, problems, numbers, decisions, plans. ' +
  'Leave out greetings, small talk, jokes, personal or private matters (health, family, injuries) and anything said to someone outside the meeting. ' +
  'Never write that a name, product or company "was mentioned": only report what was said about it. ' +
  'If a line is unclear, skip it rather than guess. If there is little real discussion, keep the notes short and say so in the summary instead of filling them. ' +
  'People may speak English, Urdu or a mix; always write the notes in clear, simple English. ' +
  'Answer with one JSON object and nothing else.'

const KEYS_SPEC = `Return JSON with exactly these keys:
{
  "summary": "up to 6 sentences: what the meeting was about and where things landed (shorter when little was discussed)",
  "keyPoints": ["the main points discussed, one short sentence each"],
  "decisions": ["each decision that was clearly made"],
  "actionItems": [{ "owner": "person's name or null", "task": "what they will do", "due": "when, as said in the meeting, or null", "dueDate": "that day as YYYY-MM-DD worked out from the meeting date, or null" }],
  "openQuestions": ["questions left unanswered or things to follow up"]
}
Use empty arrays when there is nothing for a key.`

/** Split a long transcript at line breaks into parts of about `size` characters. */
export function splitTranscript(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const parts: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > size) { parts.push(cur); cur = '' }
    cur += (cur ? '\n' : '') + line
  }
  if (cur) parts.push(cur)
  return parts
}

async function ask(system: string, prompt: string): Promise<string> {
  return notesProvider() === 'groq' ? chatJson(system, prompt) : askClaude(prompt)
}

/** Write the notes: in one go, or part by part and then combined for long meetings. */
async function writeNotes(ctx: { title: string; agenda: string; people: string[]; transcript: string; date?: string }): Promise<MeetingNotes> {
  const size = Number(process.env.NOTES_CHUNK_CHARS ?? (notesProvider() === 'groq' ? 14_000 : 150_000))
  const parts = splitTranscript(ctx.transcript, size)
  if (parts.length === 1) return parseNotes(await ask(SYSTEM, buildPrompt(ctx)))
  const partial: MeetingNotes[] = []
  for (let i = 0; i < parts.length; i++) {
    partial.push(parseNotes(await ask(SYSTEM, buildPrompt({ ...ctx, transcript: parts[i] }, `This is part ${i + 1} of ${parts.length} of the transcript. Write notes for this part only.`))))
  }
  const merge = `Meeting: ${ctx.title}\nThese are notes written for each part of one meeting, in order:\n${JSON.stringify(partial)}\n\nCombine them into the notes for the whole meeting. Remove repeats; keep every distinct decision and action item.\n${KEYS_SPEC}`
  return parseNotes(await ask(SYSTEM, merge))
}

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
      const dueDate = typeof o.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate) ? o.dueDate : null
      return { owner: o.owner ? String(o.owner) : null, task: String(o.task ?? '').trim(), due: o.due ? String(o.due) : null, dueDate }
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
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const j = (await r.json()) as { content?: { type: string; text?: string }[] }
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
}

function buildPrompt(ctx: { title: string; agenda: string; people: string[]; transcript: string; date?: string }, note = ''): string {
  return `Meeting: ${ctx.title}${ctx.date ? ` (held on ${ctx.date})` : ''}
${ctx.agenda ? `Agenda:\n${ctx.agenda}\n` : ''}People in the call: ${ctx.people.join(', ') || 'unknown'}
${note}
Transcript (time from the start of the call, speaker, words):
${ctx.transcript}

${KEYS_SPEC}`
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
  // Pieces of speech may still be on their way to text: wait for them first.
  await Stt.waitForCall(callId)
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
    if (!notesProvider()) throw new Error('no-key')
    const date = call.startedAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi' })
    notes = await writeNotes({ title, agenda: call.meeting?.agenda ?? '', people, transcript: transcriptText(call.startedAt, call.transcript), date })
  } catch (e) {
    const msg = (e as Error).message
    status = msg === 'no-key' ? 'no-ai' : 'failed'
    notes = status === 'failed' ? { error: msg.slice(0, 300) } : null
    if (status === 'failed') {
      // eslint-disable-next-line no-console
      console.error('[notes] summary failed:', msg)
    }
  }
  // Written again ("Try again"): keep the tasks already made from action items.
  const old = call.notes as unknown as MeetingNotes | null
  if (notes && 'actionItems' in notes && old?.actionItems?.length) {
    const made = new Map(old.actionItems.filter((x) => x.taskCode).map((x) => [x.task.trim().toLowerCase(), x.taskCode]))
    notes.actionItems = notes.actionItems.map((x) => ({ ...x, taskCode: made.get(x.task.trim().toLowerCase()) ?? null }))
    const leftover = old.actionItems.filter((x) => x.taskCode && !notes!.actionItems.some((y) => y.taskCode === x.taskCode))
    notes.actionItems.push(...(leftover as ActionItem[]))
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
