import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { paddleMessages, paddleSignatureOk, stripeMessages, stripeSignatureOk } from '../lib/billing/providers'
import { billingState, readOnlyReason } from '../lib/billing/billing'

// Phase 1, step 8: the payment providers' messages are only taken when signed, and read the same way.

const secret = 'test-signing-value'
const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }))

describe('signatures', () => {
  it('Stripe: the right signature, not too old', () => {
    const t = Math.floor(Date.now() / 1000)
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body.toString()}`).digest('hex')
    expect(stripeSignatureOk(`t=${t},v1=${v1}`, body, secret)).toBe(true)
    expect(stripeSignatureOk(`t=${t},v1=${v1.replace(/.$/, '0')}`, body, secret)).toBe(false)
    expect(stripeSignatureOk(`t=${t},v1=${v1}`, Buffer.from('{}'), secret)).toBe(false)
    expect(stripeSignatureOk(`t=${t - 600},v1=${crypto.createHmac('sha256', secret).update(`${t - 600}.${body.toString()}`).digest('hex')}`, body, secret)).toBe(false)
  })
  it('Paddle: the right signature, not too old', () => {
    const ts = Math.floor(Date.now() / 1000)
    const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${body.toString()}`).digest('hex')
    expect(paddleSignatureOk(`ts=${ts};h1=${h1}`, body, secret)).toBe(true)
    expect(paddleSignatureOk(`ts=${ts};h1=${h1}`, body, 'other')).toBe(false)
  })
})

describe("reading the providers' messages", () => {
  it('Stripe: checkout, subscription changes, paid and failed invoices', () => {
    expect(stripeMessages({ id: 'e1', type: 'checkout.session.completed', data: { object: { subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'co_1', metadata: { plan: 'starter', interval: 'year' } } } })[0])
      .toMatchObject({ type: 'subscription', companyId: 'co_1', externalId: 'sub_1', plan: 'starter', interval: 'year', status: 'ACTIVE' })
    expect(stripeMessages({ id: 'e2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', current_period_end: 1800000000, metadata: { companyId: 'co_1' } } } })[0])
      .toMatchObject({ status: 'PAST_DUE', periodEnd: new Date(1800000000 * 1000) })
    expect(stripeMessages({ id: 'e3', type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1', amount_due: 2900, tax: 400, currency: 'usd', lines: { data: [{ period: { start: 1700000000, end: 1702592000 } }] } } } })[0])
      .toMatchObject({ type: 'invoice', status: 'FAILED', amountCents: 2900, taxCents: 400, currency: 'USD' })
    expect(stripeMessages({ id: 'e4', type: 'customer.created', data: { object: {} } })[0].type).toBe('ignored')
  })
  it('Paddle: subscriptions and transactions', () => {
    expect(paddleMessages({ event_id: 'p1', event_type: 'subscription.canceled', data: { id: 'sub_p', status: 'canceled', custom_data: { companyId: 'co_2' } } })[0]).toMatchObject({ status: 'CANCELED', companyId: 'co_2' })
    expect(paddleMessages({ event_id: 'p2', event_type: 'transaction.completed', data: { id: 'txn_1', subscription_id: 'sub_p', currency_code: 'EUR', details: { totals: { grand_total: '9900', tax: '1650' } }, custom_data: { companyId: 'co_2', plan: 'business', interval: 'month' } } })[0])
      .toMatchObject({ type: 'invoice', status: 'PAID', amountCents: 9900, taxCents: 1650, currency: 'EUR', plan: 'business' })
  })
})

describe('what a company can do', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const c = (o: object = {}) => ({ id: 'co_1', plan: 'starter', status: 'ACTIVE', trialEndsAt: null, ...o })
  it('trial, trial ended, paid, payment failed (7 days to fix), ended', () => {
    expect(billingState(c({ id: 'company-1', plan: 'internal' }), null, now)).toBe('internal')
    expect(billingState(c({ status: 'TRIAL', trialEndsAt: new Date('2026-11-20') }), null, now)).toBe('trial')
    expect(billingState(c({ status: 'TRIAL', trialEndsAt: new Date('2026-11-01') }), null, now)).toBe('trial_ended')
    expect(billingState(c(), { status: 'ACTIVE', currentPeriodEnd: new Date('2026-12-01'), pastDueSince: null }, now)).toBe('active')
    expect(billingState(c(), { status: 'PAST_DUE', currentPeriodEnd: new Date('2026-12-01'), pastDueSince: new Date('2026-11-06') }, now)).toBe('past_due')
    expect(billingState(c(), { status: 'PAST_DUE', currentPeriodEnd: new Date('2026-12-01'), pastDueSince: new Date('2026-11-01') }, now)).toBe('locked')
    expect(billingState(c(), { status: 'CANCELED', currentPeriodEnd: new Date('2026-11-20'), pastDueSince: null }, now)).toBe('canceling')
    expect(billingState(c(), { status: 'CANCELED', currentPeriodEnd: new Date('2026-11-01'), pastDueSince: null }, now)).toBe('ended')
    expect(readOnlyReason('locked')).toMatch(/7 days/)
    expect(readOnlyReason('active')).toBeNull()
  })
})
