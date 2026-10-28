import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { HOME_COMPANY_ID } from '../company'
import { PLANS, planOf, activePeople, type PlanKey } from '../plans'
import { sendMail, appUrl } from '../mail'
import type { BillingMessage, Interval, ProviderKey } from './providers'

/**
 * Billing (Phase 1, step 8): what a company pays, and what happens when it does not.
 *  - a free trial, then a plan (monthly, or yearly with two months free);
 *  - a failed payment gives 7 days to fix the card (with emails), then Metriq becomes read-only;
 *  - a cancelled plan runs to the end of what was paid, then read-only;
 *  - read-only means everything can still be looked at and exported; nothing is deleted.
 * 99 Technologies (internal plan) is never billed.
 */

export const GRACE_DAYS = 7
export const SELLABLE: PlanKey[] = ['personal', 'starter', 'business']
export const priceCents = (plan: string, interval: Interval) => Math.round((interval === 'year' ? planOf(plan).priceYearly : planOf(plan).priceMonthly) * 100)

type CompanyLike = { id: string; plan: string; status: string; trialEndsAt: Date | null }
type SubLike = { status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; currentPeriodEnd: Date; pastDueSince: Date | null; cancelAtPeriodEnd?: boolean } | null

export type BillingState = 'internal' | 'trial' | 'trial_ended' | 'active' | 'canceling' | 'past_due' | 'locked' | 'ended' | 'free'

export function billingState(c: CompanyLike, sub: SubLike, now = new Date()): BillingState {
  if (c.id === HOME_COMPANY_ID || c.plan === 'internal') return 'internal'
  if (sub) {
    if (sub.status === 'ACTIVE') return sub.cancelAtPeriodEnd ? 'canceling' : 'active'
    if (sub.status === 'PAST_DUE') return sub.pastDueSince && now.getTime() - sub.pastDueSince.getTime() > GRACE_DAYS * 86400_000 ? 'locked' : 'past_due'
    return sub.currentPeriodEnd < now ? 'ended' : 'canceling'
  }
  if (c.status === 'TRIAL') return c.trialEndsAt && c.trialEndsAt < now ? 'trial_ended' : 'trial'
  return 'free'
}

/** Why nothing new can be saved right now (the company can still look at everything), or null. */
export function readOnlyReason(state: BillingState): string | null {
  switch (state) {
    case 'trial_ended': return 'Your free trial has ended. Choose a plan in Billing to keep going; nothing has been lost.'
    case 'locked': return `Your payment has not gone through for ${GRACE_DAYS} days. Update your card in Billing to keep going; nothing has been lost.`
    case 'ended': return 'Your plan has ended. Choose a plan in Billing to keep going; nothing has been lost.'
    default: return null
  }
}

