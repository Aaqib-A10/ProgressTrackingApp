import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { DIM, fromBytes } from './embed'
import type { SearchFilter, StoredChunk } from './store'

/**
 * Metra's search index in the database instead of the server's memory (plan 2026-11, 3.6). Switched on with
 * METRA_INDEX=database in server/.env; without it the in-memory index (store.ts) is used as before.
 *
 * Words: Postgres's own full-text search over the piece's title and text (an index on it is made by the migration).
 * Meaning: the piece's vector is kept in the `vec` column as an array of numbers, and the closest ones are worked out
 * by the database. That reads every piece the person may see for each question: fine for tens of thousands of
 * pieces; for many more, the pgvector extension can be put on the server and used instead. Either way nothing is held
 * in the server's memory, so the memory no longer grows with the number of companies.
 *
 * The person's access is part of the query (a piece is read only when one of its labels is one of theirs), exactly as
 * the in-memory index checks it inside its scan.
 */

export const dbIndexOn = () => (process.env.METRA_INDEX ?? '').toLowerCase() === 'database'

export interface DbHits { vector: [number, number][]; keyword: [number, number][]; chunkAt: (at: number) => StoredChunk }

/** Words for a Postgres text query: letters and digits only, any of them may match. */
export function tsWords(words: string[]): string {
  return [...new Set(words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter((w) => w.length >= 2))].slice(0, 30).join(' | ')
}

export async function dbSearch(companyId: string, vec: Float32Array, words: string[], f: SearchFilter, k: number): Promise<DbHits> {
  const principals = [...f.principals]
  const sources = [...f.sources]
  const from = f.from ?? null
  const to = f.to ?? null
  const where = Prisma.sql`"companyId" = ${companyId} AND "sourceType" = ANY(${sources}::text[]) AND "labels" && ${principals}::text[]
    AND (${from}::timestamptz IS NULL OR "occurredAt" >= ${from}::timestamptz) AND (${to}::timestamptz IS NULL OR "occurredAt" <= ${to}::timestamptz)`
  const q = Array.from(vec)
  const byMeaning = await prisma.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
    SELECT "id", (SELECT SUM(a * b) FROM unnest("vec", ${q}::real[]) AS t(a, b))::float8 AS score
    FROM "AiChunk" WHERE ${where} AND cardinality("vec") = ${DIM}
    ORDER BY score DESC LIMIT ${k}`)
  const tsq = tsWords(words)
  const byWords = tsq ? await prisma.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
    SELECT "id", ts_rank_cd(to_tsvector('simple', "title" || ' ' || "text"), to_tsquery('simple', ${tsq}))::float8 AS score
    FROM "AiChunk" WHERE ${where} AND to_tsvector('simple', "title" || ' ' || "text") @@ to_tsquery('simple', ${tsq})
    ORDER BY score DESC LIMIT ${k}`) : []

  const ids = [...new Set([...byMeaning.map((r) => r.id), ...byWords.map((r) => r.id)])]
  const rows = ids.length ? await prisma.aiChunk.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, sourceType: true, sourceId: true, part: true, title: true, text: true, labels: true, occurredAt: true, link: true, meta: true } }) : []
  const chunks = rows.map((r) => ({ ...r, meta: (r.meta as Record<string, unknown> | null) ?? null }))
  const at = new Map(chunks.map((c, i) => [c.id, i]))
  const pos = (list: { id: string; score: number }[]) => list.filter((r) => at.has(r.id)).map((r) => [at.get(r.id)!, Number(r.score)] as [number, number])
  return { vector: pos(byMeaning), keyword: pos(byWords), chunkAt: (i) => chunks[i] }
}

/**
 * Fill `vec` for pieces saved before it existed (from the embedding already stored with each piece). Run once when
 * the database index is switched on, and after a re-index; a thousand pieces at a time. Returns how many were filled.
 */
export async function fillVectors(companyId: string): Promise<number> {
  let filled = 0
  for (;;) {
    const rows = await prisma.aiChunk.findMany({ where: { companyId, vec: { isEmpty: true } }, select: { id: true, embedding: true }, take: 1000 })
    if (!rows.length) break
    let done = 0
    for (const r of rows) {
      const v = fromBytes(r.embedding)
      if (v.length !== DIM) continue // another model's: re-embedded by the next re-index
      await prisma.aiChunk.update({ where: { id: r.id }, data: { vec: Array.from(v) }, select: { id: true } })
      done++
    }
    filled += done
    if (!done || rows.length < 1000) break
  }
  return filled
}
