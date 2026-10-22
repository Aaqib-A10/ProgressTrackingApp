import { prisma } from '../prisma'
import { captureError } from './errors'

/**
 * Background jobs report here every time they run, so System Health can tell a job that
 * stopped (nothing for too long) from one that is failing (runs, but with an error).
 */

const MIN = 60_000

/** Every job the app runs, how often, and what it does (shown on the health page). */
export const JOBS: { name: string; label: string; everyMs: number | null }[] = [
  { name: 'auto-checkout', label: 'Auto check-out at shift end', everyMs: MIN },
  { name: 'meeting-reminders', label: 'Meeting reminders', everyMs: MIN },
  { name: 'attendance-reminders', label: 'Check-in and check-out reminders', everyMs: 5 * MIN },
  { name: 'attendance-violations', label: 'Late and break alerts', everyMs: 5 * MIN },
  { name: 'task-reminders', label: 'Urgent task reminders', everyMs: 5 * MIN },
  { name: 'pm-deadlines', label: 'Project due and overdue alerts', everyMs: 5 * MIN },
  { name: 'cleanup', label: 'Daily cleanup', everyMs: 24 * 60 * MIN },
  { name: 'health-audit', label: 'Hourly self check', everyMs: 60 * MIN },
  { name: 'monthly-report', label: 'Monthly report email (1st and 2nd of the month)', everyMs: null },
]

/** Run one tick of a job and record how it went. Errors are logged and passed on as before. */
export async function runTracked(name: string, fn: () => Promise<unknown>): Promise<void> {
  const start = Date.now()
  let error: unknown = null
  try {
    await fn()
  } catch (e) {
    error = e
  }
  const at = new Date()
  const ms = Date.now() - start
  const message = error ? (error instanceof Error ? error.message : String(error)) : null
  try {
    await prisma.jobHeartbeat.upsert({
      where: { name },
      create: { name, lastRunAt: at, lastOkAt: error ? null : at, lastError: message?.slice(0, 500) ?? null, lastDurationMs: ms, runs: 1, failures: error ? 1 : 0 },
      update: { lastRunAt: at, ...(error ? { lastError: message!.slice(0, 500), failures: { increment: 1 } } : { lastOkAt: at, lastError: null }), lastDurationMs: ms, runs: { increment: 1 } },
    })
  } catch { /* the heartbeat is best-effort */ }
  if (error) {
    captureError({ source: 'JOB', message: message ?? 'Job failed', stack: error instanceof Error ? error.stack : null, route: `job:${name}` })
    throw error
  }
}
