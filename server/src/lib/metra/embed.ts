import path from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Metra's local models (docs/metra/DESIGN.md §5). They run on the server's CPU: no text leaves the server to be
 * indexed. Loaded on first use and kept for the life of the process.
 *
 *  - Embeddings: Xenova/multilingual-e5-small (384 dimensions; English, Urdu script and Roman Urdu). e5 wants
 *    "query: " / "passage: " in front of the text.
 *  - Re-ranking: Xenova/ms-marco-MiniLM-L-6-v2 (a cross-encoder: scores a question against each candidate).
 *
 * METRA_EMBEDDER=hash (the default in tests, or when the models cannot be loaded) uses a small deterministic
 * word-hashing embedding instead: no download, same interface, good enough to test access and the pipeline.
 * Env: METRA_EMBED_MODEL, METRA_RERANK_MODEL, METRA_MODELS_DIR (default server/.cache/models).
 */

export const DIM = 384
export const EMBED_MODEL = process.env.METRA_EMBED_MODEL || 'Xenova/multilingual-e5-small'
export const RERANK_MODEL = process.env.METRA_RERANK_MODEL || 'Xenova/ms-marco-MiniLM-L-6-v2'

type Mode = 'model' | 'hash'
const wanted = (): Mode => {
  const m = (process.env.METRA_EMBEDDER || '').toLowerCase()
  if (m === 'hash' || m === 'model') return m
  return process.env.VITEST || process.env.NODE_ENV === 'test' ? 'hash' : 'model'
}
let mode: Mode = wanted()
/** The model id stored with each chunk: a chunk embedded by another model is embedded again. */
export const embedModelId = (): string => (mode === 'hash' ? `hash-${DIM}` : EMBED_MODEL)

type Extractor = (texts: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>
type Ranker = { tok: (a: string[], o: { text_pair: string[]; padding: boolean; truncation: boolean }) => unknown; model: (inputs: unknown) => Promise<{ logits: { tolist(): number[][] } }> }
let extractor: Promise<Extractor> | null = null
let ranker: Promise<Ranker | null> | null = null

async function lib() {
  // The expired cached Hugging Face token on some PCs makes public downloads fail (401): never send one.
  delete process.env.HF_TOKEN
  process.env.HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
  const t = await import('@huggingface/transformers')
  t.env.cacheDir = process.env.METRA_MODELS_DIR || path.resolve(__dirname, '../../../.cache/models')
  t.env.allowRemoteModels = process.env.METRA_OFFLINE !== '1'
  return t
}

function loadExtractor(): Promise<Extractor> {
  extractor ??= (async () => {
    const t = await lib()
    return (await t.pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })) as unknown as Extractor
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[metra] could not load ${EMBED_MODEL}, using the hash embedding instead:`, (e as Error).message)
    mode = 'hash'
    extractor = null
    throw e
  })
  return extractor
}

// ------------------------------------------------------------------ the hash embedding (tests, fallback)

const WORD = /[\p{L}\p{N}]+/gu
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATES: [RegExp, (m: RegExpMatchArray) => [number | null, number, number]][] = [
  [/\b(\d{4})[-/.‐-―](\d{1,2})[-/.‐-―](\d{1,2})\b/g, (m) => [+m[1], +m[2], +m[3]]], // 2026-07-03 (any kind of hyphen)
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(\\d{4})\\b`, 'g'), (m) => [+m[3], MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]]], // 3 Jul 2026
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'g'), (m) => [+m[3], MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]]], // July 3, 2026
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?!\\s*,?\\s*\\d{4})`, 'g'), (m) => [null, MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]]], // 3 July
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})`, 'g'), (m) => [null, MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]]], // July 3
]
/**
 * One word per date, however it is written: "2026-07-03", "3 Jul 2026" and "July 3, 2026" all give d20260703 (and
 * md0703, which a date with no year also gives). Records write dates one way and people ask another: the benchmark's
 * misses were "the log for July 3, 2026" against records titled "ITAD log 2026-07-03", which shared only "2026".
 */
