// LOCAL ONLY (erp): a made-up "Sales" pipeline for Test Company, so the deal board, the contacts
// list and the CRM dashboard have something to show on your own PC. Every company, person, number
// and amount here is invented. Called from devOwner.ts (npm run dev:erp -- --testuser), which
// refuses to run against anything but a database on this computer.
import type { PrismaClient } from '@prisma/client'
import { normalizePhone, orgKey, SALES_PIPELINE, websiteKey } from '../lib/leads/pipeline'

export const DEMO_SALES_ID = 'demo-sales'
export const DEMO_REPS = [
  { username: 'zara', email: 'zara@local.test', name: 'Zara Malik' },
  { username: 'daniel', email: 'daniel@local.test', name: 'Daniel Reed' },
]

type Person = { name: string; role: string; email: string; phone: string; dm?: boolean }
type Deal = {
  org: string; industry: string; city: string; state: string; site: string
  main: Person; others?: Person[]
  status: string; value: number | null; rep: 0 | 1 | null
  source: 'FORM' | 'PHONE' | 'IMPORT' | 'EMAIL'; ageDays: number
  next?: { step: string; inDays: number }; calls?: number; note?: string; lost?: { reason: string; note: string }
}

const p = (name: string, role: string, domain: string, last4: string, dm = false): Person => ({ name, role, email: `${name.replace(/^Dr\. /, '').toLowerCase().split(' ')[0]}@${domain}`, phone: `(602) 555-${last4}`, dm })

