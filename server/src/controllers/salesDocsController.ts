import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { recordActivity } from '../lib/audit'
import { companyToday, dateStringFromDb, dbDateFromString } from '../lib/time'
import { sendSalesDocEmail } from '../lib/mail'

/**
 * Quotes and invoices (plan 2026-11, 2.3). A document with lines, tax and a discount, sent to a customer, and for
 * an invoice whether it was paid. There is no ledger: it answers "what did we quote, what did we bill, what is
 * still owed", not bookkeeping. Admins and team leads see every document; everyone else sees the ones they made.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const KINDS = ['QUOTE', 'INVOICE'] as const
type Kind = (typeof KINDS)[number]
const STATUSES: Record<Kind, string[]> = { QUOTE: ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'], INVOICE: ['DRAFT', 'SENT', 'PAID', 'VOID'] }
const PREFIX: Record<Kind, string> = { QUOTE: 'Q', INVOICE: 'INV' }
const WORD: Record<Kind, string> = { QUOTE: 'Quote', INVOICE: 'Invoice' }

const INCLUDE = { lines: { orderBy: { position: 'asc' as const } }, createdBy: { select: { id: true, name: true } } } satisfies Prisma.SalesDocInclude
type Doc = Prisma.SalesDocGetPayload<{ include: typeof INCLUDE }>

const round = (n: number) => Math.round(n * 100) / 100

/** The totals of a document, worked out the same way everywhere. */
export function docTotals(lines: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) {
  const subtotal = round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  const afterDiscount = Math.max(0, subtotal - discount)
  const tax = round((afterDiscount * taxRate) / 100)
  return { subtotal, tax, total: round(afterDiscount + tax) }
}

function view(d: Doc, meId: string, admin: boolean) {
  const lines = d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: Number(l.unitPrice), amount: round(l.quantity * Number(l.unitPrice)) }))
  const t = docTotals(lines, d.taxRate, Number(d.discount))
  const today = companyToday()
  const due = d.dueDate ? dateStringFromDb(d.dueDate) : null
  return {
    id: d.id, kind: d.kind, number: d.number,
    customerName: d.customerName, customerEmail: d.customerEmail ?? '', customerAddress: d.customerAddress ?? '',
    issueDate: dateStringFromDb(d.issueDate), dueDate: due,
    currency: d.currency, status: d.status, taxRate: d.taxRate, discount: Number(d.discount), notes: d.notes ?? '',
    lines, subtotal: t.subtotal, tax: t.tax, total: t.total,
    paidAt: d.paidAt?.toISOString() ?? null, paidNote: d.paidNote ?? '',
    fromDocId: d.fromDocId,
    overdue: d.kind === 'INVOICE' && d.status === 'SENT' && !!due && due < today,
    createdBy: d.createdBy.name,
    createdAt: d.createdAt.toISOString(),
    canEdit: admin || d.createdById === meId,
  }
}

const seesAll = (role: string) => role === 'SUPER_ADMIN' || role === 'TEAM_LEAD'
const scope = (req: AuthedRequest): Prisma.SalesDocWhereInput => (seesAll(req.user!.role) ? {} : { createdById: req.user!.id })

async function find(req: AuthedRequest, res: Response): Promise<Doc | null> {
  const d = await prisma.salesDoc.findFirst({ where: { id: req.params.id, ...scope(req) }, include: INCLUDE })
  if (!d) res.status(404).json({ error: 'Document not found' })
  return d
}
const mayEdit = (req: AuthedRequest, d: Doc) => req.user!.role === 'SUPER_ADMIN' || d.createdById === req.user!.id

const lineSchema = z.object({ description: z.string().trim().min(1, 'Every line needs a description.').max(300), quantity: z.number().positive().max(1e7), unitPrice: z.number().min(0).max(1e10) })
const docSchema = z.object({
  kind: z.enum(KINDS),
  customerName: z.string().trim().min(1, 'Who is it for?').max(160),
  customerEmail: z.string().trim().email('That email does not look right.').max(200).or(z.literal('')).optional(),
  customerAddress: z.string().trim().max(400).optional(),
  issueDate: z.string().regex(DATE).optional(),
  dueDate: z.string().regex(DATE).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter currency, like USD.').optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0).max(1e10).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema).min(1, 'Add at least one line.').max(100),
})

/** The next number of this kind for the company ("INV-0007"). */
async function nextNumber(kind: Kind): Promise<string> {
  const last = await prisma.salesDoc.findMany({ where: { kind }, select: { number: true }, orderBy: { createdAt: 'desc' }, take: 50 })
  const top = last.reduce((m, d) => Math.max(m, Number(/(\d+)$/.exec(d.number)?.[1] ?? 0)), 0)
  return `${PREFIX[kind]}-${String(top + 1).padStart(4, '0')}`
}

