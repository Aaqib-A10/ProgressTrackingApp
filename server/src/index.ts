import 'dotenv/config'
import { createApp } from './app'
import { startAttendanceReminders } from './lib/attendanceReminders'
import { startAttendanceViolations } from './lib/attendanceViolations'
import { startAutoCheckout } from './lib/autoCheckout'
import { startMonthlyReports } from './lib/monthlyReportCron'

const PORT = Number(process.env.PORT) || 4000

// Process-level safety net. Cron ticks are already individually try/catch-wrapped,
// but a stray rejection/throw elsewhere shouldn't silently take the process down
// with only a default trace. Log both; exit on uncaughtException so the process
// manager (pm2) restarts a process left in an unknown state.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[server] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[server] Uncaught exception:', err)
  process.exit(1)
})

const app = createApp()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Metriq API listening on http://localhost:${PORT}`)
  startAttendanceReminders()
  startAttendanceViolations()
  startAutoCheckout()
  startMonthlyReports()
})
