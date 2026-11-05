/**
 * TalkLoop, the phone system (api.talkloop.ai). One account token, kept in the server's .env as
 * TALKLOOP_TOKEN (never in code, never sent to the browser). The token sees the whole account, so
 * Metriq decides who may hear what; TalkLoop only streams.
 *
 * What we use (from their Swagger, Nov 2026):
 *   GET /users                       who has an extension (id, name, email, extension_id)
 *   GET /cdr?startDate&endDate&page  the call log: uniqueid, calldate, src, dst, direction, disposition,
 *                                    duration, billsec, recording_file, user_id, user{name, extension_id}
 *   GET /cdr/transcription/:uniqueid the transcript, when their transcriber has finished
 *   GET /v2/cdr/recording/:uniqueid  the audio, with Range support (streamed through Metriq)
 * There is no webhook: Metriq polls the call log every few minutes. Click-to-call (originate) is not in
 * their API yet; when the TalkLoop team adds it, TALKLOOP_ORIGINATE=1 (and TALKLOOP_ORIGINATE_PATH if the
 * path differs from /calls/originate) switches the "Call via TalkLoop" buttons on.
 */

export interface TalkLoopUser { id: number; name: string; email: string | null; role: string; extension_id: string | null; registration_status: string | null }
export interface TalkLoopCdr {
  uniqueid: string; calldate: string; src: string; dst: string; direction: string; disposition: string
  duration: number; billsec: number; recording_file: string | null; user_id: number | null; user?: { name: string; extension_id: string } | null; did?: string | null
}
export interface TalkLoopClient {
  users(): Promise<TalkLoopUser[]>
  cdrs(q: { startDate: string; endDate: string; page: number; limit: number }): Promise<{ records: TalkLoopCdr[]; totalPages: number }>
  transcription(uniqueid: string): Promise<string | null>
  /** The raw upstream response for a recording, to pipe to the browser (Range passed through). */
  recording(uniqueid: string, range?: string | null): Promise<globalThis.Response>
  /** Click-to-call: ring the user's extension, then dial `to`; returns the call's uniqueid when TalkLoop gives one. Absent until TalkLoop ships the endpoint. */
  originate?(q: { userId: number; to: string; callerId?: string | null }): Promise<{ uniqueid: string | null }>
}

/** Tests put a stub here, so nothing touches the network. */
let override: TalkLoopClient | null = null
export function useTalkLoopClientForTests(c: TalkLoopClient | null): void { override = c }

export const talkloopConfigured = (): boolean => !!override || !!process.env.TALKLOOP_TOKEN
/** Click-to-call is on when the client can originate (the stub in tests, or TALKLOOP_ORIGINATE=1 on the server). */
export const talkloopDialOn = (): boolean => !!talkloopClient()?.originate

export function talkloopClient(): TalkLoopClient | null {
  if (override) return override
  const token = process.env.TALKLOOP_TOKEN
  if (!token) return null
  const base = (process.env.TALKLOOP_API_URL || 'https://api.talkloop.ai').replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(25_000) })
    if (!r.ok) throw new Error(`TalkLoop ${path.split('?')[0]} answered ${r.status}`)
    return (await r.json()) as T
  }
  return {
    async users() {
      const out: TalkLoopUser[] = []
      for (let page = 1; page <= 20; page++) {
        const j = await get<{ data: TalkLoopUser[]; pagination?: { totalPages?: number } }>(`/users?limit=100&page=${page}`)
        out.push(...(j.data ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email ?? null, role: u.role, extension_id: u.extension_id ?? null, registration_status: u.registration_status ?? null })))
        if (!j.pagination || page >= (j.pagination.totalPages ?? 1)) break
      }
      return out
    },
    async cdrs(q) {
      const j = await get<{ records?: TalkLoopCdr[]; data?: TalkLoopCdr[]; pagination?: { totalPages?: number } }>(`/cdr?limit=${q.limit}&page=${q.page}&sortOrder=ASC&startDate=${encodeURIComponent(q.startDate)}&endDate=${encodeURIComponent(q.endDate)}`)
      return { records: j.records ?? j.data ?? [], totalPages: j.pagination?.totalPages ?? 1 }
    },
    async transcription(uniqueid) {
      try {
        const j = await get<{ transcription_text?: string | null; text?: string | null; status?: string }>(`/cdr/transcription/${encodeURIComponent(uniqueid)}`)
        const t = (j.transcription_text ?? j.text ?? '').trim()
        return t || null
      } catch { return null }
    },
    recording(uniqueid, range) {
      return fetch(`${base}/v2/cdr/recording/${encodeURIComponent(uniqueid)}`, { headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) }, signal: AbortSignal.timeout(60_000) })
    },
    ...(process.env.TALKLOOP_ORIGINATE === '1' ? {
      async originate(q) {
        const r = await fetch(`${base}${process.env.TALKLOOP_ORIGINATE_PATH || '/calls/originate'}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: q.userId, to: q.to, ...(q.callerId ? { caller_id: q.callerId } : {}) }), signal: AbortSignal.timeout(25_000) })
        if (!r.ok) throw new Error(`TalkLoop could not place the call (${r.status})`)
        const j = (await r.json().catch(() => ({}))) as { uniqueid?: string; call_id?: string; data?: { uniqueid?: string } }
        return { uniqueid: j.uniqueid ?? j.call_id ?? j.data?.uniqueid ?? null }
      },
    } : {}),
  }
}