const DEALS: Deal[] = [
  { org: 'Harbor Street Bakery', industry: 'Food & Beverage', city: 'Portland', state: 'OR', site: 'harborstreetbakery.example', main: p('Nadia Brooks', 'Owner', 'harborstreetbakery.example', '0101', true), status: 'NEW', value: 4800, rep: null, source: 'FORM', ageDays: 0, note: 'Asked for a quote from the website form: 3 shops, 22 staff.' },
  { org: 'Pinecrest Dental Group', industry: 'Healthcare', city: 'Denver', state: 'CO', site: 'pinecrestdental.example', main: p('Dr. Alan Whitfield', 'Managing Partner', 'pinecrestdental.example', '0102', true), others: [p('Maya Torres', 'Office Manager', 'pinecrestdental.example', '0103')], status: 'NEW', value: 12500, rep: 0, source: 'PHONE', ageDays: 1, next: { step: 'First call', inDays: 0 } },
  { org: 'Bluewater Logistics', industry: 'Logistics', city: 'Houston', state: 'TX', site: 'bluewaterlogistics.example', main: p('Marcus Lane', 'Operations Director', 'bluewaterlogistics.example', '0104'), others: [p('Priya Nair', 'CFO', 'bluewaterlogistics.example', '0105', true), p('Tom Becker', 'IT Lead', 'bluewaterlogistics.example', '0106')], status: 'CONTACTED', value: 38000, rep: 0, source: 'IMPORT', ageDays: 6, next: { step: 'Send the case study', inDays: 1 }, calls: 2 },
  { org: 'Maple & Finch Interiors', industry: 'Retail', city: 'Chicago', state: 'IL', site: 'mapleandfinch.example', main: p('Elena Fischer', 'Founder', 'mapleandfinch.example', '0107', true), status: 'CONTACTED', value: 7200, rep: 1, source: 'EMAIL', ageDays: 4, next: { step: 'Follow-up call', inDays: -1 }, calls: 1 },
  { org: 'Summit Ridge Builders', industry: 'Construction', city: 'Salt Lake City', state: 'UT', site: 'summitridgebuilders.example', main: p('Greg Holloway', 'Project Manager', 'summitridgebuilders.example', '0108'), others: [p('Dana Okafor', 'Owner', 'summitridgebuilders.example', '0109', true)], status: 'QUALIFIED', value: 54000, rep: 1, source: 'PHONE', ageDays: 11, next: { step: 'Demo with the owner', inDays: 2 }, calls: 3 },
  { org: 'Lumen Fitness Studios', industry: 'Fitness', city: 'Austin', state: 'TX', site: 'lumenfitness.example', main: p('Chloe Bennett', 'General Manager', 'lumenfitness.example', '0110', true), status: 'QUALIFIED', value: 9600, rep: 0, source: 'FORM', ageDays: 9, next: { step: 'Send pricing', inDays: 0 }, calls: 2 },
  { org: 'Orchard Valley Farms', industry: 'Agriculture', city: 'Fresno', state: 'CA', site: 'orchardvalleyfarms.example', main: p('Luis Romero', 'Co-owner', 'orchardvalleyfarms.example', '0111', true), others: [p('Hannah Romero', 'Bookkeeper', 'orchardvalleyfarms.example', '0112')], status: 'PROPOSAL', value: 26500, rep: 1, source: 'IMPORT', ageDays: 16, next: { step: 'Walk through the proposal', inDays: 3 }, calls: 4 },
  { org: 'Northwind Print Co.', industry: 'Printing', city: 'Minneapolis', state: 'MN', site: 'northwindprint.example', main: p('Owen Park', 'Purchasing', 'northwindprint.example', '0113'), others: [p('Ruth Adler', 'CEO', 'northwindprint.example', '0114', true)], status: 'PROPOSAL', value: 18900, rep: 0, source: 'EMAIL', ageDays: 14, next: { step: 'Proposal follow-up', inDays: 1 }, calls: 3 },
  { org: 'Cedar Point Accounting', industry: 'Professional Services', city: 'Columbus', state: 'OH', site: 'cedarpointaccounting.example', main: p('Irene Castillo', 'Partner', 'cedarpointaccounting.example', '0115', true), status: 'PROPOSAL', value: 14200, rep: 0, source: 'FORM', ageDays: 12, next: { step: 'Answer the security questions', inDays: -2 }, calls: 2 },
  { org: 'Atlas Freight Partners', industry: 'Logistics', city: 'Atlanta', state: 'GA', site: 'atlasfreight.example', main: p('Jerome Wallace', 'VP Operations', 'atlasfreight.example', '0116', true), others: [p('Kim Sato', 'Procurement', 'atlasfreight.example', '0117'), p('Victor Hale', 'Legal Counsel', 'atlasfreight.example', '0118')], status: 'NEGOTIATION', value: 72000, rep: 1, source: 'PHONE', ageDays: 24, next: { step: 'Contract call with legal', inDays: 1 }, calls: 6 },
  { org: 'Brightline Pediatrics', industry: 'Healthcare', city: 'Phoenix', state: 'AZ', site: 'brightlinepediatrics.example', main: p('Dr. Sofia Mendes', 'Clinic Director', 'brightlinepediatrics.example', '0119', true), status: 'NEGOTIATION', value: 21000, rep: 0, source: 'FORM', ageDays: 20, next: { step: 'Send the revised terms', inDays: 0 }, calls: 5 },
  { org: 'Kestrel Coffee Roasters', industry: 'Food & Beverage', city: 'Seattle', state: 'WA', site: 'kestrelcoffee.example', main: p('Ben Archer', 'Owner', 'kestrelcoffee.example', '0120', true), status: 'WON', value: 16800, rep: 0, source: 'FORM', ageDays: 30, calls: 4, note: 'Signed for a year. Start date agreed.' },
  { org: 'Granite Peak Outfitters', industry: 'Retail', city: 'Boise', state: 'ID', site: 'granitepeak.example', main: p('Rachel Kim', 'COO', 'granitepeak.example', '0121', true), others: [p('Sam Turner', 'Store Manager', 'granitepeak.example', '0122')], status: 'WON', value: 43500, rep: 1, source: 'IMPORT', ageDays: 41, calls: 7 },
  { org: 'Silverline Auto Care', industry: 'Automotive', city: 'Tampa', state: 'FL', site: 'silverlineauto.example', main: p('Tony Russo', 'Owner', 'silverlineauto.example', '0123', true), status: 'LOST', value: 8400, rep: 1, source: 'PHONE', ageDays: 18, calls: 3, lost: { reason: 'PRICE', note: 'Went with a cheaper option; open to talk again next year.' } },
]

const TALKS = [
  'Intro call with {name}: what they use today and what is not working.',
  '{name} asked for pricing for the whole team and a start date.',
  'Walked {name} through the plan; they will bring in the person who signs.',
  'Answered questions on set-up time and moving their data over.',
  '{name} confirmed the budget. Sending the paperwork next.',
]
const daysFrom = (n: number, hour = 15) => { const d = new Date(Date.now() + n * 86400_000); d.setUTCHours(hour, 0, 0, 0); return d }

