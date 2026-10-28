import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { Prisma, ReportFieldType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, companyTz, dateStringFromDb, dbDateFromString } from '../lib/time'
import { loadPowers } from '../lib/permissions'
import { checkAnswers, csvCell, sumNumbers, targetTone, type FieldDef } from '../lib/dailyReport'

/**
 * The Daily Report builder (Phase 1, step 5). A company builds its own daily form (numbers,
 * text, choices, yes/no, ratings, links) for a department or for everyone; people fill it in
 * once a day (sending again updates it); team leads see the team's day, charts and a monthly
 * report. Days on leave and holidays are left out of the averages.
 */

const FIELD_TYPES = ['NUMBER', 'TEXT', 'LONG_TEXT', 'CHOICE', 'MULTI_CHOICE', 'YES_NO', 'RATING', 'LINK'] as const
const EDIT_DAYS = 7

class Refused extends Error { constructor(public status: number, message: string) { super(message) } }
function send(res: Response, e: unknown): void {
  if (e instanceof Refused) { res.status(e.status).json({ error: e.message }); return }
  if (e instanceof z.ZodError) { res.status(400).json({ error: e.issues[0]?.message ?? 'Invalid input' }); return }
  throw e
}
const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<void>) => async (req: AuthedRequest, res: Response) => { try { await fn(req, res) } catch (e) { send(res, e) } }

async function whoAmI(req: AuthedRequest) {
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { id: true, name: true, role: true, departmentId: true, memberships: { select: { departmentId: true, role: true } }, company: { select: { kind: true } } },
  })
  return { ...me, powers: await loadPowers(me.id) }
}
type Me = Awaited<ReturnType<typeof whoAmI>>
type FormRow = Prisma.ReportFormGetPayload<{ include: { fields: true; department: { select: { name: true } } } }>

const inDept = (me: Me, departmentId: string) => me.departmentId === departmentId || me.memberships.some((m) => m.departmentId === departmentId)
const leadsDept = (me: Me, departmentId: string) => (me.role === 'TEAM_LEAD' && me.departmentId === departmentId) || me.memberships.some((m) => m.departmentId === departmentId && m.role === 'TEAM_LEAD')

/** Builds and changes the form: the Super Admin, Company settings, or the department's team lead. */
function manages(me: Me, form: { departmentId: string | null }): boolean {
  if (me.role === 'SUPER_ADMIN' || me.powers.includes('company.settings')) return true
  return !!form.departmentId && leadsDept(me, form.departmentId)
}
/** Sees the team's answers: managers, and any team lead (for an everyone-form, their own department's people). */
function seesTeam(me: Me, form: { departmentId: string | null }): boolean {
  return manages(me, form) || (!form.departmentId && (me.role === 'TEAM_LEAD' || me.memberships.some((m) => m.role === 'TEAM_LEAD')))
}
/** Fills it in: the department's people, or for an everyone-form everyone (the Super Admin too). */
function fills(me: Me, form: { departmentId: string | null; active: boolean }): boolean {
  if (!form.active) return false
  if (form.departmentId) return inDept(me, form.departmentId)
  return true
}

/** The people who fill this form in (for a team lead looking at an everyone-form: their department). */
async function fillers(form: FormRow, me: Me) {
  const people = await prisma.user.findMany({
    where: {
      isActive: true, status: 'ACTIVE',
      ...(form.departmentId ? { OR: [{ departmentId: form.departmentId }, { memberships: { some: { departmentId: form.departmentId } } }] } : {}),
    },
    select: { id: true, name: true, role: true, departmentId: true, memberships: { select: { departmentId: true } } },
    orderBy: { name: 'asc' },
  })
  let list = people
  if (!form.departmentId && !manages(me, form)) {
    const mine = new Set([me.departmentId, ...me.memberships.filter((m) => m.role === 'TEAM_LEAD').map((m) => m.departmentId)].filter(Boolean) as string[])
    list = list.filter((p) => (p.departmentId && mine.has(p.departmentId)) || p.memberships.some((m) => mine.has(m.departmentId)))
  }
  return list
}

