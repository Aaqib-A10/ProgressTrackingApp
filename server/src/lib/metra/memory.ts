import { createHash } from 'node:crypto'
import { prisma } from '../prisma'
import { completeText } from './llm'

/**
 * What Metra remembers (docs/metra/DESIGN.md):
 *
 *  - Long-term memory per person, across chats: facts they told Metra about themselves or how they like answers
 *    ("I lead the Marketing team", "keep answers short", "call me Anees"). Saved by the remember_fact tool, shown in
 *    the system prompt, listed and deletable by the person. Stored as AiInsight rows of kind MEMORY (their own only).
 *  - The conversation: past answers keep what actually happened (cards confirmed, done or dismissed), and a long chat
 *    is compacted: older turns become a short summary (a SUMMARY message), only the recent turns go in full.
 */

const KEY = (t: string) => createHash('sha1').update(t.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 24)
const MAX_MEMORIES = 30

export interface Memory { id: string; text: string; createdAt: string }

export async function memoriesOf(userId: string): Promise<Memory[]> {
  const rows = await prisma.aiInsight.findMany({ where: { userId, kind: 'MEMORY', state: 'NEW' }, orderBy: { createdAt: 'desc' }, take: MAX_MEMORIES })
  return rows.map((r) => ({ id: r.id, text: String((r.payload as { text?: string } | null)?.text ?? r.title), createdAt: r.createdAt.toISOString() }))
}

export async function remember(userId: string, fact: string): Promise<string> {
  const text = fact.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (text.length < 3) return 'Nothing to remember.'
  await prisma.aiInsight.upsert({
    where: { userId_kind_day_subjectId: { userId, kind: 'MEMORY', day: '', subjectId: KEY(text) } },
    create: { userId, kind: 'MEMORY', day: '', subjectId: KEY(text), title: text.slice(0, 120), payload: { text } },
    update: { state: 'NEW', title: text.slice(0, 120), payload: { text } },
  })
  // Keep the newest ones only.
  const extra = await prisma.aiInsight.findMany({ where: { userId, kind: 'MEMORY', state: 'NEW' }, orderBy: { createdAt: 'desc' }, skip: MAX_MEMORIES, select: { id: true } })
  if (extra.length) await prisma.aiInsight.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } })
  return `Saved to Metra's memory: "${text}"`
}

/** Forget memories matching some words (or an id). */
export async function forget(userId: string, what: string): Promise<string> {
  const q = what.toLowerCase().trim()
  const mine = await memoriesOf(userId)
  const hit = mine.filter((m) => m.id === what || (q.length >= 3 && m.text.toLowerCase().includes(q)))
  if (!hit.length) return 'No saved memory matches that.'
  await prisma.aiInsight.deleteMany({ where: { userId, id: { in: hit.map((h) => h.id) } } })
  return `Forgot ${hit.length} thing${hit.length > 1 ? 's' : ''}: ${hit.map((h) => `"${h.text}"`).join(', ')}`
}

// ------------------------------------------------------------------ the conversation

type Row = { id: string; role: string; content: string; actions: unknown; createdAt: Date }

/** A past answer as the model reads it again: its words, and what really happened with its cards. */
export function historyText(m: Row): string {
  if (m.role !== 'ASSISTANT') return m.content
  const cards = (Array.isArray(m.actions) ? m.actions : []) as { summary?: string; state?: string; result?: string }[]
  const notes = cards.map((c) => `[Card "${c.summary ?? ''}": ${c.state === 'DONE' ? `CONFIRMED and DONE${c.result ? ` (${c.result.slice(0, 120)})` : ''}` : c.state === 'DISMISSED' ? 'dismissed by the person' : c.state === 'FAILED' ? `confirmed but FAILED${c.result ? ` (${c.result.slice(0, 120)})` : ''}` : 'shown, not confirmed yet'}]`)
  return [m.content, ...notes].filter(Boolean).join('\n')
}

const KEEP = 6
const COMPACT_AT = 12

/**
 * The conversation for the model: a summary of older turns (made once the chat is long, then kept up to date) and
 * the recent turns in full. Summaries are SUMMARY messages, never shown in the chat itself.
 */
export async function conversationContext(conversationId: string): Promise<{ summary: string | null; recent: { role: 'user' | 'assistant'; content: string }[] }> {
  const rows: Row[] = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, actions: true, createdAt: true } })
  const lastSummary = [...rows].reverse().find((r) => r.role === 'SUMMARY') ?? null
  const after = rows.filter((r) => (r.role === 'USER' || r.role === 'ASSISTANT') && r.content && (!lastSummary || r.createdAt > lastSummary.createdAt))
  let summary = lastSummary?.content ?? null
  if (after.length > COMPACT_AT) {
    const old = after.slice(0, after.length - KEEP)
    try {
      const text = await completeText([
        { role: 'system', content: 'Summarise this conversation between a person and Metra (an assistant inside the Metriq app) for Metra to continue it. Keep: what the person wants and is working on, facts and numbers found (with names and dates), actions confirmed or dismissed, open questions. At most 180 words, plain bullets. Do not invent anything.' },
        { role: 'user', content: [summary ? `Earlier summary:\n${summary}` : '', ...old.map((m) => `${m.role === 'USER' ? 'Person' : 'Metra'}: ${historyText(m).slice(0, 1500)}`)].filter(Boolean).join('\n\n') },
      ], 450)
      if (text) {
        summary = text
        await prisma.aiMessage.create({ data: { conversationId, role: 'SUMMARY', content: text, createdAt: new Date(old[old.length - 1].createdAt.getTime() + 1) } })
      }
    } catch { /* compaction is best effort: the recent turns still go */ }
    return { summary, recent: after.slice(-KEEP).map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: historyText(m).slice(0, 3000) })) }
  }
  return { summary, recent: after.slice(-(KEEP + 4)).map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: historyText(m).slice(0, 3000) })) }
}
