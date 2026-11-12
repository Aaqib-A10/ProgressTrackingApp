/**
 * Metra's one service layer for the language model (ITAD update 12 Nov, section 5: "behind one service layer so
 * GPT or Claude can be chosen later"). It speaks the OpenAI-compatible chat API with streaming and tool calls,
 * which Groq (the default: openai/gpt-oss-120b), OpenAI and Anthropic's compatibility endpoint all serve.
 *
 * Env (server/.env):
 *   GROQ_API_KEY            the key (already used by the meeting note taker)
 *   METRA_MODEL             default openai/gpt-oss-120b
 *   METRA_LLM_BASE_URL      default https://api.groq.com/openai/v1  (OpenAI: https://api.openai.com/v1,
 *                           Claude: https://api.anthropic.com/v1/ with METRA_LLM_API_KEY and a Claude model id)
 *   METRA_LLM_API_KEY       overrides GROQ_API_KEY for another provider
 */

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export interface ToolSpec { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export const llmBase = () => (process.env.METRA_LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')
export const llmKey = () => process.env.METRA_LLM_API_KEY || process.env.GROQ_API_KEY || ''
export const llmModel = () => process.env.METRA_MODEL || 'openai/gpt-oss-120b'
export const llmReady = (): boolean => !!llmKey()

export class LlmError extends Error { constructor(message: string, public status = 0) { super(message) } }

export type LlmEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'done'; finish: string | null; tokensIn: number; tokensOut: number }

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
/** The model that served the last turn (main or fallback), for the answer's record. */
export let modelUsed = ''

/**
 * Models to fall back on when the main one is rate limited (Groq limits each model separately, so a busy
 * gpt-oss-120b does not make gpt-oss-20b busy). METRA_FALLBACK_MODELS="a,b"; empty = no fallback.
 */
export const fallbackModels = (): string[] => (process.env.METRA_FALLBACK_MODELS ?? 'openai/gpt-oss-20b').split(',').map((s) => s.trim()).filter((m) => m && m !== llmModel())
/**
 * Where an answer can come from, in order: the main model, the other models on the same provider (Groq limits each
 * model separately), then backup servers on other providers, e.g. the team's own Ollama server:
 *   METRA_BACKUP_ENDPOINTS="http://ollama-host:11434/v1|gpt-oss:20b"   (base|model|key, comma-separated; key optional)
 * A busy (429), failing (5xx) or unreachable endpoint is skipped for a while, so nobody waits on it.
 */
interface Endpoint { id: string; base: string; key: string; model: string }
export function endpoints(): Endpoint[] {
  const main = [llmModel(), ...fallbackModels()].map((model) => ({ id: `${llmBase()}#${model}`, base: llmBase(), key: llmKey(), model }))
  const backups = (process.env.METRA_BACKUP_ENDPOINTS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [base, model, key] = s.split('|').map((x) => x?.trim())
    return { id: `${base}#${model}`, base: (base ?? '').replace(/\/+$/, ''), key: key || 'none', model: model ?? '' }
  }).filter((e) => e.base && e.model)
  return [...main, ...backups]
}

/** Endpoints that were busy or down recently, and until when (the next question goes straight to one that is free). */
const busyUntil = new Map<string, number>()
let usedId = ''
/** Tests: forget which models were busy. */
export function resetModelBusy(): void { busyUntil.clear() }

