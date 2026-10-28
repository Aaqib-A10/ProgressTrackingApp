import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, CreditCard, FileText, AlertTriangle, Sparkles } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { billingApi, money, type BillingOverview, type Interval } from '../../../lib/billingApi'

/**
 * Billing (Phase 1, step 8): the company's plan, monthly or yearly (two months free), invoices,
 * and what to do when a payment fails. 99 Technologies is never billed.
 */

export function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const PART_LABEL: Record<string, string> = { itad: 'ITAD', dialer: 'Lead Dialer', leadgen: 'Lead Generation', marketing: 'Marketing', ecommerce: 'E-commerce', inventory: 'Inventory', qa: 'Quality Assurance', feedback: 'Feedback', reports: 'Team reports' }
const STATUS_TONE: Record<string, BadgeTone> = { PAID: 'success', FAILED: 'danger', OPEN: 'warning', VOID: 'neutral' }

export default function Billing() {
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [data, setData] = useState<BillingOverview | null>(null)
  const [interval, setInterval] = useState<Interval>('year')
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => billingApi.overview().then((r) => { setData(r); if (r.subscription) setInterval(r.subscription.interval) }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load billing.') }))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.get('paid')) addToast({ type: 'success', message: 'Thank you. Your plan is being switched on; it takes a few seconds.' }) }, [params, addToast])

  if (!data) return <div className="mx-auto max-w-4xl"><Card><p className="text-body-md text-ink-muted">Loading…</p></Card></div>
  if (data.state === 'internal') return <div className="mx-auto max-w-4xl"><Card title="Billing"><p className="text-body-md text-ink-muted">{data.company.name} is on the internal plan: everything on, no limits, never billed.</p></Card></div>
  const sub = data.subscription
  const current = sub && sub.status !== 'CANCELED' ? sub : null

  async function choose(plan: string) {
    setBusy(plan)
    try {
      const r = current ? await billingApi.change(plan, interval) : await billingApi.checkout(plan, interval)
      if ('url' in r && r.url) { if (r.url.startsWith('/')) navigate(r.url); else window.location.assign(r.url); return }
      addToast({ type: 'success', message: 'Plan changed.' })
      await load(); void refresh?.()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not change the plan.') }) } finally { setBusy(null) }
  }
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy('act')
    try { await fn(); addToast({ type: 'success', message: ok }); await load() } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Something went wrong.') }) } finally { setBusy(null) }
  }
  async function portal() {
    try { window.location.assign((await billingApi.portal()).url) } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not open the payment page.') }) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-headline-lg text-ink">Billing</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Your plan, what it costs, and your invoices.</p>
      </div>

      <StateBanner data={data} onPortal={portal} />

      {current && (
        <Card title="Your plan" action={current.hasPortal ? <Button size="sm" variant="secondary" leadingIcon={<CreditCard size={15} />} onClick={portal}>Manage payment</Button> : undefined}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-headline-md text-ink">{data.plans.find((p) => p.key === current.plan)?.label ?? current.plan} · {current.interval === 'year' ? 'yearly' : 'monthly'}</p>
              <p className="text-body-sm text-ink-muted">{current.cancelAtPeriodEnd ? `Ends on ${fmtDate(current.currentPeriodEnd)}.` : `Renews on ${fmtDate(current.currentPeriodEnd)}.`}{data.provider?.test ? ' (Test payments)' : ''}</p>
            </div>
            <div className="ml-auto">
              {current.cancelAtPeriodEnd
                ? <Button size="sm" disabled={!!busy} onClick={() => act(billingApi.resume, 'Your plan carries on.')}>Keep my plan</Button>
                : <Button size="sm" variant="ghost" className="text-danger" disabled={!!busy} onClick={() => act(billingApi.cancel, 'Cancelled. It runs to the end of what is paid.')}>Cancel plan</Button>}
            </div>
          </div>
        </Card>
      )}

      {data.canPay && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-headline-md text-ink">{current ? 'Change plan' : 'Choose a plan'}</h2>
            <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-btn border border-line bg-slate-50 p-0.5">
              {([['month', 'Monthly'], ['year', 'Yearly (2 months free)']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={interval === v} onClick={() => setInterval(v)} className={cn('rounded-[6px] px-3 py-1.5 text-body-sm font-medium', interval === v ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>{l}</button>
              ))}
            </div>
          </div>
          <div className={cn('grid gap-4', data.plans.length > 1 ? 'md:grid-cols-2' : 'max-w-md')}>
            {data.plans.map((p) => {
              const isCurrent = current?.plan === p.key && current.interval === interval
              const price = interval === 'year' ? p.priceYearly : p.priceMonthly
              return (
                <Card key={p.key} className={cn(isCurrent && 'ring-2 ring-primary/30')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-headline-md text-ink">{p.label}</p>
                      <p className="mt-1"><span className="text-metric-lg tabular-nums text-ink">${price}</span><span className="text-body-sm text-ink-muted"> / {interval === 'year' ? 'year' : 'month'}</span></p>
                      {interval === 'year' && <p className="text-body-sm text-success">${p.priceMonthly * 12 - p.priceYearly} less than monthly</p>}
                    </div>
                    {p.key === 'business' && !isCurrent && <Badge tone="accent"><Sparkles size={12} className="mr-1 inline" />Everything</Badge>}
                    {isCurrent && <Badge tone="primary">Your plan</Badge>}
                  </div>
                  <ul className="mt-4 space-y-1.5 text-body-md text-ink">
                    <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />{p.people === null ? 'Any number of people' : p.people === 1 ? 'Just you' : `Up to ${p.people} people`}</li>
                    <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />{p.storageGb} GB of files</li>
                    <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />{p.aiHours} hours of AI meeting notes a month</li>
                    <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />Daily reports, attendance, projects, chat and calls</li>
                    {p.partsLeftOut.length > 0 && <li className="text-body-sm text-ink-muted">Not included: {p.partsLeftOut.map((k) => PART_LABEL[k] ?? k).join(', ')}</li>}
                  </ul>
                  <Button className="mt-5 w-full" variant={isCurrent ? 'secondary' : 'primary'} disabled={isCurrent || !!busy || !data.provider} onClick={() => choose(p.key)}>
                    {isCurrent ? 'Your plan' : busy === p.key ? 'One moment…' : current ? `Switch to ${p.label}` : `Choose ${p.label}`}
                  </Button>
                </Card>
              )
            })}
          </div>
          {!data.provider && <p className="text-body-sm text-ink-muted">Payments are being set up. Write to us from the Help button and we will set your plan by hand.</p>}
          <p className="text-body-sm text-ink-muted">Prices are in US dollars; tax is added at checkout where it applies. Changing plan in the middle of a period is worked out to the day.</p>
        </>
      )}

      {data.canPay && (
        <Card title="Invoices" flush>
          {data.invoices.length === 0 ? <p className="px-5 py-4 text-body-md text-ink-muted">No invoices yet.</p> : (
            <ul className="divide-y divide-line">
              {data.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <FileText size={16} className="text-ink-muted" />
                  <span className="min-w-[90px] tabular-nums text-body-md text-ink">#{String(i.number).padStart(5, '0')}</span>
                  <span className="min-w-[120px] text-body-sm text-ink-muted">{fmtDate(i.createdAt)}</span>
                  <span className="min-w-[90px] tabular-nums text-body-md text-ink">{money(i.amountCents, i.currency)}</span>
                  <Badge tone={STATUS_TONE[i.status]}>{i.status === 'PAID' ? 'Paid' : i.status === 'FAILED' ? 'Failed' : i.status === 'OPEN' ? 'Due' : 'Void'}</Badge>
                  <Link to={`/app/billing/invoices/${i.id}`} className="ml-auto text-body-sm font-semibold text-primary hover:underline">View</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function StateBanner({ data, onPortal }: { data: BillingOverview; onPortal: () => void }) {
  const s = data.state
  const days = data.company.trialEndsAt ? Math.ceil((new Date(data.company.trialEndsAt).getTime() - Date.now()) / 86400_000) : null
  const box = (tone: string, text: string, action?: ReactNode) => (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 text-body-md', tone)}>
      <AlertTriangle size={18} className="shrink-0" /><span className="flex-1">{text}</span>{action}
    </div>
  )
  if (s === 'trial') return box('border-primary/20 bg-primary/5 text-ink', `Free trial: ${days} day${days === 1 ? '' : 's'} left, with everything on. Choose a plan any time; nothing stops when you do.`)
  if (s === 'trial_ended') return box('border-danger/30 bg-danger/5 text-danger', 'Your free trial has ended. Everything is still there and can be looked at; choose a plan to keep adding to it.')
  if (s === 'past_due') return box('border-warning/40 bg-warning/10 text-ink', 'Your last payment did not go through. Please update your card within 7 days; after that Metriq becomes read-only until it is paid.', data.subscription?.hasPortal ? <Button size="sm" onClick={onPortal}>Update card</Button> : undefined)
  if (s === 'locked') return box('border-danger/30 bg-danger/5 text-danger', 'Your payment has not gone through for 7 days, so Metriq is read-only. Pay to open it again; nothing has been lost.', data.subscription?.hasPortal ? <Button size="sm" onClick={onPortal}>Update card</Button> : undefined)
  if (s === 'ended') return box('border-danger/30 bg-danger/5 text-danger', 'Your plan has ended. Everything is still there and can be looked at; choose a plan to keep going.')
  return null
}
