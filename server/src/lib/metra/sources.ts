import { DateTime } from 'luxon'
import { prisma } from '../prisma'
import { companyTz } from '../time'
import type { AreaKey } from '../permissions'
import { dealMoney } from '../dealMoney'

/**
 * Metra's sources (docs/metra/DESIGN.md §6): how each kind of record becomes text to search, and who may read it.
 *
 * Every adapter turns record ids into chunk drafts with ACCESS LABELS taken from the rule the app itself applies
 * to that record (audited 12 Nov; file references in the design doc). A person retrieves a chunk only when one of
 * its labels is among their principals (lib/metra/access.ts). Where two screens of the app disagree, the stricter
 * one is followed. A record that no longer exists, or is hidden in the app (deleted, cancelled...), builds no
 * chunks, so its old chunks are removed.
 *
 * Never indexed: passwords and hashes, tokens and keys, IPs and user agents, raw import rows, recording files,
 * inbox passwords, salaries, notifications.
 */

export interface ChunkDraft {
  part: number
  title: string
  text: string
  labels: string[]
  occurredAt: Date
  link: string | null
  meta?: Record<string, unknown>
}

export interface Source {
  type: string
  /** Shown in answers and filters. */
  label: string
  /** The app area a company role can switch off; a person with it off never retrieves this source. */
  area?: AreaKey
  /** Prisma models whose writes change this source, and how to find the affected source ids. */
  watch: Record<string, (ids: string[]) => Promise<string[]>>
  /** Every source id, in pages (for the full reconcile): this page's ids and the cursor of the next page (null = done). */
  all: (cursor: string | null, take: number) => Promise<{ ids: string[]; next: string | null }>
  /** Chunk drafts per source id (an empty list: nothing to index, old chunks go). */
  build: (ids: string[]) => Promise<Map<string, ChunkDraft[]>>
}

// ------------------------------------------------------------------ helpers

const MAX = 1100
const OVERLAP = 150
/** Long text in pieces of about 1100 characters, cut at a sentence or line where possible, with some overlap. */
export function split(text: string): string[] {
  const t = text.trim()
  if (t.length <= MAX) return t ? [t] : []
  const out: string[] = []
  let i = 0
  while (i < t.length) {
    let end = Math.min(t.length, i + MAX)
    if (end < t.length) {
      const window = t.slice(i + 600, end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
      if (cut > 0) end = i + 600 + cut + 1
    }
    out.push(t.slice(i, end).trim())
    if (end >= t.length) break
    i = Math.max(end - OVERLAP, i + 1)
  }
  return out.filter(Boolean)
}

/** One record as chunks: a header line (what, who, when) on top of every piece, so each piece stands alone. */
function chunks(header: string, body: string, base: Omit<ChunkDraft, 'part' | 'text'>): ChunkDraft[] {
  const pieces = split(body)
  if (!pieces.length) return header.trim() ? [{ ...base, part: 0, text: header }] : []
  return pieces.map((p, part) => ({ ...base, part, text: `${header}\n${p}` }))
}

/** Non-empty lines joined; `x.length && ...` may give 0, which is skipped like any other falsy value. */
const lines = (...xs: (string | number | null | undefined | false)[]) => xs.filter((x): x is string => typeof x === 'string' && !!x.trim()).join('\n')
const day = (d: Date | null | undefined) => (d ? DateTime.fromJSDate(d).setZone(companyTz()).toFormat('d LLL yyyy') : '')
const page = async <T extends { id: string }>(rows: Promise<T[]>) => { const r = await rows; return { ids: r.map((x) => x.id), next: r.length ? r[r.length - 1].id : null } }
const cursorArgs = (cursor: string | null, take: number) => ({ take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: { id: 'asc' as const } })
const same = async (ids: string[]) => ids
const result = (ids: string[]) => new Map<string, ChunkDraft[]>(ids.map((id) => [id, []]))
const userNames = async (ids: (string | null | undefined)[]) => {
  const want = [...new Set(ids.filter(Boolean) as string[])]
  const rows = want.length ? await prisma.user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } }) : []
  return new Map(rows.map((u) => [u.id, u.name]))
}

// ------------------------------------------------------------------ Lead Dialer (ITAD)

/** Owner, and the dialer managers who may see this owner's leads (principal dm:<owner>). Super Admins only via dm (as the app). */
const dialerLabels = (ownerId: string) => [`u:${ownerId}`, `dm:${ownerId}`]

