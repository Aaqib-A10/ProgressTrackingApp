import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { billingApi, type Interval } from '../../../lib/billingApi'
import { errMsg } from './Billing'

/**
 * The built-in test checkout (Phase 1, step 8): stands in for Stripe or Paddle while they are
 * not set up, so paying, failing to pay and changing plan can all be tried without real money.
 */
export default function TestCheckout() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const plan = params.get('plan') ?? 'starter'
  const interval = (params.get('interval') === 'year' ? 'year' : 'month') as Interval
  const [busy, setBusy] = useState(false)
  async function pay(fail: boolean) {
    setBusy(true)
    try {
      await billingApi.testPay(plan, interval, fail)
      addToast({ type: fail ? 'warning' : 'success', message: fail ? 'The test payment failed, as asked.' : 'Paid (test). Your plan is on.' })
      await refresh?.()
      navigate('/app/billing', { replace: true })
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not pay.') }); setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-md space-y-4 pt-6">
      <Card>
        <div className="flex items-center gap-2 text-warning"><FlaskConical size={18} /><span className="text-body-sm font-semibold uppercase tracking-wide">Test checkout</span></div>
        <h1 className="mt-2 text-headline-lg text-ink">{plan[0].toUpperCase() + plan.slice(1)}, paid {interval === 'year' ? 'yearly' : 'monthly'}</h1>
        <p className="mt-1 text-body-md text-ink-muted">No real money moves here. On the live server this is Stripe or Paddle's own payment page.</p>
        <div className="mt-5 grid gap-2">
          <Button disabled={busy} onClick={() => pay(false)}>Pay (test)</Button>
          <Button variant="secondary" disabled={busy} onClick={() => pay(true)}>Make the payment fail</Button>
          <Button variant="ghost" disabled={busy} onClick={() => navigate('/app/billing')}>Back</Button>
        </div>
      </Card>
    </div>
  )
}
