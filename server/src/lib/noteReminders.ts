import cron from 'node-cron'
import { runTracked } from './health/jobs'
import { forEachCompany } from './company'
import { runNoteReminderTick } from '../controllers/notesController'

/** Note reminders (Notes): every minute, each note whose reminder time has come tells its owner, once. */
export function startNoteReminders(): void {
  cron.schedule('* * * * *', () => {
    runTracked('note-reminders', () => forEachCompany(() => runNoteReminderTick())).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[note-reminders] tick failed:', e)
    })
  })
}
