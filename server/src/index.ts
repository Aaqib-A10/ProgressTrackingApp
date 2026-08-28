import 'dotenv/config'
import { createApp } from './app'
import { startAttendanceReminders } from './lib/attendanceReminders'
import { startAttendanceViolations } from './lib/attendanceViolations'
import { startAutoCheckout } from './lib/autoCheckout'
import { startMonthlyReports } from './lib/monthlyReportCron'

const PORT = Number(process.env.PORT) || 4000

const app = createApp()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] PulseTrack API listening on http://localhost:${PORT}`)
  startAttendanceReminders()
  startAttendanceViolations()
  startAutoCheckout()
  startMonthlyReports()
})
