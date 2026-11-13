import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * How good is Metra's search, measured (docs/metra/DESIGN.md §8). It answers three questions with numbers:
 *
 *   1. Does the right record come back?  For a sample of real indexed records, a question that the record answers is
 *      written by the model (once, then kept in server/.cache/metra-bench.json so runs compare), and each search
 *      set-up is asked it: hit@1, hit@5, hit@8 (what the model is shown), MRR, and whether the record was among the
 *      candidates at all (so a miss is known to be a finding problem or a ranking problem).
 *   2. Which part earns its keep?  Meaning only (vectors), words only (BM25), both merged, both + the re-ranker
 *      (what runs live), and a wider re-rank.
 *   3. How fast, and how much memory, at this size (and what that means at 10x).
 *
 *   npm run metra:bench -w server -- --erp                  on your PC: 12 records per source
 *   npm run metra:bench -w server -- --erp --total 1000     on your PC: up to 1,000 questions
 *   npx tsx src/scripts/metraBench.ts --live --as you@company.com --total 1000     on the live server
 *
 * --live reads the live index and changes nothing in the database (it never re-indexes there); it only writes its
 * questions to server/.cache/metra-bench.json. It prints totals only; add --misses to also see the questions it got
 * wrong (those lines contain record titles). It asks as the account given with --as (default: the test Super Admin),
 * so it measures what that person can read: private chats and DMs of others are never in it.
 */

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const url = process.env.DATABASE_URL ?? ''
const LIVE = flag('--live')
if (!LIVE && !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) { console.error('metra:bench runs on a database on this computer. On the live server add --live (read-only).'); process.exit(1) }
if (flag('--erp') && !LIVE) process.env.DATABASE_URL = url.replace(/\/[^/?]+(\?|$)/, '/pulsetrack_erp$1')