const fieldDefs = (form: FormRow): FieldDef[] => form.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required, target: f.target, targetDir: f.targetDir, archived: f.archived }))
function formView(form: FormRow, me: Me) {
  return {
    id: form.id, name: form.name, description: form.description, active: form.active,
    departmentId: form.departmentId, department: form.department?.name ?? null,
    fields: form.fields.filter((f) => !f.archived).sort((a, b) => a.position - b.position).map((f) => ({ id: f.id, label: f.label, help: f.help, type: f.type, options: f.options, required: f.required, target: f.target, targetDir: f.targetDir, unit: f.unit })),
    canManage: manages(me, form), canSeeTeam: seesTeam(me, form), fills: fills(me, form),
  }
}
async function loadForm(id: string): Promise<FormRow> {
  const f = await prisma.reportForm.findUnique({ where: { id }, include: { fields: { orderBy: { position: 'asc' } }, department: { select: { name: true } } } })
  if (!f) throw new Refused(404, 'Form not found')
  return f
}

function parseDate(s: unknown, fallback: string): string {
  const v = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback
  if (!DateTime.fromISO(v).isValid) throw new Refused(400, 'Not a date')
  return v
}

// ------------------------------------------------------------------ forms

/** GET /api/daily-report/forms — the forms I fill in and the ones I look after. */
export const listForms = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const forms = await prisma.reportForm.findMany({ include: { fields: { orderBy: { position: 'asc' } }, department: { select: { name: true } } }, orderBy: { createdAt: 'asc' } })
  const mine = forms.filter((f) => fills(me, f) || seesTeam(me, f))
  res.json({ forms: mine.map((f) => formView(f, me)), canCreate: me.role === 'SUPER_ADMIN' || me.powers.includes('company.settings') || me.role === 'TEAM_LEAD' || me.memberships.some((m) => m.role === 'TEAM_LEAD') })
})

const fieldSchema = z.object({
  id: z.string().max(40).optional(),
  label: z.string().trim().min(1, 'Every question needs a label').max(120),
  help: z.string().trim().max(300).nullable().optional(),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  required: z.boolean().default(false),
  target: z.number().min(0).max(1e9).nullable().optional(),
  targetDir: z.enum(['MIN', 'MAX']).default('MIN'),
  unit: z.string().trim().max(20).nullable().optional(),
})
const formSchema = z.object({
  name: z.string().trim().min(2, 'Give the form a name').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  departmentId: z.string().max(40).nullable().optional(),
  active: z.boolean().optional(),
  fields: z.array(fieldSchema).min(1, 'Add at least one question').max(40),
})

function checkFields(fields: z.infer<typeof fieldSchema>[]) {
  for (const f of fields) {
    if ((f.type === 'CHOICE' || f.type === 'MULTI_CHOICE') && f.options.length < 2) throw new Refused(400, `"${f.label}" needs at least two choices`)
    if (new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) throw new Refused(400, `"${f.label}" has the same choice twice`)
  }
}
const fieldData = (f: z.infer<typeof fieldSchema>, position: number) => ({
  label: f.label, help: f.help ?? null, type: f.type as ReportFieldType, options: f.type === 'CHOICE' || f.type === 'MULTI_CHOICE' ? f.options : [],
  required: f.required, target: f.type === 'NUMBER' ? f.target ?? null : null, targetDir: f.targetDir, unit: f.type === 'NUMBER' ? f.unit ?? null : null, position, archived: false,
})

/** POST /api/daily-report/forms */
export const createForm = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const body = formSchema.parse(req.body)
  checkFields(body.fields)
  const departmentId = body.departmentId ?? null
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) throw new Refused(404, 'Department not found')
  if (!manages(me, { departmentId })) throw new Refused(403, departmentId ? 'Only this department\'s team lead or the Super Admin can make its form.' : 'Only the Super Admin can make a form for everyone.')
  const form = await prisma.reportForm.create({
    data: { name: body.name, description: body.description ?? null, departmentId, createdById: me.id, fields: { create: body.fields.map((f, i) => fieldData(f, i)) } },
  })
  res.status(201).json({ form: formView(await loadForm(form.id), me) })
})

