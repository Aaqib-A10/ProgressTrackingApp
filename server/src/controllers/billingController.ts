import type { Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HOME_COMPANY_ID } from '../lib/company'
import { loadPowers } from '../lib/permissions'
import { PLANS, planOf, type PlanKey } from '../lib/plans'
import { appUrl } from '../lib/mail'
import { activeProvider, PROVIDERS, type Interval, type ProviderKey } from '../lib/billing/providers'
import { sellerDetails } from '../lib/platform/settings'
import { SELLABLE, applyMessage, billingState, cannotFit, priceCents, testPayment } from '../lib/billing/billing'

/**
 * Billing (Phase 1, step 8), for the company's Super Admin: the plan, monthly or yearly,
 * checkout, change or cancel, invoices; and the payment providers' messages (webhooks).
 */

class Refused extends Error { constructor(public status: number, message: string) { super(message) } }
function send(res: Response, e: unknown): void {
  if (e instanceof Refused) { res.status(e.status).json({ error: e.message }); return }
  if (e instanceof z.ZodError) { res.status(400).json({ error: e.issues[0]?.message ?? 'Invalid input' }); return }
  throw e
}
const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<void>) => async (req: AuthedRequest, res: Response) => { try { await fn(req, res) } catch (e) { send(res, e) } }

async function payer(req: AuthedRequest) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, email: true, companyId: true } })
  if (!(await loadPowers(u.id)).includes('company.settings')) throw new Refused(403, 'Only the Super Admin looks after billing.')
  if (u.companyId === HOME_COMPANY_ID) throw new Refused(400, '99 Technologies is on the internal plan and is never billed.')
  const company = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId }, include: { subscription: true } })
  if (company.plan === 'internal') throw new Refused(400, 'This company is on the internal plan and is never billed.')
  return { u, company }
}
const planSchema = z.object({ plan: z.enum(SELLABLE as [PlanKey, ...PlanKey[]]), interval: z.enum(['month', 'year']) })

/** GET /api/billing — the plan, what it costs, the invoices. */
export const overview = wrap(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, companyId: true } })
  const canPay = (await loadPowers(u.id)).includes('company.settings')
  const company = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId }, include: { subscription: true } })
  const state = billingState(company, company.subscription)
  const provider = activeProvider()
  const invoices = canPay ? await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }) : []
  res.json({
    state, canPay,
    company: { name: company.name, kind: company.kind, plan: company.plan, trialEndsAt: company.status === 'TRIAL' ? company.trialEndsAt : null },
    subscription: company.subscription && canPay ? {
      plan: company.subscription.plan, interval: company.subscription.interval, status: company.subscription.status, currentPeriodEnd: company.subscription.currentPeriodEnd,
      cancelAtPeriodEnd: company.subscription.cancelAtPeriodEnd, pastDueSince: company.subscription.pastDueSince, provider: company.subscription.provider,
      hasPortal: !!company.subscription.customerId && company.subscription.provider !== 'test',
    } : null,
    plans: SELLABLE.filter((k) => (company.kind === 'PERSONAL' ? k === 'personal' : k !== 'personal')).map((k) => ({
      key: k, label: PLANS[k].label, priceMonthly: PLANS[k].priceMonthly, priceYearly: PLANS[k].priceYearly,
      people: PLANS[k].people, storageGb: PLANS[k].storageGb, aiHours: PLANS[k].aiHours, partsLeftOut: PLANS[k].areasOff,
    })),
    provider: provider ? { key: provider.key, label: provider.label, test: provider.key === 'test' } : null,
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, plan: i.plan, interval: i.interval, amountCents: i.amountCents, taxCents: i.taxCents, currency: i.currency, status: i.status, periodStart: i.periodStart, periodEnd: i.periodEnd, paidAt: i.paidAt, hostedUrl: i.hostedUrl, createdAt: i.createdAt })),
  })
})

/** POST /api/billing/checkout { plan, interval } — off to pay (a new plan); with a plan already, it changes it. */
export const checkout = wrap(async (req, res) => {
  const { u, company } = await payer(req)
  const body = planSchema.parse(req.body)
  if (company.kind === 'PERSONAL' && body.plan !== 'personal') throw new Refused(400, 'A personal workspace is on the Personal plan. Start a team to use the others.')
  const fit = await cannotFit(company.id, body.plan)
  if (fit) throw new Refused(409, fit)
  const provider = activeProvider()
  if (!provider) throw new Refused(409, 'Online payment is coming soon. Until then your trial keeps everything on; write to us from the Help button if you want a plan set by hand.')
  const sub = company.subscription
  if (sub && sub.status !== 'CANCELED') { await change(company.id, sub, body.plan, body.interval); res.json({ changed: true }); return }
  const r = await provider.checkout({ companyId: company.id, companyName: company.name, email: u.email, plan: body.plan, interval: body.interval, returnUrl: `${appUrl()}/app/billing`, customerId: sub?.customerId ?? null })
  res.json({ url: r.url })
})

