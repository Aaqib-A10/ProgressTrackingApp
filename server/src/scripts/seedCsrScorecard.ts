// Idempotent: create (or refresh) the CSR "Call Quality Monitoring Form" scorecard.
//   npx tsx src/scripts/seedCsrScorecard.ts
// Q1–10 are YES/NO (1 pt each), Q11–20 are 1–10 ratings. Bands 50/64/82.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const NAME = 'Call Quality Monitoring Form'

const Y = (text: string) => ({ text, type: 'YES_NO' as const, maxScore: 1, criticalFail: false, allowNA: true })
const R = (text: string) => ({ text, type: 'RATING' as const, maxScore: 10, criticalFail: false, allowNA: true })

const categories = [
  { name: 'Greeting', questions: [
    Y('Professional Greeting Used?'), Y('Active Listening/Engagement'), Y('Maintained Professionalism'),
    Y('Appropriate Tone Used'), Y('Tone Confidence/Engagement'),
  ] },
  { name: 'Handling Contact', questions: [
    Y('Avoided Technical Jargon'), Y('Used Effective Questioning'), Y('Was the Core Issue Identified'),
    Y('Was the Root Cause Explained'), Y('Product Expertise Shown'),
  ] },
  { name: 'Solution Information', questions: [
    R('Was Troubleshooting done properly without providing Replacement'), R('Rebuttals/Objection Handling of the agent'),
  ] },
  { name: 'Notifications', questions: [
    R('Did the agent demonstrate Active Listening'), R('Agent sounded friendly, polite and welcoming'),
  ] },
  { name: 'Telephony skills', questions: [
    R('Agent avoided long silences during the call'), R('Correct procedures followed for placing a customer on hold'),
  ] },
  { name: 'Soft skills', questions: [
    R('Was the final resolution provided clear and confirmed?'), R('Was the transition from "problem" to "solution" smooth?'),
  ] },
  { name: 'End call', questions: [
    R('Did the agent avoid misleading statements?'), R('Did the agent ask if there was anything else they could assist with?'),
  ] },
]

async function main() {
  const existing = await prisma.qaScorecard.findFirst({ where: { name: NAME, departmentType: 'CSR' } })
  const data = {
    name: NAME,
    description: 'CSR call-quality scorecard',
    departmentType: 'CSR' as const,
    passThreshold: 50,
    bandGood: 64,
    bandExcellent: 82,
    isActive: true,
    categories: {
      create: categories.map((c, ci) => ({
        name: c.name,
        order: ci,
        questions: { create: c.questions.map((q, qi) => ({ ...q, order: qi })) },
      })),
    },
  }

  if (existing) {
    // Replace the category tree (snapshots protect past evaluations).
    await prisma.qaScorecard.update({
      where: { id: existing.id },
      data: { ...data, categories: { deleteMany: {}, ...data.categories } },
    })
    console.log('Updated existing CSR scorecard:', existing.id)
  } else {
    const c = await prisma.qaScorecard.create({ data, include: { categories: { include: { questions: true } } } })
    console.log('Created CSR scorecard:', c.id, '| categories:', c.categories.length, '| questions:', c.categories.reduce((s, x) => s + x.questions.length, 0))
  }
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
