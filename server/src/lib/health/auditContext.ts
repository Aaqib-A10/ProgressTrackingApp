import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

/**
 * Test mode for the hourly self check. Every request the self check makes carries a secret
 * header made fresh at each start (never stored). While such a request runs, any attempt to
 * save, change or delete data is stopped before it reaches the database, emails and pop-up
 * notifications are skipped, and errors are kept for the report instead of the error log.
 * So the check can call every API, including the ones that write, without changing anything.
 */
export interface ProbeState {
  probeId: string
  /** The first save the request tried, e.g. "pmTask.create" (it was stopped). */
  blockedWrite: string | null
  /** An error the request hit, kept for the report. */
  error: { message: string; stack?: string } | null
}

export const auditStore = new AsyncLocalStorage<ProbeState>()

/** Made at start, lives only in memory: only this process can switch test mode on. */
export const AUDIT_SECRET = randomBytes(24).toString('hex')
export const AUDIT_HEADER = 'x-pt-audit'
export const PROBE_HEADER = 'x-pt-audit-probe'

const probes = new Map<string, ProbeState>()

export function openProbe(probeId: string): ProbeState {
  const state: ProbeState = { probeId, blockedWrite: null, error: null }
  probes.set(probeId, state)
  setTimeout(() => probes.delete(probeId), 120_000).unref()
  return state
}

/** What happened inside a probe request (read once by the self check, then forgotten). */
export function takeProbe(probeId: string): ProbeState | null {
  const s = probes.get(probeId) ?? null
  probes.delete(probeId)
  return s
}

export const inAudit = (): boolean => auditStore.getStore() !== undefined

export class AuditWriteBlocked extends Error {
  constructor(what: string) {
    super(`Test mode: stopped a save (${what})`)
    this.name = 'AuditWriteBlocked'
  }
}

const WRITES = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe', 'executeRaw', 'executeRawUnsafe',
])

/** Called before every database operation: in test mode a write is stopped here. */
export function guardWrite(operation: string, model: string | undefined): void {
  const s = auditStore.getStore()
  if (!s || !WRITES.has(operation)) return
  const what = `${model ? model.charAt(0).toLowerCase() + model.slice(1) : 'sql'}.${operation.replace(/^\$/, '')}`
  s.blockedWrite ??= what
  throw new AuditWriteBlocked(what)
}