async function admins(companyId: string): Promise<string[]> {
  return (await prisma.user.findMany({ where: { companyId, role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' }, select: { email: true } })).map((u) => u.email)
}

export async function billingMail(companyId: string, subject: string, lines: string[], cta = 'Open Billing'): Promise<void> {
  const to = await admins(companyId)
  if (!to.length) return
  const link = `${appUrl()}/app/billing`
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A"><p style="font-weight:700;font-size:18px">Metriq</p><h1 style="font-size:20px">${subject}</h1>${lines.map((l) => `<p style="font-size:14px;line-height:1.5">${l}</p>`).join('')}<a href="${link}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin:12px 0">${cta}</a></div>`
  await sendMail({ to, subject, html, text: [subject, '', ...lines, '', link].join('\n'), category: 'Billing' })
}

const money = (cents: number, currency = 'USD') => `${currency === 'USD' ? '$' : `${currency} `}${(cents / 100).toFixed(2)}`

/**
 * Take one message from a provider (each only once): keep the subscription and invoices in step,
 * and put the company on the plan it pays for.
 */
export async function applyMessage(provider: ProviderKey, msg: BillingMessage, payload: unknown = {}): Promise<'done' | 'again' | 'ignored'> {
  const seen = await prisma.billingEvent.findUnique({ where: { provider_externalId: { provider, externalId: msg.id } } })
  // Sent twice: done already. (One that failed half way is taken again.)
  if (seen?.processedAt || (seen && msg.type === 'ignored')) return 'again'
  if (!seen) {
    try {
      await prisma.billingEvent.create({ data: { provider, externalId: msg.id, type: msg.type === 'ignored' ? msg.raw : msg.type, companyId: msg.type === 'ignored' ? null : msg.companyId, payload: payload as Prisma.InputJsonValue } })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return 'again'
      throw e
    }
  }
  if (msg.type === 'ignored') return 'ignored'
  try {
    const took = msg.type === 'subscription' ? await applySubscription(provider, msg) : await applyInvoice(provider, msg)
    // A message for no company we bill (or for 99 Technologies) is kept, and never taken.
    await prisma.billingEvent.update({ where: { provider_externalId: { provider, externalId: msg.id } }, data: { processedAt: new Date(), ...(took ? {} : { error: 'No company we bill for this' }) } })
    return took ? 'done' : 'ignored'
  } catch (e) {
    await prisma.billingEvent.update({ where: { provider_externalId: { provider, externalId: msg.id } }, data: { error: (e as Error).message.slice(0, 500) } })
    throw e
  }
}

async function companyFor(provider: ProviderKey, companyId: string | null, externalId?: string | null) {
  const id = companyId ?? (externalId ? (await prisma.subscription.findFirst({ where: { provider, externalId } }))?.companyId : null)
  if (!id || id === HOME_COMPANY_ID) return null
  return prisma.company.findUnique({ where: { id } })
}

async function applySubscription(provider: ProviderKey, m: Extract<BillingMessage, { type: 'subscription' }>): Promise<boolean> {
  const c = await companyFor(provider, m.companyId, m.externalId)
  if (!c || c.plan === 'internal') return false
  const prev = await prisma.subscription.findUnique({ where: { companyId: c.id } })
  const plan = (m.plan && SELLABLE.includes(m.plan as PlanKey) ? m.plan : prev?.plan) ?? c.plan
  const interval = m.interval ?? (prev?.interval as Interval | undefined) ?? 'month'
  const periodEnd = m.periodEnd ?? prev?.currentPeriodEnd ?? new Date(Date.now() + (interval === 'year' ? 365 : 31) * 86400_000)
  const pastDueSince = m.status === 'PAST_DUE' ? prev?.pastDueSince ?? new Date() : null
  await prisma.subscription.upsert({
    where: { companyId: c.id },
    update: { provider, externalId: m.externalId, customerId: m.customerId ?? prev?.customerId ?? null, plan, interval, status: m.status, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: !!m.cancelAtPeriodEnd, pastDueSince },
    create: { companyId: c.id, provider, externalId: m.externalId, customerId: m.customerId ?? null, plan, interval, status: m.status, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: !!m.cancelAtPeriodEnd, pastDueSince },
  })
  if (m.status !== 'CANCELED') await prisma.company.update({ where: { id: c.id }, data: { plan, status: c.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' } })
  if (!prev && m.status === 'ACTIVE') await billingMail(c.id, `Welcome to Metriq ${PLANS[plan as PlanKey]?.label ?? ''}`, [`Thank you. ${c.name} is on the ${PLANS[plan as PlanKey]?.label ?? plan} plan, paid ${interval === 'year' ? 'yearly' : 'monthly'}.`, 'Invoices are in Billing.'], 'See invoices')
  if (prev && prev.status !== 'CANCELED' && m.status === 'CANCELED') await billingMail(c.id, 'Your Metriq plan has ended', [`${c.name}'s plan has ended. Everything is still there and can be looked at and exported.`, 'Choose a plan any time to keep going.'], 'Choose a plan')
  return true
}

async function applyInvoice(provider: ProviderKey, m: Extract<BillingMessage, { type: 'invoice' }>): Promise<boolean> {
  const c = await companyFor(provider, m.companyId, m.subscriptionId)
  if (!c || c.plan === 'internal') return false
  const sub = await prisma.subscription.findUnique({ where: { companyId: c.id } })
  const plan = m.plan ?? sub?.plan ?? c.plan
  const interval = m.interval ?? (sub?.interval as Interval | undefined) ?? 'month'
  const data = { plan, interval, currency: m.currency, amountCents: m.amountCents, taxCents: m.taxCents, status: m.status, periodStart: m.periodStart, periodEnd: m.periodEnd, paidAt: m.status === 'PAID' ? new Date() : null, hostedUrl: m.hostedUrl ?? null }
  await prisma.invoice.upsert({ where: { provider_externalId: { provider, externalId: m.externalId } }, update: data, create: { companyId: c.id, provider, externalId: m.externalId, ...data } })
  if (!sub) return true
  if (m.status === 'FAILED') {
    const first = !sub.pastDueSince
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', pastDueSince: sub.pastDueSince ?? new Date() } })
    await billingMail(c.id, first ? 'Your Metriq payment did not go through' : 'Your Metriq payment still has not gone through', [
      `We could not take ${money(m.amountCents, m.currency)} for ${c.name}'s ${PLANS[plan as PlanKey]?.label ?? plan} plan.`,
      `Please update your card in Billing within ${GRACE_DAYS} days. After that, Metriq becomes read-only until it is paid; nothing is deleted.`,
    ], 'Update my card')
  } else if (m.status === 'PAID') {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', pastDueSince: null, currentPeriodEnd: m.periodEnd > sub.currentPeriodEnd ? m.periodEnd : sub.currentPeriodEnd } })
    if (sub.pastDueSince) await billingMail(c.id, 'Thank you: your Metriq payment went through', [`${money(m.amountCents, m.currency)} for ${c.name} is paid. Everything is open again.`], 'See invoices')
  }
  return true
}

/** Can the company move to this plan (does it fit: people)? The reason it cannot, or null. */
export async function cannotFit(companyId: string, plan: string): Promise<string | null> {
  const p = planOf(plan)
  if (p.people !== null && (await activePeople(companyId)) > p.people) return `${p.label} has room for ${p.people} ${p.people === 1 ? 'person' : 'people'}. Remove people first, or pick a bigger plan.`
  return null
}

/**
 * The built-in test provider "pays" (or fails to pay) straight away: the same messages a real
 * provider would send, through the same path.
 */
export async function testPayment(companyId: string, plan: string, interval: Interval, fail = false): Promise<void> {
  const now = new Date()
  const end = new Date(now.getTime() + (interval === 'year' ? 365 : 30) * 86400_000)
  const prev = await prisma.subscription.findUnique({ where: { companyId } })
  const externalId = prev?.externalId ?? `test_sub_${companyId}`
  const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  if (!fail || !prev) await applyMessage('test', { id: `test_ev_${n}_s`, type: 'subscription', companyId, externalId, customerId: `test_cus_${companyId}`, plan, interval, status: 'ACTIVE', periodEnd: end, cancelAtPeriodEnd: false })
  await applyMessage('test', { id: `test_ev_${n}_i`, type: 'invoice', companyId, externalId: `test_in_${n}`, subscriptionId: externalId, plan, interval, status: fail ? 'FAILED' : 'PAID', amountCents: priceCents(plan, interval), taxCents: 0, currency: 'USD', periodStart: now, periodEnd: end })
}

/** The daily reminders: the trial ends in 3 days, and the trial has ended (each once). */
export async function runBillingReminders(companyId: string, now = new Date()): Promise<void> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, include: { subscription: true } })
  if (!c || c.id === HOME_COMPANY_ID || c.status !== 'TRIAL' || !c.trialEndsAt || c.subscription) return
  const left = (c.trialEndsAt.getTime() - now.getTime()) / 86400_000
  if (left <= 0 && !c.trialEndedMailAt) {
    await prisma.company.update({ where: { id: c.id }, data: { trialEndedMailAt: now } })
    await billingMail(c.id, 'Your Metriq free trial has ended', [`Thank you for trying Metriq with ${c.name}. Everything you made is still there, and can be looked at.`, 'Choose a plan to keep adding to it.'], 'Choose a plan')
  } else if (left > 0 && left <= 3 && !c.trialEndingMailAt) {
    await prisma.company.update({ where: { id: c.id }, data: { trialEndingMailAt: now } })
    await billingMail(c.id, `Your Metriq free trial ends in ${Math.ceil(left)} day${Math.ceil(left) === 1 ? '' : 's'}`, [`${c.name}'s free trial ends on ${c.trialEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`, 'Choose a plan now and nothing stops.'], 'Choose a plan')
  }
}
