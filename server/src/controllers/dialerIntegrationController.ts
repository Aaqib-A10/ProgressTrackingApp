import type { Request, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { whoAmI } from './dialerController'
import { isOn } from '../lib/flags'
import { runAsCompany } from '../lib/tenancy'
import {
  DEFAULT_DISPOSITIONS, FIELD_KEYS, FIELDS, KEY_PREFIX, OUTCOMES, OUTCOME_KEYS,
  applyToLead, findAgent, findLead, flatten, hashToken, newToken, outcomeOf, readCall, receiveCall, type Outcome,
} from '../lib/dialer/calls'

/**
 * Lead Dialer → Settings → Predictive dialer (ITAD managers), and the private link the dialer
 * calls after every call. See lib/dialer/calls.ts for what happens to each call.
 */

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')

async function manager(req: AuthedRequest, res: Response) {
  const me = await whoAmI(req)
  if (!me.isManager) { res.status(403).json({ error: 'Only ITAD team leads and Super Admins can set up the dialer.' }); return null }
  return me
}

const current = () => prisma.dialerIntegration.findFirst({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } })

const callView = (c: Prisma.DialerCallGetPayload<{ include: { lead: { select: { id: true; company: true; owner: { select: { name: true } } } }; agent: { select: { name: true } } } }>) => ({
  id: c.id, calledAt: c.calledAt.toISOString(), phone: c.phone, disposition: c.disposition, outcome: c.outcome,
  outcomeLabel: c.outcome ? OUTCOMES[c.outcome as Outcome] : null, notes: c.notes, durationSec: c.durationSec,
  agent: c.agent?.name ?? null, agentRaw: c.agentRaw, matchedBy: c.matchedBy, effect: c.effect,
  lead: c.lead ? { id: c.lead.id, company: c.lead.company, owner: c.lead.owner.name } : null,
})
const callInclude = { lead: { select: { id: true, company: true, owner: { select: { name: true } } } }, agent: { select: { name: true } } } as const

