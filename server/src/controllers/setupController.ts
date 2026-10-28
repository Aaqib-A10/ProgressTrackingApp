import type { Response } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { Prisma, type DepartmentType, type Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { hashPassword, signInviteToken } from '../lib/auth'
import { loadPowers } from '../lib/permissions'
import { checkPeopleRoom } from '../lib/plans'
import { sendInviteEmail } from '../lib/mail'
import { createProjectWithDefaults } from '../lib/pm/tasks'
import { companyToday, dbDateFromString } from '../lib/time'
import { randomBytes } from 'node:crypto'

/**
 * The setup wizard (Phase 1, step 7): a new company is ready in about five minutes. Name and
 * time zone, departments, a daily report to start with, people (by email or a CSV), and sample
 * data to look around with (taken out again with one click).
 */

class Refused extends Error { constructor(public status: number, message: string) { super(message) } }
function send(res: Response, e: unknown): void {
  if (e instanceof Refused) { res.status(e.status).json({ error: e.message }); return }
  if (e instanceof z.ZodError) { res.status(400).json({ error: e.issues[0]?.message ?? 'Invalid input' }); return }
  throw e
}
const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<void>) => async (req: AuthedRequest, res: Response) => { try { await fn(req, res) } catch (e) { send(res, e) } }

async function founder(req: AuthedRequest) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, companyId: true, emailCheckPending: true, departmentId: true } })
  if (!(await loadPowers(u.id)).includes('company.settings')) throw new Refused(403, 'Only the Super Admin can set up the company.')
  return u
}

type Q = { label: string; type: 'NUMBER' | 'TEXT' | 'LONG_TEXT' | 'RATING' | 'YES_NO'; target?: number; targetDir?: 'MIN' | 'MAX'; unit?: string; required?: boolean }
/** Daily forms to start from (they can be changed in Report Forms any time). */
export const FORM_TEMPLATES: Record<string, { name: string; description: string; fields: Q[] }> = {
  general: { name: 'Daily report', description: 'What got done, and what is in the way.', fields: [
    { label: 'Tasks finished', type: 'NUMBER', target: 5, required: true },
    { label: 'What did you work on?', type: 'LONG_TEXT', required: true },
    { label: 'Anything blocking you?', type: 'LONG_TEXT' },
    { label: 'How was your day?', type: 'RATING' },
  ] },
  sales: { name: 'Sales daily', description: 'Calls, meetings and deals.', fields: [
    { label: 'Calls made', type: 'NUMBER', target: 50, required: true },
    { label: 'Conversations', type: 'NUMBER', target: 15 },
    { label: 'Meetings booked', type: 'NUMBER', target: 2 },
    { label: 'Deals closed', type: 'NUMBER' },
    { label: 'Notes on the pipeline', type: 'LONG_TEXT' },
  ] },
  support: { name: 'Support daily', description: 'Tickets and how fast we answer.', fields: [
    { label: 'Tickets solved', type: 'NUMBER', target: 20, required: true },
    { label: 'First reply time', type: 'NUMBER', target: 30, targetDir: 'MAX', unit: 'min' },
    { label: 'Passed on to someone else', type: 'NUMBER', target: 2, targetDir: 'MAX' },
    { label: 'Anything customers keep asking?', type: 'LONG_TEXT' },
  ] },
  solo: { name: 'My day', description: 'Three things, focus and energy.', fields: [
    { label: 'Top things I finished', type: 'LONG_TEXT', required: true },
    { label: 'Hours of focused work', type: 'NUMBER', target: 4, unit: 'h' },
    { label: 'Energy', type: 'RATING' },
    { label: "Tomorrow's first thing", type: 'TEXT' },
  ] },
}

/** GET /api/setup — where the company is in the setup. */
export const status = wrap(async (req, res) => {
  const u = await founder(req)
  const c = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId } })
  const [departments, forms, people] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, type: true }, orderBy: { createdAt: 'asc' } }),
    prisma.reportForm.count(),
    prisma.user.count({ where: { isActive: true } }),
  ])
  res.json({
    company: { id: c.id, name: c.name, kind: c.kind, timeZone: c.timeZone, slug: c.slug, trialEndsAt: c.trialEndsAt, setupDoneAt: c.setupDoneAt },
    emailCheckPending: u.emailCheckPending,
    departments, hasDailyForm: forms > 0, people, hasSample: !!c.sampleIds,
    templates: Object.entries(FORM_TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description, questions: t.fields.map((f) => f.label) })),
  })
})

