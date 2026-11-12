import cron from 'node-cron'
import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { forEachCompany } from '../company'
import { maybeCompanyId } from '../tenancy'
import { isOn } from '../flags'
import { runTracked } from '../health/jobs'
import { withDefaults } from '../dialer/rules'
import { nextStepIn } from './nextStep'
import { completeText, llmReady } from './llm'

/**
 * Metra's insights for ITAD agents (ITAD update 12 Nov, section 5): "leads with a stated next step and nothing logged
 * since" and a short daily brief before the shift. Built from facts in Metriq; the model only words the brief and
 * never adds facts (a plain template is used when no model is set up). Suggested actions are cards the agent confirms.
 */

const PKT = 'Asia/Karachi'
/** The agent's work day starts at noon Pakistan time (a night shift is one day). */
export const shiftDay = (now = new Date()) => DateTime.fromJSDate(now).setZone(PKT).minus({ hours: 12 }).toISODate()!

export interface NextStepMiss { leadId: string; company: string; status: string; said: string; due: string; noteAt: string }

/** The agent's own notes that state a next step whose day has passed, with nothing logged by them since. */
export async function nextStepMisses(ownerId: string, now = new Date()): Promise<NextStepMiss[]> {
  const settings = withDefaults((await prisma.dialerSettings.findUnique({ where: { id: 'default' } }))?.data)
  const today = DateTime.fromJSDate(now).setZone('America/New_York').toISODate()!
  const leads = await prisma.dialerLead.findMany({
    where: { ownerId, inLatestImport: true, duplicate: false, status: { notIn: settings.closed }, doNotCall: false, OR: [{ callLaterAt: null }, { callLaterAt: { lt: now } }] },
    select: { id: true, company: true, status: true },
  })
  if (!leads.length) return []
  const since = new Date(now.getTime() - 60 * 86400000)
  const notes = await prisma.dialerNote.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, userId: ownerId, deletedAt: null, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { leadId: true, text: true, createdAt: true, nextActionAt: true } })
  const touches = await prisma.dialerTouch.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, userId: ownerId, source: 'MANUAL', dismissedAt: null, at: { gte: since } }, select: { leadId: true, at: true } })
  const out: NextStepMiss[] = []
  for (const l of leads) {
    const own = notes.filter((n) => n.leadId === l.id)
    const latest = own[0]
    if (!latest) continue
    const step = latest.nextActionAt ? { day: DateTime.fromJSDate(latest.nextActionAt).setZone('America/New_York').toISODate()!, said: latest.text.slice(0, 200) } : nextStepIn(latest.text, latest.createdAt)
    if (!step || step.day >= today) continue
    // Anything the agent logged after that note (a later call) answers it.
    if (touches.some((t) => t.leadId === l.id && t.at > latest.createdAt)) continue
    out.push({ leadId: l.id, company: l.company, status: l.status, said: step.said, due: step.day, noteAt: latest.createdAt.toISOString() })
  }
  const rank: Record<string, number> = { Pipeline: 0, Interested: 1, Connected: 2 }
  return out.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.due.localeCompare(b.due))
}

/** The facts the brief is written from. */
export async function briefFacts(ownerId: string, now = new Date()) {
  const endOfDay = DateTime.fromJSDate(now).setZone(PKT).plus({ hours: 18 }).toJSDate()
  const [followUps, callBacks, misses, hot] = await Promise.all([
    prisma.workLogEntry.count({ where: { userId: ownerId, autoReason: 'FOLLOW_UP_RULE', status: { not: 'DONE' }, cancelledAt: null, dueAt: { lte: endOfDay } } }),
    prisma.workLogEntry.findMany({ where: { userId: ownerId, autoReason: 'CALL_LATER', status: { not: 'DONE' }, cancelledAt: null, dueAt: { lte: endOfDay } }, select: { title: true, dueAt: true }, take: 10, orderBy: { dueAt: 'asc' } }),
    nextStepMisses(ownerId, now),
    prisma.dialerLead.findMany({ where: { ownerId, inLatestImport: true, duplicate: false, status: { in: ['Pipeline', 'Interested'] } }, orderBy: { lastActivityAt: 'asc' }, take: 3, select: { company: true, status: true, lastActivityAt: true } }),
  ])
  return {
    followUpsDue: followUps,
    callBacksToday: callBacks.map((c) => ({ what: c.title, at: c.dueAt ? DateTime.fromJSDate(c.dueAt).setZone(PKT).toFormat('HH:mm') + ' PKT' : null })),
    nextStepsMissed: misses.slice(0, 5).map((m) => ({ company: m.company, status: m.status, said: m.said, due: m.due })),
    quietestHotLeads: hot.map((h) => ({ company: h.company, status: h.status, lastActivity: h.lastActivityAt?.toISOString().slice(0, 10) ?? null })),
  }
}

