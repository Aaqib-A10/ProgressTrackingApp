import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { parse } from '../lib/pm/http'
import { isOn } from '../lib/flags'
import { canManage, leadFor, leadScope, requireLeadAdmin, type LeadScope, type LeadViewer } from '../lib/leads/access'
import { talkloopClient, talkloopConfigured } from '../lib/talkloop/client'
import { pipeTalkLoopRecording } from '../lib/talkloop/stream'
import { attachUnmatched, unmatchedScope } from '../lib/talkloop/unmatched'
import { dialSetting, saveDialSetting } from '../lib/leads/dial'
import { runTalkLoopSync, syncStatus } from '../lib/talkloop/sync'

/**
 * TalkLoop inside Lead Settings (Super Admin): is the phone system connected, who is who, sync now.
 * The token itself never leaves the server; the browser only learns whether one is set.
 */

async function ctx(req: AuthedRequest): Promise<{ me: LeadViewer; s: LeadScope }> {
  if (!req.user) throw new HttpError(401, 'Not authenticated')
  const m = { id: req.user.id, role: req.user.role, companyId: req.user.companyId }
  if (!(await isOn('lead-management', m.companyId))) throw new HttpError(403, 'Lead Management is not switched on for your company.')
  return { me: m, s: await leadScope(m) }
}

/** GET /api/leads/talkloop — status, this company's people with their TalkLoop link, and TalkLoop's users (name, email, extension only). */
export async function talkloopInfo(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const configured = talkloopConfigured()
  const people = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, talkloopUserId: true, talkloopExt: true }, orderBy: { name: 'asc' } })
  let talkloopUsers: { id: number; name: string; email: string | null; extension: string | null; status: string | null }[] = []
  let error: string | null = null
  let pbxDomain: string | null = null
  if (configured) {
    try {
      const raw = await talkloopClient()!.users()
      talkloopUsers = raw.map((u) => ({ id: u.id, name: u.name, email: u.email, extension: u.extension_id ? u.extension_id.split('-')[0] : null, status: u.registration_status }))
      // The PBX domain, read off an extension id like "1000-cmr.talkloop.ai", for sip: links.
      pbxDomain = raw.find((u) => u.extension_id?.includes('-'))?.extension_id?.split('-').slice(1).join('-') ?? null
    } catch (e) { error = e instanceof Error ? e.message : 'Could not reach TalkLoop' }
  }
  res.json({ configured, status: await syncStatus(), people, talkloopUsers, error, dial: await dialSetting(m.companyId), pbxDomain })
}

const linkSchema = z.object({ userId: z.string().max(60).optional(), talkloopUserId: z.number().int().nullable().optional(), auto: z.boolean().optional() })

/** PATCH /api/leads/talkloop/link { userId, talkloopUserId } — or { auto: true } to match everyone by email. */
export async function talkloopLink(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  const b = parse(linkSchema, req.body)
  const client = talkloopClient()
  if (!client) throw new HttpError(422, 'TalkLoop is not connected: set TALKLOOP_TOKEN on the server first.')
  const tl = await client.users()
  const ext = (id: number | null | undefined) => { const u = tl.find((x) => x.id === id); return u?.extension_id ? u.extension_id.split('-')[0] : null }
  if (b.auto) {
    const people = await prisma.user.findMany({ where: { isActive: true, talkloopUserId: null }, select: { id: true, email: true, name: true } })
    let linked = 0
    for (const p of people) {
      const match = tl.find((u) => u.email && u.email.toLowerCase() === p.email.toLowerCase()) ?? tl.find((u) => u.name && u.name.trim().toLowerCase() === p.name.trim().split(' ')[0].toLowerCase())
      if (!match) continue
      const taken = await prisma.user.findUnique({ where: { talkloopUserId: match.id }, select: { id: true } })
      if (taken) continue
      await prisma.user.update({ where: { id: p.id }, data: { talkloopUserId: match.id, talkloopExt: ext(match.id) } })
      linked++
    }
    res.json({ linked })
    return
  }
  if (!b.userId) throw new HttpError(422, 'Pick the person')
  const user = await prisma.user.findUnique({ where: { id: b.userId }, select: { id: true } })
  if (!user) throw new HttpError(404, 'Person not found')
  if (b.talkloopUserId != null) {
    if (!tl.some((u) => u.id === b.talkloopUserId)) throw new HttpError(422, 'That TalkLoop user does not exist any more')
    const taken = await prisma.user.findUnique({ where: { talkloopUserId: b.talkloopUserId }, select: { id: true, name: true } })
    if (taken && taken.id !== user.id) throw new HttpError(409, `${taken.name} is already linked to that TalkLoop user`)
  }
  await prisma.user.update({ where: { id: user.id }, data: { talkloopUserId: b.talkloopUserId ?? null, talkloopExt: b.talkloopUserId != null ? ext(b.talkloopUserId) : null } })
  res.json({ ok: true })
}

/** POST /api/leads/talkloop/sync — read the whole last week now (the 3-minute sync only reads what is new). */
export async function talkloopSyncNow(req: AuthedRequest, res: Response): Promise<void> {
  const { s } = await ctx(req)
  requireLeadAdmin(s)
  if (!talkloopConfigured()) throw new HttpError(422, 'TalkLoop is not connected: set TALKLOOP_TOKEN on the server first.')
  res.json({ status: await runTalkLoopSync(talkloopClient(), new Date(), true) })
}