const deptSchema = z.object({ departments: z.array(z.object({ name: z.string().trim().min(2).max(60), type: z.enum(['GENERAL', 'ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE', 'INVENTORY', 'CSR']).default('GENERAL') })).max(20) })

/** POST /api/setup/departments { departments: [{ name, type }] } — adds the ones that are not there yet; the founder joins the first. */
export const departments = wrap(async (req, res) => {
  const u = await founder(req)
  const body = deptSchema.parse(req.body)
  const have = await prisma.department.findMany({ select: { id: true, name: true, type: true } })
  for (const d of body.departments) {
    if (have.some((h) => h.name.toLowerCase() === d.name.toLowerCase())) continue
    if (d.type !== 'GENERAL' && have.some((h) => h.type === d.type)) continue
    have.push(await prisma.department.create({ data: { name: d.name, type: d.type as DepartmentType }, select: { id: true, name: true, type: true } }))
  }
  res.json({ departments: have, me: u.id })
})

/** POST /api/setup/daily-form { template, departmentId? } — start from a ready daily form (or skip with "none"). */
export const dailyForm = wrap(async (req, res) => {
  const u = await founder(req)
  const { template, departmentId } = z.object({ template: z.string(), departmentId: z.string().nullable().optional() }).parse(req.body)
  if (template === 'none') { res.json({ ok: true }); return }
  const t = FORM_TEMPLATES[template]
  if (!t) throw new Refused(404, 'No such template')
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) throw new Refused(404, 'Department not found')
  const form = await prisma.reportForm.create({
    data: {
      name: t.name, description: t.description, departmentId: departmentId ?? null, createdById: u.id,
      fields: { create: t.fields.map((f, i) => ({ label: f.label, type: f.type, required: !!f.required, target: f.target ?? null, targetDir: f.targetDir ?? 'MIN', unit: f.unit ?? null, position: i })) },
    },
    select: { id: true, name: true },
  })
  res.status(201).json({ form })
})

const inviteSchema = z.object({
  people: z.array(z.object({
    name: z.string().trim().max(80).optional(),
    email: z.string().trim().toLowerCase().email('One of the emails is not right'),
    departmentId: z.string().max(40).nullable().optional(),
    role: z.enum(['MEMBER', 'TEAM_LEAD']).default('MEMBER'),
  })).min(1, 'Add at least one person').max(200, 'At most 200 people at a time'),
})

/**
 * POST /api/company/invites { people: [{ name?, email, departmentId?, role }] } — invite people by
 * email (typed in, or from a CSV). Each gets an email to set their password. People who already
 * have a Metriq account are skipped and listed.
 */
export const invite = wrap(async (req, res) => {
  const u = await founder(req)
  if (u.emailCheckPending) throw new Refused(403, 'Confirm your email first (we sent you a link), then invite your people.')
  const body = inviteSchema.parse(req.body)
  const seen = new Set<string>()
  const list = body.people.filter((p) => !seen.has(p.email) && seen.add(p.email))
  const taken = new Set((await prisma.$queryRaw<{ email: string }[]>`SELECT email FROM "User" WHERE email = ANY(${list.map((p) => p.email)})`).map((r) => r.email))
  const fresh = list.filter((p) => !taken.has(p.email))
  await checkPeopleRoom(fresh.length)
  const depts = new Set((await prisma.department.findMany({ select: { id: true } })).map((d) => d.id))
  const added: { email: string; name: string }[] = []
  for (const p of fresh) {
    const name = p.name || p.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const departmentId = p.departmentId && depts.has(p.departmentId) ? p.departmentId : null
    const role: Role = p.role
    const user = await prisma.user.create({
      data: {
        name, email: p.email, role, status: 'ACTIVE', isActive: true, passwordHash: await hashPassword(randomBytes(18).toString('base64url')),
        departmentId, emailVerifiedAt: null, ...(departmentId ? { memberships: { create: { departmentId, role } } } : {}),
      },
    })
    await sendInviteEmail({ to: user.email, name: user.name.split(' ')[0], token: signInviteToken(user.id), inviterName: u.name })
    added.push({ email: user.email, name: user.name })
  }
  res.status(201).json({ added, skipped: [...taken] })
})