export function dateTokens(lower: string): string[] {
  const out: string[] = []
  const two = (n: number) => String(n).padStart(2, '0')
  for (const [re, pick] of DATES) {
    for (const m of lower.matchAll(re)) {
      const [y, mo, d] = pick(m)
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
      if (y != null) { if (y < 1990 || y > 2100) continue; out.push(`d${y}${two(mo)}${two(d)}`) }
      out.push(`md${two(mo)}${two(d)}`)
    }
  }
  return out
}
export function tokens(text: string): string[] {
  const lower = text.toLowerCase().normalize('NFKC')
  return [...(lower.match(WORD) ?? []).filter((w) => w.length > 1 || /\d/.test(w)), ...dateTokens(lower)]
}
function hashVec(text: string): Float32Array {
  const v = new Float32Array(DIM)
  const ws = tokens(text)
  const add = (s: string, w: number) => { const h = createHash('md5').update(s).digest(); const i = h.readUInt32LE(0) % DIM; v[i] += (h[4] & 1 ? 1 : -1) * w }
  for (let i = 0; i < ws.length; i++) {
    add(ws[i], 1)
    if (ws[i].length > 4) add(ws[i].slice(0, 4), 0.5) // a little fuzziness: "recycle" ~ "recycling"
    if (i + 1 < ws.length) add(`${ws[i]} ${ws[i + 1]}`, 0.5)
  }
  return normalise(v)
}

export function normalise(v: Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

// ------------------------------------------------------------------ the interface

/** Embed passages (indexed text), in batches. */
export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return []
  if (mode === 'model') {
    try {
      const ext = await loadExtractor()
      const out: Float32Array[] = []
      for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32).map((t) => `passage: ${t.slice(0, 2000)}`)
        const r = (await ext(batch, { pooling: 'mean', normalize: true })).tolist()
        for (const row of r) out.push(Float32Array.from(row))
        // Let requests run between batches: indexing never holds the server up.
        await new Promise((ok) => setImmediate(ok))
      }
      return out
    } catch { /* fell back to hash */ }
  }
  return texts.map(hashVec)
}

/** Embed a question. */
export async function embedQuery(text: string): Promise<Float32Array> {
  if (mode === 'model') {
    try {
      const ext = await loadExtractor()
      return Float32Array.from((await ext([`query: ${text.slice(0, 1000)}`], { pooling: 'mean', normalize: true })).tolist()[0])
    } catch { /* fell back */ }
  }
  return hashVec(text)
}

/** Cross-encoder scores (higher = more relevant); null when re-ranking is not available (hash mode). */
export async function rerank(query: string, docs: string[]): Promise<number[] | null> {
  if (mode !== 'model' || !docs.length || process.env.METRA_RERANK === '0') return null
  ranker ??= (async () => {
    try {
      const t = await lib()
      const tok = await t.AutoTokenizer.from_pretrained(RERANK_MODEL)
      const model = await t.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8' })
      return { tok: tok as unknown as Ranker['tok'], model: model as unknown as Ranker['model'] }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[metra] could not load ${RERANK_MODEL}; answers use the merged ranking only:`, (e as Error).message)
      return null
    }
  })()
  const r = await ranker
  if (!r) return null
  const scores: number[] = []
  for (let i = 0; i < docs.length; i += 16) {
    const part = docs.slice(i, i + 16).map((d) => d.slice(0, 1500))
    const inputs = r.tok(new Array(part.length).fill(query), { text_pair: part, padding: true, truncation: true })
    const { logits } = await r.model(inputs)
    for (const row of logits.tolist()) scores.push(row[0])
  }
  return scores
}

/** Float32Array <-> the bytes stored in AiChunk.embedding. */
export const toBytes = (v: Float32Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(v.byteLength))
  out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
  return out
}
export const fromBytes = (b: Uint8Array): Float32Array => {
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}

/** For System Health / Admin: which embedding is in use. */
export function embedStatus(): { mode: Mode; model: string; reranker: string | null } {
  return { mode, model: embedModelId(), reranker: mode === 'model' ? RERANK_MODEL : null }
}

/** Load the models now (at boot, in the background), so the first question does not wait. */
export function warmUp(): void {
  if (mode !== 'model') return
  void embedQuery('warm up').then(() => rerank('warm up', ['warm up'])).catch(() => undefined)
}
