import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Prisma, User } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, periodRange, type RangeKey } from '../lib/time'
import { scoreEvaluation, type ScoredCategory } from '../lib/qa'

const UPLOAD_DIR = path.resolve('uploads')
const RECORDING_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

// QA evaluates agents in these departments.
const QA_DEPTS = ['ITAD', 'CSR'] as const

function loadMe(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}
function isQa(role: string): boolean {
  return role === 'QA' || role === 'QA_LEAD' || role === 'SUPER_ADMIN'
}
function isQaLead(role: string): boolean {
  return role === 'QA_LEAD' || role === 'SUPER_ADMIN'
}
function thin(u: Pick<User, 'id' | 'name' | 'email' | 'role'>) {
  return { id: u.id, name: u.name, email: u.email, role: u.role }
}

// ============================ Scorecards (builder) ============================

const questionSchema = z.object({
  text: z.string().min(1).max(300),
  type: z.enum(['RATING', 'YES_NO']).default('RATING'),
  maxScore: z.number().int().min(1).max(100).default(10),
  criticalFail: z.boolean().default(false),
  allowNA: z.boolean().default(true),
})
const categorySchema = z.object({
  name: z.string().min(1).max(120),
  questions: z.array(questionSchema).min(1),
})
const scorecardSchema = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    departmentType: z.enum(['ITAD', 'CSR']).nullable().optional(),
    passThreshold: z.number().min(0).max(100).default(50),
    bandGood: z.number().min(0).max(100).default(64),
    bandExcellent: z.number().min(0).max(100).default(82),
    categories: z.array(categorySchema).min(1),
  })
  .refine((d) => d.passThreshold <= d.bandGood && d.bandGood <= d.bandExcellent, {
    message: 'Thresholds must increase: Acceptable ≤ Good ≤ Excellent',
  })

export async function listScorecards(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const cards = await prisma.qaScorecard.findMany({
    where: { isActive: true },
    include: { _count: { select: { categories: true, evaluations: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({
    scorecards: cards.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      departmentType: c.departmentType,
      passThreshold: c.passThreshold,
      categoryCount: c._count.categories,
      evaluationCount: c._count.evaluations,
    })),
  })
}

export async function getScorecard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const card = await prisma.qaScorecard.findUnique({
    where: { id: req.params.id },
    include: { categories: { orderBy: { order: 'asc' }, include: { questions: { orderBy: { order: 'asc' } } } } },
  })
  if (!card) {
    res.status(404).json({ error: 'Scorecard not found' })
    return
  }
  res.json({ scorecard: serializeScorecard(card) })
}

type ScorecardWithTree = Prisma.QaScorecardGetPayload<{
  include: { categories: { include: { questions: true } } }
}>
function serializeScorecard(c: ScorecardWithTree) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    departmentType: c.departmentType,
    passThreshold: c.passThreshold,
    bandGood: c.bandGood,
    bandExcellent: c.bandExcellent,
    categories: [...c.categories]
      .sort((a, b) => a.order - b.order)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        questions: [...cat.questions]
          .sort((a, b) => a.order - b.order)
          .map((q) => ({ id: q.id, text: q.text, type: q.type, maxScore: q.maxScore, criticalFail: q.criticalFail, allowNA: q.allowNA })),
      })),
  }
}

export async function createScorecard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = scorecardSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const card = await prisma.qaScorecard.create({
    data: {
      name: v.name,
      description: v.description ?? null,
      departmentType: v.departmentType ?? null,
      passThreshold: v.passThreshold,
      bandGood: v.bandGood,
      bandExcellent: v.bandExcellent,
      createdById: me.id,
      categories: {
        create: v.categories.map((c, ci) => ({
          name: c.name,
          order: ci,
          questions: { create: c.questions.map((q, qi) => ({ ...q, order: qi })) },
        })),
      },
    },
    include: { categories: { include: { questions: true } } },
  })
  res.status(201).json({ scorecard: serializeScorecard(card) })
}

export async function updateScorecard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = scorecardSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const card = await prisma.qaScorecard.update({
    where: { id: req.params.id },
    data: {
      name: v.name,
      description: v.description ?? null,
      departmentType: v.departmentType ?? null,
      passThreshold: v.passThreshold,
      bandGood: v.bandGood,
      bandExcellent: v.bandExcellent,
      categories: {
        deleteMany: {}, // replace the whole tree (snapshots protect past evaluations)
        create: v.categories.map((c, ci) => ({
          name: c.name,
          order: ci,
          questions: { create: c.questions.map((q, qi) => ({ ...q, order: qi })) },
        })),
      },
    },
    include: { categories: { include: { questions: true } } },
  })
  res.json({ scorecard: serializeScorecard(card) })
}

