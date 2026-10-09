/**
 * Groq (free tier) for the AI note taker: Whisper speech-to-text and an open model
 * for the written notes. Set GROQ_API_KEY in server/.env (free key from console.groq.com).
 *
 * The free tier has per-minute limits (about 20 transcriptions a minute, 8K tokens a
 * minute for the notes model), so every call here waits its turn and retries politely
 * when Groq answers 429 "slow down".
 *
 * Optional overrides: GROQ_STT_MODEL (default whisper-large-v3), GROQ_NOTES_MODEL
 * (default openai/gpt-oss-120b), GROQ_BASE_URL.
 */

const BASE = () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
export const groqEnabled = (): boolean => !!process.env.GROQ_API_KEY

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

export class GroqError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function groqFetch(path: string, init: () => RequestInit, attempts = 6): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE()}${path}`, { ...init(), headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...(init().headers ?? {}) } })
      if (r.status === 429 || r.status >= 500) {
        // Free-tier limit (or a hiccup): wait as long as Groq asks, then try again.
        const ra = Number(r.headers.get('retry-after'))
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000 + 250, 65_000) : Math.min(2000 * 2 ** i, 30_000)
        lastErr = new GroqError(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status)
        await sleep(wait)
        continue
      }
      return r
    } catch (e) {
      lastErr = e
      await sleep(Math.min(2000 * 2 ** i, 20_000))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Groq request failed')
}

// ---------- speech to text ----------

/** mixed = any language (Urdu, English or both) written in English; en = English; ur = Urdu in Urdu script. */
export type SpeechMode = 'mixed' | 'en' | 'ur'

// Whisper sometimes "hears" these in silence or noise.
const HALLUCINATIONS = [
  /^thank(s| you)( so much| very much)?( for watching| for listening)?[.!]*$/i,
  /^(you|bye|bye-bye|okay|ok|hmm+|uh+|um+|yeah|yes|no|so|\.|\.\.\.)[.!?]*$/i,
  /subtitles? (by|provided)/i, /please subscribe/i, /like and subscribe/i, /amara\.org/i, /transcribed by/i,
  /^\[?\(?(music|silence|blank_audio|noise|applause|laughter|inaudible)\)?\]?$/i,
]

export interface VerboseSegment { text: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number; start?: number; end?: number }

/**
 * Keep only the parts Whisper really heard. Whisper invents sentences when the
 * sound is mostly silence, far-away voices or noise; it then reports a high
 * "no speech" chance, a low confidence or very repetitive text. Those are dropped.
 */
export function keepSegment(s: VerboseSegment): boolean {
  const t = s.text.trim()
  if (!t) return false
  const noSpeech = s.no_speech_prob ?? 0
  const conf = s.avg_logprob ?? 0
  if (noSpeech > 0.5 && conf < -0.4) return false // probably not speech at all
  if (noSpeech > 0.8) return false
  if (conf < -1.0) return false // Whisper was guessing
  if ((s.compression_ratio ?? 0) > 2.4) return false // the same words over and over
  const words = t.split(/\s+/).length
  if (words <= 2 && conf < -0.6) return false // a stray word or two it was unsure of
  return !HALLUCINATIONS.some((re) => re.test(t))
}

/** Remove a phrase repeated back to back ("start the engine, start the engine, start the engine"). */
export function collapseRepeats(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/)
  const out: string[] = []
  for (const p of parts) if (!out.length || out[out.length - 1].toLowerCase() !== p.toLowerCase()) out.push(p)
  return out.join(' ')
}

/** One short recording -> text (empty string when nobody really spoke). */
export async function transcribeAudio(audio: Buffer, opts: { mode: SpeechMode; prompt?: string; mime?: string }): Promise<string> {
  const translate = opts.mode === 'mixed'
  const model = translate ? 'whisper-large-v3' : process.env.GROQ_STT_MODEL || 'whisper-large-v3'
  const ext = (opts.mime ?? 'audio/webm').includes('ogg') ? 'ogg' : (opts.mime ?? '').includes('mp4') ? 'm4a' : 'webm'
  const r = await groqFetch(translate ? '/audio/translations' : '/audio/transcriptions', () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: opts.mime ?? 'audio/webm' }), `speech.${ext}`)
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    if (!translate) form.append('language', opts.mode === 'ur' ? 'ur' : 'en')
    // A prompt is only passed when explicitly given: Whisper tends to repeat prompt words
    // (names, company names) when the sound is unclear, so none is sent by default.
    if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 300))
    return { method: 'POST', body: form }
  })
  if (!r.ok) throw new GroqError(`Groq speech-to-text ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status)
  const j = (await r.json()) as { text?: string; segments?: VerboseSegment[] }
  const segs = j.segments?.length
    ? j.segments.filter(keepSegment).map((s) => s.text.trim())
    : [String(j.text ?? '').trim()].filter((t) => t && !HALLUCINATIONS.some((re) => re.test(t)))
  return collapseRepeats(segs.join(' ').replace(/\s+/g, ' ').trim())
}

// ---------- notes model ----------

/** Ask the notes model for one JSON answer. */
export async function chatJson(system: string, user: string, maxTokens = 2500): Promise<string> {
  const model = process.env.GROQ_NOTES_MODEL || 'openai/gpt-oss-120b'
  let extras: Record<string, unknown> = { response_format: { type: 'json_object' }, ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}) }
  for (let round = 0; round < 2; round++) {
    const r = await groqFetch('/chat/completions', () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...extras }),
    }))
    if (r.status === 400 && round === 0) {
      // Some models do not take JSON mode / reasoning settings: ask again without them.
      extras = {}
      continue
    }
    if (!r.ok) throw new GroqError(`Groq notes ${r.status}: ${(await r.text()).slice(0, 300)}`, r.status)
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    return j.choices?.[0]?.message?.content ?? ''
  }
  throw new Error('Groq notes failed')
}