/** One streamed model turn. On a rate limit or an outage it moves to the next endpoint; when all are busy it waits (up to 30 s). */
export async function* streamChat(o: { messages: LlmMessage[]; tools?: ToolSpec[]; toolChoice?: 'auto' | 'none'; maxTokens?: number; signal?: AbortSignal; onWait?: (seconds: number) => void }): AsyncGenerator<LlmEvent> {
  const list = endpoints()
  const bodyFor = (model: string) => JSON.stringify({
    model, messages: o.messages, stream: true, temperature: 0.2, max_completion_tokens: o.maxTokens ?? 1800, max_tokens: o.maxTokens ?? 1800,
    ...(o.tools?.length ? { tools: o.tools, tool_choice: o.toolChoice ?? 'auto', parallel_tool_calls: true } : {}),
    ...(/gpt-oss/.test(model) ? { reasoning_effort: process.env.METRA_REASONING || 'low' } : {}),
    stream_options: { include_usage: true },
  })
  let res: Response | null = null
  let used = list[0]
  for (let attempt = 0; attempt < list.length + 4; attempt++) {
    // The first endpoint that is not known to be busy; if all are, the one free soonest.
    const free = list.find((e) => (busyUntil.get(e.id) ?? 0) <= Date.now())
    used = free ?? [...list].sort((a, b) => (busyUntil.get(a.id) ?? 0) - (busyUntil.get(b.id) ?? 0))[0]
    if (!free) {
      const wait = Math.max(500, (busyUntil.get(used.id) ?? 0) - Date.now())
      if (wait > 30_000) break
      o.onWait?.(Math.ceil(wait / 1000))
      await sleep(wait)
    }
    // An endpoint gets 90 s to start answering (a local model may be loading); then it counts as down.
    const ctl = new AbortController()
    const stopTimer = setTimeout(() => ctl.abort(), 90_000)
    const onAbort = () => ctl.abort()
    o.signal?.addEventListener('abort', onAbort)
    try {
      res = await fetch(`${used.base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${used.key}`, 'Content-Type': 'application/json' }, body: bodyFor(used.model), signal: ctl.signal })
    } catch (e) {
      if (o.signal?.aborted) throw e
      res = null
      busyUntil.set(used.id, Date.now() + 60_000) // unreachable: skip it for a minute
      continue
    } finally {
      clearTimeout(stopTimer)
      o.signal?.removeEventListener('abort', onAbort)
    }
    // 413: this question is too big for that model's per-minute size limit (free Groq: 8K tokens); another can take it.
    if (res.status === 413) {
      busyUntil.set(used.id, Date.now() + 60_000)
      await res.text().catch(() => '')
      res = null
      continue
    }
    if (res.status !== 429 && res.status < 500) break
    const ra = Number(res.headers.get('retry-after'))
    busyUntil.set(used.id, Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 + 250 : 4000 * 2 ** Math.min(attempt, 3)))
    await res.text().catch(() => '')
    res = null
  }
  modelUsed = used.model
  usedId = used.id
  // eslint-disable-next-line no-console
  if (process.env.METRA_DEBUG) console.log(`[metra] answered by ${used.model} at ${used.base.replace(/^https?:\/\//, '')}`)
  if (!res || !res.ok || !res.body) {
    const t = res ? (await res.text().catch(() => '')).slice(0, 300) : ''
    throw new LlmError(!res || res.status === 429 ? 'The AI model is busy (rate limit). Try again in a minute.' : `The AI model answered ${res?.status ?? 'nothing'}${t ? `: ${t}` : ''}`, res?.status ?? 0)
  }

  const calls = new Map<number, ToolCall>()
  let finish: string | null = null, tokensIn = 0, tokensOut = 0
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j: { choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }; error?: { message?: string; code?: string } }
      try { j = JSON.parse(data) } catch { continue }
      // An error sent inside the stream (Groq does this for limits hit mid-answer): mark the model busy and report it.
      const streamErr = j.error ?? j.x_groq?.error
      if (streamErr) {
        busyUntil.set(usedId, Date.now() + 20_000)
        throw new LlmError(`The AI model stopped: ${streamErr.message ?? 'error'}`, 429)
      }
      const u = j.usage ?? j.x_groq?.usage
      if (u) { tokensIn = u.prompt_tokens ?? tokensIn; tokensOut = u.completion_tokens ?? tokensOut }
      const c = j.choices?.[0]
      if (!c) continue
      if (c.delta?.content) yield { type: 'delta', text: c.delta.content }
      for (const tc of c.delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.function.name += tc.function.name
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
        calls.set(tc.index, cur)
      }
      if (c.finish_reason) finish = c.finish_reason
    }
  }
  if (calls.size) yield { type: 'tool_calls', calls: [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}` })) }
  yield { type: 'done', finish, tokensIn, tokensOut }
}

/** A short non-streamed answer (titles, the daily brief). */
export async function completeText(messages: LlmMessage[], maxTokens = 600, signal?: AbortSignal): Promise<string> {
  let out = ''
  for await (const e of streamChat({ messages, maxTokens, signal })) if (e.type === 'delta') out += e.text
  return out.trim()
}
