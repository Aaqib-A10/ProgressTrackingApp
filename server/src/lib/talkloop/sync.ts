import cron from 'node-cron'
import { prisma } from '../prisma'
import { runAsCompany } from '../tenancy'
import { runTracked } from '../health/jobs'
import { settingsOf } from '../leads/pipeline'
import { talkloopClient, type TalkLoopCdr, type TalkLoopClient } from './client'

/**
 * Calls from TalkLoop land on the leads by themselves (plan: "TalkLoop call log integration").
 *
 * Every few minutes Metriq reads TalkLoop's call log since the last run, and for each call made or
 * taken by a person linked to a TalkLoop user, finds the lead with that phone number and adds the
 * call under it: when, how long, answered or not, who called, the recording (streamed through
 * Metriq, so Jesse and the managers can listen) and, a little later, the transcript. The SDR then
 * only adds the summary and the facts. A call to a number no lead has is counted but not stored.
 *
 * Two-party consent states (CA, WA…): the recording is kept on file but not playable until the
 * SDR ticks "consent given" on that call.
 */

const SETTING = 'talkloop-sync'
export interface SyncStatus { lastRunAt: string | null; lastCallAt: string | null; synced: number; unmatched: number; lastError: string | null; lastRunSynced: number; lastRunUnmatched: number }
const EMPTY: SyncStatus = { lastRunAt: null, lastCallAt: null, synced: 0, unmatched: 0, lastError: null, lastRunSynced: 0, lastRunUnmatched: 0 }

export async function syncStatus(): Promise<SyncStatus> {
  const row = await prisma.platformSetting.findUnique({ where: { key: SETTING } }).catch(() => null)
  return { ...EMPTY, ...((row?.value as Partial<SyncStatus> | null) ?? {}) }
}
async function saveStatus(s: SyncStatus): Promise<void> {
  await prisma.platformSetting.upsert({ where: { key: SETTING }, update: { value: s as object }, create: { key: SETTING, value: s as object } })
}

/** "6312420300" / "+16312420300" / "16312420300" → "+16312420300"; an extension or short code → null. */
export function e164Of(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  if (d.length >= 11 && d.length <= 15) return `+${d}`
  return null
}

/** TalkLoop's words → ours. ANSWERED but shorter than the business's "connected" threshold is a voicemail or a hang-up. */
export function dispositionOf(c: TalkLoopCdr, connectedSecs: number): string {
  const d = (c.disposition || '').toUpperCase()
  if (d === 'ANSWERED') return (c.billsec ?? 0) >= connectedSecs ? 'CONNECTED' : 'VOICEMAIL'
  if (d === 'BUSY') return 'BUSY'
  return 'NO_ANSWER'
}

/** The run: fetch once, then file each call under the right company's lead. Exported for the tests (with a stub client). */
let running = false
export async function runTalkLoopSync(client: TalkLoopClient | null = talkloopClient(), now = new Date()): Promise<SyncStatus> {
  const status = await syncStatus()
  if (!client || running) return status
  running = true
  try { return await syncOnce(client, status, now) } finally { running = false }
}

async function syncOnce(client: TalkLoopClient, status: SyncStatus, now: Date): Promise<SyncStatus> {
  const linked = await prisma.user.findMany({ where: { talkloopUserId: { not: null }, isActive: true }, select: { id: true, companyId: true, talkloopUserId: true } })
  const byTl = new Map(linked.map((u) => [u.talkloopUserId!, u]))
  // Overlap the last run by ten minutes: a call that ends late still arrives once (externalId is unique).
  const since = status.lastCallAt ? new Date(new Date(status.lastCallAt).getTime() - 10 * 60_000) : new Date(now.getTime() - 7 * 86400_000)
  let synced = 0, unmatched = 0, newest = status.lastCallAt ? new Date(status.lastCallAt) : since
  try {
    const records: TalkLoopCdr[] = []
    for (let page = 1; page <= 50; page++) {
      const r = await client.cdrs({ startDate: since.toISOString(), endDate: new Date(now.getTime() + 86400_000).toISOString(), page, limit: 200 })
      records.push(...r.records)
      if (page >= r.totalPages) break
    }
    // One row per call. An incoming call rings every extension in the group and TalkLoop writes a leg for
    // each; keep the leg that was answered (else the first), so the lead shows one call, not one per SDR.
    const seen = new Set<string>()
    const byGroup = new Map<string, TalkLoopCdr>()
    const unique: TalkLoopCdr[] = []
    for (const c of records) {
      if (seen.has(c.uniqueid)) continue
      seen.add(c.uniqueid)
      if ((c.direction || '').toLowerCase() !== 'incoming') { unique.push(c); continue }
      const key = c.recording_file || `${c.src}@${c.calldate.slice(0, 16)}`
      const cur = byGroup.get(key)
      const answered = (x: TalkLoopCdr) => (x.disposition || '').toUpperCase() === 'ANSWERED' && (x.billsec ?? 0) > 0 && x.user_id != null
      if (!cur || (answered(c) && !answered(cur)) || (!answered(cur) && cur.user_id == null && c.user_id != null)) byGroup.set(key, c)
    }
    unique.push(...byGroup.values())
    // Group by company so each company's calls are written inside its own walls.
    const byCompany = new Map<string, TalkLoopCdr[]>()
    for (const c of unique) {
      const at = new Date(c.calldate)
      if (at > newest) newest = at
      if (c.user_id == null) continue // ring groups and IVR legs: the leg that reached a person has the user
      const u = byTl.get(c.user_id)
      if (!u) continue
      const list = byCompany.get(u.companyId) ?? []
      list.push(c)
      byCompany.set(u.companyId, list)
    }
    for (const [companyId, list] of byCompany) {
      const r = await runAsCompany(companyId, () => fileCalls(companyId, list, byTl))
      synced += r.synced; unmatched += r.unmatched
    }
    // Transcripts arrive a few minutes after the call: pick up the ones still missing (newest first, a handful per run).
    const want = await prisma.leadCall.findMany({ where: { provider: 'TALKLOOP', transcript: null, recordingFile: { not: null }, at: { lte: new Date(now.getTime() - 3 * 60_000), gte: new Date(now.getTime() - 3 * 86400_000) } }, select: { id: true, externalId: true, companyId: true }, orderBy: { at: 'desc' }, take: 25 })
    for (const c of want) {
      const text = await client.transcription(c.externalId!)
      if (text) await runAsCompany(c.companyId, () => prisma.leadCall.update({ where: { id: c.id }, data: { transcript: text.slice(0, 20000) } }))
    }
    const next: SyncStatus = { lastRunAt: now.toISOString(), lastCallAt: newest.toISOString(), synced: status.synced + synced, unmatched: status.unmatched + unmatched, lastError: null, lastRunSynced: synced, lastRunUnmatched: unmatched }
    await saveStatus(next)
    return next
  } catch (e) {
    const next: SyncStatus = { ...status, lastRunAt: now.toISOString(), lastError: e instanceof Error ? e.message : String(e), lastRunSynced: synced, lastRunUnmatched: unmatched }
    await saveStatus(next)
    return next
  }
}

