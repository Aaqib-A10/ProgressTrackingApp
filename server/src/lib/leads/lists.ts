import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { emailKey, normalizePhone, orgKey, websiteKey } from './pipeline'

/** The pre-call check: is this company (by name, phone, email or website) on the business's Prohibited or existing-customer list? */
export type ListHit = { kind: string; name: string; on: string }
export async function listMatches(businessId: string, l: { orgKey: string | null; phoneE164: string | null; email: string | null; websiteKey: string | null }): Promise<{ prohibited: boolean; existingCustomer: boolean; hits: ListHit[] }> {
  const or: Prisma.LeadListEntryWhereInput[] = []
  if (l.orgKey) or.push({ nameKey: l.orgKey })
  if (l.phoneE164) or.push({ phone: l.phoneE164 })
  if (l.email) or.push({ email: l.email.toLowerCase() })
  if (l.websiteKey) or.push({ website: l.websiteKey })
  if (!or.length) return { prohibited: false, existingCustomer: false, hits: [] }
  const rows = await prisma.leadListEntry.findMany({ where: { businessId, OR: or }, select: { kind: true, name: true, nameKey: true, phone: true, email: true, website: true } })
  const hits = rows.map((r) => ({ kind: r.kind, name: r.name, on: r.nameKey && r.nameKey === l.orgKey ? 'company name' : r.phone && r.phone === l.phoneE164 ? 'phone' : r.email && r.email === l.email?.toLowerCase() ? 'email' : 'website' }))
  return { prohibited: hits.some((h) => h.kind === 'PROHIBITED'), existingCustomer: hits.some((h) => h.kind === 'CUSTOMER'), hits }
}

/** The keys of a lead's identifying fields. */
export const keysOf = (l: { organization?: string | null; phone?: string | null; email?: string | null; website?: string | null }) => ({
  orgKey: orgKey(l.organization), phoneE164: normalizePhone(l.phone).e164, email: emailKey(l.email), websiteKey: websiteKey(l.website),
})

/** Re-check every lead of a business against its lists (after the lists change). Returns how many changed. */
export async function reflagLeads(businessId: string): Promise<number> {
  const leads = await prisma.lead.findMany({ where: { businessId }, select: { id: true, orgKey: true, phoneE164: true, email: true, websiteKey: true, prohibited: true, existingCustomer: true } })
  let n = 0
  for (const l of leads) {
    const r = await listMatches(businessId, l)
    if (r.prohibited !== l.prohibited || r.existingCustomer !== l.existingCustomer) { n++; await prisma.lead.update({ where: { id: l.id }, data: { prohibited: r.prohibited, existingCustomer: r.existingCustomer } }) }
  }
  return n
}