/** PATCH /api/leads/calls/:id { consentGiven } — the SDR confirms both sides agreed to the recording; it becomes playable. */
export async function callConsent(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const { consentGiven } = parse(z.object({ consentGiven: z.boolean() }), req.body)
  const c = await prisma.leadCall.findFirst({ where: { id: String(req.params.id), ...(s.admin ? {} : { OR: [{ userId: m.id }, { businessId: { in: s.managerOf } }] }) }, select: { id: true, leadId: true, recordingUrl: true } })
  if (!c) throw new HttpError(404, 'Call not found')
  const saved = await prisma.leadCall.update({ where: { id: c.id }, data: { consentGiven, recordingKept: consentGiven && !!c.recordingUrl } })
  await prisma.leadEvent.create({ data: { leadId: c.leadId, userId: m.id, kind: 'CALL', text: consentGiven ? 'Consent to record confirmed: the recording can be played.' : 'Consent withdrawn: the recording stays locked.' } })
  res.json({ call: { id: saved.id, consentGiven: saved.consentGiven, recordingKept: saved.recordingKept, hasRecording: !!saved.recordingUrl && saved.recordingKept, recordingUrl: saved.recordingUrl && saved.recordingKept ? `/api/leads/calls/${saved.id}/recording` : null } })
}

// ------------------------------------------------------------------ calls to numbers no lead has yet

/** GET /api/leads/unmatched — TalkLoop calls to numbers no lead has, one row per number, newest first. */
export async function listUnmatched(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const rows = await prisma.leadUnmatchedCall.findMany({ where: await unmatchedScope(m, s), orderBy: { at: 'desc' }, take: 3000, include: { user: { select: { id: true, name: true } } } })
  const byPhone = new Map<string, typeof rows>()
  for (const r of rows) { const l = byPhone.get(r.phone) ?? []; l.push(r); byPhone.set(r.phone, l) }
  const numbers = [...byPhone.entries()].map(([phone, calls]) => {
    const latest = calls[0]
    const people = [...new Map(calls.map((c) => [c.user.id, c.user])).values()]
    return {
      phone, calls: calls.length, lastAt: latest.at, firstAt: calls[calls.length - 1].at, people,
      connected: calls.filter((c) => c.disposition === 'CONNECTED').length,
      items: calls.slice(0, 20).map((c) => ({ id: c.id, at: c.at, direction: c.direction, durationSec: c.durationSec, disposition: c.disposition, user: c.user, recordingUrl: c.recordingFile && c.durationSec > 0 ? `/api/leads/unmatched/${c.id}/recording` : null })),
    }
  })
  res.json({ numbers, total: rows.length })
}

/** GET /api/leads/unmatched/:id/recording — streamed through Metriq like a lead's recording. */
export async function unmatchedRecording(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const c = await prisma.leadUnmatchedCall.findFirst({ where: { id: String(req.params.id), ...(await unmatchedScope(m, s)) }, select: { externalId: true, recordingFile: true, durationSec: true } })
  if (!c || !c.recordingFile || !c.durationSec) throw new HttpError(404, 'No recording')
  await pipeTalkLoopRecording(req, res, c.externalId)
}

/** POST /api/leads/unmatched/attach { phone, leadId } — every kept call to that number moves under the lead (a new one from "Add as lead", or an existing one). */
export async function attachUnmatchedCalls(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  const b = parse(z.object({ phone: z.string().min(8).max(20), leadId: z.string().min(1).max(60) }), req.body)
  const lead = await leadFor(m, s, b.leadId)
  // A rep attaches to their own leads; a manager to any lead of their businesses.
  if (!canManage(s, lead.businessId) && lead.assigneeId !== m.id && lead.createdById !== m.id) throw new HttpError(403, 'That lead is not yours to change.')
  const mine = await prisma.leadUnmatchedCall.count({ where: { phone: b.phone, ...(await unmatchedScope(m, s)) } })
  if (!mine) throw new HttpError(404, 'No kept calls for that number')
  const moved = await attachUnmatched(m.companyId, b.phone, lead.id, m.id)
  res.json({ moved, leadId: lead.id })
}

/** PATCH /api/leads/talkloop/dial { scheme, domain?, template? } — how the Call buttons dial on this company's PCs. */
export async function setDial(req: AuthedRequest, res: Response): Promise<void> {
  const { me: m, s } = await ctx(req)
  requireLeadAdmin(s)
  const b = parse(z.object({ scheme: z.enum(['tel', 'sip', 'callto', 'custom']), domain: z.string().trim().max(120).nullable().optional(), template: z.string().trim().max(300).nullable().optional() }), req.body)
  if (b.scheme === 'sip' && !b.domain) throw new HttpError(422, 'sip: links need the PBX domain (e.g. cmr.talkloop.ai)')
  if (b.scheme === 'custom' && !(b.template && b.template.includes('{number}') || b.template?.includes('{digits}'))) throw new HttpError(422, 'The custom link must contain {number} or {digits}')
  const next = { scheme: b.scheme, domain: b.domain ?? null, template: b.template ?? null }
  await saveDialSetting(m.companyId, next)
  res.json({ dial: next })
}
