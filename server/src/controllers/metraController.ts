import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { isOn } from '../lib/flags'
import { askerOf } from '../lib/metra/access'
import { answer, suggestionsFor, GAVE_UP, WRITE_TOOLS, type ActionCard, type Emit, type ToolUse } from '../lib/metra/agent'
import { llmReady, LlmError } from '../lib/metra/llm'
import { embedStatus } from '../lib/metra/embed'
import { indexNow } from '../lib/metra/indexer'
import { indexStats } from '../lib/metra/store'
import { SOURCES } from '../lib/metra/sources'
import { conversationContext, forget, memoriesOf } from '../lib/metra/memory'

/**
 * Metra API (docs/metra/DESIGN.md). Everything is the asking person's own: conversations are private to them, and
 * answers come only from records they can read (lib/metra/access). Behind the company switch `metra`.
 */

async function on(req: AuthedRequest, res: Response): Promise<boolean> {
  if (await isOn('metra', req.user!.companyId)) return true
  res.status(403).json({ error: 'Metra is not switched on for your company yet.' })
  return false
}

// A person's questions: a short burst is fine, a flood is not (the model has rate limits too).
const recent = new Map<string, number[]>()
function tooMany(userId: string): boolean {
  const now = Date.now()
  const xs = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (xs.length >= 10) { recent.set(userId, xs); return true }
  xs.push(now)
  recent.set(userId, xs)
  return false
}

const chatSchema = z.object({ conversationId: z.string().min(1).max(60).optional(), message: z.string().trim().min(1, 'Ask a question.').max(4000) })

/**
 * POST /api/metra/chat { conversationId?, message } — the answer streamed as server-sent events:
 * meta {conversationId, messageId}, status "Searching...", sources [...], delta "text", action {card}, done {...}, error {error}.
 */
export async function chat(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = chatSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Ask a question.' }); return }
  if (!llmReady()) { res.status(503).json({ error: 'Metra is not connected to its AI model yet (GROQ_API_KEY in server/.env).' }); return }
  if (tooMany(req.user!.id)) { res.status(429).json({ error: 'That is a lot of questions at once: wait a moment.' }); return }
  const userId = req.user!.id
  let conv = p.data.conversationId ? await prisma.aiConversation.findFirst({ where: { id: p.data.conversationId, userId } }) : null
  if (p.data.conversationId && !conv) { res.status(404).json({ error: 'Conversation not found' }); return }
  conv ??= await prisma.aiConversation.create({ data: { userId, title: p.data.message.replace(/\s+/g, ' ').slice(0, 70) } })
  // The chat so far (older turns compacted into a summary) and what Metra remembers about this person.
  const [{ summary, recent: history }, memories] = await Promise.all([conversationContext(conv.id), memoriesOf(userId)])
  await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'USER', content: p.data.message } })

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no') // Nginx: pass each piece on at once
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  const ctl = new AbortController()
  res.on('close', () => { if (!res.writableEnded) ctl.abort() })
  const started = Date.now()
  const draft = await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', content: '' } })
  send('meta', { conversationId: conv.id, messageId: draft.id, title: conv.title })
  try {
    const asker = await askerOf(userId)
    const emit: Emit = (event, data) => send(event, data)
    const r = await answer(asker, history, p.data.message, emit, ctl.signal, { memories, summary })
    // A card with no words still needs a line; no words and no card means the model gave nothing back.
    if (!r.content && !r.actions.length && !r.sources.length && !r.tools.length) throw new LlmError('The AI model did not answer. Please try again.', 502)
    const content = r.content || (r.actions.length ? 'Here is a card for it: press Confirm to do it.' : 'I couldn\'t find that in your Metriq data.')
    await prisma.aiMessage.update({
      where: { id: draft.id },
      data: { content, sources: r.sources as unknown as Prisma.InputJsonValue, tools: r.tools as unknown as Prisma.InputJsonValue, actions: r.actions as unknown as Prisma.InputJsonValue, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: Date.now() - started, model: r.model },
    })
    await prisma.aiConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
    send('done', { messageId: draft.id, content, sources: r.sources, actions: r.actions, latencyMs: Date.now() - started })
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : ctl.signal.aborted ? 'Stopped.' : 'Metra could not answer just now. Try again.'
    await prisma.aiMessage.update({ where: { id: draft.id }, data: { content: '', error: (e as Error).message.slice(0, 500), latencyMs: Date.now() - started } }).catch(() => undefined)
    send('error', { error: msg })
  } finally {
    res.end()
  }
}

/** GET /api/metra/conversations — mine, newest first. */
export async function listConversations(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const rows = await prisma.aiConversation.findMany({ where: { userId: req.user!.id }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }], take: 100, select: { id: true, title: true, pinned: true, updatedAt: true } })
  res.json({ conversations: rows.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })) })
}

