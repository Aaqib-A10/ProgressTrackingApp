import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { chatJson, groqEnabled } from './groq'
import * as Stt from './stt'
import * as Translate from './translate'

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
  /** Language the notes are written in. */
  language?: NotesLang
}

/** en = English, ur = Urdu (Urdu script). auto = the language most of the meeting was in. */
export type NotesLang = 'en' | 'ur'

/** Mostly Urdu (Urdu/Arabic or Devanagari script) or mostly English? */
export function detectLanguage(text: string): NotesLang {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return 'en'
  const urdu = text.match(/[\u0600-\u06FF\u0750-\u077F\u0900-\u097F]/g)?.length ?? 0
  return urdu / letters > 0.3 ? 'ur' : 'en'
}

/** Which AI writes the notes (null = none set up). */
export function notesProvider(): 'groq' | 'anthropic' | null {
  if (groqEnabled()) return 'groq'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  return null
}

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_TRANSCRIPT_CHARS = 400_000

const SYSTEM_BASE =
  'You write meeting notes for a busy team. Be accurate: only include what was actually said in the transcript, and never add anything that was not said. ' +
  'The transcript comes from speech recognition in an office: it can contain lines that are side talk from people nearby, background voices, ' +
  'misheard words or sentences that make no sense in the meeting. Leave all of those out. ' +
  'Only note work that the people in the meeting discussed with each other: tasks, projects, clients, problems, numbers, decisions, plans. ' +
  'Leave out greetings, small talk, jokes, personal or private matters (health, family, injuries) and anything said to someone outside the meeting. ' +
  'Never write that a name, product or company "was mentioned": only report what was said about it. ' +
  'If a line is unclear, skip it rather than guess. If there is little real discussion, keep the notes short and say so in the summary instead of filling them. ' +
  'People may speak English, Urdu or a mix (Urdu may appear in Urdu or Hindi script). '

function systemFor(lang: NotesLang): string {
  const write = lang === 'ur'
    ? 'Write every value of the notes in simple, natural Urdu in Urdu script (the way the team speaks). Keep names of people, companies, products and technical words in English letters. '
    : 'Write every value of the notes in clear, simple English. '
  return SYSTEM_BASE + write + 'The JSON keys stay in English. Answer with one JSON object and nothing else.'
}

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
  return notesProvider() === 'groq' ? chatJson(system, prompt, 3500) : askClaude(prompt, system)
}

/** Write the notes: in one go, or part by part and then combined for long meetings. */
async function writeNotes(ctx: { title: string; agenda: string; people: string[]; transcript: string; date?: string }, lang: NotesLang): Promise<MeetingNotes> {
  const SYSTEM = systemFor(lang)
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

async function askClaude(prompt: string, system: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no-key')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      system,
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
export async function generateNotes(callId: string, opts: { force?: boolean; lang?: NotesLang | 'auto' } = {}): Promise<void> {
  const claim = await prisma.chatCall.updateMany({
    where: opts.force ? { id: callId } : { id: callId, notesStatus: null },
    data: { notesStatus: 'pending' },
  })
  if (!claim.count) return
  // Pieces of speech may still be on their way to text, then to English: wait for them first.
  await Stt.waitForCall(callId)
  await Translate.waitForCall(callId)
  await Translate.translateMissing(callId)
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
    // Written from the English lines (the original when a line has no English yet).
    const transcript = transcriptText(call.startedAt, call.transcript.map((l) => ({ ...l, text: l.textEn ?? l.text })))
    // English unless someone asks for Urdu with the switch.
    const lang: NotesLang = opts.lang && opts.lang !== 'auto' ? opts.lang : 'en'
    notes = { ...(await writeNotes({ title, agenda: call.meeting?.agenda ?? '', people, transcript, date }, lang)), language: lang }
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