export async function archiveScorecard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.qaScorecard.update({ where: { id: req.params.id }, data: { isActive: false } })
  res.status(204).end()
}

// ============================ Agents ============================

/** GET /api/qa/agents?department=ITAD|CSR — roster + QA summary stats.
 *  QA/Admin choose the department; a Team Lead is scoped to their own. */
export async function listAgents(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  let deptType: string
  if (isQa(me.role)) {
    deptType = req.query.department as string
    if (!QA_DEPTS.includes(deptType as (typeof QA_DEPTS)[number])) {
      res.status(400).json({ error: 'department must be ITAD or CSR' })
      return
    }
  } else if (me.role === 'TEAM_LEAD' && me.department && QA_DEPTS.includes(me.department.type as (typeof QA_DEPTS)[number])) {
    deptType = me.department.type
  } else {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const dept = await prisma.department.findUnique({ where: { type: deptType as 'ITAD' | 'CSR' } })
  if (!dept) {
    res.json({ agents: [] })
    return
  }
  const [members, lead] = await Promise.all([
    prisma.user.findMany({ where: { departmentId: dept.id, role: 'MEMBER', isActive: true }, orderBy: { name: 'asc' } }),
    prisma.user.findFirst({ where: { departmentId: dept.id, role: 'TEAM_LEAD', isActive: true }, orderBy: { name: 'asc' } }),
  ])
  const ids = members.map((m) => m.id)
  const evals = await prisma.qaEvaluation.findMany({
    where: { agentId: { in: ids }, status: 'SUBMITTED' },
    select: { agentId: true, totalScore: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const byAgent = new Map<string, { scores: number[]; last?: number }>()
  for (const e of evals) {
    const a = byAgent.get(e.agentId) ?? { scores: [] }
    if (a.last === undefined) a.last = e.totalScore
    a.scores.push(e.totalScore)
    byAgent.set(e.agentId, a)
  }
  res.json({
    department: deptType,
    teamLead: lead ? { id: lead.id, name: lead.name, email: lead.email } : null,
    agents: members.map((m) => {
      const a = byAgent.get(m.id)
      const avg = a && a.scores.length ? a.scores.reduce((s, x) => s + x, 0) / a.scores.length : null
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        evaluations: a?.scores.length ?? 0,
        lastScore: a?.last ?? null,
        avgScore: avg === null ? null : Math.round(avg * 10) / 10,
      }
    }),
  })
}

// ============================ Evaluations ============================

const evalSchema = z.object({
  scorecardId: z.string().min(1),
  agentId: z.string().min(1),
  callReference: z.string().max(120).optional(),
  customerNumber: z.string().max(120).optional(),
  callDate: z.string().optional(),
  recordingAttachmentId: z.string().optional(),
  overallComments: z.string().max(4000).optional(),
  sections: z.array(
    z.object({
      categoryId: z.string(),
      comment: z.string().max(2000).optional(),
      answers: z.array(z.object({ questionId: z.string(), score: z.number().int().min(0).max(100).nullable(), isNA: z.boolean().default(false) })),
    }),
  ),
})

export async function createEvaluation(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const parsed = evalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data

  const agent = await prisma.user.findUnique({ where: { id: v.agentId }, include: { department: true } })
  if (!agent || !agent.department || !QA_DEPTS.includes(agent.department.type as (typeof QA_DEPTS)[number])) {
    res.status(400).json({ error: 'Agent must belong to ITAD or CSR' })
    return
  }
  const card = await prisma.qaScorecard.findUnique({
    where: { id: v.scorecardId },
    include: { categories: { orderBy: { order: 'asc' }, include: { questions: { orderBy: { order: 'asc' } } } } },
  })
  if (!card) {
    res.status(404).json({ error: 'Scorecard not found' })
    return
  }

  // Index answers by questionId, and section comments by categoryId.
  const answerByQ = new Map<string, { score: number | null; isNA: boolean }>()
  const commentByCat = new Map<string, string | undefined>()
  for (const s of v.sections) {
    commentByCat.set(s.categoryId, s.comment)
    for (const a of s.answers) answerByQ.set(a.questionId, { score: a.score, isNA: a.isNA })
  }

  // Build scoring input + snapshot rows from the template.
  const scored: ScoredCategory[] = []
  const categorySnapshots: { name: string; order: number; comment?: string }[] = []
  const answerSnapshots: { categoryName: string; questionText: string; type: 'RATING' | 'YES_NO'; maxScore: number; criticalFail: boolean; score: number | null; isNA: boolean; order: number }[] = []

  card.categories.forEach((cat, ci) => {
    const sQuestions = cat.questions.map((q) => {
      const a = answerByQ.get(q.id) ?? { score: null, isNA: true }
      const isNA = a.isNA || a.score === null
      return { type: q.type as 'RATING' | 'YES_NO', maxScore: q.maxScore, criticalFail: q.criticalFail, score: isNA ? null : a.score, isNA }
    })
    scored.push({ questions: sQuestions })
    categorySnapshots.push({ name: cat.name, order: ci, comment: commentByCat.get(cat.id) })
    cat.questions.forEach((q, qi) => {
      const sq = sQuestions[qi]
      answerSnapshots.push({
        categoryName: cat.name,
        questionText: q.text,
        type: q.type as 'RATING' | 'YES_NO',
        maxScore: q.maxScore,
        criticalFail: q.criticalFail,
        score: sq.isNA ? null : sq.score,
        isNA: sq.isNA,
        order: ci * 100 + qi,
      })
    })
  })

  const result = scoreEvaluation(scored, { passThreshold: card.passThreshold, bandGood: card.bandGood, bandExcellent: card.bandExcellent })

  const created = await prisma.qaEvaluation.create({
    data: {
      scorecardId: card.id,
      scorecardName: card.name,
      evaluatorId: me.id,
      agentId: agent.id,
      departmentId: agent.departmentId,
      callReference: v.callReference ?? null,
      customerNumber: v.customerNumber ?? null,
      callDate: v.callDate ? new Date(v.callDate) : null,
      recordingAttachmentId: v.recordingAttachmentId ?? null,
      status: 'SUBMITTED',
      totalScore: result.totalScore,
      band: result.band,
      passed: result.passed,
      criticalFailTriggered: result.criticalFailTriggered,
      coachingNeeded: !result.passed, // below the Acceptable line
      overallComments: v.overallComments ?? null,
      submittedAt: new Date(),
      categories: {
        create: categorySnapshots.map((c, i) => ({
          name: c.name,
          earned: result.categories[i]?.earned ?? 0,
          maxPossible: result.categories[i]?.maxPossible ?? 0,
          scorePct: result.categories[i]?.scorePct ?? 0,
          comment: c.comment ?? null,
          order: i,
        })),
      },
      answers: { create: answerSnapshots },
    },
  })
  res.status(201).json({ id: created.id, totalScore: created.totalScore, band: created.band, passed: created.passed, criticalFailTriggered: created.criticalFailTriggered })
}

type EvalFull = Prisma.QaEvaluationGetPayload<{
  include: { evaluator: true; agent: true; categories: true; answers: true; recording: true }
}>
function serializeEvaluation(e: EvalFull) {
  return {
    id: e.id,
    scorecardName: e.scorecardName,
    evaluator: thin(e.evaluator),
    agent: thin(e.agent),
    callReference: e.callReference,
    customerNumber: e.customerNumber,
    callDate: e.callDate ? e.callDate.toISOString() : null,
    recording: e.recording ? { id: e.recording.id, name: e.recording.originalName, mimeType: e.recording.mimeType } : null,
    totalScore: e.totalScore,
    band: e.band,
    passed: e.passed,
    criticalFailTriggered: e.criticalFailTriggered,
    coachingNeeded: e.coachingNeeded,
    overallComments: e.overallComments,
    agentAcknowledgedAt: e.agentAcknowledgedAt ? e.agentAcknowledgedAt.toISOString() : null,
    agentRebuttal: e.agentRebuttal,
    createdAt: e.createdAt.toISOString(),
    categories: [...e.categories]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ name: c.name, earned: c.earned, maxPossible: c.maxPossible, scorePct: c.scorePct, comment: c.comment })),
    answers: [...e.answers]
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ categoryName: a.categoryName, questionText: a.questionText, type: a.type, maxScore: a.maxScore, criticalFail: a.criticalFail, score: a.score, isNA: a.isNA })),
  }
}