function fields(d: z.infer<typeof docSchema>) {
  const t = docTotals(d.lines, d.taxRate ?? 0, d.discount ?? 0)
  return {
    customerName: d.customerName,
    customerEmail: d.customerEmail || null,
    customerAddress: d.customerAddress || null,
    issueDate: dbDateFromString(d.issueDate ?? companyToday()),
    dueDate: d.dueDate ? dbDateFromString(d.dueDate) : null,
    currency: d.currency ?? 'USD',
    taxRate: d.taxRate ?? 0,
    discount: d.discount ?? 0,
    notes: d.notes || null,
    subtotal: t.subtotal,
    total: t.total,
  }
}

/** GET /api/sales-docs?kind=QUOTE|INVOICE: the documents and the money they add up to. */
export async function listDocs(req: AuthedRequest, res: Response): Promise<void> {
  const kind = KINDS.includes(req.query.kind as Kind) ? (req.query.kind as Kind) : undefined
  const docs = await prisma.salesDoc.findMany({ where: { ...scope(req), ...(kind ? { kind } : {}) }, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 500 })
  const rows = docs.map((d) => view(d, req.user!.id, req.user!.role === 'SUPER_ADMIN'))
  const sum = (f: (r: (typeof rows)[number]) => boolean) => round(rows.filter(f).reduce((s, r) => s + r.total, 0))
  const month = companyToday().slice(0, 7)
  res.json({
    docs: rows.map(({ lines, ...r }) => ({ ...r, lineCount: lines.length })),
    summary: {
      openQuotes: sum((r) => r.kind === 'QUOTE' && r.status === 'SENT'),
      owed: sum((r) => r.kind === 'INVOICE' && r.status === 'SENT'),
      overdue: sum((r) => r.overdue),
      paidThisMonth: sum((r) => r.kind === 'INVOICE' && r.status === 'PAID' && (r.paidAt ?? '').slice(0, 7) === month),
    },
  })
}

/** GET /api/sales-docs/:id */
export async function getDoc(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  const company = await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { name: true } })
  res.json({ doc: view(d, req.user!.id, req.user!.role === 'SUPER_ADMIN'), from: company?.name ?? '' })
}

/** POST /api/sales-docs */
export async function createDoc(req: AuthedRequest, res: Response): Promise<void> {
  const p = docSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the document.' }); return }
  let made: Doc | null = null
  // Two people making a document in the same second get different numbers: try again on a clash.
  for (let i = 0; i < 5 && !made; i++) {
    try {
      made = await prisma.salesDoc.create({
        data: { kind: p.data.kind, number: await nextNumber(p.data.kind), ...fields(p.data), createdById: req.user!.id, lines: { create: p.data.lines.map((l, position) => ({ ...l, position })) } },
        include: INCLUDE,
      })
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e
    }
  }
  if (!made) { res.status(409).json({ error: 'Could not give the document a number. Try again.' }); return }
  await recordActivity(req.user!.id, 'CREATE', 'SalesDoc', made.id, { after: { summary: `Made ${WORD[made.kind as Kind].toLowerCase()} ${made.number} for ${made.customerName}` } })
  res.status(201).json({ doc: view(made, req.user!.id, req.user!.role === 'SUPER_ADMIN') })
}

/** PUT /api/sales-docs/:id: change a draft (a sent document is not rewritten; set it back to draft first). */
export async function updateDoc(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  if (!mayEdit(req, d)) { res.status(403).json({ error: 'Only the person who made it, or an admin, changes it.' }); return }
  if (d.status !== 'DRAFT') { res.status(409).json({ error: 'Only a draft can be changed. Set it back to draft first.' }); return }
  const p = docSchema.safeParse({ ...req.body, kind: d.kind })
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the document.' }); return }
  const [, , after] = await prisma.$transaction([
    prisma.salesDocLine.deleteMany({ where: { docId: d.id } }),
    prisma.salesDocLine.createMany({ data: p.data.lines.map((l, position) => ({ ...l, position, docId: d.id })) }),
    prisma.salesDoc.update({ where: { id: d.id }, data: fields(p.data), include: INCLUDE }),
  ])
  res.json({ doc: view(after, req.user!.id, req.user!.role === 'SUPER_ADMIN') })
}