async function change(companyId: string, sub: { id: string; provider: string; externalId: string | null; plan: string; interval: string }, plan: string, interval: Interval) {
  if (sub.plan === plan && sub.interval === interval) return
  const p = PROVIDERS[sub.provider as ProviderKey]
  if (sub.provider !== 'test') {
    if (!p?.configured() || !sub.externalId) throw new Refused(409, 'Online payment is coming soon. Write to us from the Help button.')
    await p.changePlan(sub.externalId, plan, interval)
  } else {
    await testPayment(companyId, plan, interval)
  }
  // Provider messages confirm it; until they arrive, the company already has its new plan.
  await prisma.subscription.update({ where: { id: sub.id }, data: { plan, interval } })
  await prisma.company.update({ where: { id: companyId }, data: { plan } })
}

/** POST /api/billing/change { plan, interval } — upgrade or downgrade (the difference is worked out by the provider). */
export const changePlan = wrap(async (req, res) => {
  const { company } = await payer(req)
  const body = planSchema.parse(req.body)
  const sub = company.subscription
  if (!sub || sub.status === 'CANCELED') throw new Refused(409, 'Choose a plan first.')
  const fit = await cannotFit(company.id, body.plan)
  if (fit) throw new Refused(409, fit)
  await change(company.id, sub, body.plan, body.interval)
  res.json({ ok: true })
})

/** POST /api/billing/cancel { atPeriodEnd? } — stop at the end of what is paid (or undo with POST /resume). */
export const cancel = wrap(async (req, res) => {
  const { company } = await payer(req)
  const sub = company.subscription
  if (!sub || sub.status === 'CANCELED') throw new Refused(409, 'There is no plan to cancel.')
  if (sub.provider !== 'test') { const p = PROVIDERS[sub.provider as ProviderKey]; if (!p?.configured() || !sub.externalId) throw new Refused(409, 'Online payment is coming soon.'); await p.cancel(sub.externalId, true) }
  await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } })
  res.json({ ok: true, endsAt: sub.currentPeriodEnd })
})

export const resume = wrap(async (req, res) => {
  const { company } = await payer(req)
  const sub = company.subscription
  if (!sub || sub.status === 'CANCELED' || !sub.cancelAtPeriodEnd) throw new Refused(409, 'Nothing to undo.')
  if (sub.provider !== 'test') throw new Refused(409, 'Open the payment page (Manage payment) to keep your plan.')
  await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } })
  res.json({ ok: true })
})

/** GET /api/billing/portal — the provider's page for the card, address and tax invoices. */
export const portal = wrap(async (req, res) => {
  const { company } = await payer(req)
  const sub = company.subscription
  const p = sub ? PROVIDERS[sub.provider as ProviderKey] : undefined
  if (!sub?.customerId || sub.provider === 'test' || !p?.configured()) throw new Refused(404, 'No payment page yet.')
  const r = await p.portal(sub.customerId, `${appUrl()}/app/billing`)
  if (!r) throw new Refused(404, 'No payment page yet.')
  res.json(r)
})

/** POST /api/billing/test/pay { plan, interval, fail? } — the built-in test checkout ("Pay (test)"). */
export const testPay = wrap(async (req, res) => {
  const { company } = await payer(req)
  if (activeProvider()?.key !== 'test') throw new Refused(404, 'Test payments are off.')
  const body = planSchema.extend({ fail: z.boolean().default(false) }).parse(req.body)
  if (!body.fail) { const fit = await cannotFit(company.id, body.plan); if (fit) throw new Refused(409, fit) }
  await testPayment(company.id, body.plan, body.interval, body.fail)
  res.json({ ok: true })
})

/** GET /api/billing/invoices/:id — one invoice, to print or save as PDF. */
export const invoice = wrap(async (req, res) => {
  const { company } = await payer(req)
  const i = await prisma.invoice.findUnique({ where: { id: req.params.id } })
  if (!i) throw new Refused(404, 'Invoice not found')
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { name: true, email: true }, orderBy: { createdAt: 'asc' } })
  res.json({
    invoice: { ...i, planLabel: planOf(i.plan).label, subtotalCents: i.amountCents - i.taxCents },
    billedTo: { company: company.name, name: admin?.name ?? null, email: admin?.email ?? null },
    seller: await sellerDetails().then(({ fromConsole: _f, ...s }) => s),
    priceNow: priceCents(i.plan, i.interval as Interval),
  })
})

/** POST /api/billing/webhook/:provider — a payment provider's message (checked by its signature). */
export async function webhook(req: Request, res: Response): Promise<void> {
  const key = String(req.params.provider) as ProviderKey
  const p = PROVIDERS[key]
  if (!p || key === 'test' || !p.configured()) { res.status(404).json({ error: 'Unknown' }); return }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))
  const messages = p.readWebhook(req, raw)
  if (!messages) { res.status(400).json({ error: 'Bad signature' }); return }
  let payload: unknown = {}
  try { payload = JSON.parse(raw.toString('utf8')) } catch { /* kept as {} */ }
  try {
    for (const m of messages) await applyMessage(key, m, payload)
    res.json({ ok: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[billing] webhook failed:', (e as Error).message)
    // 500: the provider sends it again later.
    res.status(500).json({ error: 'Could not take it now' })
  }
}
