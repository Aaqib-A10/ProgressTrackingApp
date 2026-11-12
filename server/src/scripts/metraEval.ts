import { prisma } from '../lib/prisma'
import { runAsCompany } from '../lib/tenancy'
import { HOME_COMPANY_ID } from '../lib/company'
import { askerOf } from '../lib/metra/access'
import { searchMetriq } from '../lib/metra/search'
import { indexNow } from '../lib/metra/indexer'
import { answer } from '../lib/metra/agent'
import { llmReady } from '../lib/metra/llm'
import { embedStatus } from '../lib/metra/embed'
import { demoPeople } from './metraDemo'

/**
 * Metra's evaluation (docs/metra/DESIGN.md §8), over the demo records (src/scripts/metraDemo.ts). Run it before and
 * after any change to prompts, models or retrieval settings:
 *
 *   npx tsx src/scripts/metraEval.ts             retrieval: hit@5, MRR, and access (must-not-see) checks
 *   npx tsx src/scripts/metraEval.ts --answers   also full answers from the model (needs GROQ_API_KEY), checked for
 *                                                 the expected facts and for "not found" where nothing should be found
 */

type Who = 'agent' | 'other' | 'lead' | 'leadgen' | 'admin'
interface Case { who: Who; q: string; expect?: string[]; mustNot?: string[]; notFound?: boolean }

const CASES: Case[] = [
  { who: 'agent', q: 'What did the CFO at Acme say?', expect: ['400 laptops'] },
  { who: 'agent', q: 'how many servers does Acme have to retire', expect: ['60 servers'] },
  { who: 'agent', q: 'Who is interested in shredding hard drives?', expect: ['Birch'] },
  { who: 'agent', q: 'Which client has a contract ending in December?', expect: ['SafeShred'] },
  { who: 'agent', q: 'what is the new daily dial target', expect: ['120'] },
  { who: 'agent', q: 'who did lead gen find at Acme procurement', expect: ['Raj Mehta'] },
  { who: 'agent', q: 'certificate template task', expect: ['NIST'] },
  { who: 'agent', q: 'my appraisal', expect: ['appraisal'] },
  { who: 'agent', q: 'Acme warehouse move', expect: ['Plano'] },
  // Must not see.
  { who: 'agent', q: 'Delta Bank pricing per pound', mustNot: ['4.50'] },
  { who: 'lead', q: 'surprise party offsite', mustNot: ['surprise party'] },
  { who: 'admin', q: 'surprise party offsite', mustNot: ['surprise party'] },
  { who: 'lead', q: 'appraisal self-review', mustNot: ['appraisal'] },
  { who: 'leadgen', q: 'Acme CFO laptops quote', mustNot: ['400 laptops'] },
  { who: 'other', q: 'Acme CFO laptops quote', mustNot: ['400 laptops'] },
  // Can see (team lead over their team, people in the DM).
  { who: 'lead', q: 'Acme CFO laptops quote', expect: ['400 laptops'] },
  { who: 'leadgen', q: 'surprise party', expect: ['surprise party'] },
  // Nothing to find.
  { who: 'agent', q: 'What is the weather on Mars?', notFound: true },
]

async function main() {
  const withAnswers = process.argv.includes('--answers')
  const companyId = process.env.METRA_DEMO_COMPANY || HOME_COMPANY_ID
  await runAsCompany(companyId, async () => {
    const p = await demoPeople()
    console.log(`Embedding: ${JSON.stringify(embedStatus())}. Indexing...`)
    await indexNow(companyId)
    let hits = 0, rr = 0, positives = 0, leaks = 0, checks = 0, answered = 0, answerOk = 0
    for (const c of CASES) {
      const asker = await askerOf(p[c.who].id)
      const found = await searchMetriq(asker, c.q, { k: 5 })
      const texts = found.map((h) => h.chunk.text)
      let line = `${c.who.padEnd(7)} ${c.q.padEnd(48)} `
      if (c.expect) {
        positives++
        const rank = texts.findIndex((t) => c.expect!.every((e) => t.toLowerCase().includes(e.toLowerCase())))
        if (rank >= 0) { hits++; rr += 1 / (rank + 1) }
        line += rank >= 0 ? `found at #${rank + 1}` : 'MISSED'
      }
      if (c.mustNot) {
        checks++
        const leaked = texts.some((t) => c.mustNot!.some((m) => t.toLowerCase().includes(m.toLowerCase())))
        if (leaked) leaks++
        line += leaked ? 'LEAK!' : 'not shown (correct)'
      }
      if (c.notFound) line += found.length ? `${found.length} weak hits` : 'nothing (correct)'
      if (withAnswers && llmReady() && (c.expect || c.notFound)) {
        answered++
        const r = await answer(asker, [], c.q, () => undefined)
        const ok = c.notFound ? /couldn.t find|not find|no .*(record|data)/i.test(r.content) : c.expect!.every((e) => r.content.toLowerCase().includes(e.toLowerCase()))
        if (ok) answerOk++
        line += ` | answer ${ok ? 'OK' : 'CHECK'}: ${r.content.replace(/\s+/g, ' ').slice(0, 110)}`
      }
      console.log(line)
    }
    console.log(`\nRetrieval: hit@5 ${hits}/${positives} (${Math.round((hits / positives) * 100)}%), MRR ${(rr / positives).toFixed(2)}`)
    console.log(`Access: ${checks - leaks}/${checks} must-not-see checks held${leaks ? `  <-- ${leaks} LEAK(S): fix before shipping` : ''}`)
    if (withAnswers) console.log(llmReady() ? `Answers: ${answerOk}/${answered} contained the expected facts` : 'Answers: skipped (no GROQ_API_KEY)')
    if (leaks) process.exitCode = 1
  })
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