/** POST /api/sales-docs/:id/status { status, note }: sent, accepted, declined, paid, void, or back to draft. */
export async function setStatus(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  if (!mayEdit(req, d)) { res.status(403).json({ error: 'Only the person who made it, or an admin, changes it.' }); return }
  const p = z.object({ status: z.string(), note: z.string().trim().max(300).optional() }).safeParse(req.body)
  if (!p.success || !STATUSES[d.kind as Kind].includes(p.data.status)) { res.status(400).json({ error: `A ${WORD[d.kind as Kind].toLowerCase()} cannot be set to that.` }); return }
  const paid = p.data.status === 'PAID'
  const after = await prisma.salesDoc.update({ where: { id: d.id }, data: { status: p.data.status, paidAt: paid ? new Date() : null, paidNote: paid ? p.data.note || null : null }, include: INCLUDE })
  await recordActivity(req.user!.id, 'UPDATE', 'SalesDoc', d.id, { after: { summary: `${WORD[d.kind as Kind]} ${d.number} (${d.customerName}) set to ${p.data.status.toLowerCase()}` } })
  res.json({ doc: view(after, req.user!.id, req.user!.role === 'SUPER_ADMIN') })
}

/** POST /api/sales-docs/:id/convert: make an invoice from a quote (the quote is marked accepted). */
export async function convertDoc(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  if (!mayEdit(req, d)) { res.status(403).json({ error: 'Only the person who made it, or an admin, changes it.' }); return }
  if (d.kind !== 'QUOTE') { res.status(400).json({ error: 'Only a quote becomes an invoice.' }); return }
  const existing = await prisma.salesDoc.findFirst({ where: { fromDocId: d.id, status: { not: 'VOID' } }, select: { number: true } })
  if (existing) { res.status(409).json({ error: `This quote already became invoice ${existing.number}.` }); return }
  const invoice = await prisma.salesDoc.create({
    data: {
      kind: 'INVOICE', number: await nextNumber('INVOICE'), fromDocId: d.id, createdById: req.user!.id,
      customerName: d.customerName, customerEmail: d.customerEmail, customerAddress: d.customerAddress,
      issueDate: dbDateFromString(companyToday()), dueDate: null, currency: d.currency, taxRate: d.taxRate, discount: d.discount, notes: d.notes, subtotal: d.subtotal, total: d.total,
      lines: { create: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, position: l.position })) },
    },
    include: INCLUDE,
  })
  if (d.status !== 'ACCEPTED') await prisma.salesDoc.update({ where: { id: d.id }, data: { status: 'ACCEPTED' } })
  await recordActivity(req.user!.id, 'CREATE', 'SalesDoc', invoice.id, { after: { summary: `Made invoice ${invoice.number} from quote ${d.number} (${d.customerName})` } })
  res.status(201).json({ doc: view(invoice, req.user!.id, req.user!.role === 'SUPER_ADMIN') })
}

/** POST /api/sales-docs/:id/send: email it to the customer and mark it sent. */
export async function sendDoc(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  if (!mayEdit(req, d)) { res.status(403).json({ error: 'Only the person who made it, or an admin, sends it.' }); return }
  if (!d.customerEmail) { res.status(400).json({ error: 'Add the customer’s email first.' }); return }
  if (d.status === 'VOID') { res.status(409).json({ error: 'A void invoice is not sent.' }); return }
  const company = await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { name: true } })
  const sender = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, name: true } })
  const v = view(d, req.user!.id, true)
  await sendSalesDocEmail({ to: d.customerEmail, replyTo: sender?.email, from: company?.name ?? 'Metriq', word: WORD[d.kind as Kind], doc: v })
  const after = d.status === 'DRAFT' ? await prisma.salesDoc.update({ where: { id: d.id }, data: { status: 'SENT' }, include: INCLUDE }) : d
  await recordActivity(req.user!.id, 'UPDATE', 'SalesDoc', d.id, { after: { summary: `Emailed ${WORD[d.kind as Kind].toLowerCase()} ${d.number} to ${d.customerName}` } })
  res.json({ doc: view(after, req.user!.id, req.user!.role === 'SUPER_ADMIN') })
}

/** DELETE /api/sales-docs/:id: a draft only (a sent invoice is voided, not deleted, so its number is never reused). */
export async function deleteDoc(req: AuthedRequest, res: Response): Promise<void> {
  const d = await find(req, res)
  if (!d) return
  if (!mayEdit(req, d)) { res.status(403).json({ error: 'Only the person who made it, or an admin, deletes it.' }); return }
  if (d.status !== 'DRAFT') { res.status(409).json({ error: d.kind === 'INVOICE' ? 'A sent invoice is voided, not deleted.' : 'Only a draft is deleted.' }); return }
  await prisma.salesDoc.delete({ where: { id: d.id } })
  res.status(204).end()
}
