import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Printer, ExternalLink } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { useToast } from '../../../components/ui/Toast'
import { billingApi, money, type InvoiceDetail } from '../../../lib/billingApi'
import { errMsg } from './Billing'

/** One invoice, to print or save as a PDF (Phase 1, step 8). The provider's own tax invoice is linked when there is one. */
export default function InvoiceView() {
  const { id = '' } = useParams()
  const { addToast } = useToast()
  const [d, setD] = useState<InvoiceDetail | null>(null)
  useEffect(() => { billingApi.invoice(id).then(setD).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the invoice.') })) }, [id, addToast])
  if (!d) return <div className="mx-auto max-w-2xl"><Card><p className="text-body-md text-ink-muted">Loading…</p></Card></div>
  const i = d.invoice
  const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link to="/app/billing" className="text-body-sm text-ink-muted hover:text-ink">← Billing</Link>
        <div className="ml-auto flex gap-2">
          {i.hostedUrl && <a href={i.hostedUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" leadingIcon={<ExternalLink size={14} />}>Tax invoice</Button></a>}
          <Button size="sm" leadingIcon={<Printer size={14} />} onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>
      <div className="rounded-card border border-line bg-card p-8 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-headline-lg text-ink">{d.seller.name}</p>
            {d.seller.address && <p className="whitespace-pre-line text-body-sm text-ink-muted">{d.seller.address}</p>}
            {d.seller.taxId && <p className="text-body-sm text-ink-muted">Tax ID {d.seller.taxId}</p>}
          </div>
          <div className="text-right">
            <p className="text-label-md uppercase text-ink-muted">Invoice</p>
            <p className="text-headline-md tabular-nums text-ink">#{String(i.number).padStart(5, '0')}</p>
            <p className="text-body-sm text-ink-muted">{day(i.createdAt)}</p>
            <p className={i.status === 'PAID' ? 'text-body-sm font-semibold text-success' : 'text-body-sm font-semibold text-danger'}>{i.status === 'PAID' ? `Paid ${i.paidAt ? day(i.paidAt) : ''}` : i.status === 'FAILED' ? 'Payment failed' : 'Due'}</p>
          </div>
        </div>
        <div className="mt-6">
          <p className="text-label-md uppercase text-ink-muted">Billed to</p>
          <p className="text-body-md font-semibold text-ink">{d.billedTo.company}</p>
          {d.billedTo.name && <p className="text-body-sm text-ink-muted">{d.billedTo.name}{d.billedTo.email ? ` · ${d.billedTo.email}` : ''}</p>}
        </div>
        <table className="mt-6 w-full text-body-md">
          <thead><tr className="border-b border-line text-left text-body-sm text-ink-muted"><th className="py-2 font-medium">What</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-line"><td className="py-3 text-ink">Metriq {i.planLabel}, {i.interval === 'year' ? 'yearly' : 'monthly'}<br /><span className="text-body-sm text-ink-muted">{day(i.periodStart)} to {day(i.periodEnd)}</span></td><td className="py-3 text-right tabular-nums">{money(i.subtotalCents, i.currency)}</td></tr>
            <tr><td className="pt-3 text-right text-ink-muted">Tax</td><td className="pt-3 text-right tabular-nums">{money(i.taxCents, i.currency)}</td></tr>
            <tr><td className="pt-1 text-right font-semibold text-ink">Total</td><td className="pt-1 text-right text-headline-md tabular-nums text-ink">{money(i.amountCents, i.currency)}</td></tr>
          </tbody>
        </table>
        {i.provider === 'test' && <p className="mt-6 text-body-sm text-warning">Test payment: no real money was taken.</p>}
      </div>
    </div>
  )
}
