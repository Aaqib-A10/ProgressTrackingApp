import { prisma } from '../prisma'
import { settingsOf } from '../leads/pipeline'
import type { LeadScope, LeadViewer } from '../leads/access'

/**
 * Calls to numbers no lead has yet. The sync keeps them (one row per call) instead of throwing them
 * away; the SDR turns the number into a lead or attaches it to one, and every call for that number
 * moves under the lead as a normal LeadCall. New calls to the number then land there by themselves.
 * Everything here runs inside the company's walls (runAsCompany or a request).
 */

export interface UnmatchedRow { id: string; userId: string; at: Date; direction: string; phone: string; durationSec: number; disposition: string; externalId: string; recordingFile: string | null }

/** Move every kept call for `phone` under `leadId`. Returns how many moved. */
export async function attachUnmatched(companyId: string, phone: string, leadId: string, actorId: string | null): Promise<number> {
  const rows = await prisma.leadUnmatchedCall.findMany({ where: { companyId, phone }, orderBy: { at: 'asc' } })
  if (!rows.length) return 0
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { id: true, businessId: true, state: true, status: true, firstCallAt: true, phone: true, phoneE164: true, business: { select: { id: true, kind: true, pipeline: true, settings: true } } } })
  const biz = lead.business
  const cmr = biz.kind === 'CMR'
  const set = settingsOf(biz)
  const twoParty = cmr && !!lead.state && set.consentStates.map((x) => x.toUpperCase()).includes(lead.state.toUpperCase())
  const known = new Set((await prisma.leadCall.findMany({ where: { businessId: biz.id, externalId: { in: rows.map((r) => r.externalId) } }, select: { externalId: true } })).map((x) => x.externalId))
  let moved = 0, connected = false
  for (const r of rows) {
    if (!known.has(r.externalId)) {
      await prisma.leadCall.create({ data: {
        leadId: lead.id, businessId: biz.id, userId: r.userId, at: r.at, direction: r.direction, durationSec: r.durationSec, disposition: r.disposition, summary: '',
        provider: r.provider, externalId: r.externalId, phone: r.phone, recordingFile: r.recordingFile,
        recordingUrl: r.recordingFile && r.durationSec > 0 ? `talkloop:${r.externalId}` : null, recordingKept: !twoParty, consentGiven: twoParty ? false : null,
      } })
      moved++
      if (r.disposition === 'CONNECTED') connected = true
    }
    await prisma.leadUnmatchedCall.delete({ where: { id: r.id } })
  }
  if (!moved) return 0
  const first = rows[0].at, last = rows[rows.length - 1].at
  await prisma.lead.update({ where: { id: lead.id }, data: {
    callsCount: { increment: moved }, lastCallAt: last, lastActivityAt: new Date(),
    ...(lead.firstCallAt ? {} : { firstCallAt: first, firstContactAt: first }),
    // The lead gets the number when it had none, so later calls match by themselves.
    ...(lead.phoneE164 ? {} : { phone: lead.phone || phone, phoneE164: phone }),
    ...(!cmr && connected && lead.status === 'NEW' ? { status: 'CONTACTED' } : {}),
  } })
  const by = actorId ? await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null
  await prisma.leadEvent.create({ data: { leadId: lead.id, userId: actorId, kind: 'CALL', text: `${moved} earlier TalkLoop call${moved === 1 ? '' : 's'} to ${phone} added${by ? ` by ${by.name}` : ''}${lead.phoneE164 && lead.phoneE164 !== phone ? ` (another number than the lead's: ${lead.phoneE164})` : ''}.`, data: { provider: 'TALKLOOP', phone, moved } } })
  return moved
}

/** Kept calls whose number now belongs to a lead (added or imported since) move under it. Returns how many moved. */
export async function rematchUnmatched(companyId: string): Promise<number> {
  const phones = await prisma.leadUnmatchedCall.groupBy({ by: ['phone'], where: { companyId }, _count: { _all: true } })
  if (!phones.length) return 0
  const leads = await prisma.lead.findMany({ where: { phoneE164: { in: phones.map((p) => p.phone) }, business: { companyId } }, select: { id: true, phoneE164: true }, orderBy: { lastActivityAt: 'desc' } })
  let moved = 0
  const done = new Set<string>()
  for (const l of leads) {
    if (!l.phoneE164 || done.has(l.phoneE164)) continue
    done.add(l.phoneE164)
    moved += await attachUnmatched(companyId, l.phoneE164, l.id, null)
  }
  return moved
}

/** Whose kept calls I may see: admin all; a manager their businesses' people and themselves; a rep their own. */
export async function unmatchedScope(m: LeadViewer, s: LeadScope): Promise<{ userId?: { in: string[] } }> {
  if (s.admin) return {}
  const members = s.managerOf.length ? await prisma.leadBusinessMember.findMany({ where: { businessId: { in: s.managerOf } }, select: { userId: true } }) : []
  return { userId: { in: [...new Set([m.id, ...members.map((x) => x.userId)])] } }
}
