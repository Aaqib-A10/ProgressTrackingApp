import cron from 'node-cron'
import { prisma } from './prisma'
import { buildManagementReport } from './reports'
import { renderManagementReportEmail } from './reportEmail'
import { sendMail } from './mail'
import { reportRecipients, previousMonth } from '../controllers/reportsController'

/**
 * Scheduled monthly management report.
 *
 * On the 1st–2nd of each month the tick builds the previous month's CONSOLIDATED
 * report (ITAD + Bid Tracker + Marketing) and emails it to the configured
 * REPORT_RECIPIENTS. A per-(month, department) row in SentMonthlyReport is
 * claimed first (unique constraint), so the report is sent exactly once
 * regardless of how many ticks run or restarts happen. Email is best-effort
 * (no-op without RESEND_API_KEY).
 */
const CLAIM_KEY = 'MANAGEMENT'

export async function runMonthlyReportTick(month: string = previousMonth()): Promise<{ sent: string[] }> {
  const recipients = reportRecipients()
  if (recipients.length === 0) return { sent: [] } // nothing configured — skip silently

  // Claim the send first; a duplicate (already-sent) throws on the unique key.
  try {
    await prisma.sentMonthlyReport.create({ data: { month, department: CLAIM_KEY } })
  } catch {
    return { sent: [] } // already sent this month
  }
  const report = await buildManagementReport(month)
  const { subject, html, text } = renderManagementReportEmail(report)
  await sendMail({ to: recipients, subject, html, text })
  // eslint-disable-next-line no-console
  console.log(`[monthly-report] sent management ${month} to ${recipients.length} recipient(s)`)
  return { sent: [CLAIM_KEY] }
}

/** Start the monthly-report scheduler. Call once on server boot. */
export function startMonthlyReports(): void {
  // Hourly on the 1st–2nd; the per-month claim guarantees a single send even if
  // the process was down for a few hours around the rollover.
  cron.schedule('0 * 1-2 * *', () => {
    runMonthlyReportTick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[monthly-report] tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log('[monthly-report] monthly report scheduler started (1st–2nd, hourly)')
}