function templateBrief(name: string, f: Awaited<ReturnType<typeof briefFacts>>): string {
  const lines = [`Good evening ${name.split(' ')[0]}. Here is your shift:`]
  lines.push(`- ${f.followUpsDue} follow-up${f.followUpsDue === 1 ? '' : 's'} due.`)
  if (f.callBacksToday.length) lines.push(`- Call backs: ${f.callBacksToday.map((c) => `${c.what}${c.at ? ` at ${c.at}` : ''}`).join('; ')}.`)
  if (f.nextStepsMissed.length) lines.push(`- Next steps you wrote that have passed: ${f.nextStepsMissed.map((m) => `${m.company} ("${m.said.slice(0, 60)}", ${m.due})`).join('; ')}.`)
  if (f.quietestHotLeads.length) lines.push(`- Hot leads gone quietest: ${f.quietestHotLeads.map((h) => `${h.company} (${h.status})`).join(', ')}.`)
  return lines.join('\n')
}

export async function writeBrief(name: string, f: Awaited<ReturnType<typeof briefFacts>>): Promise<string> {
  if (!llmReady()) return templateBrief(name, f)
  try {
    const text = await completeText([
      { role: 'system', content: 'You are Metra, the assistant in Metriq. Write a short shift brief (at most 6 lines, plain text, bullets with "- ") for an ITAD calling agent. Use ONLY the facts given in JSON; do not add any lead, number or date that is not there. Start with where to focus first. Friendly and direct.' },
      { role: 'user', content: `Agent: ${name}\nFacts: ${JSON.stringify(f)}` },
    ], 500)
    return text || templateBrief(name, f)
  } catch {
    return templateBrief(name, f)
  }
}

/** Next-step insights for every agent, and the brief at the brief hour (once per shift day). */
export async function runInsights(now = new Date(), forceBrief = false): Promise<{ nextSteps: number; briefs: number }> {
  const companyId = maybeCompanyId()
  if (!companyId || !(await isOn('metra', companyId))) return { nextSteps: 0, briefs: 0 }
  const day = shiftDay(now)
  const briefHour = Number(process.env.METRA_BRIEF_HOUR ?? 18)
  const briefTime = forceBrief || DateTime.fromJSDate(now).setZone(PKT).hour === briefHour
  const owners = await prisma.dialerLead.findMany({ where: { inLatestImport: true }, distinct: ['ownerId'], select: { ownerId: true, owner: { select: { name: true, isActive: true } } } })
  let nextSteps = 0, briefs = 0
  for (const o of owners) {
    if (!o.owner.isActive) continue
    for (const m of await nextStepMisses(o.ownerId, now)) {
      const r = await prisma.aiInsight.upsert({
        where: { userId_kind_day_subjectId: { userId: o.ownerId, kind: 'NEXT_STEP', day: m.due, subjectId: m.leadId } },
        create: { userId: o.ownerId, kind: 'NEXT_STEP', day: m.due, subjectId: m.leadId, title: `${m.company}: next step passed, nothing logged since`, payload: m as unknown as Prisma.InputJsonValue },
        update: {},
        select: { createdAt: true, updatedAt: true },
      })
      if (r.createdAt.getTime() === r.updatedAt.getTime()) nextSteps++
    }
    if (!briefTime) continue
    const exists = await prisma.aiInsight.findUnique({ where: { userId_kind_day_subjectId: { userId: o.ownerId, kind: 'BRIEF', day, subjectId: '' } } })
    if (exists) continue
    const facts = await briefFacts(o.ownerId, now)
    const text = await writeBrief(o.owner.name, facts)
    const ins = await prisma.aiInsight.create({ data: { userId: o.ownerId, kind: 'BRIEF', day, title: 'Your shift brief', payload: { text, facts } as unknown as Prisma.InputJsonValue } })
    await prisma.notification.create({ data: { userId: o.ownerId, type: 'AI_INSIGHT', title: 'Your shift brief from Metra', body: text.split('\n').slice(0, 3).join(' ').slice(0, 300), link: `/app/metra?insight=${ins.id}`, entityType: 'AiInsight', entityId: ins.id } })
    briefs++
  }
  return { nextSteps, briefs }
}

export function startMetraInsights(): void {
  cron.schedule('5 * * * *', () => {
    void runTracked('metra-insights', () => forEachCompany(() => runInsights())).catch(() => undefined)
  })
}
