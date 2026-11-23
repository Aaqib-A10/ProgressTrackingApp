import { DateTime } from 'luxon'
import type { PrismaClient } from '@prisma/client'

/**
 * Test rows for the parts of Metriq the test company does not use by itself: Lead Management (a business with its
 * people, leads, follow-up tasks and calls, and a second one with the review flow, a lead waiting for the head and a
 * rep's daily report), one Daily Report form with a few days of reports, one Lead Dialer
 * import and one custom block with three records. Used by `npm run metra:coverage` and `npm run metra:check`, on a database on this computer only (both
 * scripts refuse any other). Every row carries the METRA-CHECK mark and `clearMore` takes exactly those out again.
 *
 * Call inside runAsCompany(the test company).
 */

export const MORE_MARK = 'METRA-CHECK'
const FORM_KEY = 'metra-check-freight'

/** The switches these parts sit behind. The scripts turn them on for the test company while they run. */
export const MORE_FLAGS = ['lead-management', 'deal-board', 'cmr', 'daily-report', 'department-studio', 'requests', 'people-records', 'sales-docs', 'report-builder', 'project-extras'] as const

export const MORE_TRUTH = {
  business: `${MORE_MARK} Freight`,
  leads: [
    { name: 'Dana Whitfield', organization: 'Northline Cold Storage', status: 'NEW', value: 12000, mine: true, overdue: false },
    { name: 'Omar Siddiqui', organization: 'Brightway Packaging', status: 'CONTACTED', value: 8500, mine: true, overdue: true },
    { name: 'Lucia Ferrand', organization: 'Harbor Mills', status: 'QUALIFIED', value: 30000, mine: true, overdue: false },
    { name: 'Peter Vanek', organization: 'Vanek Tools', status: 'CLOSED_WON', value: 15000, mine: true, overdue: false },
    { name: 'Ruth Adeyemi', organization: 'Crestfield Foods', status: 'NEW', value: 4000, mine: false, overdue: false },
    { name: 'Ian Brooke', organization: 'Brooke and Sons', status: 'NEW', value: null, mine: false, overdue: false },
  ],
  tasks: [
    { title: 'Send the rate sheet', lead: 'Omar Siddiqui', when: -1, done: false },
    { title: 'Call back about pallets', lead: 'Dana Whitfield', when: 0, done: false },
    { title: 'Book the site visit', lead: 'Lucia Ferrand', when: 3, done: false },
    { title: 'Confirm the first order', lead: 'Peter Vanek', when: -2, done: true },
  ],
  calls: [
    { lead: 'Dana Whitfield', by: 'rep', seconds: 240, disposition: 'CONNECTED', summary: 'Wants a quote for 6 pallets a week to Phoenix.' },
    { lead: 'Omar Siddiqui', by: 'rep', seconds: 0, disposition: 'VOICEMAIL', summary: 'Left a voicemail.' },
    { lead: 'Lucia Ferrand', by: 'manager', seconds: 615, disposition: 'CONNECTED', summary: 'Agreed to a site visit next week.' },
  ],
  /** A second business, of the kind with the review flow (the head decides on qualified leads; reps send a daily report). */
  reviewBusiness: `${MORE_MARK} Recycling`,
  review: [
    { name: 'Hugo Marsh', organization: 'Marsh Battery Depot', status: 'QUALIFIED', waiting: true, ask: 'Can we take 2,000 lbs a month at the published rate?' },
    { name: 'Nina Okafor', organization: 'Okafor Recycling', status: 'FOLLOW_UP', waiting: false, ask: '' },
  ],
  reviewCalls: [
    { lead: 'Hugo Marsh', seconds: 300, disposition: 'CONNECTED', summary: 'Confirmed the monthly volume.' },
    { lead: 'Nina Okafor', seconds: 0, disposition: 'VOICEMAIL', summary: 'Left a voicemail.' },
  ],
  leadReport: { dials: 2, connected: 1, voicemails: 1, emails: 0, interested: 0, note: 'Two calls, one connect.' },
  form: `${MORE_MARK} Daily numbers`,
  fields: ['Calls made', 'Quotes sent', 'Blockers'],
  /** What the member sent: today, yesterday, and three days ago. The lead sent nothing. */
  reports: [{ back: 0, calls: 18, quotes: 3, blockers: 'Waiting on the new price list.' }, { back: 1, calls: 22, quotes: 5, blockers: '' }, { back: 3, calls: 15, quotes: 2, blockers: 'Phone line was down for an hour.' }],
  importFile: `${MORE_MARK} leads.csv`,
  block: `${MORE_MARK} Vendors`,
  vendors: [{ vendor: 'Kestrel Freight', amount: 1200, note: 'Pays in 30 days' }, { vendor: 'Dune Packaging', amount: 450, note: '' }, { vendor: 'Halden Tools', amount: 3100, note: 'New this month' }],
  // Requests (asked by the rep; their team lead approves), the rep's own leave days and job, quotes and invoices.
  requests: [{ title: `${MORE_MARK} Courier to the port`, amount: 140, approved: false }, { title: `${MORE_MARK} Trade show tickets`, amount: 900, approved: true }],
  annualLeave: 18,
  job: 'Senior freight agent',
  docs: [
    { kind: 'QUOTE', number: 'Q-9001', customer: `${MORE_MARK} Bluewater Imports`, total: 2400, status: 'SENT' },
    { kind: 'INVOICE', number: 'INV-9001', customer: `${MORE_MARK} Harlow Exports`, total: 1750, status: 'SENT' },
    { kind: 'INVOICE', number: 'INV-9002', customer: `${MORE_MARK} Corvid Supplies`, total: 620, status: 'PAID' },
  ],
}

