import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './helpers'
import { HOME_COMPANY_ID } from '../lib/company'
import { runAsCompany } from '../lib/tenancy'
import { embedPassages, embedQuery, toBytes, embedModelId, tokens } from '../lib/metra/embed'
import { indexOf, dropIndex } from '../lib/metra/store'
import { dbSearch, fillVectors, tsWords } from '../lib/metra/dbIndex'

// Metra's search inside the database (plan 2026-11, 3.6, METRA_INDEX=database): it must find what the in-memory
// index finds, and never a piece the person may not read, from another company, or outside the dates asked for.

const OTHER = 'dbindex-other-co'
const PIECES = [
  { id: 'dbx-1', title: 'Quartz Valley Hospital bid', text: 'Laptop recycling bid for Quartz Valley Hospital, due Friday. Price 0.45 per pound.', labels: ['all'], at: '2026-11-10' },
  { id: 'dbx-2', title: 'Weekly sync on Amazon returns', text: 'Returns older than 30 days go to the liquidation pallet. Pause the Walmart repricer.', labels: ['all'], at: '2026-11-18' },
  { id: 'dbx-3', title: 'Private chat about salaries', text: 'Salary review for the sales team, confidential.', labels: ['u:boss'], at: '2026-11-19' },
  { id: 'dbx-4', title: 'Old hospital note', text: 'Quartz Valley Hospital asked about recycling last year.', labels: ['all'], at: '2025-06-01' },
]

beforeAll(async () => {
  await prisma.aiChunk.deleteMany({ where: { id: { startsWith: 'dbx-' } } })
  await prisma.company.deleteMany({ where: { id: OTHER } })
  await prisma.company.create({ data: { id: OTHER, name: 'Other Index Co', slug: OTHER, status: 'ACTIVE', plan: 'business', timeZone: 'UTC' } })
  const vecs = await embedPassages(PIECES.map((p) => `${p.title}\n${p.text}`))
  // Saved the way pieces were saved before the `vec` column: only the embedding. fillVectors fills it.
  for (const [i, p] of PIECES.entries()) {
    await runAsCompany(HOME_COMPANY_ID, () => prisma.aiChunk.create({ data: { id: p.id, sourceType: 'PM_TASK', sourceId: p.id, part: 0, title: p.title, text: p.text, hash: p.id, labels: p.labels, occurredAt: new Date(`${p.at}T10:00:00Z`), embedding: toBytes(vecs[i]), model: embedModelId() } }))
  }
  // The same words in another company: never found.
  await runAsCompany(OTHER, () => prisma.aiChunk.create({ data: { id: 'dbx-other', sourceType: 'PM_TASK', sourceId: 'dbx-other', part: 0, title: 'Quartz Valley Hospital bid', text: 'Another company’s hospital bid.', hash: 'x', labels: ['all'], occurredAt: new Date('2026-11-10T10:00:00Z'), embedding: toBytes(vecs[0]), model: embedModelId() } }))
})
afterAll(async () => {
  await prisma.aiChunk.deleteMany({ where: { id: { startsWith: 'dbx-' } } })
  await prisma.company.deleteMany({ where: { id: OTHER } })
  dropIndex(HOME_COMPANY_ID)
  await prisma.$disconnect()
})

const asker = (labels: string[]) => ({ principals: new Set(labels), sources: new Set(['PM_TASK']) })
const ids = (r: { vector: [number, number][]; keyword: [number, number][]; chunkAt: (i: number) => { id: string } }, which: 'vector' | 'keyword') => r[which].map(([at]) => r.chunkAt(at).id)

describe('Metra search in the database', () => {
  it('fills the numbers of pieces saved before, once', async () => {
    expect(await fillVectors(HOME_COMPANY_ID)).toBeGreaterThanOrEqual(4)
    expect(await fillVectors(HOME_COMPANY_ID)).toBe(0)
    const v = await prisma.aiChunk.findUniqueOrThrow({ where: { id: 'dbx-1' }, select: { vec: true } })
    expect(v.vec.length).toBe(384)
  })

  it('finds what the in-memory index finds, by meaning and by words', async () => {
    const question = 'Quartz Valley Hospital recycling bid'
    const vec = await embedQuery(question)
    const words = tokens(question)
    const f = asker(['all'])
    const db = await runAsCompany(HOME_COMPANY_ID, () => dbSearch(HOME_COMPANY_ID, vec, words, f, 50))
    dropIndex(HOME_COMPANY_ID)
    const mem = await runAsCompany(HOME_COMPANY_ID, async () => { const ix = await indexOf(HOME_COMPANY_ID); const r = ix.search(vec, words, f, 50); return { ...r, chunkAt: (i: number) => ix.chunkAt(i) } })
    const ours = (l: string[]) => l.filter((x) => x.startsWith('dbx-'))
    // The same pieces, the closest first.
    expect(ours(ids(db, 'vector'))).toEqual(ours(ids(mem, 'vector')))
    expect(ours(ids(db, 'vector'))[0]).toBe('dbx-1')
    expect(new Set(ours(ids(db, 'keyword')))).toEqual(new Set(ours(ids(mem, 'keyword'))))
    expect(ids(db, 'keyword')).toContain('dbx-4')
  })

  it('never returns a piece the person may not read, another company’s, or one outside the dates', async () => {
    const vec = await embedQuery('salary review hospital bid')
    const words = tokens('salary review hospital bid')
    const all = (r: Awaited<ReturnType<typeof dbSearch>>) => [...ids(r, 'vector'), ...ids(r, 'keyword')]
    const member = await runAsCompany(HOME_COMPANY_ID, () => dbSearch(HOME_COMPANY_ID, vec, words, asker(['all']), 50))
    expect(all(member)).not.toContain('dbx-3')
    expect(all(member)).not.toContain('dbx-other')
    const boss = await runAsCompany(HOME_COMPANY_ID, () => dbSearch(HOME_COMPANY_ID, vec, words, asker(['all', 'u:boss']), 50))
    expect(all(boss)).toContain('dbx-3')
    const thisYear = await runAsCompany(HOME_COMPANY_ID, () => dbSearch(HOME_COMPANY_ID, vec, words, { ...asker(['all']), from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') }, 50))
    expect(all(thisYear)).not.toContain('dbx-4')
    expect(all(thisYear)).toContain('dbx-1')
  })

  it('turns the question into a safe text query', () => {
    expect(tsWords(['hospital', "o'brien", 'a', 'bid!', 'hospital', '|&'])).toBe('hospital | obrien | bid')
    expect(tsWords([])).toBe('')
  })
})