async function canViewEvaluation(me: Awaited<ReturnType<typeof loadMe>>, e: { agentId: string; evaluatorId: string; departmentId: string | null }): Promise<boolean> {
  if (isQa(me.role)) return true
  if (me.id === e.agentId || me.id === e.evaluatorId) return true
  if (me.role === 'TEAM_LEAD' && me.departmentId && me.departmentId === e.departmentId) return true
  return false
}

export async function getEvaluation(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const e = await prisma.qaEvaluation.findUnique({
    where: { id: req.params.id },
    include: { evaluator: true, agent: true, categories: true, answers: true, recording: true },
  })
  if (!e) {
    res.status(404).json({ error: 'Evaluation not found' })
    return
  }
  if (!(await canViewEvaluation(me, e))) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (me.id === e.agentId && !e.agentReadAt) {
    await prisma.qaEvaluation.update({ where: { id: e.id }, data: { agentReadAt: new Date() } })
  }
  res.json({ evaluation: serializeEvaluation(e) })
}

/** GET /api/qa/evaluations?agentId= — list (summaries) for an agent. */
export async function listEvaluations(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const agentId = req.query.agentId as string | undefined
  let where: Prisma.QaEvaluationWhereInput
  if (agentId) {
    const agent = await prisma.user.findUnique({ where: { id: agentId } })
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    if (!(await canViewEvaluation(me, { agentId, evaluatorId: '', departmentId: agent.departmentId }))) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    where = { agentId, status: 'SUBMITTED' }
  } else if (isQa(me.role)) {
    where = { status: 'SUBMITTED' }
  } else if (me.role === 'TEAM_LEAD' && me.departmentId) {
    where = { departmentId: me.departmentId, status: 'SUBMITTED' } // manager: their team's evaluations
  } else {
    where = { agentId: me.id, status: 'SUBMITTED' }
  }
  const list = await prisma.qaEvaluation.findMany({
    where,
    include: { evaluator: true, agent: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json({ evaluations: list.map(summarizeEvaluation) })
}

/** GET /api/qa/my-evaluations — the caller's own received evaluations. */
export async function myEvaluations(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const list = await prisma.qaEvaluation.findMany({
    where: { agentId: me.id, status: 'SUBMITTED' },
    include: { evaluator: true, agent: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ evaluations: list.map(summarizeEvaluation) })
}

type EvalSummaryRow = Prisma.QaEvaluationGetPayload<{ include: { evaluator: true; agent: true } }>
function summarizeEvaluation(e: EvalSummaryRow) {
  return {
    id: e.id,
    scorecardName: e.scorecardName,
    evaluatorName: e.evaluator.name,
    agentName: e.agent.name,
    agentId: e.agentId,
    totalScore: e.totalScore,
    band: e.band,
    passed: e.passed,
    criticalFailTriggered: e.criticalFailTriggered,
    coachingNeeded: e.coachingNeeded,
    acknowledged: !!e.agentAcknowledgedAt,
    unread: !e.agentReadAt,
    createdAt: e.createdAt.toISOString(),
  }
}

export async function acknowledgeEvaluation(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const e = await prisma.qaEvaluation.findUnique({ where: { id: req.params.id } })
  if (!e) {
    res.status(404).json({ error: 'Evaluation not found' })
    return
  }
  if (e.agentId !== me.id) {
    res.status(403).json({ error: 'Only the evaluated agent can acknowledge' })
    return
  }
  const rebuttal = z.object({ rebuttal: z.string().max(2000).optional() }).safeParse(req.body)
  await prisma.qaEvaluation.update({
    where: { id: e.id },
    data: { agentAcknowledgedAt: new Date(), agentReadAt: e.agentReadAt ?? new Date(), agentRebuttal: rebuttal.success ? rebuttal.data.rebuttal ?? e.agentRebuttal : e.agentRebuttal },
  })
  res.json({ ok: true })
}

/** GET /api/qa/unread-count — agent's unread evaluations (sidebar badge). */
export async function qaUnreadCount(req: AuthedRequest, res: Response): Promise<void> {
  const count = await prisma.qaEvaluation.count({ where: { agentId: req.user!.id, status: 'SUBMITTED', agentReadAt: null } })
  res.json({ count })
}

// ============================ Analytics ============================

export async function qaAnalytics(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  // QA/Admin: any/all department; Team Lead: own department only.
  let departmentId: string | undefined
  const deptType = req.query.department as string | undefined
  if (me.role === 'TEAM_LEAD') {
    if (!me.departmentId) {
      res.status(400).json({ error: 'No department' })
      return
    }
    departmentId = me.departmentId
  } else if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  } else if (deptType && QA_DEPTS.includes(deptType as (typeof QA_DEPTS)[number])) {
    const d = await prisma.department.findUnique({ where: { type: deptType as 'ITAD' | 'CSR' } })
    departmentId = d?.id
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const start = new Date(range.startDate + 'T00:00:00Z')
  const end = new Date(range.endDate + 'T23:59:59Z')

  const evals = await prisma.qaEvaluation.findMany({
    where: { status: 'SUBMITTED', ...(departmentId ? { departmentId } : {}), createdAt: { gte: start, lte: end } },
    include: { agent: true, categories: true },
    orderBy: { createdAt: 'asc' },
  })

  const total = evals.length
  const avgScore = total ? Math.round((evals.reduce((s, e) => s + e.totalScore, 0) / total) * 10) / 10 : 0
  const passCount = evals.filter((e) => e.passed).length

  // Distribution bands (use each evaluation's stored band)
  const bands: Record<string, number> = { Excellent: 0, Good: 0, Acceptable: 0, Unacceptable: 0 }
  for (const e of evals) bands[e.band] = (bands[e.band] ?? 0) + 1

  // Per-agent averages
  const agentMap = new Map<string, { name: string; scores: number[] }>()
  for (const e of evals) {
    const a = agentMap.get(e.agentId) ?? { name: e.agent.name, scores: [] }
    a.scores.push(e.totalScore)
    agentMap.set(e.agentId, a)
  }
  const agents = [...agentMap.values()]
    .map((a) => ({ name: a.name, avg: Math.round((a.scores.reduce((s, x) => s + x, 0) / a.scores.length) * 10) / 10, count: a.scores.length }))
    .sort((a, b) => b.avg - a.avg)

  // Per-category averages
  const catMap = new Map<string, number[]>()
  for (const e of evals) for (const c of e.categories) {
    const arr = catMap.get(c.name) ?? []
    arr.push(c.scorePct)
    catMap.set(c.name, arr)
  }
  const categories = [...catMap.entries()].map(([name, arr]) => ({ name, avg: Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 }))

  // Trend (per-week average)
  const trendMap = new Map<string, { label: string; scores: number[] }>()
  for (const e of evals) {
    const wk = DateTime.fromJSDate(e.createdAt, { zone: 'utc' }).startOf('week')
    const key = wk.toISODate()!
    const t = trendMap.get(key) ?? { label: wk.toFormat('LLL d'), scores: [] }
    t.scores.push(e.totalScore)
    trendMap.set(key, t)
  }
  const trend = [...trendMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, t]) => ({ label: t.label, value: Math.round((t.scores.reduce((s, x) => s + x, 0) / t.scores.length) * 10) / 10 }))

  res.json({
    range: { ...range, key: rangeKey },
    totals: { evaluations: total, avgScore, passRate: total ? Math.round((passCount / total) * 1000) / 10 : 0 },
    distribution: Object.entries(bands).map(([name, value]) => ({ name, value })),
    passFail: [{ name: 'Pass', value: passCount }, { name: 'Fail', value: total - passCount }],
    agents,
    categories,
    trend,
  })
}

// ============================ Employee of the Month ============================

/** GET /api/qa/employee-of-month?month=YYYY-MM — per-department winner by avg QA score. */
export async function employeeOfMonth(req: AuthedRequest, res: Response): Promise<void> {
  const monthStr = (req.query.month as string) || companyToday().slice(0, 7)
  const start = DateTime.fromISO(monthStr + '-01', { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  const MIN_EVALS = 3

  const evals = await prisma.qaEvaluation.findMany({
    where: { status: 'SUBMITTED', createdAt: { gte: start.toJSDate(), lte: end.toJSDate() }, department: { type: { in: ['ITAD', 'CSR'] } } },
    include: { agent: true, department: true },
  })

  const byDeptAgent = new Map<string, Map<string, { name: string; scores: number[] }>>()
  for (const e of evals) {
    const dt = e.department!.type
    if (!byDeptAgent.has(dt)) byDeptAgent.set(dt, new Map())
    const am = byDeptAgent.get(dt)!
    const a = am.get(e.agentId) ?? { name: e.agent.name, scores: [] }
    a.scores.push(e.totalScore)
    am.set(e.agentId, a)
  }

  const winners = QA_DEPTS.map((dept) => {
    const am = byDeptAgent.get(dept)
    if (!am) return { department: dept, winner: null }
    let best: { name: string; avg: number; count: number } | null = null
    for (const a of am.values()) {
      if (a.scores.length < MIN_EVALS) continue
      const avg = a.scores.reduce((s, x) => s + x, 0) / a.scores.length
      if (!best || avg > best.avg) best = { name: a.name, avg: Math.round(avg * 10) / 10, count: a.scores.length }
    }
    return { department: dept, winner: best }
  })

  res.json({ month: monthStr, minEvaluations: MIN_EVALS, winners })
}

// ============================ QA team (QA-lead oversight) ============================

/** GET /api/qa/evaluators — the QA team and each evaluator's productivity. QA-lead/Admin. */
export async function listEvaluators(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQaLead(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const people = await prisma.user.findMany({
    where: { role: { in: ['QA', 'QA_LEAD'] }, isActive: true },
    orderBy: { name: 'asc' },
  })
  const ids = people.map((p) => p.id)
  const evals = await prisma.qaEvaluation.findMany({
    where: { evaluatorId: { in: ids }, status: 'SUBMITTED' },
    select: { evaluatorId: true, totalScore: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const byEval = new Map<string, { scoresGiven: number[]; last?: Date }>()
  for (const e of evals) {
    const a = byEval.get(e.evaluatorId) ?? { scoresGiven: [] }
    if (!a.last) a.last = e.createdAt
    a.scoresGiven.push(e.totalScore)
    byEval.set(e.evaluatorId, a)
  }
  res.json({
    evaluators: people.map((p) => {
      const a = byEval.get(p.id)
      const avgGiven = a && a.scoresGiven.length ? Math.round((a.scoresGiven.reduce((s, x) => s + x, 0) / a.scoresGiven.length) * 10) / 10 : null
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        completed: a?.scoresGiven.length ?? 0,
        avgScoreGiven: avgGiven,
        lastActivity: a?.last ? a.last.toISOString() : null,
      }
    }),
  })
}

// ============================ Call recordings ============================

/** POST /api/qa/recordings — QA uploads an audio recording (raw binary body). */
export async function uploadRecording(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    res.status(400).json({ error: 'No file received' })
    return
  }
  if (buf.length > RECORDING_MAX_BYTES) {
    res.status(413).json({ error: 'Recording is larger than 50 MB' })
    return
  }
  const mime = req.headers['content-type'] || 'application/octet-stream'
  if (!mime.startsWith('audio/')) {
    res.status(415).json({ error: 'Only audio recordings are allowed' })
    return
  }
  const originalName = String(req.query.name || 'recording').slice(0, 200).replace(/[\r\n]/g, '').trim() || 'recording'
  const ext = path.extname(originalName).replace('.', '').toLowerCase()
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)
  const row = await prisma.entryAttachment.create({
    data: { userId: me.id, kind: 'QA_RECORDING', date: dbDateFromString(companyToday()), storedName, originalName, mimeType: mime, size: buf.length },
  })
  res.status(201).json({ attachmentId: row.id, name: row.originalName, downloadUrl: `/api/qa/recordings/${row.id}` })
}

/** GET /api/qa/recordings/:id — streams audio inline for QA/uploader/evaluation participants. */
export async function downloadRecording(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const att = await prisma.entryAttachment.findUnique({ where: { id: req.params.id } })
  if (!att || att.kind !== 'QA_RECORDING') {
    res.status(404).json({ error: 'Recording not found' })
    return
  }
  let allowed = isQa(me.role) || att.userId === me.id
  if (!allowed) {
    const ev = await prisma.qaEvaluation.findUnique({ where: { recordingAttachmentId: att.id } })
    if (ev) allowed = await canViewEvaluation(me, ev)
  }
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const filePath = path.join(UPLOAD_DIR, att.storedName)
  try {
    await fs.access(filePath)
  } catch {
    res.status(404).json({ error: 'File missing on server' })
    return
  }
  res.setHeader('Content-Type', att.mimeType)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.originalName)}"`)
  res.sendFile(filePath)
}