/** GET /api/metra/conversations/:id — the messages (mine only). */
export async function getConversation(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const c = await prisma.aiConversation.findFirst({ where: { id: req.params.id, userId: req.user!.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } })
  if (!c) { res.status(404).json({ error: 'Conversation not found' }); return }
  res.json({
    conversation: { id: c.id, title: c.title, pinned: c.pinned },
    messages: c.messages.filter((m) => m.role === 'USER' || (m.role === 'ASSISTANT' && (m.content || m.error))).map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources ?? [], actions: m.actions ?? [], feedback: m.feedback, error: m.error ? 'Metra could not answer this one.' : null, createdAt: m.createdAt.toISOString() })),
  })
}

export async function updateConversation(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Invalid change' }); return }
  const r = await prisma.aiConversation.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: p.data })
  if (!r.count) { res.status(404).json({ error: 'Conversation not found' }); return }
  res.json({ ok: true })
}

export async function deleteConversation(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const r = await prisma.aiConversation.deleteMany({ where: { id: req.params.id, userId: req.user!.id } })
  if (!r.count) { res.status(404).json({ error: 'Conversation not found' }); return }
  res.json({ ok: true })
}

async function myMessage(req: AuthedRequest, res: Response) {
  const m = await prisma.aiMessage.findFirst({ where: { id: req.params.id, role: 'ASSISTANT', conversation: { userId: req.user!.id } } })
  if (!m) res.status(404).json({ error: 'Message not found' })
  return m
}