/** POST /api/setup/sample { on } — a sample project, tasks, a week of daily reports and to-dos to look around with; off takes them out again. */
export const sample = wrap(async (req, res) => {
  const u = await founder(req)
  const { on } = z.object({ on: z.boolean() }).parse(req.body)
  const c = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId }, select: { sampleIds: true } })
  const ids = (c.sampleIds ?? {}) as Record<string, string[]>
  if (!on) {
    if (ids.PmProject?.length) await prisma.pmProject.deleteMany({ where: { id: { in: ids.PmProject } } })
    if (ids.ReportForm?.length) await prisma.reportForm.deleteMany({ where: { id: { in: ids.ReportForm } } })
    if (ids.TodoItem?.length) await prisma.todoItem.deleteMany({ where: { id: { in: ids.TodoItem } } })
    await prisma.company.update({ where: { id: u.companyId }, data: { sampleIds: Prisma.DbNull } })
    res.json({ sample: false })
    return
  }
  if (c.sampleIds) { res.json({ sample: true }); return }
  const out: Record<string, string[]> = { PmProject: [], ReportForm: [], TodoItem: [] }
  const key = (await prisma.pmProject.findFirst({ where: { key: 'SAMPLE' } })) ? `S${Date.now().toString(36).slice(-4).toUpperCase()}` : 'SAMPLE'
  const project = await createProjectWithDefaults({ name: 'Sample project', key, description: 'Made by the setup wizard so you can look around. Take it out in Company settings → Setup.', color: '#14B8A6', ownerId: u.id })
  out.PmProject.push(project.id)
  const columns = await prisma.pmColumn.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } })
  const titles: [string, number][] = [['Plan the launch week', 0], ['Write the welcome email', 1], ['Set up the team board', 1], ['Collect feedback from the first customers', 0], ['Celebrate the first sale', columns.length - 1]]
  let n = 0
  for (const [title, col] of titles) {
    n++
    const column = columns[Math.min(col, columns.length - 1)]
    await prisma.pmTask.create({ data: { projectId: project.id, code: `${key}-${n}`, title, columnId: column.id, position: n * 1000, createdById: u.id, completedAt: column.category === 'DONE' ? new Date() : null, dueAt: DateTime.now().plus({ days: n }).toJSDate(), assignees: { create: { userId: u.id, assignedById: u.id } } } })
  }
  await prisma.pmProject.update({ where: { id: project.id }, data: { taskCounter: n } })
  const t = FORM_TEMPLATES.general
  const form = await prisma.reportForm.create({ data: { name: 'Sample daily report', description: 'Sample data: a week of reports to see the team view and charts.', createdById: u.id, fields: { create: t.fields.map((f, i) => ({ label: f.label, type: f.type, required: !!f.required, target: f.target ?? null, targetDir: f.targetDir ?? 'MIN', position: i })) } }, include: { fields: { orderBy: { position: 'asc' } } } })
  out.ReportForm.push(form.id)
  const today = DateTime.fromISO(companyToday())
  for (let d = 1; d <= 6; d++) {
    const day = today.minus({ days: d })
    if (day.weekday === 7) continue
    const values: Record<string, Prisma.InputJsonValue> = { [form.fields[0].id]: 3 + ((d * 2) % 5), [form.fields[1].id]: 'Sample: worked on the launch plan.', [form.fields[3].id]: 3 + (d % 3) }
    await prisma.reportEntry.create({ data: { formId: form.id, userId: u.id, date: dbDateFromString(day.toISODate()!), values } })
  }
  for (const [i, title] of ['Try the daily report', 'Invite your team', 'Look at the sample project board'].entries()) {
    out.TodoItem.push((await prisma.todoItem.create({ data: { userId: u.id, title, order: i } })).id)
  }
  await prisma.company.update({ where: { id: u.companyId }, data: { sampleIds: out } })
  res.status(201).json({ sample: true })
})

/** POST /api/setup/done — the wizard is finished (or skipped). */
export const done = wrap(async (req, res) => {
  const u = await founder(req)
  await prisma.company.update({ where: { id: u.companyId }, data: { setupDoneAt: new Date() } })
  res.json({ ok: true })
})