/** GET /api/dialer/integration — the set-up, the defaults, recent calls and calls waiting to be matched. */
export async function getIntegration(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const it = await current()
  const [recent, unmatched, agents] = await Promise.all([
    it ? prisma.dialerCall.findMany({ where: { integrationId: it.id }, orderBy: { createdAt: 'desc' }, take: 50, include: callInclude }) : [],
    it ? prisma.dialerCall.findMany({ where: { integrationId: it.id, leadId: null }, orderBy: { createdAt: 'desc' }, take: 100, include: callInclude }) : [],
    prisma.user.findMany({ where: { isActive: true, status: 'ACTIVE', OR: [{ department: { type: 'ITAD' } }, { memberships: { some: { department: { type: 'ITAD' } } } }] }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ])
  res.json({
    integration: it ? {
      id: it.id, name: it.name, prefix: it.prefix, enabled: it.enabled, createdAt: it.createdAt.toISOString(), lastReceivedAt: it.lastReceivedAt?.toISOString() ?? null,
      fieldMap: it.fieldMap, dispositionMap: it.dispositionMap, agentMap: it.agentMap,
    } : null,
    outcomes: OUTCOME_KEYS.map((k) => ({ key: k, label: OUTCOMES[k] })),
    defaultDispositions: DEFAULT_DISPOSITIONS,
    fields: FIELD_KEYS.map((k) => ({ key: k, names: FIELDS[k] })),
    agents,
    recent: recent.map(callView),
    unmatched: unmatched.map(callView),
  })
}

/** POST /api/dialer/integration { name } — a new private link (the old one stops). Shown once. */
export async function createIntegration(req: AuthedRequest, res: Response): Promise<void> {
  const me = await manager(req, res)
  if (!me) return
  const p = z.object({ name: z.string().trim().min(1).max(60).default('Predictive dialer') }).safeParse(req.body ?? {})
  if (!p.success) { res.status(400).json({ error: 'Give the dialer a name.' }); return }
  const old = await current()
  const token = newToken()
  const it = await prisma.$transaction(async (tx) => {
    if (old) await tx.dialerIntegration.update({ where: { id: old.id }, data: { revokedAt: new Date(), enabled: false } })
    return tx.dialerIntegration.create({
      data: {
        name: p.data.name, tokenHash: hashToken(token), prefix: token.slice(0, 10), createdById: me.id,
        // A new link keeps the mappings already set up.
        fieldMap: (old?.fieldMap ?? {}) as Prisma.InputJsonValue, dispositionMap: (old?.dispositionMap ?? {}) as Prisma.InputJsonValue, agentMap: (old?.agentMap ?? {}) as Prisma.InputJsonValue,
      },
    })
  })
  res.status(201).json({ id: it.id, hookUrl: `${APP_URL()}/api/dialer-hook/${token}` })
}

const mapSchema = z.record(z.string().trim().min(1).max(120), z.string().trim().max(200))
const putSchema = z.object({
  enabled: z.boolean().optional(),
  fieldMap: z.record(z.enum(['timeZone', ...FIELD_KEYS] as unknown as [string, ...string[]]), z.string().trim().max(120)).optional(),
  dispositionMap: z.record(z.string().trim().min(1).max(120), z.enum(OUTCOME_KEYS as [Outcome, ...Outcome[]])).optional(),
  agentMap: mapSchema.optional(),
})

/** PUT /api/dialer/integration — field names, disposition codes, agents, on/off. */
export async function updateIntegration(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const it = await current()
  if (!it) { res.status(404).json({ error: 'Make the dialer link first.' }); return }
  const p = putSchema.safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: p.error.issues[0]?.message ?? 'Check the settings.' }); return }
  const tz = p.data.fieldMap?.timeZone
  if (tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch { res.status(400).json({ error: `Unknown time zone "${tz}". Use one like America/New_York or Asia/Karachi.` }); return } }
  if (p.data.agentMap) {
    const ids = [...new Set(Object.values(p.data.agentMap).filter(Boolean))]
    const found = await prisma.user.count({ where: { id: { in: ids } } })
    if (found !== ids.length) { res.status(400).json({ error: 'An agent is linked to someone who is not in Metriq.' }); return }
  }
  const clean = (m: Record<string, string> | undefined) => (m ? Object.fromEntries(Object.entries(m).filter(([, v]) => v)) : undefined)
  const next = await prisma.dialerIntegration.update({
    where: { id: it.id },
    data: {
      ...(p.data.enabled !== undefined ? { enabled: p.data.enabled } : {}),
      ...(p.data.fieldMap ? { fieldMap: clean(p.data.fieldMap) } : {}),
      ...(p.data.dispositionMap ? { dispositionMap: p.data.dispositionMap } : {}),
      ...(p.data.agentMap ? { agentMap: clean(p.data.agentMap) } : {}),
    },
  })
  res.json({ ok: true, enabled: next.enabled })
}

/** DELETE /api/dialer/integration — switch the link off (the dialer's messages are refused). */
export async function revokeIntegration(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const it = await current()
  if (!it) { res.status(404).json({ error: 'No dialer link.' }); return }
  await prisma.dialerIntegration.update({ where: { id: it.id }, data: { revokedAt: new Date(), enabled: false } })
  res.status(204).end()
}

