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
const HALLUCINATIONS = [/^thank(s| you)( so much)?( for watching)?[.!]*$/i, /^(you|bye|okay|\.|\.\.\.)[.!]*$/i, /subtitles? by/i, /please subscribe/i, /^\[?(music|silence|blank_audio|noise)\]?$/i]

interface VerboseSegment { text: string; no_speech_prob?: number; avg_logprob?: number }

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
    if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 600))
    return { method: 'POST', body: form }
  })
  if (!r.ok) throw new GroqError(`Groq speech-to-text ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status)
  const j = (await r.json()) as { text?: string; segments?: VerboseSegment[] }
  const segs = j.segments?.length
    ? j.segments.filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.7)).map((s) => s.text.trim())
    : [String(j.text ?? '').trim()]
  const text = segs.filter((t) => t && !HALLUCINATIONS.some((re) => re.test(t))).join(' ').replace(/\s+/g, ' ').trim()
  return text
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
