import cron from 'node-cron'
import { runTracked } from '../health/jobs'
import { forEachCompany } from '../company'
import { runBillingReminders } from './billing'

/** Every hour: trial-ending and trial-ended emails (each once per company; Phase 1, step 8). */
export function startBillingReminders(): void {
  cron.schedule('23 * * * *', () => {
    runTracked('billing-reminders', () => forEachCompany((companyId) => runBillingReminders(companyId))).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[billing] reminders failed:', e)
    })
  })
}
