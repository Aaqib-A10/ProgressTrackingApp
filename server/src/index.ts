import 'dotenv/config'
import { createApp } from './app'
import { startAttendanceReminders } from './lib/attendanceReminders'
import { startAutoCheckout } from './lib/autoCheckout'

const PORT = Number(process.env.PORT) || 4000

const app = createApp()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] PulseTrack API listening on http://localhost:${PORT}`)
  startAttendanceReminders()
  startAutoCheckout()
})