export async function clearMore(prisma: PrismaClient): Promise<number> {
  let n = 0
  n += (await prisma.approvalRequest.deleteMany({ where: { title: { startsWith: MORE_MARK } } })).count // its steps go with it
  n += (await prisma.salesDoc.deleteMany({ where: { customerName: { startsWith: MORE_MARK } } })).count
  // Leads, tasks, calls and members go with their business.
  n += (await prisma.leadBusiness.deleteMany({ where: { OR: [{ formKey: FORM_KEY }, { name: { startsWith: MORE_MARK } }] } })).count
  n += (await prisma.reportForm.deleteMany({ where: { name: { startsWith: MORE_MARK } } })).count
  n += (await prisma.dialerImport.deleteMany({ where: { fileName: { startsWith: MORE_MARK } } })).count
  n += (await prisma.customBlock.deleteMany({ where: { name: { startsWith: MORE_MARK } } })).count // its records go with it
  return n
}

type Who = { id: string }
/** `manager` runs the business and leads the form's department; `rep` works the leads and fills in the form. */
export async function seedMore(prisma: PrismaClient, p: { admin: Who; manager: Who; rep: Who; dialer: Who }, zone: string, now = new Date()): Promise<void> {
  await clearMore(prisma)
  const day = DateTime.fromJSDate(now).setZone(zone).startOf('day')
  const at = (days: number, hour = 11) => day.plus({ days, hours: hour }).toJSDate()

  const biz = await prisma.leadBusiness.create({ data: { name: MORE_TRUTH.business, formKey: FORM_KEY, kind: 'GENERAL', headId: p.admin.id } })
  await prisma.leadBusinessMember.createMany({ data: [{ businessId: biz.id, userId: p.manager.id, role: 'MANAGER' }, { businessId: biz.id, userId: p.rep.id, role: 'REP' }] })
  const leadId = new Map<string, string>()
  for (const [i, l] of MORE_TRUTH.leads.entries()) {
    const made = await prisma.lead.create({
      data: {
        businessId: biz.id, name: l.name, organization: l.organization, status: l.status, value: l.value, source: 'WEBSITE', email: `${l.name.split(' ')[0].toLowerCase()}@example.com`,
        assigneeId: l.mine ? p.rep.id : null, assignedAt: l.mine ? at(-3) : null, assignedById: l.mine ? p.manager.id : null,
        nextStep: l.overdue ? 'Send the rate sheet' : null, nextStepDate: l.overdue ? at(-2) : null,
        createdAt: at(-4, 9 + i), lastActivityAt: at(-1, 9 + i), createdById: p.manager.id,
      },
    })
    leadId.set(l.name, made.id)
  }
  for (const t of MORE_TRUTH.tasks) await prisma.leadTask.create({ data: { businessId: biz.id, leadId: leadId.get(t.lead)!, assigneeId: p.rep.id, title: t.title, dueAt: at(t.when, t.when === 0 ? 23 : 10), doneAt: t.done ? at(-1, 15) : null, doneById: t.done ? p.rep.id : null, outcome: t.done ? 'Order confirmed' : null } })
  for (const [i, c] of MORE_TRUTH.calls.entries()) await prisma.leadCall.create({ data: { businessId: biz.id, leadId: leadId.get(c.lead)!, userId: c.by === 'rep' ? p.rep.id : p.manager.id, at: at(0, 9 + i), direction: 'OUT', durationSec: c.seconds, disposition: c.disposition, summary: c.summary } })

  // The business with the review flow: both leads are the rep's; one waits for the head's decision.
  const cmr = await prisma.leadBusiness.create({ data: { name: MORE_TRUTH.reviewBusiness, formKey: `${FORM_KEY}-review`, kind: 'CMR', headId: p.admin.id } })
  await prisma.leadBusinessMember.createMany({ data: [{ businessId: cmr.id, userId: p.manager.id, role: 'MANAGER' }, { businessId: cmr.id, userId: p.rep.id, role: 'REP' }] })
  for (const [i, l] of MORE_TRUTH.review.entries()) {
    const made = await prisma.lead.create({
      data: {
        businessId: cmr.id, name: l.name, organization: l.organization, status: l.status, source: 'PHONE', assigneeId: p.rep.id, assignedAt: at(-3), assignedById: p.manager.id,
        createdAt: at(-5, 9 + i), lastActivityAt: at(-1, 12 + i), createdById: p.manager.id,
        ...(l.waiting ? { cmr: { create: { jesseInputNeeded: true, jesseAsk: l.ask, flaggedAt: at(-2), qualifiedAt: at(-2), qualifiedById: p.rep.id } } } : {}),
      },
    })
    leadId.set(l.name, made.id)
  }
  for (const [i, c] of MORE_TRUTH.reviewCalls.entries()) await prisma.leadCall.create({ data: { businessId: cmr.id, leadId: leadId.get(c.lead)!, userId: p.rep.id, at: at(0, 6 + i), direction: 'OUT', durationSec: c.seconds, disposition: c.disposition, summary: c.summary } })
  await prisma.leadDailyReport.create({ data: { businessId: cmr.id, userId: p.rep.id, date: new Date(`${day.toISODate()}T00:00:00.000Z`), ...MORE_TRUTH.leadReport } })

  const rep = await prisma.user.findUniqueOrThrow({ where: { id: p.rep.id }, select: { departmentId: true } })
  const form = await prisma.reportForm.create({ data: { name: MORE_TRUTH.form, departmentId: rep.departmentId, description: 'Test form for Metra', createdById: p.admin.id } })
  const [calls, quotes, blockers] = await Promise.all([
    prisma.reportField.create({ data: { formId: form.id, label: MORE_TRUTH.fields[0], type: 'NUMBER', target: 20, position: 0, required: true } }),
    prisma.reportField.create({ data: { formId: form.id, label: MORE_TRUTH.fields[1], type: 'NUMBER', position: 1 } }),
    prisma.reportField.create({ data: { formId: form.id, label: MORE_TRUTH.fields[2], type: 'LONG_TEXT', position: 2 } }),
  ])
  for (const r of MORE_TRUTH.reports) {
    const d = day.minus({ days: r.back }).toISODate()!
    await prisma.reportEntry.create({ data: { formId: form.id, userId: p.rep.id, date: new Date(`${d}T00:00:00.000Z`), values: { [calls.id]: r.calls, [quotes.id]: r.quotes, [blockers.id]: r.blockers } } })
  }

  const block = await prisma.customBlock.create({ data: { name: MORE_TRUTH.block, description: 'Test block for Metra', fields: [{ key: 'vendor', label: 'Vendor', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'note', label: 'Note', type: 'longtext' }], settings: { membersSee: 'all', membersAdd: true, boardField: null, dateField: null }, createdById: p.admin.id } })
  for (const v of MORE_TRUTH.vendors) await prisma.customRecord.create({ data: { blockId: block.id, departmentId: rep.departmentId, createdById: p.rep.id, data: v } })

  await prisma.dialerImport.create({ data: { userId: p.dialer.id, fileName: MORE_TRUTH.importFile, headerSignature: 'company|phone|status', mapping: {}, rowCount: 40, summary: { added: 31, changed: 7, unchanged: 2 }, funnel: {}, createdAt: at(-1, 10) } })

  // ---- plan 2026-11 modules: requests and approvals, leave days, a person record, quotes and invoices
  const year = day.year
  let number = (await prisma.approvalRequest.aggregate({ _max: { number: true } }))._max.number ?? 0
  for (const r of MORE_TRUTH.requests) {
    await prisma.approvalRequest.create({
      data: {
        number: ++number, kind: 'EXPENSE', title: r.title, amount: r.amount, currency: 'USD', requesterId: p.rep.id, status: r.approved ? 'APPROVED' : 'PENDING', decidedAt: r.approved ? at(-1) : null, createdAt: at(-2),
        steps: { create: [{ position: 0, approver: 'LEAD', status: r.approved ? 'APPROVED' : 'PENDING', decidedById: r.approved ? p.manager.id : null, decidedAt: r.approved ? at(-1) : null }] },
      },
    })
  }
  await prisma.leaveAllowance.upsert({ where: { userId_year_kind: { userId: p.rep.id, year, kind: 'ANNUAL' } }, update: { days: MORE_TRUTH.annualLeave }, create: { userId: p.rep.id, year, kind: 'ANNUAL', days: MORE_TRUTH.annualLeave } })
  await prisma.personRecord.upsert({ where: { userId: p.rep.id }, update: { jobTitle: MORE_TRUTH.job, managerId: p.manager.id }, create: { userId: p.rep.id, jobTitle: MORE_TRUTH.job, managerId: p.manager.id } })
  for (const d of MORE_TRUTH.docs) {
    await prisma.salesDoc.create({
      data: {
        kind: d.kind, number: d.number, customerName: d.customer, issueDate: new Date(`${day.minus({ days: 3 }).toISODate()}T00:00:00.000Z`), status: d.status, subtotal: d.total, total: d.total, createdById: p.admin.id, paidAt: d.status === 'PAID' ? at(-1) : null,
        lines: { create: [{ position: 0, description: 'Freight handling', quantity: 1, unitPrice: d.total }] },
      },
    })
  }
}
