import { embedQuery, rerank, tokens } from './embed'
import { indexOf, type StoredChunk } from './store'
import { canRead, type Asker } from './access'

/**
 * search_metriq (docs/metra/DESIGN.md §2, step 3): vector top 50 + keyword (BM25) top 50, merged by reciprocal rank,
 * re-ranked by the local cross-encoder, cut at a minimum relevance, at most two pieces per record, top 8.
 * Only chunks the asker may read are ever scored (the store checks labels inside the scan); the final list is
 * checked once more here.
 */

export interface Hit { chunk: StoredChunk; score: number }
export interface SearchOptions { sources?: string[]; from?: Date | null; to?: Date | null; k?: number }

/** Below this cross-encoder score a passage is not about the question (ms-marco logits: relevant ~0 and up). */
const MIN_RERANK = Number(process.env.METRA_MIN_RERANK ?? -6)

export async function searchMetriq(asker: Asker, query: string, o: SearchOptions = {}): Promise<Hit[]> {
  const q = query.trim().slice(0, 500)
  if (!q) return []
  const sources = new Set([...asker.sources].filter((s) => !o.sources?.length || o.sources.includes(s)))
  if (!sources.size) return []
  const ix = await indexOf(asker.companyId)
  const [vec, words] = [await embedQuery(q), tokens(q)]
  const { vector, keyword } = ix.search(vec, words, { principals: asker.principals, sources, from: o.from, to: o.to }, 50)

  // Reciprocal rank fusion.
  const fused = new Map<number, { rrf: number; cos: number; kw: boolean }>()
  vector.forEach(([at, cos], r) => fused.set(at, { rrf: 1 / (60 + r), cos, kw: false }))
  keyword.forEach(([at], r) => { const f = fused.get(at) ?? { rrf: 0, cos: 0, kw: false }; f.rrf += 1 / (60 + r); f.kw = true; fused.set(at, f) })
  let cands = [...fused].sort((a, b) => b[1].rrf - a[1].rrf).slice(0, 30).map(([at, f]) => ({ chunk: ix.chunkAt(at), score: f.rrf, cos: f.cos, kw: f.kw }))

  const scores = await rerank(q, cands.map((c) => `${c.chunk.title}\n${c.chunk.text}`))
  if (scores) {
    cands = cands.map((c, i) => ({ ...c, score: scores[i] })).filter((c) => c.score >= MIN_RERANK).sort((a, b) => b.score - a.score)
  } else {
    // No re-ranker (hash embedding): keep what matched a word of the question or is clearly close.
    cands = cands.filter((c) => c.kw || c.cos > 0.25)
  }

  const perRecord = new Map<string, number>()
  const out: Hit[] = []
  for (const c of cands) {
    if (!canRead(c.chunk.labels, asker.principals) || !asker.sources.has(c.chunk.sourceType)) continue // belt and braces
    const key = `${c.chunk.sourceType}:${c.chunk.sourceId}`
    if ((perRecord.get(key) ?? 0) >= 2) continue
    perRecord.set(key, (perRecord.get(key) ?? 0) + 1)
    out.push({ chunk: c.chunk, score: c.score })
    if (out.length >= (o.k ?? 8)) break
  }
  return out
}