async function fileCalls(companyId: string, list: TalkLoopCdr[], byTl: Map<number, { id: string; companyId: string }>): Promise<{ synced: number; unmatched: number }> {
  let synced = 0, unmatched = 0
  const businesses = await prisma.leadBusiness.findMany({ where: { companyId }, select: { id: true, kind: true, pipeline: true, settings: true, headId: true, members: { select: { userId: true } } } })
  if (!businesses.length) return { synced: 0, unmatched: list.length }
  const known = new Set((await prisma.leadCall.findMany({ where: { externalId: { in: list.map((c) => c.uniqueid) } }, select: { externalId: true } })).map((x) => x.externalId))
  for (const c of list) {
    if (known.has(c.uniqueid)) continue
    const user = byTl.get(c.user_id!)!
    const outgoing = (c.direction || '').toLowerCase() !== 'incoming'
    const phone = e164Of(outgoing ? c.dst : c.src)
    if (!phone) { unmatched++; continue }
    const leads = await prisma.lead.findMany({ where: { phoneE164: phone, businessId: { in: businesses.map((b) => b.id) } }, select: { id: true, businessId: true, state: true, status: true, firstCallAt: true, assigneeId: true }, orderBy: { lastActivityAt: 'desc' } })
    if (!leads.length) { unmatched++; continue }
    // Prefer the caller's own lead, then one in a business they work, then the most recent.
    const mine = (b: { id: string; headId: string | null; members: { userId: string }[] }) => b.headId === user.id || b.members.some((m) => m.userId === user.id)
    const lead = leads.find((l) => l.assigneeId === user.id) ?? leads.find((l) => mine(businesses.find((b) => b.id === l.businessId)!)) ?? leads[0]
    const biz = businesses.find((b) => b.id === lead.businessId)!
    const set = settingsOf(biz)
    const cmr = biz.kind === 'CMR'
    const twoParty = cmr && !!lead.state && set.consentStates.map((x) => x.toUpperCase()).includes(lead.state.toUpperCase())
    const at = new Date(c.calldate)
    const disposition = dispositionOf(c, set.connectedSecs)
    try {
      await prisma.leadCall.create({ data: {
        leadId: lead.id, businessId: biz.id, userId: user.id, at, direction: outgoing ? 'OUT' : 'IN', durationSec: c.billsec ?? 0, disposition, summary: '',
        // A call nobody answered has no audio worth playing, even when the group leaves a file name.
        provider: 'TALKLOOP', externalId: c.uniqueid, phone, recordingFile: c.recording_file || null,
        recordingUrl: c.recording_file && (c.billsec ?? 0) > 0 ? `talkloop:${c.uniqueid}` : null, recordingKept: !twoParty, consentGiven: twoParty ? false : null,
      } })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue // already filed by another run
      throw e
    }
    const connected = disposition === 'CONNECTED'
    await prisma.lead.update({ where: { id: lead.id }, data: {
      callsCount: { increment: 1 }, lastCallAt: at, lastActivityAt: at, ...(lead.firstCallAt ? {} : { firstCallAt: at, firstContactAt: at }),
      // A plain pipeline moves to Contacted on the first conversation; the CMR flow waits for the SDR's summary.
      ...(!cmr && connected && lead.status === 'NEW' ? { status: 'CONTACTED' } : {}),
    } })
    await prisma.leadEvent.create({ data: { leadId: lead.id, userId: user.id, kind: 'CALL', text: `${outgoing ? 'Called' : 'Call from'} ${phone} · ${disposition.toLowerCase().replace('_', ' ')}${c.billsec ? ` · ${Math.round(c.billsec / 60)} min` : ''} (TalkLoop)`, data: { provider: 'TALKLOOP', uniqueid: c.uniqueid } } })
    synced++
  }
  return { synced, unmatched }
}

/** Every 3 minutes, when a token is set. */
export function startTalkLoopSync(): void {
  if (!talkloopClient()) { console.log('[talkloop] no TALKLOOP_TOKEN: call sync off'); return }
  cron.schedule('*/3 * * * *', () => { runTracked('talkloop-sync', () => runTalkLoopSync()).catch((e) => console.error('[talkloop]', e)) })
  console.log('[talkloop] call sync on (every 3 min)')
}