/** PUT /api/daily-report/forms/:id — name, who fills it, and its questions. A removed question is archived (old answers keep it). */
export const updateForm = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!manages(me, form)) throw new Refused(403, 'Only the team lead or the Super Admin can change this form.')
  const body = formSchema.parse(req.body)
  checkFields(body.fields)
  const departmentId = body.departmentId === undefined ? form.departmentId : body.departmentId
  if (departmentId !== form.departmentId && !manages(me, { departmentId })) throw new Refused(403, 'You cannot move the form to that department.')
  const keep = new Set(body.fields.map((f) => f.id).filter(Boolean) as string[])
  for (const id of keep) if (!form.fields.some((f) => f.id === id)) throw new Refused(400, 'A question does not belong to this form')
  await prisma.$transaction(async (tx) => {
    await tx.reportForm.update({ where: { id: form.id }, data: { name: body.name, description: body.description ?? null, departmentId, ...(body.active !== undefined ? { active: body.active } : {}) } })
    await tx.reportField.updateMany({ where: { formId: form.id, id: { notIn: [...keep] } }, data: { archived: true } })
    for (const [i, f] of body.fields.entries()) {
      if (f.id) {
        // The kind of answer cannot change once there are answers (they would stop making sense).
        const old = form.fields.find((x) => x.id === f.id)!
        await tx.reportField.update({ where: { id: f.id }, data: { ...fieldData(f, i), type: old.type } })
      } else {
        await tx.reportField.create({ data: { formId: form.id, ...fieldData(f, i) } })
      }
    }
  })
  res.json({ form: formView(await loadForm(form.id), me) })
})

/** DELETE /api/daily-report/forms/:id — only a form nobody has filled in yet; otherwise switch it off. */
export const deleteForm = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!manages(me, form)) throw new Refused(403, 'Only the team lead or the Super Admin can remove this form.')
  if (await prisma.reportEntry.count({ where: { formId: form.id } })) throw new Refused(409, 'People have filled this form in. Switch it off instead, so their reports stay.')
  await prisma.reportForm.delete({ where: { id: form.id } })
  res.status(204).end()
})

// ------------------------------------------------------------------ my report

/** GET /api/daily-report/forms/:id/entry?date= — my answers for a day. */
export const myEntry = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!fills(me, form)) throw new Refused(403, 'This form is not yours to fill in.')
  const today = companyToday()
  const date = parseDate(req.query.date, today)
  const [entry, leave, holiday, recent] = await Promise.all([
    prisma.reportEntry.findUnique({ where: { formId_userId_date: { formId: form.id, userId: me.id, date: dbDateFromString(date) } } }),
    prisma.leaveDay.findUnique({ where: { userId_date: { userId: me.id, date: dbDateFromString(date) } } }),
    prisma.holiday.findFirst({ where: { date: dbDateFromString(date) } }),
    prisma.reportEntry.findMany({ where: { formId: form.id, userId: me.id }, orderBy: { date: 'desc' }, take: 14, select: { date: true, submittedAt: true, updatedAt: true } }),
  ])
  const oldest = DateTime.fromISO(today, { zone: companyTz() }).minus({ days: EDIT_DAYS - 1 }).toISODate()!
  res.json({
    form: formView(form, me), date, today, editable: date <= today && date >= oldest,
    entry: entry ? { values: entry.values, submittedAt: entry.submittedAt, updatedAt: entry.updatedAt } : null,
    onLeave: !!leave, holiday: holiday?.name ?? null,
    recent: recent.map((r) => ({ date: dateStringFromDb(r.date), updatedAt: r.updatedAt })),
  })
})

/** PUT /api/daily-report/forms/:id/entry { date, values } — send (or send again) my report for a day. */
export const saveEntry = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!fills(me, form)) throw new Refused(403, 'This form is not yours to fill in.')
  const today = companyToday()
  const date = parseDate(req.body?.date, today)
  const oldest = DateTime.fromISO(today, { zone: companyTz() }).minus({ days: EDIT_DAYS - 1 }).toISODate()!
  if (date > today) throw new Refused(422, 'You cannot send a report for a day that has not come yet.')
  if (date < oldest) throw new Refused(422, `Reports can be sent or changed for the last ${EDIT_DAYS} days only.`)
  const check = checkAnswers(fieldDefs(form), req.body?.values)
  if (!check.ok) throw new Refused(422, check.error)
  const values = check.values as Prisma.InputJsonValue
  const e = await prisma.reportEntry.upsert({
    where: { formId_userId_date: { formId: form.id, userId: me.id, date: dbDateFromString(date) } },
    update: { values },
    create: { formId: form.id, userId: me.id, date: dbDateFromString(date), values },
  })
  res.json({ entry: { values: e.values, submittedAt: e.submittedAt, updatedAt: e.updatedAt }, date })
})