const DIALER_LEAD: Source = {
  type: 'DIALER_LEAD', label: 'Lead Dialer lead', area: 'dialer',
  watch: { DialerLead: same },
  all: (c, t) => page(prisma.dialerLead.findMany({ ...cursorArgs(c, t), where: { duplicate: false }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.dialerLead.findMany({ where: { id: { in: ids }, duplicate: false }, include: { owner: { select: { name: true } }, contacts: { where: { state: 'ACCEPTED' } } } })
    for (const l of rows) {
      const links = (Array.isArray(l.ezLinks) ? (l.ezLinks as { label: string; url: string }[]) : []).map((x) => `${x.label}: ${x.url}`)
      const body = lines(
        `Status: ${l.status}${l.inLatestImport ? '' : ' (no longer in the latest import)'}`,
        l.contactName && `Contact: ${l.contactName}${l.jobTitle ? `, ${l.jobTitle}` : ''}`,
        l.phone && `Phone: ${l.phone}`, l.phone2 && `Second phone: ${l.phone2}`, l.altPhones.length && `Alternative numbers: ${l.altPhones.join(', ')}`,
        l.email && `Email: ${l.email}`, l.email2 && `Second email: ${l.email2}`, l.linkedin && `LinkedIn: ${l.linkedin}`,
        l.decisionMaker && `Decision maker: ${l.decisionMaker}`, l.bestTime && `Best time to call: ${l.bestTime}`,
        [l.city, l.stateOverride ?? l.state].filter(Boolean).length && `Location: ${[l.city, l.stateOverride ?? l.state].filter(Boolean).join(', ')}`,
        l.industry && `Industry: ${l.industry}`, l.companySize && `Size: ${l.companySize}`, l.website && `Website: ${l.website}`,
        l.description && `Description: ${l.description}`, links.length && `Links: ${links.join('; ')}`,
        l.contacts.length && `Other contacts: ${l.contacts.map((c) => [c.name, c.title, c.email, c.phone].filter(Boolean).join(', ')).join('; ')}`,
        l.callLaterAt && `Call back set for ${day(l.callLaterAt)}`, l.tags.length && `Tags: ${l.tags.join(', ')}`,
        `Agent: ${l.owner.name}`, l.lastActivityAt && `Last updated in Earth Zone: ${day(l.lastActivityAt)}`,
      )
      out.set(l.id, chunks(`Lead Dialer lead: ${l.company}`, body, {
        title: l.company, labels: dialerLabels(l.ownerId), occurredAt: l.lastActivityAt ?? l.updatedAt,
        link: `/app/itad/dialer?lead=${l.id}&rep=${l.ownerId}`, meta: { status: l.status, ownerId: l.ownerId, kind: 'lead' },
      }))
    }
    return out
  },
}

const DIALER_NOTE: Source = {
  type: 'DIALER_NOTE', label: 'Lead Dialer note', area: 'dialer',
  watch: { DialerNote: same },
  all: (c, t) => page(prisma.dialerNote.findMany({ ...cursorArgs(c, t), where: { deletedAt: null }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.dialerNote.findMany({ where: { id: { in: ids }, deletedAt: null, lead: { duplicate: false } }, include: { user: { select: { name: true } }, lead: { select: { id: true, company: true, ownerId: true, contactName: true, status: true } } } })
    const SRC: Record<string, string> = { EARTHZONE: 'Earth Zone', CLAUDE: 'Claude', METRIQ: 'Metriq' }
    for (const n of rows) {
      const author = n.user?.name ?? n.authorName ?? 'Earth Zone'
      out.set(n.id, chunks(`Note on ${n.lead.company} (Lead Dialer) by ${author}, ${day(n.createdAt)}, from ${SRC[n.source] ?? n.source}:`, n.text, {
        title: `Note on ${n.lead.company}`, labels: dialerLabels(n.lead.ownerId), occurredAt: n.createdAt,
        link: `/app/itad/dialer?lead=${n.lead.id}&rep=${n.lead.ownerId}`,
        meta: { leadId: n.lead.id, author, authorId: n.userId, ownerId: n.lead.ownerId, own: n.userId === n.lead.ownerId, nextActionAt: n.nextActionAt?.toISOString() ?? null, kind: 'note' },
      }))
    }
    return out
  },
}

const DIALER_CALL: Source = {
  type: 'DIALER_CALL', label: 'Predictive dialer call', area: 'dialer',
  watch: { DialerCall: same },
  all: (c, t) => page(prisma.dialerCall.findMany({ ...cursorArgs(c, t), where: { leadId: { not: null }, notes: { not: null } }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.dialerCall.findMany({ where: { id: { in: ids }, notes: { not: null } }, include: { lead: { select: { id: true, company: true, ownerId: true } }, agent: { select: { name: true } } } })
    for (const c of rows) {
      if (!c.lead || !c.notes) continue
      out.set(c.id, chunks(`Call to ${c.lead.company} on ${day(c.calledAt)} by ${c.agent?.name ?? c.agentRaw ?? 'the dialer'} (${c.disposition}):`, c.notes, {
        title: `Call to ${c.lead.company}`, labels: dialerLabels(c.lead.ownerId), occurredAt: c.calledAt, link: `/app/itad/dialer?lead=${c.lead.id}&rep=${c.lead.ownerId}`, meta: { leadId: c.lead.id },
      }))
    }
    return out
  },
}

// ------------------------------------------------------------------ Lead Management (CRM, CMR)

/** leadWhere (lib/leads/access.ts): the assignee, the business's managers and head, Super Admins. */
const leadLabels = (l: { assigneeId: string | null; businessId: string }) => [...(l.assigneeId ? [`u:${l.assigneeId}`] : []), `lbm:${l.businessId}`, 'sa']

const LEAD: Source = {
  type: 'LEAD', label: 'Lead', area: 'leads',
  watch: { Lead: same, LeadCmr: async (ids) => (await prisma.leadCmr.findMany({ where: { id: { in: ids } }, select: { leadId: true } })).map((x) => x.leadId), LeadContact: async (ids) => (await prisma.leadContact.findMany({ where: { id: { in: ids } }, select: { leadId: true } })).map((x) => x.leadId) },
  all: (c, t) => page(prisma.lead.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.lead.findMany({ where: { id: { in: ids } }, include: { business: { select: { name: true } }, assignee: { select: { name: true } }, cmr: true, contacts: true } })
    for (const l of rows) {
      const c = l.cmr
      const body = lines(
        `Business: ${l.business.name}. Status: ${l.status}. Owner: ${l.owner}${l.assignee ? `, assigned to ${l.assignee.name}` : ''}.`,
        l.organization && `Organization: ${l.organization}`, l.jobTitle && `Job title: ${l.jobTitle}`, l.email && `Email: ${l.email}`, l.phone && `Phone: ${l.phone}`,
        l.secondaryContact && `Secondary contact: ${l.secondaryContact}`, l.secondaryEmail && `Secondary email: ${l.secondaryEmail}`,
        [l.city, l.state, l.country].filter(Boolean).length && `Location: ${[l.city, l.state, l.country].filter(Boolean).join(', ')}`,
        l.industry && `Industry: ${l.industry}`, l.employees && `Employees: ${l.employees}`, l.website && `Website: ${l.website}`, l.value != null && `Deal value: ${l.value}`,
        l.message && `Their message: ${l.message}`, l.productInfo && `Product info: ${l.productInfo}`, l.nextStep && `Next step: ${l.nextStep}${l.nextStepDate ? ` (${day(l.nextStepDate)})` : ''}`,
        l.lostReason && `Lost: ${l.lostReason}${l.lostNote ? ` — ${l.lostNote}` : ''}`, l.source && `Came from: ${l.source}${l.sourceDetail ? ` (${l.sourceDetail})` : ''}`,
        l.contacts.length && `Other contacts: ${l.contacts.map((x) => [x.name, x.role, x.email, x.phone].filter(Boolean).join(', ')).join('; ')}`,
        c && lines(
          c.decisionMakerName && `Decision maker: ${c.decisionMakerName}`, c.material.length && `Material: ${c.material.join(', ')}`,
          c.lbsPerMonth != null && `Pounds per month: ${c.lbsPerMonth}`, c.currentVendor && `Current vendor: ${c.currentVendor}`, c.pickupCity && `Pickup city: ${c.pickupCity}`,
          c.jesseAsk && `Question for the head: ${c.jesseAsk}`, c.jesseComment && `Head's comment: ${c.jesseComment}`, c.jesseDecision && `Head's decision: ${c.jesseDecision}`,
          c.meetingAt && `Meeting: ${day(c.meetingAt)}`, c.meetingBrief && `Meeting brief: ${c.meetingBrief}`, c.meetingOutcome && `Meeting outcome: ${c.meetingOutcome}`,
        ),
      )
      out.set(l.id, chunks(`Lead: ${l.name}${l.organization ? ` (${l.organization})` : ''}`, body, {
        title: l.organization ? `${l.name}, ${l.organization}` : l.name, labels: leadLabels(l), occurredAt: l.lastActivityAt, link: `/app/leads/${l.id}`, meta: { status: l.status, kind: 'lead' },
      }))
    }
    return out
  },
}

const LEAD_COMMENT: Source = {
  type: 'LEAD_COMMENT', label: 'Lead comment', area: 'leads',
  watch: { LeadComment: same },
  all: (c, t) => page(prisma.leadComment.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.leadComment.findMany({ where: { id: { in: ids } }, include: { user: { select: { name: true } }, lead: { select: { id: true, name: true, organization: true, assigneeId: true, businessId: true } } } })
    for (const c of rows) out.set(c.id, chunks(`Comment on lead ${c.lead.name}${c.lead.organization ? ` (${c.lead.organization})` : ''} by ${c.user.name}, ${day(c.createdAt)}:`, c.body, {
      title: `Comment on ${c.lead.name}`, labels: leadLabels(c.lead), occurredAt: c.createdAt, link: `/app/leads/${c.lead.id}`,
    }))
    return out
  },
}

const LEAD_CALL: Source = {
  type: 'LEAD_CALL', label: 'Lead call', area: 'leads',
  watch: { LeadCall: same },
  all: (c, t) => page(prisma.leadCall.findMany({ ...cursorArgs(c, t), where: { pending: false }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.leadCall.findMany({ where: { id: { in: ids }, pending: false }, include: { user: { select: { name: true } }, lead: { select: { id: true, name: true, organization: true, assigneeId: true, businessId: true } } } })
    for (const c of rows) {
      const body = lines(`Direction: ${c.direction}. Disposition: ${c.disposition}${c.outcome ? `. Outcome: ${c.outcome}` : ''}.`, c.summary && `Summary: ${c.summary}`, c.aiSummary && `AI summary: ${c.aiSummary}`, c.transcript && `Transcript:\n${c.transcript}`)
      out.set(c.id, chunks(`Call with ${c.lead.name}${c.lead.organization ? ` (${c.lead.organization})` : ''} on ${day(c.at)} by ${c.user?.name ?? 'unknown'}:`, body, {
        title: `Call with ${c.lead.name}`, labels: leadLabels(c.lead), occurredAt: c.at, link: `/app/leads/${c.lead.id}`,
      }))
    }
    return out
  },
}

const LEAD_TASK: Source = {
  type: 'LEAD_TASK', label: 'Lead task', area: 'leads',
  watch: { LeadTask: same },
  all: (c, t) => page(prisma.leadTask.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.leadTask.findMany({ where: { id: { in: ids } }, include: { assignee: { select: { name: true } }, lead: { select: { id: true, name: true } } } })
    for (const t of rows) out.set(t.id, chunks(`Lead task (${t.kind}) on ${t.lead.name} for ${t.assignee?.name ?? 'nobody'}, due ${day(t.dueAt)}${t.doneAt ? `, done ${day(t.doneAt)}` : ', open'}:`, lines(t.title, t.notes, t.outcome && `Outcome: ${t.outcome}`), {
      title: t.title, labels: [...(t.assigneeId ? [`u:${t.assigneeId}`] : []), `lbm:${t.businessId}`, 'sa'], occurredAt: t.doneAt ?? t.dueAt, link: `/app/leads/tasks?task=${t.id}`,
    }))
    return out
  },
}

// ------------------------------------------------------------------ Chat (DMs, groups, project channels, meeting chats)

/** One chunk set per conversation per day: id "<conversationId>:<YYYY-MM-DD>". Members only (Super Admins too only where members). */
const CHAT_DAY: Source = {
  type: 'CHAT_DAY', label: 'Chat', area: 'chat',
  watch: {
    ChatMessage: async (ids) => {
      const ms = await prisma.chatMessage.findMany({ where: { id: { in: ids } }, select: { conversationId: true, createdAt: true } })
      return [...new Set(ms.map((m) => `${m.conversationId}:${DateTime.fromJSDate(m.createdAt).setZone(companyTz()).toISODate()}`))]
    },
  },
  async all(cursor, take) {
    // Conversation-days, from the messages (paged by conversation).
    const convs = await prisma.chatConversation.findMany({ ...cursorArgs(cursor, Math.max(1, Math.floor(take / 20))), select: { id: true } })
    const out: string[] = []
    for (const c of convs) {
      const ms = await prisma.chatMessage.findMany({ where: { conversationId: c.id, deletedAt: null }, select: { createdAt: true } })
      for (const d of new Set(ms.map((m) => DateTime.fromJSDate(m.createdAt).setZone(companyTz()).toISODate()!))) out.push(`${c.id}:${d}`)
      if (!ms.length) out.push(`${c.id}:none`)
    }
    return { ids: out, next: convs.length ? convs[convs.length - 1].id : null }
  },
  async build(ids) {
    const out = result(ids)
    const tz = companyTz()
    const byConv = new Map<string, string[]>()
    for (const id of ids) { const [c, d] = id.split(':'); if (d && d !== 'none') byConv.set(c, [...(byConv.get(c) ?? []), d]) }
    for (const [convId, days] of byConv) {
      const conv = await prisma.chatConversation.findUnique({ where: { id: convId }, include: { project: { select: { key: true, name: true } }, members: { include: { user: { select: { name: true } } } } } })
      if (!conv) continue
      const names = conv.members.map((m) => m.user.name)
      const title = conv.type === 'DIRECT' ? `Direct messages: ${names.join(' & ')}` : conv.type === 'PROJECT' && conv.project ? `#${conv.project.key} ${conv.project.name}` : conv.name || `Group: ${names.slice(0, 6).join(', ')}`
      for (const d of days) {
        const start = DateTime.fromISO(d, { zone: tz }).startOf('day')
        const ms = await prisma.chatMessage.findMany({
          where: { conversationId: convId, deletedAt: null, system: null, createdAt: { gte: start.toJSDate(), lt: start.plus({ days: 1 }).toJSDate() } },
          orderBy: { seq: 'asc' }, select: { body: true, fileName: true, createdAt: true, user: { select: { name: true } } },
        })
        const text = ms.map((m) => `${DateTime.fromJSDate(m.createdAt).setZone(tz).toFormat('HH:mm')} ${m.user.name}: ${m.body}${m.fileName ? ` [file: ${m.fileName}]` : ''}`.trim()).filter((l) => l.length > 8).join('\n')
        out.set(`${convId}:${d}`, chunks(`${title} — ${start.toFormat('d LLL yyyy')}:`, text, {
          title, labels: [`chat:${convId}`], occurredAt: ms[ms.length - 1]?.createdAt ?? start.toJSDate(), link: `/app/chat?c=${convId}`, meta: { kind: conv.type },
        }))
      }
    }
    return out
  },
}

/** AI meeting notes and transcripts of a call: the people who joined it and the conversation's members. */
const CALL_NOTES: Source = {
  type: 'CALL_NOTES', label: 'Meeting notes', area: 'chat',
  watch: { ChatCall: same, CallTranscriptLine: async (ids) => (await prisma.callTranscriptLine.findMany({ where: { id: { in: ids } }, select: { callId: true } })).map((x) => x.callId) },
  all: (c, t) => page(prisma.chatCall.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.chatCall.findMany({ where: { id: { in: ids } }, include: { meeting: { select: { title: true } }, transcript: { orderBy: { id: 'asc' }, take: 4000 } } })
    const who = await userNames(rows.flatMap((r) => r.transcript.map((l) => (l as { userId?: string }).userId)))
    for (const c of rows) {
      const n = (c.notes && typeof c.notes === 'object' ? c.notes : {}) as { summary?: string; keyPoints?: string[]; decisions?: string[]; actionItems?: { owner?: string; task?: string; due?: string }[]; openQuestions?: string[] }
      const notes = lines(
        n.summary && `Summary: ${n.summary}`, n.keyPoints?.length && `Key points:\n- ${n.keyPoints.join('\n- ')}`, n.decisions?.length && `Decisions:\n- ${n.decisions.join('\n- ')}`,
        n.actionItems?.length && `Action items:\n- ${n.actionItems.map((a) => [a.owner, a.task, a.due && `(due ${a.due})`].filter(Boolean).join(': ')).join('\n- ')}`,
        n.openQuestions?.length && `Open questions:\n- ${n.openQuestions.join('\n- ')}`,
      )
      const transcript = c.transcript.map((l) => { const x = l as unknown as { text?: string; textEn?: string | null; textRoman?: string | null; userId?: string; speaker?: string }; return `${who.get(x.userId ?? '') ?? x.speaker ?? ''}: ${x.textEn || x.textRoman || x.text || ''}` }).join('\n')
      const title = c.meeting?.title ?? `Call on ${day(c.startedAt)}`
      const labels = [`chat:${c.conversationId}`, ...c.joinedIds.map((u) => `u:${u}`)]
      out.set(c.id, chunks(`${title} — meeting notes (${day(c.startedAt)}):`, lines(notes, transcript && `Transcript:\n${transcript}`), {
        title, labels, occurredAt: c.endedAt ?? c.startedAt, link: `/app/chat?c=${c.conversationId}`,
      }))
    }
    return out
  },
}

const MEETING: Source = {
  type: 'MEETING', label: 'Meeting', area: 'chat',
  watch: { Meeting: same, MeetingAttendee: async (ids) => (await prisma.meetingAttendee.findMany({ where: { id: { in: ids } }, select: { meetingId: true } })).map((x) => x.meetingId) },
  all: (c, t) => page(prisma.meeting.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.meeting.findMany({ where: { id: { in: ids } }, include: { organizer: { select: { name: true } }, attendees: { include: { user: { select: { name: true } } } } } })
    for (const m of rows) {
      const body = lines(`When: ${DateTime.fromJSDate(m.startsAt).setZone(companyTz()).toFormat('d LLL yyyy, HH:mm')}${m.cancelledAt ? ' (cancelled)' : ''}`, `Organizer: ${m.organizer.name}`, `Attendees: ${m.attendees.map((a) => `${a.user.name} (${a.response})`).join(', ')}`, m.agenda && `Agenda: ${m.agenda}`)
      out.set(m.id, chunks(`Meeting: ${m.title}`, body, { title: m.title, labels: [`u:${m.organizerId}`, ...m.attendees.map((a) => `u:${a.userId}`), 'sa'], occurredAt: m.startsAt, link: `/app/meetings/${m.id}` }))
    }
    return out
  },
}

// ------------------------------------------------------------------ Projects

const PM_TASK: Source = {
  type: 'PM_TASK', label: 'Project task', area: 'projects',
  watch: { PmTask: same, PmComment: async (ids) => (await prisma.pmComment.findMany({ where: { id: { in: ids } }, select: { taskId: true } })).map((x) => x.taskId) },
  all: (c, t) => page(prisma.pmTask.findMany({ ...cursorArgs(c, t), where: { deletedAt: null }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.pmTask.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { project: { select: { key: true, name: true } }, column: { select: { name: true } }, assignees: { include: { user: { select: { name: true } } } }, comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } },
    })
    for (const t of rows) {
      const body = lines(
        `Project ${t.project.key} ${t.project.name}. Column: ${t.column.name}. Priority: ${t.priority}.`,
        t.assignees.length && `Assigned to: ${t.assignees.map((a) => a.user.name).join(', ')}`, t.dueAt && `Due: ${day(t.dueAt)}`, t.completedAt && `Completed: ${day(t.completedAt)}`,
        t.description && `Description: ${t.description}`,
        t.comments.length && `Comments:\n${t.comments.map((c) => `${c.author.name} (${day(c.createdAt)}): ${c.body}`).join('\n')}`,
      )
      out.set(t.id, chunks(`Project task ${t.code}: ${t.title}`, body, { title: `${t.code} ${t.title}`, labels: [`proj:${t.projectId}`, 'sa'], occurredAt: t.updatedAt, link: `/app/projects/${t.project.key}?task=${t.code}` }))
    }
    return out
  },
}

// ------------------------------------------------------------------ My To-Do

const WORKLOG: Source = {
  type: 'WORKLOG', label: 'To-do entry', area: 'todos',
  watch: { WorkLogEntry: same, WorkLogNote: async (ids) => (await prisma.workLogNote.findMany({ where: { id: { in: ids } }, select: { entryId: true } })).map((x) => x.entryId) },
  // Hidden in My To-Do itself: cancelled entries and the automatic Lead Dialer follow-ups.
  all: (c, t) => page(prisma.workLogEntry.findMany({ ...cursorArgs(c, t), where: { cancelledAt: null, OR: [{ autoReason: null }, { autoReason: { not: 'FOLLOW_UP_RULE' } }] }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.workLogEntry.findMany({ where: { id: { in: ids }, cancelledAt: null, OR: [{ autoReason: null }, { autoReason: { not: 'FOLLOW_UP_RULE' } }] }, include: { user: { select: { name: true } }, notes: { orderBy: { createdAt: 'asc' } } } })
    for (const e of rows) {
      const body = lines(
        `${e.user.name}'s ${e.period.toLowerCase()} to-do for ${day(e.periodStart)}. Status: ${e.status}${e.doneAt ? ` (done ${day(e.doneAt)})` : ''}${e.blocked ? ', blocked' : ''}.`,
        e.details && `Details: ${e.details}`, e.tag && `Tag: ${e.tag}`, e.hours != null && `Hours: ${e.hours}`, e.quantity != null && `Quantity: ${e.quantity}`, e.outcome && `Outcome: ${e.outcome}`,
        e.notes.length && `Notes:\n${e.notes.map((n) => `${[n.source, n.sender].filter(Boolean).join(' from ') || 'Note'}: ${n.body}`).join('\n')}`,
      )
      const p = e.period
      out.set(e.id, chunks(`To-do: ${e.title}`, body, {
        title: e.title, labels: e.private ? [`u:${e.userId}`] : [`u:${e.userId}`, `t:${e.userId}`, 'sa'], occurredAt: e.doneAt ?? e.periodStart,
        link: `/app/todo?period=${p}&date=${e.periodStart.toISOString().slice(0, 10)}&entry=${e.id}`,
      }))
    }
    return out
  },
}

const TODO: Source = {
  type: 'TODO', label: 'Personal to-do', area: 'todos',
  watch: { TodoItem: same },
  all: (c, t) => page(prisma.todoItem.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    for (const t of await prisma.todoItem.findMany({ where: { id: { in: ids } } })) {
      out.set(t.id, chunks(`Personal to-do${t.done ? ' (done)' : ''}${t.dueDate ? `, due ${day(t.dueDate)}` : ''}:`, t.title, { title: t.title, labels: [`u:${t.userId}`], occurredAt: t.completedAt ?? t.dueDate ?? t.createdAt, link: '/app/todo' }))
    }
    return out
  },
}

// ------------------------------------------------------------------ Daily logs and the Daily Report

const DAILY_NOTE: Source = {
  type: 'DAILY_NOTE', label: 'Daily log note', area: 'itad',
  watch: { ItadDailyEntry: same },
  all: (c, t) => page(prisma.itadDailyEntry.findMany({ ...cursorArgs(c, t), where: { notes: { not: null } }, select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.itadDailyEntry.findMany({ where: { id: { in: ids }, notes: { not: null } }, include: { user: { select: { name: true } } } })
    for (const e of rows) {
      const nums = `Dials ${e.callsDialed}, connected ${e.connected}, voicemails ${e.voicemail}, emails ${e.emailsSent}, interested ${e.interested}, working on ${e.workingOn}, closed ${e.closed}, RFQs ${e.rfqs}.`
      out.set(e.id, chunks(`${e.user.name}'s ITAD daily log for ${e.date.toISOString().slice(0, 10)} (${e.status}): ${nums}`, `Notes: ${e.notes}`, {
        title: `${e.user.name}, ITAD log ${e.date.toISOString().slice(0, 10)}`, labels: [`u:${e.userId}`, `t:${e.userId}`, 'sa'], occurredAt: e.date, link: '/app/itad/log',
      }))
    }
    return out
  },
}

const REPORT_ENTRY: Source = {
  type: 'REPORT_ENTRY', label: 'Daily Report', area: 'daily-report',
  watch: { ReportEntry: same },
  all: (c, t) => page(prisma.reportEntry.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.reportEntry.findMany({ where: { id: { in: ids } }, include: { user: { select: { name: true } }, form: { include: { fields: true } } } })
    for (const e of rows) {
      const v = (e.values && typeof e.values === 'object' ? e.values : {}) as Record<string, unknown>
      const answers = e.form.fields.filter((f) => v[f.id] != null && v[f.id] !== '').map((f) => `${f.label}: ${Array.isArray(v[f.id]) ? (v[f.id] as unknown[]).join(', ') : String(v[f.id])}${f.unit ? ` ${f.unit}` : ''}`)
      if (!answers.length) continue
      out.set(e.id, chunks(`${e.user.name}'s Daily Report "${e.form.name}" for ${e.date.toISOString().slice(0, 10)}:`, answers.join('\n'), {
        title: `${e.form.name}, ${e.user.name}`, labels: [`u:${e.userId}`, `rt:${e.userId}`, 'sa', 'power:company.settings'], occurredAt: e.date, link: '/app/daily-report',
      }))
    }
    return out
  },
}

const CUSTOM_RECORD: Source = {
  type: 'CUSTOM_RECORD', label: 'Custom block record',
  watch: { CustomRecord: same },
  all: (c, t) => page(prisma.customRecord.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.customRecord.findMany({ where: { id: { in: ids } }, include: { block: true, createdBy: { select: { name: true } } } })
    for (const r of rows) {
      const fields = (Array.isArray(r.block.fields) ? r.block.fields : []) as { key: string; label: string; type: string }[]
      const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>
      const text = fields.filter((f) => data[f.key] != null && data[f.key] !== '').map((f) => `${f.label}: ${String(data[f.key])}`).join('\n')
      const s = (r.block.settings && typeof r.block.settings === 'object' ? r.block.settings : {}) as { membersSee?: string }
      const dept = r.departmentId ?? 'none'
      const labels = ['sa', `cb:${r.blockId}:${dept}:lead`, ...(r.createdById ? [`u:${r.createdById}`] : []), ...(s.membersSee === 'all' ? [`cb:${r.blockId}:${dept}:all`] : [])]
      out.set(r.id, chunks(`${r.block.name} record${r.createdBy ? ` by ${r.createdBy.name}` : ''}:`, text, { title: r.block.name, labels, occurredAt: r.updatedAt, link: `/app/custom/${r.blockId}` }))
    }
    return out
  },
}

// ------------------------------------------------------------------ Marketing, E-commerce

const MKT_TASK: Source = {
  type: 'MKT_TASK', label: 'Marketing task', area: 'marketing',
  watch: { MarketingTask: same, MarketingTaskComment: async (ids) => (await prisma.marketingTaskComment.findMany({ where: { id: { in: ids } }, select: { taskId: true } })).map((x) => x.taskId) },
  all: (c, t) => page(prisma.marketingTask.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.marketingTask.findMany({ where: { id: { in: ids } }, include: { assignee: { select: { name: true } }, brand: { select: { name: true } }, comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } } })
    for (const t of rows) {
      const body = lines(
        `${t.discipline} task. Status: ${t.status}. Priority: ${t.priority}.${t.assignee ? ` Assigned to ${t.assignee.name}.` : ''}${t.brand ? ` Brand: ${t.brand.name}.` : ''}`,
        t.dueDate && `Due: ${day(t.dueDate)}`, t.scheduledDate && `Scheduled: ${day(t.scheduledDate)}`, t.publishedDate && `Published: ${day(t.publishedDate)}`,
        t.description && `Description: ${t.description}`, t.comments.length && `Comments:\n${t.comments.map((c) => `${c.author.name} (${day(c.createdAt)}): ${c.body}`).join('\n')}`,
      )
      out.set(t.id, chunks(`Marketing task: ${t.title}`, body, { title: t.title, labels: [...(t.assigneeId ? [`u:${t.assigneeId}`] : []), 'mkt:lead', `mkt:${String(t.discipline).toLowerCase()}`], occurredAt: t.updatedAt, link: `/app/marketing/board?task=${t.id}` }))
    }
    return out
  },
}

const ECOM_TASK: Source = {
  type: 'ECOM_TASK', label: 'E-commerce task', area: 'ecommerce',
  watch: { EcommerceTask: same, EcomTaskComment: async (ids) => (await prisma.ecomTaskComment.findMany({ where: { id: { in: ids } }, select: { taskId: true } })).map((x) => x.taskId) },
  all: (c, t) => page(prisma.ecommerceTask.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.ecommerceTask.findMany({ where: { id: { in: ids } }, include: { assignedTo: { select: { name: true } }, comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } } })
    for (const t of rows) {
      const body = lines(`Status: ${t.status}.${t.assignedTo ? ` Assigned to ${t.assignedTo.name}.` : ''}${t.source ? ` Source: ${t.source}.` : ''}`, t.dueDate && `Due: ${day(t.dueDate)}`, t.description && `Description: ${t.description}`, t.comments.length && `Comments:\n${t.comments.map((c) => `${c.author.name} (${day(c.createdAt)}): ${c.body}`).join('\n')}`)
      out.set(t.id, chunks(`E-commerce task: ${t.title}`, body, { title: t.title, labels: ['dk:ECOMMERCE', 'sa'], occurredAt: t.updatedAt, link: `/app/ecommerce/board?task=${t.id}` }))
    }
    return out
  },
}

// ------------------------------------------------------------------ People

const FEEDBACK: Source = {
  type: 'FEEDBACK', label: 'Feedback', area: 'feedback',
  watch: { Feedback: same, FeedbackReply: async (ids) => (await prisma.feedbackReply.findMany({ where: { id: { in: ids } }, select: { feedbackId: true } })).map((x) => x.feedbackId) },
  all: (c, t) => page(prisma.feedback.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    const rows = await prisma.feedback.findMany({ where: { id: { in: ids } }, include: { author: { select: { name: true } }, recipient: { select: { name: true } }, replies: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } } })
    for (const f of rows) {
      const body = lines(`${f.sentiment} feedback from ${f.author.name} to ${f.recipient.name}, ${day(f.createdAt)}.`, f.title && `Title: ${f.title}`, f.body, f.replies.length && `Replies:\n${f.replies.map((r) => `${r.author.name}: ${r.body}`).join('\n')}`)
      out.set(f.id, chunks(`Feedback for ${f.recipient.name}`, body, { title: f.title || `Feedback for ${f.recipient.name}`, labels: [`u:${f.authorId}`, `u:${f.recipientId}`, `t:${f.recipientId}`, 'sa'], occurredAt: f.createdAt, link: `/app/feedback/${f.id}` }))
    }
    return out
  },
}

const BID: Source = {
  type: 'BID', label: 'Bid', area: 'itad',
  watch: { Bid: same },
  all: (c, t) => page(prisma.bid.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    for (const b of await prisma.bid.findMany({ where: { id: { in: ids } }, include: { agent: { select: { name: true } } } })) {
      const status = { ACTIVE: 'Active opportunity', SUBMITTED: 'Submitted', WON: 'Won', LOST: 'Lost' }[b.status]
      const body = lines(
        `Deal Tracker bid #${b.number}: "${b.title}" for ${b.company} (${b.type}${b.district ? `, ${b.district}` : ''}). Status: ${status}. Agent: ${b.agent.name}. Due: ${day(b.dueDate)}.`,
        b.priceQuoted != null && `Price quoted: ${dealMoney(b.priceQuoted.toNumber())}`,
        b.awardedPrice != null && b.status === 'WON' && `Awarded price: ${dealMoney(b.awardedPrice.toNumber())}`,
        b.submissionType && `Submitted by: ${b.submissionType.toLowerCase()}`,
        b.bidBond && `Bid bond: yes${b.bidBondAmount != null ? `, ${dealMoney(b.bidBondAmount.toNumber())}` : ''}`,
        b.reminderSet && 'Reminder set',
        b.closedDate && `Closed: ${day(b.closedDate)}`,
      )
      out.set(b.id, chunks(`ITAD bid: ${b.title}`, body, { title: b.title, labels: [`u:${b.agentId}`, `t:${b.agentId}`, 'sa'], occurredAt: b.updatedAt, link: '/app/itad/bids' }))
    }
    return out
  },
}

const SAVED_DOC: Source = {
  type: 'SAVED_DOC', label: 'ITAD document', area: 'itad',
  watch: { SavedDoc: same },
  all: (c, t) => page(prisma.savedDoc.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    for (const d of await prisma.savedDoc.findMany({ where: { id: { in: ids } } })) {
      out.set(d.id, chunks(`ITAD document: ${d.title}`, lines(`Category: ${d.category}`, d.brand && `Brand: ${d.brand}`, d.url && `Link: ${d.url}`, d.fileName && `File: ${d.fileName}`, d.notes && `Notes: ${d.notes}`), { title: d.title, labels: [`u:${d.userId}`], occurredAt: d.updatedAt, link: '/app/itad/docs' }))
    }
    return out
  },
}

const HOLIDAY: Source = {
  type: 'HOLIDAY', label: 'Holiday',
  watch: { Holiday: same },
  all: (c, t) => page(prisma.holiday.findMany({ ...cursorArgs(c, t), select: { id: true } })),
  async build(ids) {
    const out = result(ids)
    for (const h of await prisma.holiday.findMany({ where: { id: { in: ids } } })) {
      out.set(h.id, chunks(`Company holiday: ${h.name}`, `${h.name} on ${h.date.toISOString().slice(0, 10)} (${DateTime.fromJSDate(h.date, { zone: 'utc' }).toFormat('cccc')}).`, { title: h.name, labels: ['all'], occurredAt: h.date, link: '/app/attendance/me' }))
    }
    return out
  },
}

export const SOURCES: Source[] = [
  DIALER_LEAD, DIALER_NOTE, DIALER_CALL, LEAD, LEAD_COMMENT, LEAD_CALL, LEAD_TASK, CHAT_DAY, CALL_NOTES, MEETING, PM_TASK,
  WORKLOG, TODO, DAILY_NOTE, REPORT_ENTRY, CUSTOM_RECORD, MKT_TASK, ECOM_TASK, FEEDBACK, BID, SAVED_DOC, HOLIDAY,
]
export const SOURCE_BY_TYPE = new Map(SOURCES.map((s) => [s.type, s]))
/** model name → the sources it feeds. */
export const SOURCES_BY_MODEL = new Map<string, Source[]>()
for (const s of SOURCES) for (const m of Object.keys(s.watch)) SOURCES_BY_MODEL.set(m, [...(SOURCES_BY_MODEL.get(m) ?? []), s])

