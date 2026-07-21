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
  // The Team Lead is evaluable too (TLs still take calls), so include them in the roster —
  // not just MEMBERs — otherwise a CSR/ITAD Team Lead can never be scored.
  const members = await prisma.user.findMany({
    where: { departmentId: dept.id, role: { in: ['MEMBER', 'TEAM_LEAD'] }, isActive: true },
    orderBy: { name: 'asc' },
  })
  const lead = members.find((m) => m.role === 'TEAM_LEAD') ?? null
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
  include: { evaluator: true; agent: true; categories: true; answers: true; recording: true; scorecard: true }
}>
function serializeEvaluation(e: EvalFull, canEdit: boolean) {
  const bands = e.scorecard
    ? { passThreshold: e.scorecard.passThreshold, bandGood: e.scorecard.bandGood, bandExcellent: e.scorecard.bandExcellent }
    : { passThreshold: 50, bandGood: 64, bandExcellent: 82 }
  return {
    id: e.id,
    scorecardId: e.scorecardId,
    scorecardName: e.scorecardName,
    bands,
    canEdit,
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
      .map((a) => ({ order: a.order, categoryName: a.categoryName, questionText: a.questionText, type: a.type, maxScore: a.maxScore, criticalFail: a.criticalFail, score: a.score, isNA: a.isNA })),
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
    include: { evaluator: true, agent: true, categories: true, answers: true, recording: true, scorecard: true },
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
  const canEdit = isQaLead(me.role) || e.evaluatorId === me.id
  res.json({ evaluation: serializeEvaluation(e, canEdit) })
}

const updateEvalSchema = z.object({
  callReference: z.string().max(120).nullable().optional(),
  customerNumber: z.string().max(120).nullable().optional(),
  callDate: z.string().nullable().optional(),
  recordingAttachmentId: z.string().nullable().optional(),
  overallComments: z.string().max(4000).nullable().optional(),
  sectionComments: z.array(z.object({ name: z.string(), comment: z.string().max(2000).nullable().optional() })).optional(),
  answers: z.array(z.object({ order: z.number().int(), score: z.number().int().min(0).max(100).nullable(), isNA: z.boolean() })),
})

/** PUT /api/qa/evaluations/:id — the evaluator (or QA-lead/admin) edits a submitted evaluation. */
export async function updateEvaluation(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const e = await prisma.qaEvaluation.findUnique({
    where: { id: req.params.id },
    include: { categories: true, answers: true, scorecard: true },
  })
  if (!e) {
    res.status(404).json({ error: 'Evaluation not found' })
    return
  }
  if (!(isQaLead(me.role) || e.evaluatorId === me.id)) {
    res.status(403).json({ error: 'Only the evaluator can edit this evaluation' })
    return
  }
  const parsed = updateEvalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data

  // If a (new) call recording is being attached, verify it's a real QA recording
  // and isn't already bound to a different evaluation (recordingAttachmentId is @unique).
  if (v.recordingAttachmentId) {
    const att = await prisma.entryAttachment.findUnique({ where: { id: v.recordingAttachmentId } })
    if (!att || att.kind !== 'QA_RECORDING') {
      res.status(400).json({ error: 'Recording not found' })
      return
    }
    const owner = await prisma.qaEvaluation.findUnique({ where: { recordingAttachmentId: v.recordingAttachmentId }, select: { id: true } })
    if (owner && owner.id !== e.id) {
      res.status(400).json({ error: 'That recording is already attached to another evaluation' })
      return
    }
  }

  // Re-score from the (immutable) answer snapshots + the submitted scores, grouped by category.
  const newByOrder = new Map(v.answers.map((a) => [a.order, a]))
  const answersSorted = [...e.answers].sort((a, b) => a.order - b.order)
  const catIndexList = [...new Set(answersSorted.map((a) => Math.floor(a.order / 100)))].sort((a, b) => a - b)
  const scored: ScoredCategory[] = []
  const answerUpdates: { id: string; score: number | null; isNA: boolean }[] = []
  for (const ci of catIndexList) {
    const qs = answersSorted.filter((a) => Math.floor(a.order / 100) === ci)
    const sQuestions = qs.map((a) => {
      const upd = newByOrder.get(a.order)
      const isNA = upd ? upd.isNA || upd.score === null : a.isNA
      const score = isNA ? null : upd ? upd.score : a.score
      answerUpdates.push({ id: a.id, score, isNA })
      return { type: a.type as 'RATING' | 'YES_NO', maxScore: a.maxScore, criticalFail: a.criticalFail, score, isNA }
    })
    scored.push({ questions: sQuestions })
  }
  const bands = e.scorecard
    ? { passThreshold: e.scorecard.passThreshold, bandGood: e.scorecard.bandGood, bandExcellent: e.scorecard.bandExcellent }
    : { passThreshold: 50, bandGood: 64, bandExcellent: 82 }
  const result = scoreEvaluation(scored, bands)

  const commentByName = new Map((v.sectionComments ?? []).map((s) => [s.name, s.comment ?? null]))
  const catRows = [...e.categories].sort((a, b) => a.order - b.order)

  await prisma.$transaction([
    ...answerUpdates.map((u) => prisma.qaAnswer.update({ where: { id: u.id }, data: { score: u.score, isNA: u.isNA } })),
    ...catRows.map((c, i) =>
      prisma.qaEvaluationCategory.update({
        where: { id: c.id },
        data: {
          earned: result.categories[i]?.earned ?? 0,
          maxPossible: result.categories[i]?.maxPossible ?? 0,
          scorePct: result.categories[i]?.scorePct ?? 0,
          comment: commentByName.has(c.name) ? commentByName.get(c.name)! : c.comment,
        },
      }),
    ),
    prisma.qaEvaluation.update({
      where: { id: e.id },
      data: {
        callReference: v.callReference !== undefined ? v.callReference : e.callReference,
        customerNumber: v.customerNumber !== undefined ? v.customerNumber : e.customerNumber,
        callDate: v.callDate !== undefined ? (v.callDate ? new Date(v.callDate) : null) : e.callDate,
        recordingAttachmentId: v.recordingAttachmentId !== undefined ? v.recordingAttachmentId : e.recordingAttachmentId,
        overallComments: v.overallComments !== undefined ? v.overallComments : e.overallComments,
        totalScore: result.totalScore,
        band: result.band,
        passed: result.passed,
        criticalFailTriggered: result.criticalFailTriggered,
        coachingNeeded: !result.passed,
        agentReadAt: null, // re-notify the agent that the review changed
      },
    }),
  ])
  res.json({ id: e.id, totalScore: result.totalScore, band: result.band, passed: result.passed, criticalFailTriggered: result.criticalFailTriggered })
}

/** GET /api/qa/agents/:id/activity — the agent's call activity (ITAD daily logs) this week & month. */
export async function agentActivity(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  const agent = await prisma.user.findUnique({ where: { id: req.params.id }, include: { department: true } })
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const allowed = isQa(me.role) || (me.role === 'TEAM_LEAD' && me.departmentId && me.departmentId === agent.departmentId) || me.id === agent.id
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const deptType = agent.department?.type ?? null
  // Call activity comes from ITAD daily logs; CSR has no daily form yet.
  if (deptType !== 'ITAD') {
    res.json({ hasData: false, department: deptType, periods: [] })
    return
  }
  const defs: { key: RangeKey; label: string }[] = [
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
  ]
  const periods = []
  for (const d of defs) {
    const r = periodRange(d.key, {})
    const entries = await prisma.itadDailyEntry.findMany({
      where: { userId: agent.id, status: 'SUBMITTED', date: { gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) } },
    })
    const sum = (f: 'callsDialed' | 'connected' | 'voicemail' | 'emailsSent' | 'interested' | 'closed' | 'rfqs') =>
      entries.reduce((s, e) => s + (e[f] as number), 0)
    periods.push({
      key: d.key,
      label: d.label,
      startDate: r.startDate,
      endDate: r.endDate,
      daysLogged: entries.length,
      callsDialed: sum('callsDialed'),
      connected: sum('connected'),
      voicemail: sum('voicemail'),
      emailsSent: sum('emailsSent'),
      interested: sum('interested'),
      closed: sum('closed'),
      rfqs: sum('rfqs'),
    })
  }
  res.json({ hasData: true, department: deptType, periods })
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

// ============================ Team Lead QA dashboard ============================

const QA_EXCELLENT = 82
const QA_GOOD = 64
const QA_TARGET = 82 // category gap target
const round1 = (n: number) => Math.round(n * 10) / 10
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
function qaInitials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
function qaFlag(avg: number): 'good' | 'warn' | 'coach' {
  return avg >= QA_EXCELLENT ? 'good' : avg >= QA_GOOD ? 'warn' : 'coach'
}

/** GET /api/qa/team-dashboard?department=ITAD|CSR&range=&start=&end=
 *  Rich per-agent QA analytics for the Team Lead view (ranking, categories, weekly trend, heatmap). */
export async function qaTeamDashboard(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadMe(req.user!.id)
  // RBAC: Team Lead → own department; QA/Admin → any (or all) department.
  let departmentId: string | undefined
  let deptType = req.query.department as string | undefined
  if (me.role === 'TEAM_LEAD') {
    if (!me.departmentId) { res.status(400).json({ error: 'No department' }); return }
    departmentId = me.departmentId
    deptType = me.department?.type
  } else if (!isQa(me.role)) {
    res.status(403).json({ error: 'Forbidden' }); return
  } else if (deptType && QA_DEPTS.includes(deptType as (typeof QA_DEPTS)[number])) {
    const d = await prisma.department.findUnique({ where: { type: deptType as 'ITAD' | 'CSR' } })
    departmentId = d?.id
  }

  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  const range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  const start = new Date(range.startDate + 'T00:00:00Z')
  const end = new Date(range.endDate + 'T23:59:59Z')

  const [teamLead, evals] = await Promise.all([
    departmentId
      ? prisma.user.findFirst({ where: { departmentId, role: 'TEAM_LEAD', isActive: true }, select: { id: true, name: true } })
      : Promise.resolve(null),
    prisma.qaEvaluation.findMany({
      where: { status: 'SUBMITTED', ...(departmentId ? { departmentId } : {}), createdAt: { gte: start, lte: end } },
      include: { agent: { select: { id: true, name: true } }, categories: { select: { name: true, scorePct: true, order: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Categories must come from ONE scorecard, else mixed forms produce apples-to-oranges
  // columns. Lock onto the dominant scorecard in the period (by evaluation count).
  const scCount = new Map<string, number>()
  for (const e of evals) scCount.set(e.scorecardName, (scCount.get(e.scorecardName) ?? 0) + 1)
  const primaryScorecard = [...scCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const catEvals = evals.filter((e) => e.scorecardName === primaryScorecard)

  // Canonical category column order (lowest order wins), from the primary scorecard only.
  const catOrder = new Map<string, number>()
  for (const e of catEvals) for (const c of e.categories) {
    if (!catOrder.has(c.name) || c.order < catOrder.get(c.name)!) catOrder.set(c.name, c.order)
  }
  const categoryNames = [...catOrder.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n)

  // Per-agent aggregation. Scores/pass/fail span ALL evals; category cells only the
  // primary scorecard (so heatmap/breakdown columns line up).
  interface Agg { id: string; name: string; scores: number[]; pass: number; fail: number; cats: Map<string, number[]> }
  const byAgent = new Map<string, Agg>()
  for (const e of evals) {
    let a = byAgent.get(e.agentId)
    if (!a) { a = { id: e.agentId, name: e.agent.name, scores: [], pass: 0, fail: 0, cats: new Map() }; byAgent.set(e.agentId, a) }
    a.scores.push(e.totalScore)
    if (e.passed) a.pass++; else a.fail++
  }
  for (const e of catEvals) {
    const a = byAgent.get(e.agentId)!
    for (const c of e.categories) (a.cats.get(c.name) ?? a.cats.set(c.name, []).get(c.name)!).push(c.scorePct)
  }

  const agents = [...byAgent.values()]
    .map((a) => {
      const avg = round1(mean(a.scores))
      const cats: Record<string, number> = {}
      for (const [name, arr] of a.cats) cats[name] = Math.round(mean(arr))
      return { id: a.id, name: a.name, initials: qaInitials(a.name), avg, evals: a.scores.length, passCalls: a.pass, failCalls: a.fail, cats, flag: qaFlag(avg) }
    })
    .sort((x, y) => y.avg - x.avg)

  // Team category averages + gap-to-target + weakest agent per category.
  const categories = categoryNames.map((name) => {
    const all = catEvals.flatMap((e) => e.categories.filter((c) => c.name === name).map((c) => c.scorePct))
    return { name, avg: Math.round(mean(all)) }
  })
  const catGap = categoryNames.map((name) => {
    const avg = categories.find((c) => c.name === name)!.avg
    let weakest: { name: string; score: number } | null = null
    for (const a of agents) {
      if (a.cats[name] === undefined) continue
      if (!weakest || a.cats[name] < weakest.score) weakest = { name: a.name, score: a.cats[name] }
    }
    return { name, avg, gap: avg - QA_TARGET, weakest }
  })

  // Weekly per-agent trend.
  const weekMap = new Map<string, { label: string; perAgent: Map<string, number[]> }>()
  for (const e of evals) {
    const wk = DateTime.fromJSDate(e.createdAt, { zone: 'utc' }).startOf('week')
    const key = wk.toISODate()!
    let w = weekMap.get(key)
    if (!w) { w = { label: 'W/c ' + wk.toFormat('LLL d'), perAgent: new Map() }; weekMap.set(key, w) }
    ;(w.perAgent.get(e.agent.name) ?? w.perAgent.set(e.agent.name, []).get(e.agent.name)!).push(e.totalScore)
  }
  const weekly = [...weekMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, w]) => ({
    week: w.label,
    scores: Object.fromEntries([...w.perAgent.entries()].map(([n, arr]) => [n, Math.round(mean(arr))])),
  }))

  // Distributions (agent-level).
  const qualityDistribution = [
    { band: 'Excellent', count: agents.filter((a) => a.avg >= QA_EXCELLENT).length },
    { band: 'Watch', count: agents.filter((a) => a.avg >= QA_GOOD && a.avg < QA_EXCELLENT).length },
    { band: 'Coach', count: agents.filter((a) => a.avg < QA_GOOD).length },
  ]
  const scoreBands = [
    { label: 'Unacceptable (<50%)', count: agents.filter((a) => a.avg < 50).length },
    { label: 'Acceptable (50–63%)', count: agents.filter((a) => a.avg >= 50 && a.avg < 64).length },
    { label: 'Good (64–81%)', count: agents.filter((a) => a.avg >= 64 && a.avg < 82).length },
    { label: 'Excellent (82%+)', count: agents.filter((a) => a.avg >= 82).length },
  ]

  const totalEvals = evals.length
  const totalPass = evals.filter((e) => e.passed).length
  const avgScore = round1(mean(evals.map((e) => e.totalScore)))

  res.json({
    range: { ...range, key: rangeKey },
    department: deptType ?? 'All',
    teamLead,
    scorecard: primaryScorecard,
    bands: { good: QA_GOOD, excellent: QA_EXCELLENT, target: QA_TARGET },
    totals: {
      evaluations: totalEvals,
      avgScore,
      passRate: totalEvals ? Math.round((totalPass / totalEvals) * 1000) / 10 : 0,
      coachingCount: agents.filter((a) => a.avg < QA_GOOD).length,
      topPerformer: agents.length ? { name: agents[0].name, avg: agents[0].avg } : null,
      agentCount: agents.length,
    },
    qualityDistribution,
    scoreBands,
    passFail: { pass: totalPass, fail: totalEvals - totalPass },
    categoryNames,
    categories,
    catGap,
    agents,
    weekly,
  })
}

// ============================ Top Achiever ============================

/** GET /api/qa/employee-of-month?month=YYYY-MM — per-department winner by avg QA score. */
export async function employeeOfMonth(req: AuthedRequest, res: Response): Promise<void> {
  const monthStr = (req.query.month as string) || companyToday().slice(0, 7)
  const start = DateTime.fromISO(monthStr + '-01', { zone: 'utc' }).startOf('month')
  const end = start.endOf('month')
  const MIN_EVALS = 3
  const MIN_SCORE = 80 // Top Achiever benchmark: only agents averaging >= 80% qualify.

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
    // Apply the Top Achiever benchmark: a leading agent below MIN_SCORE doesn't qualify,
    // but we still surface their score so the UI can explain why there's no achiever.
    if (best && best.avg < MIN_SCORE) return { department: dept, winner: null, topScore: best.avg }
    return { department: dept, winner: best }
  })

  res.json({ month: monthStr, minEvaluations: MIN_EVALS, minScore: MIN_SCORE, winners })
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
