import crypto from 'node:crypto'
import type { Request } from 'express'

/**
 * Payment providers (Phase 1, step 8). Metriq talks to one of them through this small shape,
 * so Stripe and Paddle (and the built-in test one) are interchangeable. Which one is used:
 *   BILLING_PROVIDER = stripe | paddle | test   (test is only allowed away from the live server,
 *                                                 or with BILLING_TEST_MODE=1)
 * Keys live only on the server (never in code):
 *   Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>_<MONTH|YEAR>
 *   Paddle: PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_PRICE_<PLAN>_<MONTH|YEAR>, PADDLE_ENV=sandbox|live
 */

export type Interval = 'month' | 'year'
export type ProviderKey = 'test' | 'stripe' | 'paddle'

/** A provider's message, in Metriq's words. */
export type BillingMessage =
  | { id: string; type: 'subscription'; companyId: string | null; externalId: string; customerId?: string | null; plan?: string | null; interval?: Interval | null; status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; periodEnd?: Date | null; cancelAtPeriodEnd?: boolean }
  | { id: string; type: 'invoice'; companyId: string | null; externalId: string; subscriptionId?: string | null; plan?: string | null; interval?: Interval | null; status: 'PAID' | 'FAILED' | 'OPEN'; amountCents: number; taxCents: number; currency: string; periodStart: Date; periodEnd: Date; hostedUrl?: string | null }
  | { id: string; type: 'ignored'; raw: string }

export interface CheckoutInput { companyId: string; companyName: string; email: string; plan: string; interval: Interval; returnUrl: string; customerId?: string | null }

export interface Provider {
  key: ProviderKey
  label: string
  configured: () => boolean
  checkout: (i: CheckoutInput) => Promise<{ url: string }>
  /** Where a customer changes their card, sees tax invoices, etc. (null when the provider has no such page). */
  portal: (customerId: string, returnUrl: string) => Promise<{ url: string } | null>
  changePlan: (externalId: string, plan: string, interval: Interval) => Promise<void>
  cancel: (externalId: string, atPeriodEnd: boolean) => Promise<void>
  /** Check the message really comes from the provider; null if it does not. */
  readWebhook: (req: Request, raw: Buffer) => BillingMessage[] | null
}

const env = (k: string) => process.env[k] ?? ''
const priceEnv = (prefix: string, plan: string, interval: Interval) => env(`${prefix}_PRICE_${plan.toUpperCase()}_${interval === 'year' ? 'YEAR' : 'MONTH'}`)
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const sec = (n: unknown) => (typeof n === 'number' ? new Date(n * 1000) : null)

// ------------------------------------------------------------------ Stripe

