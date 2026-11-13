import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma, onRecordWritten } from '../prisma'
import { runAsCompany, maybeCompanyId } from '../tenancy'
import { forEachCompany } from '../company'
import { isOn } from '../flags'
import { runTracked } from '../health/jobs'
import { captureError } from '../health/errors'
import { embedModelId, embedPassages, toBytes, warmUp } from './embed'
import { SOURCES, SOURCES_BY_MODEL, SOURCE_BY_TYPE, type ChunkDraft, type Source } from './sources'
import { applyToIndex, evictIdle, type StoredChunk, indexOf } from './store'
import { startMetraInsights } from './insights'

/**
 * Keeps Metra's index in step with Metriq (docs/metra/DESIGN.md §2).
 *
 *  - Fast path: every save of a watched record (lib/prisma's write hook) is queued and indexed within seconds.
 *  - Safety net: a full reconcile per company (at start-up and every 6 hours, and soon after a bulk change)
 *    rebuilds each source's text, embeds only what changed (content hash) and removes chunks of records that are
 *    gone or hidden. Nothing here is ever lost for good: the index can be rebuilt from the records at any time.
 *
 * Only companies with the `metra` switch on are indexed.
 */

const SECRETS = /\b(password|passcode|api[_ -]?key|secret|token)\s*[:=]\s*\S+/gi
/** Last line of defence: a typed password or key never goes into the index. */
const scrub = (s: string) => s.replace(SECRETS, (_m, k: string) => `${k}: [hidden]`)

const hashOf = (d: ChunkDraft, model: string) => createHash('sha1').update(`${model}\u0000${d.title}\u0000${d.text}\u0000${[...d.labels].sort().join(',')}\u0000${d.occurredAt.toISOString()}\u0000${d.link ?? ''}\u0000${JSON.stringify(d.meta ?? null)}`).digest('hex')

/** Index these records of one source (inside runAsCompany). Returns how many chunks were embedded and removed. */
export async function indexSource(companyId: string, source: Source, ids: string[]): Promise<{ embedded: number; removed: number }> {
  if (!ids.length) return { embedded: 0, removed: 0 }
  const model = embedModelId()
  const drafts = await source.build(ids)
  const existing = await prisma.aiChunk.findMany({ where: { sourceType: source.type, sourceId: { in: ids } }, select: { id: true, sourceId: true, part: true, hash: true } })
  const have = new Map(existing.map((e) => [`${e.sourceId}#${e.part}`, e]))
  const todo: { sourceId: string; d: ChunkDraft; hash: string }[] = []
  const keep = new Set<string>()
  for (const [sourceId, list] of drafts) {
    for (const d0 of list) {
      const d = { ...d0, text: scrub(d0.text).slice(0, 4000), title: d0.title.slice(0, 300) }
      const key = `${sourceId}#${d.part}`
      keep.add(key)
      const hash = hashOf(d, model)
      if (have.get(key)?.hash === hash) continue
      todo.push({ sourceId, d, hash })
    }
  }
  const gone = existing.filter((e) => !keep.has(`${e.sourceId}#${e.part}`))
  if (gone.length) await prisma.aiChunk.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } })
  const vecs = await embedPassages(todo.map((t) => `${t.d.title}\n${t.d.text}`))
  const saved: { chunk: StoredChunk; vec: Float32Array }[] = []
  for (let i = 0; i < todo.length; i++) {
    const { sourceId, d, hash } = todo[i]
    const data = { title: d.title, text: d.text, hash, labels: d.labels, occurredAt: d.occurredAt, link: d.link, meta: (d.meta ?? undefined) as Prisma.InputJsonValue | undefined, embedding: toBytes(vecs[i]), model }
    const row = await prisma.aiChunk.upsert({
      where: { sourceType_sourceId_part: { sourceType: source.type, sourceId, part: d.part } },
      create: { sourceType: source.type, sourceId, part: d.part, ...data },
      update: data,
      select: { id: true },
    })
    saved.push({ chunk: { id: row.id, sourceType: source.type, sourceId, part: d.part, title: d.title, text: d.text, labels: d.labels, occurredAt: d.occurredAt, link: d.link, meta: d.meta ?? null }, vec: vecs[i] })
  }
  await applyToIndex(companyId, saved, gone.map((g) => g.id))
  return { embedded: todo.length, removed: gone.length }
}

