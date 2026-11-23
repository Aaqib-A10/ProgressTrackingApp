import { OPEN_METRA_EVENT, metraReady, useMetraStatus } from '../../lib/metraApi'
import { flagOn, useFlags } from '../../lib/flags'
import { MetraInsights } from './MetraInsights'

/**
 * What Metra noticed, on the dashboard (plan 2026-11, 3.4): the day's brief, the weekly summary and the alerts are
 * shown where people start their day, not only inside Metra. Shows nothing when there is nothing to say or when
 * Metra is off for the company. "Ask Metra" opens the panel with the question.
 */
export function MetraOnDashboard() {
  const status = useMetraStatus()
  useFlags()
  if (!metraReady(status) || !flagOn('metra-proactive')) return null
  const ask = (question: string) => window.dispatchEvent(new CustomEvent(OPEN_METRA_EVENT, { detail: { question } }))
  return (
    <div className="mb-4 empty:hidden">
      <MetraInsights compact onAsk={ask} />
    </div>
  )
}
