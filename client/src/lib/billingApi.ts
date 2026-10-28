import { api } from './api'

// Billing (Phase 1, step 8).

export type BillingState = 'internal' | 'trial' | 'trial_ended' | 'active' | 'canceling' | 'past_due' | 'locked' | 'ended' | 'free'
export type Interval = 'month' | 'year'
export interface PlanCard { key: string; label: string; priceMonthly: number; priceYearly: number; people: number | null; storageGb: number | null; aiHours: number | null; partsLeftOut: string[] }
export interface InvoiceRow { id: string; number: number; plan: string; interval: Interval; amountCents: number; taxCents: number; currency: string; status: 'OPEN' | 'PAID' | 'FAILED' | 'VOID'; periodStart: string; periodEnd: string; paidAt: string | null; hostedUrl: string | null; createdAt: string }
export interface BillingOverview {
  state: BillingState; canPay: boolean
  company: { name: string; kind: 'TEAM' | 'PERSONAL'; plan: string; trialEndsAt: string | null }
  subscription: { plan: string; interval: Interval; status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; pastDueSince: string | null; provider: string; hasPortal: boolean } | null
  plans: PlanCard[]
  provider: { key: string; label: string; test: boolean } | null
  invoices: InvoiceRow[]
}
export interface InvoiceDetail {
  invoice: InvoiceRow & { planLabel: string; subtotalCents: number; provider: string }
  billedTo: { company: string; name: string | null; email: string | null }
  seller: { name: string; address: string | null; taxId: string | null }
}

export const billingApi = {
  overview: () => api.get<BillingOverview>('/billing'),
  checkout: (plan: string, interval: Interval) => api.post<{ url?: string; changed?: boolean }>('/billing/checkout', { plan, interval }),
  change: (plan: string, interval: Interval) => api.post<{ ok: true }>('/billing/change', { plan, interval }),
  cancel: () => api.post<{ ok: true; endsAt: string }>('/billing/cancel'),
  resume: () => api.post<{ ok: true }>('/billing/resume'),
  portal: () => api.get<{ url: string }>('/billing/portal'),
  testPay: (plan: string, interval: Interval, fail = false) => api.post<{ ok: true }>('/billing/test/pay', { plan, interval, fail }),
  invoice: (id: string) => api.get<InvoiceDetail>(`/billing/invoices/${id}`),
}

export const money = (cents: number, currency = 'USD') => (currency === 'USD' ? `$${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${currency}`)