/** Rebuild one company's index (all sources, or some), removing chunks whose records are gone. */
export async function reconcile(companyId: string, types?: string[]): Promise<{ embedded: number; removed: number; chunks: number }> {
  const total = { embedded: 0, removed: 0, chunks: 0 }
  await runAsCompany(companyId, async () => {
    for (const source of SOURCES.filter((s) => !types || types.includes(s.type))) {
      const started = new Date()
      let error: string | null = null
      try {
        const seen = new Set<string>()
        let cursor: string | null = null
        for (;;) {
          const pageOf: { ids: string[]; next: string | null } = await source.all(cursor, 200)
          for (let i = 0; i < pageOf.ids.length; i += 100) {
            const batch = pageOf.ids.slice(i, i + 100)
            batch.forEach((id) => seen.add(id))
            const r = await indexSource(companyId, source, batch)
            total.embedded += r.embedded; total.removed += r.removed
          }
          if (!pageOf.next || pageOf.ids.length === 0) break
          cursor = pageOf.next
        }
        // Chunks of records that no longer exist.
        const orphans = await prisma.aiChunk.findMany({ where: { sourceType: source.type, sourceId: { notIn: [...seen] } }, select: { id: true } })
        if (orphans.length) {
          await prisma.aiChunk.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } })
          await applyToIndex(companyId, [], orphans.map((o) => o.id))
          total.removed += orphans.length
        }
      } catch (e) {
        error = (e as Error).message.slice(0, 500)
        captureError({ source: 'JOB', message: `Metra index ${source.type}: ${error}`, stack: (e as Error).stack, route: 'job:metra-index' })
      }
      const chunks = await prisma.aiChunk.count({ where: { sourceType: source.type } })
      total.chunks += chunks
      await prisma.aiIndexState.upsert({
        where: { companyId_sourceType: { companyId, sourceType: source.type } },
        create: { sourceType: source.type, watermark: started, chunks, lastRunAt: new Date(), lastError: error },
        update: { watermark: started, chunks, lastRunAt: new Date(), lastError: error },
      })
    }
  })
  return total
}

// ------------------------------------------------------------------ the fast path

type Pending = { models: Map<string, Set<string>>; dirty: Set<string> }
const queue = new Map<string, Pending>()
const reconcileSoon = new Map<string, { at: number; types: Set<string> }>()

/** A watched record was saved (or a bulk change touched a model: ids null). */
export function noteWrite(model: string, ids: string[] | null, companyId: string | null): void {
  if (!SOURCES_BY_MODEL.has(model) || !companyId) return
  const p = queue.get(companyId) ?? { models: new Map(), dirty: new Set() }
  if (ids) { const s = p.models.get(model) ?? new Set(); ids.forEach((i) => s.add(i)); p.models.set(model, s) } else p.dirty.add(model)
  queue.set(companyId, p)
}

let draining = false
async function drain(): Promise<void> {
  if (draining || !queue.size) return
  draining = true
  try {
    const work = [...queue]
    queue.clear()
    for (const [companyId, p] of work) {
      if (!(await isOn('metra', companyId))) continue
      await runAsCompany(companyId, async () => {
        for (const [model, ids] of p.models) {
          for (const source of SOURCES_BY_MODEL.get(model) ?? []) {
            const sourceIds = await source.watch[model]([...ids]).catch(() => [] as string[])
            // Deleted records are no longer found by watch(): their own ids still clear their chunks.
            const own = model === Object.keys(source.watch)[0] ? [...ids] : []
            await indexSource(companyId, source, [...new Set([...sourceIds, ...own])])
          }
        }
      })
      if (p.dirty.size) {
        const r = reconcileSoon.get(companyId) ?? { at: Date.now() + 60_000, types: new Set<string>() }
        for (const m of p.dirty) for (const s of SOURCES_BY_MODEL.get(m) ?? []) r.types.add(s.type)
        reconcileSoon.set(companyId, r)
      }
    }
    for (const [companyId, r] of [...reconcileSoon]) {
      if (r.at > Date.now()) continue
      reconcileSoon.delete(companyId)
      await reconcile(companyId, [...r.types])
    }
  } catch (e) {
    captureError({ source: 'JOB', message: `Metra index queue: ${(e as Error).message}`, stack: (e as Error).stack, route: 'job:metra-index' })
  } finally {
    draining = false
  }
}

let started = false
let fullRunning = false
/** Full reconcile of every company with Metra on. */
export async function reconcileAll(): Promise<void> {
  if (fullRunning) return
  fullRunning = true
  try { await forEachCompany(async () => { const c = maybeCompanyId(); if (c && (await isOn('metra', c))) { await indexOf(c); await reconcile(c) } }) } finally { fullRunning = false }
}

export function startMetraIndexer(): void {
  if (started) return
  started = true
  onRecordWritten(noteWrite)
  setInterval(() => { void drain() }, 3000).unref?.()
  setInterval(() => evictIdle(), 10 * 60_000).unref?.()
  startMetraInsights()
  // A first full pass after start-up (lets the server settle), then every 6 hours.
  setTimeout(() => { warmUp(); void runTracked('metra-index', reconcileAll) }, 45_000).unref?.()
  setInterval(() => { void runTracked('metra-index', reconcileAll) }, 6 * 3600_000).unref?.()
  // eslint-disable-next-line no-console
  console.log('[metra] indexer started (records are indexed seconds after they are saved; full check every 6 hours)')
}

/** For tests and the admin "re-index" button: index everything of one company now. */
export async function indexNow(companyId: string, types?: string[]) { return reconcile(companyId, types) }
export { SOURCE_BY_TYPE }