// ------------------------------------------------------------------ the team

async function daysOff(userIds: string[], from: string, to: string) {
  const [leaves, holidays] = await Promise.all([
    prisma.leaveDay.findMany({ where: { userId: { in: userIds }, date: { gte: dbDateFromString(from), lte: dbDateFromString(to) } }, select: { userId: true, date: true } }),
    prisma.holiday.findMany({ where: { date: { gte: dbDateFromString(from), lte: dbDateFromString(to) } }, select: { date: true, name: true } }),
  ])
  return {
    leave: new Set(leaves.map((l) => `${l.userId}|${dateStringFromDb(l.date)}`)),
    holidays: new Map(holidays.map((h) => [dateStringFromDb(h.date), h.name])),
  }
}

/** GET /api/daily-report/forms/:id/team?date= — everyone's answers for a day, with totals against targets. */
export const teamDay = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!seesTeam(me, form)) throw new Refused(403, "Only team leads and the Super Admin see the team's reports.")
  const date = parseDate(req.query.date, companyToday())
  const people = await fillers(form, me)
  const entries = await prisma.reportEntry.findMany({ where: { formId: form.id, date: dbDateFromString(date), userId: { in: people.map((p) => p.id) } } })
  const off = await daysOff(people.map((p) => p.id), date, date)
  const byUser = new Map(entries.map((e) => [e.userId, e]))
  const defs = fieldDefs(form).filter((f) => !f.archived)
  const sums = sumNumbers(defs, entries)
  const holiday = off.holidays.get(date) ?? null
  const rows = people.map((p) => {
    const e = byUser.get(p.id)
    const status = e ? 'SENT' : off.leave.has(`${p.id}|${date}`) ? 'ON_LEAVE' : holiday ? 'HOLIDAY' : 'MISSING'
    return {
      userId: p.id, name: p.name, status, values: e?.values ?? null, updatedAt: e?.updatedAt ?? null,
      tones: e ? Object.fromEntries(defs.filter((f) => f.type === 'NUMBER').map((f) => [f.id, targetTone(Number((e.values as Record<string, unknown>)[f.id] ?? 0), f.target, f.targetDir)])) : {},
    }
  })
  const working = rows.filter((r) => r.status === 'SENT' || r.status === 'MISSING').length
  res.json({
    form: formView(form, me), date, holiday,
    counts: { people: rows.length, sent: entries.length, missing: rows.filter((r) => r.status === 'MISSING').length, onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length },
    totals: defs.filter((f) => f.type === 'NUMBER' || f.type === 'RATING').map((f) => {
      const s = sums[f.id]
      const teamTarget = f.target && working ? f.target * working : null
      return { fieldId: f.id, total: s.total, average: s.average, answers: s.count, target: teamTarget, tone: f.type === 'NUMBER' ? targetTone(s.total, teamTarget, f.targetDir) : 'neutral' }
    }),
    rows,
  })
})

function rangeOf(req: AuthedRequest): { from: string; to: string } {
  const today = companyToday()
  const to = parseDate(req.query.to, today)
  const from = parseDate(req.query.from, DateTime.fromISO(to).minus({ days: 29 }).toISODate()!)
  if (from > to) throw new Refused(400, 'The start is after the end')
  if (DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days > 366) throw new Refused(400, 'Pick at most a year')
  return { from, to }
}