const OFF_TOPIC = ['Who won the football world cup in 2018?', 'What is the boiling point of mercury?', 'Recipe for chicken biryani', 'Explain how a transformer neural network works', 'What is the capital of Australia?', 'Best laptop to buy for gaming this year', 'How do I renew my passport?', 'Translate good morning into French']

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { runAsCompany } = await import('../lib/tenancy')
  const { HOME_COMPANY_ID } = await import('../lib/company')
  const { askerOf, canRead } = await import('../lib/metra/access')
  const { indexOf } = await import('../lib/metra/store')
  const { indexNow } = await import('../lib/metra/indexer')
  const { embedQuery, rerank, tokens, embedStatus } = await import('../lib/metra/embed')
  const { searchMetriq } = await import('../lib/metra/search')
  const { completeText, llmReady } = await import('../lib/metra/llm')
  const { SOURCE_BY_TYPE } = await import('../lib/metra/sources')

  const email = opt('--as') ?? 'admin@test.local'
  const admin = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true }, select: { id: true, name: true, role: true, companyId: true } })
  if (!admin) { console.error(`No active account ${email}. Give one with --as you@company.com`); process.exit(1) }
  const COMPANY = admin.companyId || HOME_COMPANY_ID
  const total = Number(opt('--total')) || 0
  let per = Math.max(3, Number(opt('--per')) || 12)
  console.log(`Asking as ${admin.name} (${admin.role.replace(/_/g, ' ').toLowerCase()})${LIVE ? ', on the live database, read-only' : ''}.`)

  await runAsCompany(COMPANY, async () => {
    // On live nothing is written to the database: the index is used as it is.
    if (!LIVE && !flag('--no-index')) { process.stdout.write('Bringing the index up to date... '); const t = Date.now(); await indexNow(COMPANY); console.log(`${((Date.now() - t) / 1000).toFixed(0)} s`) }
    const asker = await askerOf(admin.id)
    const ix = await indexOf(COMPANY)

    // ---- the index
    const all = await prisma.aiChunk.findMany({ select: { id: true, sourceType: true, sourceId: true, title: true, text: true, labels: true } })
    const bySource = new Map<string, number>()
    for (const c of all) bySource.set(c.sourceType, (bySource.get(c.sourceType) ?? 0) + 1)
    console.log(`\nINDEX: ${all.length.toLocaleString('en-US')} pieces, ${new Set(all.map((c) => `${c.sourceType}:${c.sourceId}`)).size.toLocaleString('en-US')} records. Search: ${JSON.stringify(embedStatus())}`)
    console.log([...bySource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `  ${(SOURCE_BY_TYPE.get(s)?.label ?? s).padEnd(26)} ${String(n).padStart(6)}`).join('\n'))

    // ---- the questions (kept between runs)
    const file = path.resolve(__dirname, '../../.cache/metra-bench.json')
    const kept: Record<string, string> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
    const readable = all.filter((c) => asker.sources.has(c.sourceType) && canRead(c.labels, asker.principals) && c.text.length >= 90 && !/METRA-CHECK|Check Company \d|Lead Own Company \d/.test(`${c.title} ${c.text}`))
    const sample: typeof readable = []
    // --total N: spread N questions over the sources, as evenly as the data allows.
    if (total) {
      const sizes = [...new Set(readable.map((c) => c.sourceType))].map((t) => readable.filter((c) => c.sourceType === t).length).sort((a, b) => a - b)
      let left = total
      sizes.forEach((n, i) => { per = Math.ceil(left / (sizes.length - i)); left -= Math.min(n, per) })
      per = Math.max(per, 1)
      // `per` is now the cap for the biggest sources; smaller ones give all they have.
    }
    for (const type of [...new Set(readable.map((c) => c.sourceType))].sort()) {
      const of = readable.filter((c) => c.sourceType === type).sort((a, b) => a.id.localeCompare(b.id))
      // Evenly through the list (not random): the same records every run.
      for (let i = 0; i < Math.min(per, of.length); i++) sample.push(of[Math.floor((i * of.length) / Math.min(per, of.length))])
    }
    const need = sample.filter((c) => !kept[c.id])
    let failedQ = 0
    if (need.length && !llmReady()) { console.error('No model key to write the test questions with.'); process.exit(1) }
    if (need.length) process.stdout.write(`\nWriting ${need.length} test questions with the model`)
    for (const c of need) {
      const q = await completeText([
        { role: 'system', content: 'You write test questions for a search engine over a company\'s work app.' },
        { role: 'user', content: `Here is one record:\n\n${c.title}\n${c.text.slice(0, 900)}\n\nWrite ONE short question (at most 16 words) that a colleague would ask and that this record answers. Use your own everyday wording: do not copy more than three words in a row from the record, no ids, no quotation marks. Mention a name, company or topic from the record so the question is about this record and not any record. Output only the question.` },
      ], 500).catch(() => '') // room for the model's own thinking before the one line
      const clean = q.split('\n').map((l) => l.trim()).filter(Boolean).pop()?.replace(/^["'\s]+|["'\s]+$/g, '') ?? ''
      // A usable question: a real sentence (five words or more), not a cut-off stub.
      const good = clean.split(/\s+/).length >= 5 && clean.length <= 220
      if (good) { kept[c.id] = clean; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(kept, null, 1)) } else failedQ++
      process.stdout.write(good ? '.' : 'x')
    }
    if (need.length) console.log(failedQ ? `  (${failedQ} could not be written; run again to retry them)` : '')
    const cases = sample.filter((c) => kept[c.id]).map((c) => ({ c, q: kept[c.id] }))

    // ---- each search set-up on each question
    const filter = { principals: asker.principals, sources: asker.sources }
    const keyOf = (at: number) => { const x = ix.chunkAt(at); return `${x.sourceType}:${x.sourceId}` }
    const rrf = (v: [number, number][], k: [number, number][]) => {
      const m = new Map<number, number>()
      v.forEach(([at], r) => m.set(at, (m.get(at) ?? 0) + 1 / (60 + r)))
      k.forEach(([at], r) => m.set(at, (m.get(at) ?? 0) + 1 / (60 + r)))
      return [...m].sort((a, b) => b[1] - a[1]).map(([at]) => at)
    }
    const reranked = async (q: string, ats: number[]) => {
      const s = await rerank(q, ats.map((at) => { const x = ix.chunkAt(at); return `${x.title}\n${x.text}` }))
      return s ? ats.map((at, i) => [at, s[i]] as [number, number]).sort((a, b) => b[1] - a[1]).map(([at]) => at) : ats
    }
    const SETUPS = ['meaning only', 'words only', 'both merged', 'both + re-rank 10 (live)', 'both + re-rank 30 (before)', 'both + re-rank 60'] as const
    const ranks: Record<string, number[]> = Object.fromEntries(SETUPS.map((s) => [s, []]))
    const bySrc = new Map<string, { n: number; hit8: number }>()
    const found: number[] = []
    const ms = { embed: [] as number[], scan: [] as number[], rerank: [] as number[] }
    const misses: string[] = []
    for (const { c, q } of cases) {
      const target = `${c.sourceType}:${c.sourceId}`
      let t = Date.now()
      const vec = await embedQuery(q); ms.embed.push(Date.now() - t)
      t = Date.now()
      const { vector, keyword } = ix.search(vec, tokens(q), filter, 50); ms.scan.push(Date.now() - t)
      const merged = rrf(vector, keyword)
      t = Date.now()
      const live = await reranked(q, merged.slice(0, 10)); ms.rerank.push(Date.now() - t)
      const thirty = await reranked(q, merged.slice(0, 30))
      const wide = await reranked(q, merged.slice(0, 60))
      const lists: Record<string, number[]> = { 'meaning only': vector.map(([at]) => at), 'words only': keyword.map(([at]) => at), 'both merged': merged, 'both + re-rank 10 (live)': live, 'both + re-rank 30 (before)': thirty, 'both + re-rank 60': wide }
      for (const s of SETUPS) ranks[s].push(lists[s].map(keyOf).indexOf(target) + 1) // 0 = not there
      found.push(merged.map(keyOf).includes(target) ? 1 : 0)
      const r = ranks['both + re-rank 10 (live)'].at(-1)!
      const b = bySrc.get(c.sourceType) ?? { n: 0, hit8: 0 }
      b.n++; if (r >= 1 && r <= 8) b.hit8++
      bySrc.set(c.sourceType, b)
      if (!(r >= 1 && r <= 8)) misses.push(`  [${SOURCE_BY_TYPE.get(c.sourceType)?.label}] "${q}"  → wanted "${c.title.slice(0, 60)}" (${r ? `came ${r}th` : merged.map(keyOf).includes(target) ? 'found, ranked out' : 'not found at all'})`)
    }
    const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5)
    const hit = (rs: number[], k: number) => rs.filter((r) => r >= 1 && r <= k).length / Math.max(1, rs.length)
    const mrr = (rs: number[]) => rs.reduce((s, r) => s + (r ? 1 / r : 0), 0) / Math.max(1, rs.length)
    console.log(`\nACCURACY on ${cases.length} questions (each has one right record):`)
    console.log(`  ${'set-up'.padEnd(30)} top 1  top 5  top 8   MRR`)
    for (const s of SETUPS) console.log(`  ${s.padEnd(30)} ${pct(hit(ranks[s], 1))}  ${pct(hit(ranks[s], 5))}  ${pct(hit(ranks[s], 8))}  ${mrr(ranks[s]).toFixed(2)}`)
    console.log(`  the right record was among the candidates (before ranking): ${pct(found.reduce((a, b) => a + b, 0) / Math.max(1, found.length))}`)
    console.log('\nBY SOURCE (live set-up, right record in the 8 shown to the model):')
    console.log([...bySrc].sort((a, b) => a[1].hit8 / a[1].n - b[1].hit8 / b[1].n).map(([s, v]) => `  ${(SOURCE_BY_TYPE.get(s)?.label ?? s).padEnd(26)} ${v.hit8}/${v.n}`).join('\n'))
    if (misses.length) console.log(LIVE && !flag('--misses') ? `\nMISSES: ${misses.length} (add --misses to list them; the lines contain record titles).` : `\nMISSES (${misses.length}):\n${misses.slice(0, flag('--misses') ? 200 : 25).join('\n')}`)

    // ---- questions that have no answer in Metriq: the search should come back empty
    let leaked = 0
    for (const q of OFF_TOPIC) if ((await searchMetriq(asker, q)).length) leaked++
    console.log(`\nOFF-TOPIC: ${OFF_TOPIC.length - leaked} of ${OFF_TOPIC.length} unrelated questions correctly returned nothing.`)

    // ---- speed and size
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0
    const mem = process.memoryUsage()
    console.log(`\nSPEED per search: understand the question ${avg(ms.embed).toFixed(0)} ms, scan ${all.length.toLocaleString('en-US')} pieces ${avg(ms.scan).toFixed(0)} ms (p95 ${p95(ms.scan)} ms), re-rank 10 ${avg(ms.rerank).toFixed(0)} ms (p95 ${p95(ms.rerank)} ms).`)
    console.log(`MEMORY: process ${Math.round(mem.rss / 1048576)} MB in all; the vectors alone ${(all.length * 384 * 4 / 1048576).toFixed(1)} MB (384 numbers per piece).`)
  })
  await prisma.$disconnect()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