/** POST /api/dialer/integration/test { message } — how Metriq would read a message, without saving anything. */
export async function testIntegration(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const it = await current()
  const p = z.object({ message: z.union([z.string().max(20000), z.record(z.string(), z.unknown())]) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Paste a message from the dialer.' }); return }
  let payload: Record<string, unknown>
  if (typeof p.data.message === 'string') {
    const t = p.data.message.trim()
    try { payload = JSON.parse(t) as Record<string, unknown> } catch {
      // A link or a query string: https://...?phone_number=...&dispo=NA
      payload = Object.fromEntries(new URLSearchParams(t.includes('?') ? t.slice(t.indexOf('?') + 1) : t))
    }
  } else payload = p.data.message
  const fieldMap = (it?.fieldMap ?? {}) as Record<string, string>
  const c = readCall(flatten(payload), fieldMap, fieldMap.timeZone || 'UTC')
  const agentId = await findAgent(c.agent, (it?.agentMap ?? {}) as Record<string, string>)
  const outcome = c.disposition ? outcomeOf(c.disposition, (it?.dispositionMap ?? {}) as Record<string, string>) : null
  const { lead, matchedBy } = await findLead(c, agentId)
  const [leadRow, agentRow] = await Promise.all([
    lead ? prisma.dialerLead.findUnique({ where: { id: lead.id }, select: { company: true, status: true, owner: { select: { name: true } } } }) : null,
    agentId ? prisma.user.findUnique({ where: { id: agentId }, select: { name: true } }) : null,
  ])
  res.json({
    read: { ...c, calledAt: c.calledAt?.toISOString() ?? null, callbackAt: c.callbackAt?.toISOString() ?? null },
    outcome, outcomeLabel: outcome ? OUTCOMES[outcome] : null,
    agent: agentRow?.name ?? null,
    lead: lead && leadRow ? { id: lead.id, company: leadRow.company, status: leadRow.status, owner: leadRow.owner.name, matchedBy } : null,
    problems: [
      !c.disposition && 'No disposition found.',
      !c.phone && !c.leadId && !c.crmId && 'No phone number or lead ID found.',
      c.disposition && !outcome && `The disposition "${c.disposition}" is not mapped: add it under Dispositions, or the call is only logged.`,
      c.agent && !agentId && `The agent "${c.agent}" is not linked to anyone in Metriq: link them under Agents.`,
      !lead && (c.phone || c.leadId || c.crmId) && 'No lead in Metriq has this number or ID.',
    ].filter(Boolean),
  })
}

/** POST /api/dialer/calls/:id/link { leadId } — a manager matches a call to its lead; the lead is updated then. */
export async function linkCall(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const p = z.object({ leadId: z.string().min(1).max(60) }).safeParse(req.body)
  if (!p.success) { res.status(400).json({ error: 'Pick the lead.' }); return }
  const call = await prisma.dialerCall.findUnique({ where: { id: req.params.id } })
  if (!call) { res.status(404).json({ error: 'Call not found' }); return }
  if (call.leadId) { res.status(409).json({ error: 'This call is already on a lead.' }); return }
  const lead = await prisma.dialerLead.findUnique({ where: { id: p.data.leadId }, select: { id: true, company: true } })
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return }
  await prisma.dialerCall.update({ where: { id: call.id }, data: { matchedBy: 'manual' } })
  const effect = await applyToLead(call.id, lead.id, call.outcome as Outcome | null, {
    disposition: call.disposition, notes: call.notes, agentId: call.agentId, agentRaw: call.agentRaw, durationSec: call.durationSec, calledAt: call.calledAt, callbackAt: call.callbackAt,
  })
  res.json({ ok: true, effect, lead })
}

/** GET /api/dialer/leads-search?q= — managers look up a lead to match a call (any ITAD rep's). */
export async function searchLeads(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await manager(req, res))) return
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) { res.json({ leads: [] }); return }
  const digits = q.replace(/\D/g, '')
  const leads = await prisma.dialerLead.findMany({
    where: { OR: [{ company: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-4) } }] : [])] },
    select: { id: true, company: true, contactName: true, phone: true, status: true, owner: { select: { name: true } } },
    take: 20, orderBy: { updatedAt: 'desc' },
  })
  res.json({ leads: leads.map((l) => ({ ...l, owner: l.owner.name })) })
}

// ------------------------------------------------------------------ the dialer's link (no login)

/** GET or POST /api/dialer-hook/:token — one call result from the dialer (JSON, a web form, or ?fields on the link). */
export async function dialerHook(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  const token = String(req.params.token ?? '')
  if (!token.startsWith(KEY_PREFIX) || token.length < 20 || token.length > 100) { res.status(404).json({ ok: false, error: 'Unknown link' }); return }
  const it = await prisma.dialerIntegration.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!it || it.revokedAt) { res.status(404).json({ ok: false, error: 'Unknown link' }); return }
  if (!it.enabled) { res.status(403).json({ ok: false, error: 'The dialer link is switched off in Metriq.' }); return }
  // Owner switch (Phase 1 safety net): 503 so the dialer retries later instead of dropping the result.
  if (!(await isOn('dialer-sync', it.companyId))) { res.status(503).json({ ok: false, error: 'Dialer sync is paused in Metriq. Try again later.' }); return }
  let body: unknown = req.body
  if (typeof body === 'string') { const t = body; try { body = JSON.parse(t) } catch { body = Object.fromEntries(new URLSearchParams(t)) } }
  const payload = { ...(req.query as Record<string, unknown>), ...(body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}) }
  // The dialer link belongs to one company: the call only ever reaches that company's leads.
  const r = await runAsCompany(it.companyId, () => receiveCall(it, payload))
  res.status(r.status).json({ ok: r.ok, message: r.message, ...(r.callId ? { callId: r.callId } : {}), matched: !!r.leadId, ...(r.outcome !== undefined ? { outcome: r.outcome } : {}), ...(r.duplicate ? { duplicate: true } : {}) })
}