/** POST /api/metra/messages/:id/feedback { feedback: UP|DOWN|null, note? } */
export async function feedback(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = z.object({ feedback: z.enum(['UP', 'DOWN']).nullable(), note: z.string().trim().max(1000).optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Invalid feedback' }); return }
  const m = await myMessage(req, res)
  if (!m) return
  await prisma.aiMessage.update({ where: { id: m.id }, data: { feedback: p.data.feedback, feedbackNote: p.data.note ?? null } })
  res.json({ ok: true })
}

/**
 * POST /api/metra/messages/:id/actions/:actionId { decision: confirm|dismiss, arguments? } — the person confirms (or
 * dismisses) an action card. Confirmed: the tool runs as the person, through Metriq's own API, so every check applies.
 */
export async function decideAction(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = z.object({ decision: z.enum(['confirm', 'dismiss']), arguments: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Confirm or dismiss.' }); return }
  const m = await myMessage(req, res)
  if (!m) return
  const actions = (Array.isArray(m.actions) ? m.actions : []) as unknown as ActionCard[]
  const card = actions.find((a) => a.id === req.params.actionId)
  if (!card) { res.status(404).json({ error: 'Action not found' }); return }
  if (card.state !== 'PROPOSED') { res.status(409).json({ error: 'This card was already used.' }); return }
  if (p.data.decision === 'dismiss') card.state = 'DISMISSED'
  else {
    const tool = WRITE_TOOLS.find((t) => t.name === card.tool)
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, name: true } })
    const args = p.data.arguments ?? card.args
    const r = tool ? await tool.run(me, args).catch((e: Error) => ({ isError: true, content: [{ type: 'text' as const, text: e.message }] })) : { isError: true, content: [{ type: 'text' as const, text: 'This action is no longer available.' }] }
    card.state = r.isError ? 'FAILED' : 'DONE'
    card.args = args
    card.result = r.content.map((x) => x.text).join('\n').slice(0, 500)
  }
  await prisma.aiMessage.update({ where: { id: m.id }, data: { actions: actions as unknown as Prisma.InputJsonValue } })
  res.json({ action: card })
}

/** GET /api/metra/status — is Metra ready for me, what to ask; for Super Admins also the index per source. */
export async function status(req: AuthedRequest, res: Response): Promise<void> {
  const enabled = await isOn('metra', req.user!.companyId)
  if (!enabled) { res.json({ enabled: false }); return }
  const asker = await askerOf(req.user!.id)
  const out: Record<string, unknown> = { enabled, llm: llmReady(), suggestions: suggestionsFor(asker), sources: SOURCES.filter((s) => asker.sources.has(s.type)).map((s) => ({ type: s.type, label: s.label })) }
  if (req.user!.role === 'SUPER_ADMIN') {
    const [states, month, stats] = await Promise.all([
      prisma.aiIndexState.findMany({ orderBy: { sourceType: 'asc' } }),
      prisma.aiMessage.aggregate({ where: { role: 'ASSISTANT', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _count: true, _sum: { tokensIn: true, tokensOut: true } }),
      indexStats(req.user!.companyId),
    ])
    out.admin = {
      embed: embedStatus(), index: stats,
      sources: states.map((s) => ({ type: s.sourceType, label: SOURCES.find((x) => x.type === s.sourceType)?.label ?? s.sourceType, chunks: s.chunks, lastRunAt: s.lastRunAt?.toISOString() ?? null, lastError: s.lastError })),
      usage: { answers: month._count, tokensIn: month._sum.tokensIn ?? 0, tokensOut: month._sum.tokensOut ?? 0 },
      feedback: await prisma.aiMessage.groupBy({ by: ['feedback'], where: { role: 'ASSISTANT', feedback: { not: null } }, _count: true }).then((g) => Object.fromEntries(g.map((x) => [x.feedback, x._count]))),
    }
  }
  res.json(out)
}

let reindexing = false
/** POST /api/metra/admin/reindex — Super Admin: rebuild the company's index now (in the background). */
export async function reindex(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only a Super Admin can do this.' }); return }
  if (!(await on(req, res))) return
  if (reindexing) { res.status(409).json({ error: 'Already re-indexing.' }); return }
  reindexing = true
  const companyId = req.user!.companyId
  void indexNow(companyId).finally(() => { reindexing = false })
  res.status(202).json({ ok: true })
}

/** GET /api/metra/insights — my insights of the last 7 days still open: the shift brief and next steps that passed. */
export async function listInsights(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  // Only the insight kinds: memories (MEMORY) and feedback (FEEDBACK) live in the same table and are not insights.
  const rows = await prisma.aiInsight.findMany({ where: { userId: req.user!.id, kind: { in: ['BRIEF', 'NEXT_STEP'] }, state: 'NEW', createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }], take: 50 })
  res.json({ insights: rows.map((r) => ({ id: r.id, kind: r.kind, day: r.day, title: r.title, payload: r.payload, createdAt: r.createdAt.toISOString() })) })
}

/** PATCH /api/metra/insights/:id { state: DONE | DISMISSED } */
export async function updateInsight(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = z.object({ state: z.enum(['DONE', 'DISMISSED', 'NEW']) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Invalid change' }); return }
  const r = await prisma.aiInsight.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { state: p.data.state } })
  if (!r.count) { res.status(404).json({ error: 'Insight not found' }); return }
  res.json({ ok: true })
}

// ------------------------------------------------------------------ feedback about Metra itself

const feedbackSchema = z.object({ rating: z.enum(['HELPS', 'NEEDS_CHANGES']), text: z.string().trim().max(2000).optional() })
  .refine((v) => v.rating === 'HELPS' || (v.text ?? '').length >= 3, { message: 'Say what should change.' })

/**
 * POST /api/metra/feedback { rating: HELPS | NEEDS_CHANGES, text? } — what a person thinks of Metra as a whole (not one
 * answer: that is the thumbs on each answer). Kept as an AiInsight of kind FEEDBACK; the company's Super Admins are
 * told, and read it under Company settings, Metra.
 */
export async function sendFeedback(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const p = feedbackSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Invalid feedback' }); return }
  const userId = req.user!.id
  const today = new Date().toISOString().slice(0, 10)
  if (await prisma.aiInsight.count({ where: { userId, kind: 'FEEDBACK', day: today } }) >= 10) { res.status(429).json({ error: 'You sent a lot of feedback today. Thank you: more tomorrow.' }); return }
  const text = (p.data.text ?? '').trim()
  const row = await prisma.aiInsight.create({
    data: { userId, kind: 'FEEDBACK', day: today, subjectId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title: p.data.rating === 'HELPS' ? 'Metra helps' : 'Metra needs changes', payload: { rating: p.data.rating, text } },
  })
  const [me, admins] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true, id: { not: userId } }, select: { id: true } }),
  ])
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({ userId: a.id, type: 'AI_INSIGHT' as const, title: `${me?.name ?? 'Someone'} sent feedback on Metra: ${p.data.rating === 'HELPS' ? 'it helps' : 'needs changes'}`, body: text.slice(0, 300), link: '/app/admin/company?tab=metra', entityType: 'AiInsight', entityId: row.id })),
    }).catch(() => undefined) // the feedback is saved either way
  }
  res.status(201).json({ ok: true })
}

/**
 * GET /api/metra/admin/feedback — Super Admin: what people said about Metra, and the answers they rated. For a rated
 * answer the admin sees the person's question and their note, never the answer itself (it may hold things only that
 * person can read).
 */