async function stripe(path: string, form: Record<string, string>, method = 'POST'): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(form),
  })
  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Stripe: ${(body.error as { message?: string } | undefined)?.message ?? res.status}`)
  return body
}

/** Stripe-Signature: t=…,v1=… with HMAC-SHA256 of "t.body"; at most 5 minutes old. */
export function stripeSignatureOk(header: string, raw: Buffer, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > 300) return false
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex')
  return header.split(',').filter((p) => p.startsWith('v1=')).some((p) => safeEqual(p.slice(3), want))
}

export function stripeMessages(ev: Record<string, unknown>): BillingMessage[] {
  const id = String(ev.id)
  const o = ((ev.data as { object?: Record<string, unknown> })?.object ?? {}) as Record<string, unknown>
  const meta = (o.metadata ?? {}) as Record<string, string>
  switch (ev.type) {
    case 'checkout.session.completed':
      if (!o.subscription) return [{ id, type: 'ignored', raw: String(ev.type) }]
      return [{ id, type: 'subscription', companyId: (o.client_reference_id as string) ?? meta.companyId ?? null, externalId: String(o.subscription), customerId: (o.customer as string) ?? null, plan: meta.plan ?? null, interval: (meta.interval as Interval) ?? null, status: 'ACTIVE' }]
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
    case 'customer.subscription.deleted': {
      const st = String(o.status)
      const status = ev.type === 'customer.subscription.deleted' || st === 'canceled' ? 'CANCELED' : st === 'past_due' || st === 'unpaid' ? 'PAST_DUE' : 'ACTIVE'
      return [{ id, type: 'subscription', companyId: meta.companyId ?? null, externalId: String(o.id), customerId: (o.customer as string) ?? null, plan: meta.plan ?? null, interval: (meta.interval as Interval) ?? null, status, periodEnd: sec(o.current_period_end), cancelAtPeriodEnd: !!o.cancel_at_period_end }]
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const line = ((o.lines as { data?: { period?: { start?: number; end?: number } }[] })?.data ?? [])[0]
      const subMeta = ((o.subscription_details as { metadata?: Record<string, string> })?.metadata ?? {}) as Record<string, string>
      return [{
        id, type: 'invoice', companyId: subMeta.companyId ?? meta.companyId ?? null, externalId: String(o.id), subscriptionId: (o.subscription as string) ?? null,
        plan: subMeta.plan ?? null, interval: (subMeta.interval as Interval) ?? null, status: ev.type === 'invoice.paid' ? 'PAID' : 'FAILED',
        amountCents: Number(o.amount_due ?? o.total ?? 0), taxCents: Number(o.tax ?? 0), currency: String(o.currency ?? 'usd').toUpperCase(),
        periodStart: sec(line?.period?.start) ?? new Date(), periodEnd: sec(line?.period?.end) ?? new Date(), hostedUrl: (o.hosted_invoice_url as string) ?? null,
      }]
    }
    default:
      return [{ id, type: 'ignored', raw: String(ev.type) }]
  }
}

const stripeProvider: Provider = {
  key: 'stripe',
  label: 'Stripe',
  configured: () => !!(env('STRIPE_SECRET_KEY') && env('STRIPE_WEBHOOK_SECRET')),
  async checkout(i) {
    const price = priceEnv('STRIPE', i.plan, i.interval)
    if (!price) throw new Error(`No Stripe price set for ${i.plan} (${i.interval})`)
    const meta = { companyId: i.companyId, plan: i.plan, interval: i.interval }
    const form: Record<string, string> = {
      mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      success_url: `${i.returnUrl}?paid=1`, cancel_url: i.returnUrl, client_reference_id: i.companyId,
      'automatic_tax[enabled]': 'true', 'tax_id_collection[enabled]': 'true', allow_promotion_codes: 'true',
      ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [`subscription_data[metadata][${k}]`, v])),
      ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])),
      ...(i.customerId ? { customer: i.customerId, 'customer_update[address]': 'auto', 'customer_update[name]': 'auto' } : { customer_email: i.email }),
    }
    const s = await stripe('checkout/sessions', form)
    return { url: String(s.url) }
  },
  async portal(customerId, returnUrl) {
    const s = await stripe('billing_portal/sessions', { customer: customerId, return_url: returnUrl })
    return { url: String(s.url) }
  },
  async changePlan(externalId, plan, interval) {
    const price = priceEnv('STRIPE', plan, interval)
    if (!price) throw new Error(`No Stripe price set for ${plan} (${interval})`)
    const sub = await stripe(`subscriptions/${externalId}`, {}, 'GET')
    const itemId = ((sub.items as { data?: { id: string }[] })?.data ?? [])[0]?.id
    await stripe(`subscriptions/${externalId}`, { 'items[0][id]': itemId, 'items[0][price]': price, proration_behavior: 'create_prorations', 'metadata[plan]': plan, 'metadata[interval]': interval })
  },
  async cancel(externalId, atPeriodEnd) {
    if (atPeriodEnd) await stripe(`subscriptions/${externalId}`, { cancel_at_period_end: 'true' })
    else await stripe(`subscriptions/${externalId}`, {}, 'DELETE')
  },
  readWebhook(req, raw) {
    const sig = String(req.headers['stripe-signature'] ?? '')
    if (!sig || !stripeSignatureOk(sig, raw, env('STRIPE_WEBHOOK_SECRET'))) return null
    try { return stripeMessages(JSON.parse(raw.toString('utf8')) as Record<string, unknown>) } catch { return null }
  },
}

// ------------------------------------------------------------------ Paddle (Billing)

const paddleBase = () => (env('PADDLE_ENV') === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com')
async function paddle(path: string, body?: unknown, method = 'POST'): Promise<Record<string, unknown>> {
  const res = await fetch(`${paddleBase()}/${path}`, { method, headers: { Authorization: `Bearer ${env('PADDLE_API_KEY')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Paddle: ${(json.error as { detail?: string } | undefined)?.detail ?? res.status}`)
  return (json.data ?? json) as Record<string, unknown>
}

/** Paddle-Signature: ts=…;h1=… with HMAC-SHA256 of "ts:body"; at most 5 minutes old. */
export function paddleSignatureOk(header: string, raw: Buffer, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(';').map((p) => p.split('=') as [string, string]))
  const ts = Number(parts.ts)
  if (!ts || !parts.h1 || Math.abs(now / 1000 - ts) > 300) return false
  const want = crypto.createHmac('sha256', secret).update(`${ts}:${raw.toString('utf8')}`).digest('hex')
  return safeEqual(parts.h1, want)
}

const iso = (s: unknown) => (typeof s === 'string' ? new Date(s) : null)
export function paddleMessages(ev: Record<string, unknown>): BillingMessage[] {
  const id = String(ev.event_id ?? ev.notification_id ?? '')
  const d = (ev.data ?? {}) as Record<string, unknown>
  const custom = (d.custom_data ?? {}) as Record<string, string>
  const t = String(ev.event_type)
  if (t.startsWith('subscription.')) {
    const st = String(d.status)
    const status = st === 'canceled' ? 'CANCELED' : st === 'past_due' ? 'PAST_DUE' : 'ACTIVE'
    const period = (d.current_billing_period ?? {}) as { ends_at?: string }
    const scheduled = (d.scheduled_change ?? null) as { action?: string } | null
    return [{ id, type: 'subscription', companyId: custom.companyId ?? null, externalId: String(d.id), customerId: (d.customer_id as string) ?? null, plan: custom.plan ?? null, interval: (custom.interval as Interval) ?? null, status, periodEnd: iso(period.ends_at), cancelAtPeriodEnd: scheduled?.action === 'cancel' }]
  }
  if (t === 'transaction.completed' || t === 'transaction.payment_failed') {
    const totals = ((d.details as { totals?: { grand_total?: string; tax?: string } })?.totals ?? {})
    const period = (d.billing_period ?? {}) as { starts_at?: string; ends_at?: string }
    return [{
      id, type: 'invoice', companyId: custom.companyId ?? null, externalId: String(d.id), subscriptionId: (d.subscription_id as string) ?? null,
      plan: custom.plan ?? null, interval: (custom.interval as Interval) ?? null, status: t === 'transaction.completed' ? 'PAID' : 'FAILED',
      amountCents: Number(totals.grand_total ?? 0), taxCents: Number(totals.tax ?? 0), currency: String(d.currency_code ?? 'USD'),
      periodStart: iso(period.starts_at) ?? new Date(), periodEnd: iso(period.ends_at) ?? new Date(), hostedUrl: null,
    }]
  }
  return [{ id, type: 'ignored', raw: t }]
}

const paddleProvider: Provider = {
  key: 'paddle',
  label: 'Paddle',
  configured: () => !!(env('PADDLE_API_KEY') && env('PADDLE_WEBHOOK_SECRET')),
  async checkout(i) {
    const price = priceEnv('PADDLE', i.plan, i.interval)
    if (!price) throw new Error(`No Paddle price set for ${i.plan} (${i.interval})`)
    // Paddle is the seller of record: it adds and pays the tax, and its checkout asks for the address.
    const tx = await paddle('transactions', { items: [{ price_id: price, quantity: 1 }], custom_data: { companyId: i.companyId, plan: i.plan, interval: i.interval }, ...(i.customerId ? { customer_id: i.customerId } : {}), checkout: { url: i.returnUrl } })
    const url = (tx.checkout as { url?: string } | undefined)?.url
    if (!url) throw new Error('Paddle did not give a checkout link (set a default payment link in Paddle)')
    return { url }
  },
  async portal(customerId) {
    const s = await paddle(`customers/${customerId}/portal-sessions`, {})
    const url = ((s.urls as { general?: { overview?: string } })?.general?.overview) ?? null
    return url ? { url } : null
  },
  async changePlan(externalId, plan, interval) {
    const price = priceEnv('PADDLE', plan, interval)
    if (!price) throw new Error(`No Paddle price set for ${plan} (${interval})`)
    await paddle(`subscriptions/${externalId}`, { items: [{ price_id: price, quantity: 1 }], proration_billing_mode: 'prorated_immediately', custom_data: { plan, interval } }, 'PATCH')
  },
  async cancel(externalId, atPeriodEnd) {
    await paddle(`subscriptions/${externalId}/cancel`, { effective_from: atPeriodEnd ? 'next_billing_period' : 'immediately' })
  },
  readWebhook(req, raw) {
    const sig = String(req.headers['paddle-signature'] ?? '')
    if (!sig || !paddleSignatureOk(sig, raw, env('PADDLE_WEBHOOK_SECRET'))) return null
    try { return paddleMessages(JSON.parse(raw.toString('utf8')) as Record<string, unknown>) } catch { return null }
  },
}

// ------------------------------------------------------------------ test (built in)

/**
 * The built-in test provider: a pretend checkout page inside Metriq ("Pay (test)" / "Make the
 * payment fail"), so plans, invoices, failed payments and upgrades can all be tried without
 * real money. Never on the live server unless BILLING_TEST_MODE=1.
 */
const testProvider: Provider = {
  key: 'test',
  label: 'Test payments',
  configured: () => process.env.NODE_ENV !== 'production' || env('BILLING_TEST_MODE') === '1',
  async checkout(i) {
    const q = new URLSearchParams({ plan: i.plan, interval: i.interval })
    return { url: `/app/billing/test-checkout?${q}` }
  },
  async portal() { return null },
  async changePlan() { /* applied straight away by the billing layer */ },
  async cancel() { /* applied straight away by the billing layer */ },
  readWebhook() { return null },
}

export const PROVIDERS: Record<ProviderKey, Provider> = { stripe: stripeProvider, paddle: paddleProvider, test: testProvider }

/** The provider in use: the one named in BILLING_PROVIDER if it has its keys; else test where allowed; else none. */
export function activeProvider(): Provider | null {
  const named = env('BILLING_PROVIDER') as ProviderKey
  if (named && PROVIDERS[named]?.configured()) return PROVIDERS[named]
  if (!named && testProvider.configured()) return testProvider
  return null
}
