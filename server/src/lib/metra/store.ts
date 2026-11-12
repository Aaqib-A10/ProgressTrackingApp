import { prisma } from '../prisma'
import { DIM, fromBytes, tokens } from './embed'

/**
 * Vector + keyword search without a vector database (docs/metra/DESIGN.md §4). Per company, loaded lazily from
 * AiChunk and kept up to date by the indexer (the API runs as one process). Exact cosine over a packed Float32
 * matrix (vectors are normalised, so cosine = dot product) and BM25 over the words. Access is checked INSIDE the
 * scan: a chunk the asker may not read is never scored, so it can never leak through a ranking or a count.
 * Idle companies are dropped from memory after 30 minutes.
 */

export interface StoredChunk {
  id: string
  sourceType: string
  sourceId: string
  part: number
  title: string
  text: string
  labels: string[]
  occurredAt: Date
  link: string | null
  meta: Record<string, unknown> | null
}

interface Slot { chunk: StoredChunk; labelIds: Int32Array; terms: Map<string, number>; len: number }

class CompanyIndex {
  vecs = new Float32Array(1024 * DIM)
  slots: (Slot | null)[] = []
  free: number[] = []
  byId = new Map<string, number>()
  labelIds = new Map<string, number>()
  postings = new Map<string, Map<number, number>>()
  totalLen = 0
  count = 0
  lastUsed = Date.now()

  private labelId(l: string): number {
    let id = this.labelIds.get(l)
    if (id == null) { id = this.labelIds.size; this.labelIds.set(l, id) }
    return id
  }

  upsert(c: StoredChunk, vec: Float32Array): void {
    this.remove(c.id)
    const at = this.free.pop() ?? this.slots.length
    if ((at + 1) * DIM > this.vecs.length) {
      const bigger = new Float32Array(Math.max(this.vecs.length * 2, (at + 1) * DIM))
      bigger.set(this.vecs)
      this.vecs = bigger
    }
    this.vecs.set(vec.subarray(0, DIM), at * DIM)
    const terms = new Map<string, number>()
    const ws = tokens(`${c.title} ${c.text}`)
    for (const w of ws) terms.set(w, (terms.get(w) ?? 0) + 1)
    for (const [w, tf] of terms) {
      let p = this.postings.get(w)
      if (!p) { p = new Map(); this.postings.set(w, p) }
      p.set(at, tf)
    }
    this.slots[at] = { chunk: c, labelIds: Int32Array.from(c.labels.map((l) => this.labelId(l))), terms, len: ws.length }
    this.byId.set(c.id, at)
    this.totalLen += ws.length
    this.count++
  }

  remove(id: string): void {
    const at = this.byId.get(id)
    if (at == null) return
    const s = this.slots[at]!
    for (const w of s.terms.keys()) { const p = this.postings.get(w); p?.delete(at); if (p && !p.size) this.postings.delete(w) }
    this.totalLen -= s.len
    this.count--
    this.slots[at] = null
    this.free.push(at)
    this.byId.delete(id)
  }

  /** Label ids of the principals that exist in this company (unknown ones can match nothing). */
  allowedLabels(principals: Set<string>): Set<number> {
    const out = new Set<number>()
    for (const p of principals) { const id = this.labelIds.get(p); if (id != null) out.add(id) }
    return out
  }

  private ok(s: Slot | null, allowed: Set<number>, f: SearchFilter): s is Slot {
    if (!s) return false
    if (!f.sources.has(s.chunk.sourceType)) return false
    if (f.from && s.chunk.occurredAt < f.from) return false
    if (f.to && s.chunk.occurredAt > f.to) return false
    for (let i = 0; i < s.labelIds.length; i++) if (allowed.has(s.labelIds[i])) return true
    return false
  }