export async function adminFeedback(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only a Super Admin can do this.' }); return }
  if (!(await on(req, res))) return
  const who = { select: { name: true, department: { select: { name: true } } } }
  const [general, rated] = await Promise.all([
    prisma.aiInsight.findMany({ where: { kind: 'FEEDBACK' }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: who } }),
    prisma.aiMessage.findMany({ where: { role: 'ASSISTANT', feedback: { not: null } }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, feedback: true, feedbackNote: true, tools: true, createdAt: true, conversationId: true, conversation: { select: { user: who } } } }),
  ])
  // The question each rated answer was for: the person's last message before it in that chat.
  const questions = rated.length ? await prisma.aiMessage.findMany({ where: { role: 'USER', conversationId: { in: [...new Set(rated.map((r) => r.conversationId))] } }, orderBy: { createdAt: 'asc' }, select: { conversationId: true, content: true, createdAt: true } }) : []
  const questionFor = (m: { conversationId: string; createdAt: Date }) => questions.filter((q) => q.conversationId === m.conversationId && q.createdAt <= m.createdAt).pop()?.content ?? ''
  res.json({
    general: general.map((g) => {
      const pl = (g.payload ?? {}) as { rating?: string; text?: string }
      return { id: g.id, name: g.user.name, department: g.user.department?.name ?? null, rating: pl.rating === 'HELPS' ? 'HELPS' : 'NEEDS_CHANGES', text: pl.text ?? '', handled: g.state !== 'NEW', createdAt: g.createdAt.toISOString() }
    }),
    answers: rated.map((m) => ({
      id: m.id, name: m.conversation.user.name, department: m.conversation.user.department?.name ?? null, feedback: m.feedback, note: m.feedbackNote ?? '',
      // The question is the person's own: the admin sees it only when they sent a note with it (the app says it goes along).
      question: m.feedbackNote ? questionFor(m).slice(0, 500) : '', tools: (Array.isArray(m.tools) ? (m.tools as { name?: string }[]) : []).map((t) => String(t.name ?? '')).filter(Boolean), createdAt: m.createdAt.toISOString(),
    })),
  })
}

/**
 * GET /api/metra/admin/problems — Super Admin: the answers of the last 14 days that went wrong, newest first, so a
 * failure is seen here and not only when someone complains. A problem is: the answer failed, a lookup failed, Metra
 * said it could not find or read something, or the person marked it not helpful. It shows which lookups ran, with
 * what options, and why one failed; never the question or the answer (those stay the person's own).
 */
export async function adminProblems(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only a Super Admin can do this.' }); return }
  if (!(await on(req, res))) return
  const rows = await prisma.aiMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - 14 * 86400000) } }, orderBy: { createdAt: 'desc' }, take: 1000,
    select: { id: true, content: true, error: true, tools: true, feedback: true, latencyMs: true, model: true, createdAt: true, conversation: { select: { user: { select: { name: true, department: { select: { name: true } } } } } } },
  })
  const problems = rows.flatMap((m) => {
    const tools = (Array.isArray(m.tools) ? m.tools : []) as unknown as ToolUse[]
    const kind = m.error ? 'ERROR' : tools.some((t) => t.ok === false) ? 'LOOKUP_FAILED' : GAVE_UP.test(m.content) ? 'GAVE_UP' : m.feedback === 'DOWN' ? 'NOT_HELPFUL' : null
    if (!kind) return []
    return [{
      id: m.id, kind, name: m.conversation.user.name, department: m.conversation.user.department?.name ?? null, createdAt: m.createdAt.toISOString(),
      error: m.error ? m.error.slice(0, 300) : null, model: m.model, latencyMs: m.latencyMs,
      tools: tools.map((t) => ({ name: String(t.name ?? ''), args: t.args ?? {}, ok: t.ok !== false, ms: t.ms ?? null, error: t.error ? String(t.error).slice(0, 300) : null })),
    }]
  })
  res.json({ answers: rows.length, problems: problems.slice(0, 100), total: problems.length })
}

/** PATCH /api/metra/admin/feedback/:id { handled } — Super Admin: tick a piece of feedback as dealt with. */
export async function setFeedbackHandled(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only a Super Admin can do this.' }); return }
  if (!(await on(req, res))) return
  const p = z.object({ handled: z.boolean() }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Invalid change' }); return }
  const r = await prisma.aiInsight.updateMany({ where: { id: req.params.id, kind: 'FEEDBACK' }, data: { state: p.data.handled ? 'DONE' : 'NEW' } })
  if (!r.count) { res.status(404).json({ error: 'Feedback not found' }); return }
  res.json({ ok: true })
}

/** GET /api/metra/memories — what Metra remembers about me. */
export async function listMemories(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  res.json({ memories: await memoriesOf(req.user!.id) })
}

/** DELETE /api/metra/memories/:id — forget one thing. */
export async function deleteMemory(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await on(req, res))) return
  const r = await forget(req.user!.id, req.params.id)
  res.json({ ok: !r.startsWith('No '), message: r })
}