/** GET /api/daily-report/forms/:id/trend?from=&to= — per day: reports sent and each number added up (for the charts). */
export const trend = wrap(async (req, res) => {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!seesTeam(me, form)) throw new Refused(403, "Only team leads and the Super Admin see the team's reports.")
  const { from, to } = rangeOf(req)
  const people = await fillers(form, me)
  const entries = await prisma.reportEntry.findMany({ where: { formId: form.id, userId: { in: people.map((p) => p.id) }, date: { gte: dbDateFromString(from), lte: dbDateFromString(to) } }, select: { date: true, values: true } })
  const defs = fieldDefs(form).filter((f) => !f.archived && (f.type === 'NUMBER' || f.type === 'RATING'))
  const byDay = new Map<string, { values: unknown }[]>()
  for (const e of entries) { const d = dateStringFromDb(e.date); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(e) }
  const days: { date: string; sent: number; totals: Record<string, number>; averages: Record<string, number> }[] = []
  for (let d = DateTime.fromISO(from); d <= DateTime.fromISO(to); d = d.plus({ days: 1 })) {
    const iso = d.toISODate()!
    const list = byDay.get(iso) ?? []
    const s = sumNumbers(defs, list)
    days.push({ date: iso, sent: list.length, totals: Object.fromEntries(defs.map((f) => [f.id, s[f.id].total])), averages: Object.fromEntries(defs.map((f) => [f.id, s[f.id].average])) })
  }
  res.json({ from, to, people: people.length, fields: defs.map((f) => ({ id: f.id, label: f.label, type: f.type, target: f.target, targetDir: f.targetDir })), days })
})

async function monthly(req: AuthedRequest) {
  const me = await whoAmI(req)
  const form = await loadForm(req.params.id)
  if (!seesTeam(me, form)) throw new Refused(403, "Only team leads and the Super Admin see the team's reports.")
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : companyToday().slice(0, 7)
  const start = DateTime.fromISO(`${month}-01`)
  if (!start.isValid) throw new Refused(400, 'Not a month')
  const from = start.toISODate()!
  const end = start.endOf('month').toISODate()!
  const to = end < companyToday() ? end : companyToday()
  const people = await fillers(form, me)
  const entries = await prisma.reportEntry.findMany({ where: { formId: form.id, userId: { in: people.map((p) => p.id) }, date: { gte: dbDateFromString(from), lte: dbDateFromString(end) } }, select: { userId: true, date: true, values: true } })
  const off = await daysOff(people.map((p) => p.id), from, to)
  const defs = fieldDefs(form).filter((f) => !f.archived)
  const numbers = defs.filter((f) => f.type === 'NUMBER' || f.type === 'RATING')
  // Working days in the month so far: Monday to Saturday, not holidays.
  const workDays: string[] = []
  for (let d = start; d.toISODate()! <= to; d = d.plus({ days: 1 })) if (d.weekday !== 7 && !off.holidays.has(d.toISODate()!)) workDays.push(d.toISODate()!)
  const rows = people.map((p) => {
    const mine = entries.filter((e) => e.userId === p.id)
    const leaveDays = workDays.filter((d) => off.leave.has(`${p.id}|${d}`)).length
    const due = workDays.length - leaveDays
    const s = sumNumbers(numbers, mine)
    return {
      userId: p.id, name: p.name, sent: mine.length, due, onLeave: leaveDays,
      fields: Object.fromEntries(numbers.map((f) => [f.id, { total: s[f.id].total, average: s[f.id].average, tone: f.type === 'NUMBER' ? targetTone(s[f.id].average, f.target, f.targetDir) : 'neutral' }])),
    }
  })
  return { form, me, month, from, to, workDays: workDays.length, fields: numbers.map((f) => ({ id: f.id, label: f.label, type: f.type, target: f.target, targetDir: f.targetDir })), rows }
}

/** GET /api/daily-report/forms/:id/monthly?month=YYYY-MM — per person: reports sent, and each number's total and daily average. */
export const monthlyReport = wrap(async (req, res) => {
  const m = await monthly(req)
  res.json({ form: formView(m.form, m.me), month: m.month, workDays: m.workDays, fields: m.fields, rows: m.rows })
})

/** GET /api/daily-report/forms/:id/monthly.csv?month= — the monthly report as a spreadsheet. */
export const monthlyCsv = wrap(async (req, res) => {
  const m = await monthly(req)
  const head = ['Name', 'Reports sent', 'Reports due', 'Days on leave', ...m.fields.flatMap((f) => [`${f.label} (total)`, `${f.label} (daily average)`])]
  const lines = [head.map(csvCell).join(',')]
  for (const r of m.rows) lines.push([r.name, r.sent, r.due, r.onLeave, ...m.fields.flatMap((f) => [r.fields[f.id].total, Math.round(r.fields[f.id].average * 100) / 100])].map(csvCell).join(','))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${m.form.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'daily-report'}-${m.month}.csv"`)
  res.send(lines.join('\n'))
})
