import 'dotenv/config'
import { prisma } from './lib/prisma'
import { HOME_COMPANY_ID } from './lib/company'
import { createApp } from './app'
import { startAttendanceReminders } from './lib/attendanceReminders'
import { startAttendanceViolations } from './lib/attendanceViolations'
import { startAutoCheckout } from './lib/autoCheckout'
import { startMonthlyReports } from './lib/monthlyReportCron'
import { startTaskReminders } from './lib/taskReminders'
import { startPmDeadlines } from './lib/pm/deadlines'
import { startCallSweeper, setOnCallEnded } from './lib/pm/calls'
import { startMeetingReminders } from './lib/pm/meetings'
import { startCleanup } from './lib/cleanup'
import { scheduleNotes } from './controllers/chatController'
import { recoverNotes } from './lib/pm/notes'
import { captureError, flushErrors } from './lib/health/errors'
import { fillContactsFromRaw } from './lib/dialerRaw'
import { startBreakCutoff } from './lib/breakCutoff'
import { setAuditBaseUrl, startHealthAudit } from './lib/health/audit'

const PORT = Number(process.env.PORT) || 4000

// Process-level safety net. Cron ticks are already individually try/catch-wrapped,
// but a stray rejection/throw elsewhere shouldn't silently take the process down
// with only a default trace. Log both; exit on uncaughtException so the process
// manager (pm2) restarts a process left in an unknown state.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[server] Unhandled promise rejection:', reason)
  const e = reason instanceof Error ? reason : new Error(String(reason))
  captureError({ source: 'SERVER', message: `Unhandled promise rejection: ${e.message}`, stack: e.stack, route: 'process' })
})
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[server] Uncaught exception:', err)
  // Save it to the error log first (at most 2 seconds), then let pm2 restart the process.
  captureError({ source: 'SERVER', message: `Crash: ${err.message}`, stack: err.stack, route: 'process' })
  void Promise.race([flushErrors(), new Promise((r) => setTimeout(r, 2000))]).finally(() => process.exit(1))
})

const app = createApp()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Metriq API listening on http://localhost:${PORT}`)
  // 99 Technologies' time zone stays the one the server was set up with (APP_TIMEZONE).
  if (process.env.APP_TIMEZONE) void prisma.company.updateMany({ where: { id: HOME_COMPANY_ID }, data: { timeZone: process.env.APP_TIMEZONE } }).catch(() => undefined)
  startAttendanceReminders()
  startAttendanceViolations()
  startBreakCutoff()
  startAutoCheckout()
  startMonthlyReports()
  startTaskReminders()
  startPmDeadlines()
  startCallSweeper()
  startMeetingReminders()
  startCleanup()
  setAuditBaseUrl(`http://127.0.0.1:${PORT}`)
  startHealthAudit()
  // Leads imported before the import learned First/Last Name and more website columns.
  void fillContactsFromRaw().then((n) => { if (n) console.log(`[dialer] filled contact name / website / industry on ${n} leads from their import rows`) }).catch((e: Error) => captureError({ source: 'JOB', message: `Fill lead names from import rows: ${e.message}`, stack: e.stack, route: 'job:dialer-fill-contacts' }))
  // When a call with the AI note taker on ends, write its notes.
  setOnCallEnded((c) => { if (c.noteTaker) scheduleNotes(c.callId) })
  // Notes interrupted by a restart or deploy are written now.
  setTimeout(() => { void recoverNotes().catch((e) => console.error('[notes] recovery', e)) }, 30_000) // eslint-disable-line no-console
})