  search(q: Float32Array, qWords: string[], f: SearchFilter, k: number): { vector: [number, number][]; keyword: [number, number][] } {
    this.lastUsed = Date.now()
    const allowed = this.allowedLabels(f.principals)
    const vector: [number, number][] = []
    for (let at = 0; at < this.slots.length; at++) {
      const s = this.slots[at]
      if (!this.ok(s, allowed, f)) continue
      let dot = 0
      const o = at * DIM
      for (let i = 0; i < DIM; i++) dot += q[i] * this.vecs[o + i]
      vector.push([at, dot])
    }
    vector.sort((a, b) => b[1] - a[1])
    // BM25 (k1 1.2, b 0.75) over the chunks the asker may read.
    const scores = new Map<number, number>()
    const n = Math.max(1, this.count), avg = this.totalLen / n || 1
    for (const w of new Set(qWords)) {
      const p = this.postings.get(w)
      if (!p) continue
      const idf = Math.log(1 + (n - p.size + 0.5) / (p.size + 0.5))
      for (const [at, tf] of p) {
        const s = this.slots[at]
        if (!this.ok(s, allowed, f)) continue
        scores.set(at, (scores.get(at) ?? 0) + idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * s.len) / avg))))
      }
    }
    const keyword = [...scores].sort((a, b) => b[1] - a[1])
    return { vector: vector.slice(0, k), keyword: keyword.slice(0, k) }
  }

  chunkAt(at: number): StoredChunk { return this.slots[at]!.chunk }
}

export interface SearchFilter { principals: Set<string>; sources: Set<string>; from?: Date | null; to?: Date | null }

const indexes = new Map<string, Promise<CompanyIndex>>()

/** The company's index, loaded from the database on first use. */
export function indexOf(companyId: string): Promise<CompanyIndex> {
  let p = indexes.get(companyId)
  if (!p) {
    p = (async () => {
      const ix = new CompanyIndex()
      let cursor: string | null = null
      for (;;) {
        const rows: { id: string; sourceType: string; sourceId: string; part: number; title: string; text: string; labels: string[]; occurredAt: Date; link: string | null; meta: unknown; embedding: Uint8Array }[] = await prisma.aiChunk.findMany({
          where: { companyId }, take: 2000, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, sourceType: true, sourceId: true, part: true, title: true, text: true, labels: true, occurredAt: true, link: true, meta: true, embedding: true },
        })
        for (const r of rows) {
          const v = fromBytes(r.embedding)
          if (v.length !== DIM) continue // embedded by another model: re-embedded by the next reconcile
          ix.upsert({ ...r, meta: (r.meta as Record<string, unknown> | null) ?? null }, v)
        }
        if (rows.length < 2000) break
        cursor = rows[rows.length - 1].id
      }
      return ix
    })()
    indexes.set(companyId, p)
    p.catch(() => indexes.delete(companyId))
  }
  return p
}

/** The indexer saved or removed chunks: keep a loaded index in step (an unloaded one reads them on first use). */
export async function applyToIndex(companyId: string, upserts: { chunk: StoredChunk; vec: Float32Array }[], removedIds: string[]): Promise<void> {
  const p = indexes.get(companyId)
  if (!p) return
  const ix = await p
  for (const id of removedIds) ix.remove(id)
  for (const u of upserts) ix.upsert(u.chunk, u.vec)
}

/** Forget a company's index (re-read on next use), e.g. after a full re-index. */
export function dropIndex(companyId?: string): void { if (companyId) indexes.delete(companyId); else indexes.clear() }

/** Free memory of companies nobody asked for a while. */
export function evictIdle(maxIdleMs = 30 * 60_000): void {
  for (const [id, p] of indexes) void p.then((ix) => { if (Date.now() - ix.lastUsed > maxIdleMs) indexes.delete(id) }).catch(() => undefined)
}

export async function indexStats(companyId: string): Promise<{ loaded: boolean; chunks: number }> {
  const p = indexes.get(companyId)
  return { loaded: !!p, chunks: p ? (await p).count : await prisma.aiChunk.count({ where: { companyId } }) }
}
