// Idempotent importer for historical QA evaluations from the "* QA Recordings"
// spreadsheets. Reads a prepared JSON (meta + records) and creates one
// QaEvaluation (+ category/answer snapshots) per record, back-dated to the call.
//
//   npx tsx src/scripts/importQaEvaluations.ts src/scripts/data/csr-qa.json
//   npx tsx src/scripts/importQaEvaluations.ts src/scripts/data/itad-qa.json
//
// Safe to re-run: a record is skipped if an evaluation already exists for the
// same agent + call reference + call date.
import { readFileSync } from 'node:fs'
import { PrismaClient, type DepartmentType, type QaQuestionType } from '@prisma/client'

const prisma = new PrismaClient()

type Answer = { category: string; text: string; type: QaQuestionType; maxScore: number; score: number | null; isNA: boolean; qnum?: number }
type Category = { name: string; earned: number; maxPossible: number; scorePct: number }
type Record = {
  agentEmail: string
  date: string // ISO
  callref: string
  comments: string
  pct: number
  band: string
  passed: boolean
  categories: Category[]
  answers: Answer[]
}
type Payload = {
  meta: { department: DepartmentType; scorecardName: string; scorecardDept: DepartmentType | null; evaluatorName: string }
  records: Record[]
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: importQaEvaluations.ts <data.json>')
  const { meta, records } = JSON.parse(readFileSync(file, 'utf8')) as Payload

  const dept = await prisma.department.findUnique({ where: { type: meta.department } })
  if (!dept) throw new Error(`Department ${meta.department} not found`)

  const scorecard = await prisma.qaScorecard.findFirst({
    where: { name: meta.scorecardName, departmentType: meta.scorecardDept },
  })
  if (!scorecard) throw new Error(`Scorecard "${meta.scorecardName}" (${meta.scorecardDept ?? 'standard'}) not found — seed it first`)

  const evaluator = await prisma.user.findFirst({
    where: { name: { contains: meta.evaluatorName, mode: 'insensitive' }, role: { in: ['QA', 'QA_LEAD', 'SUPER_ADMIN'] } },
  })
  if (!evaluator) throw new Error(`Evaluator matching "${meta.evaluatorName}" (QA role) not found`)

  // Resolve agent accounts by email (case-insensitive), scoped to the department.
  const users = await prisma.user.findMany({ where: { departmentId: dept.id } })
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]))

  let created = 0,
    skipped = 0
  const unmatched = new Set<string>()

  for (const r of records) {
    const agentId = byEmail.get(r.agentEmail.toLowerCase())
    if (!agentId) {
      unmatched.add(r.agentEmail)
      continue
    }
    const callDate = new Date(r.date)
    const dup = await prisma.qaEvaluation.findFirst({
      where: { agentId, callReference: r.callref || null, callDate },
      select: { id: true },
    })
    if (dup) {
      skipped++
      continue
    }
    await prisma.qaEvaluation.create({
      data: {
        scorecardId: scorecard.id,
        scorecardName: scorecard.name,
        evaluatorId: evaluator.id,
        agentId,
        departmentId: dept.id,
        callReference: r.callref || null,
        callDate,
        status: 'SUBMITTED',
        totalScore: r.pct,
        band: r.band,
        passed: r.passed,
        overallComments: r.comments || null,
        submittedAt: callDate,
        createdAt: callDate,
        categories: {
          create: r.categories.map((c, i) => ({
            name: c.name,
            weight: 0,
            earned: c.earned,
            maxPossible: c.maxPossible,
            scorePct: c.scorePct,
            order: i,
          })),
        },
        answers: {
          create: r.answers.map((a, i) => ({
            categoryName: a.category,
            questionText: a.text,
            type: a.type,
            maxScore: a.maxScore,
            criticalFail: false,
            score: a.isNA ? null : a.score,
            isNA: a.isNA,
            order: a.qnum ?? i,
          })),
        },
      },
    })
    created++
  }

  console.log(`[${meta.department}] created ${created}, skipped ${skipped} (already imported).`)
  if (unmatched.size) console.log(`  ⚠ unmatched agent emails (skipped): ${[...unmatched].join(', ')}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