/** Adds the made-up Sales pipeline once; leaves it alone when it already has leads. */
export async function seedDemoSales(prisma: PrismaClient, companyId: string, managerId: string, repIds: [string, string]): Promise<number> {
  await prisma.featureFlagCompany.upsert({
    where: { key_companyId: { key: 'lead-management', companyId } },
    update: { enabled: true },
    create: { key: 'lead-management', companyId, enabled: true, updatedBy: 'test accounts' },
  }).catch(() => undefined)

  await prisma.leadBusiness.upsert({
    where: { id: DEMO_SALES_ID },
    update: {},
    create: {
      id: DEMO_SALES_ID, companyId, name: 'Sales', color: '#4F46E5', kind: 'GENERAL', formKey: 'demo-sales-form',
      pipeline: SALES_PIPELINE as unknown as object, settings: { currency: 'USD' }, slaAssignMins: 0, slaContactMins: 0,
    },
  })
  const members = [{ userId: managerId, role: 'MANAGER' }, ...repIds.map((userId) => ({ userId, role: 'REP' }))]
  for (const m of members) {
    await prisma.leadBusinessMember.upsert({
      where: { businessId_userId: { businessId: DEMO_SALES_ID, userId: m.userId } },
      update: {},
      create: { companyId, businessId: DEMO_SALES_ID, ...m },
    })
  }
  if (await prisma.lead.count({ where: { businessId: DEMO_SALES_ID } })) return 0

  for (const d of DEALS) {
    const assigneeId = d.rep === null ? null : repIds[d.rep]
    const created = daysFrom(-d.ageDays, 16)
    const phone = normalizePhone(d.main.phone)
    const lastCallAt = d.calls ? daysFrom(-Math.max(0, Math.min(d.ageDays - 1, 2)), 17) : null
    const closed = d.status === 'WON' || d.status === 'LOST'
    const lead = await prisma.lead.create({
      data: {
        companyId, businessId: DEMO_SALES_ID, name: d.main.name, jobTitle: d.main.role, email: d.main.email,
        phone: phone.phone, phoneE164: phone.e164, organization: d.org, orgKey: orgKey(d.org), industry: d.industry,
        city: d.city, state: d.state, country: 'USA', website: `https://${d.site}`, websiteKey: websiteKey(d.site),
        source: d.source, sourceDetail: d.source === 'FORM' ? 'Website: Get a quote' : d.source === 'IMPORT' ? 'Trade show list' : null,
        status: d.status, value: d.value, message: d.note ?? null,
        lostReason: d.lost?.reason ?? null, lostNote: d.lost?.note ?? null,
        assigneeId, assignedAt: assigneeId ? created : null, assignedById: assigneeId ? managerId : null,
        nextStep: closed ? null : d.next?.step ?? null, nextStepDate: closed || !d.next ? null : daysFrom(d.next.inDays),
        callsCount: d.calls ?? 0, firstCallAt: d.calls ? daysFrom(-Math.max(0, d.ageDays - 1), 17) : null, lastCallAt,
        firstContactAt: d.calls ? daysFrom(-Math.max(0, d.ageDays - 1), 17) : null,
        lastActivityAt: lastCallAt ?? created, createdById: managerId, createdAt: created,
      },
    })
    await prisma.leadEvent.create({ data: { companyId, leadId: lead.id, userId: managerId, kind: 'CREATED', text: `Lead added (${d.source === 'FORM' ? 'website form' : d.source === 'EMAIL' ? 'email' : d.source === 'IMPORT' ? 'file' : 'phone'})`, createdAt: created } })
    for (const o of d.others ?? []) {
      const op = normalizePhone(o.phone)
      await prisma.leadContact.create({ data: { companyId, leadId: lead.id, businessId: DEMO_SALES_ID, name: o.name, role: o.role, email: o.email, phone: op.phone, phoneE164: op.e164, decisionMaker: !!o.dm, createdById: managerId } })
    }
    for (let i = 0; i < (d.calls ?? 0); i += 1) {
      const at = daysFrom(-Math.max(0, d.ageDays - 1 - i * 3), 14 + (i % 3)); at.setUTCMinutes((i * 20 + d.ageDays * 7) % 60)
      const connected = i % 3 !== 1
      await prisma.leadCall.create({
        data: {
          companyId, businessId: DEMO_SALES_ID, leadId: lead.id, userId: assigneeId, at, direction: 'OUT',
          durationSec: connected ? 180 + i * 75 : 25, disposition: connected ? 'CONNECTED' : 'VOICEMAIL',
          summary: connected ? TALKS[i % TALKS.length].replace('{name}', d.main.name.replace(/^Dr\. /, '').split(' ')[0]) : 'Left a voicemail with a callback number.',
        },
      })
    }
    if (!closed && d.next && assigneeId) {
      await prisma.leadTask.create({ data: { companyId, businessId: DEMO_SALES_ID, leadId: lead.id, assigneeId, kind: 'NEXT_STEP', title: d.next.step, dueAt: daysFrom(d.next.inDays) } })
    }
  }
  return DEALS.length
}
