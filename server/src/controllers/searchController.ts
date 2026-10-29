import type { Response } from 'express'
import { DateTime } from 'luxon'
import { Prisma, type DepartmentType, type Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { personBlocks } from '../lib/personBlocks'
import type { AuthedRequest } from '../middleware/auth'
import { visibleProjectIds } from '../lib/pm/access'
import { dateStringFromDb } from '../lib/time'

/**
 * GET /api/search?q= — one search box for the whole app: people, projects, tasks, chats,
 * files and meetings. Everyone only finds what they can already open: chats they are in,
 * projects they belong to, their own department's task boards, their own to-dos.
 */

export interface SearchHit {
  id: string
  title: string
  /** Short second line (department, project, chat name, a piece of the message...). */
  sub?: string
  /** In-app address to open. */
  link: string
}

export interface SearchResponse {
  q: string
  people: (SearchHit & { userId: string })[]
  /** Lead Dialer leads (ITAD): by company, contact, email or phone number. */
  leads: SearchHit[]
  projects: SearchHit[]
  tasks: SearchHit[]
  chats: SearchHit[]
  files: SearchHit[]
  meetings: SearchHit[]
}

const LIMIT = 6
const DEPT_LABEL: Record<string, string> = { ITAD: 'ITAD', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing', CSR: 'CSR', ECOMMERCE: 'Ecommerce', TALKLOOP: 'Talkloop', INVENTORY: 'Inventory' }

/** A few words of the message around the match. */
function snippet(text: string, q: string, width = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0 || flat.length <= width) return flat.slice(0, width) + (flat.length > width ? '…' : '')
  const start = Math.max(0, i - Math.floor((width - q.length) / 2))
  return (start > 0 ? '…' : '') + flat.slice(start, start + width) + (start + width < flat.length ? '…' : '')
}

export async function search(req: AuthedRequest, res: Response): Promise<void> {
  const q = String(req.query.q ?? '').trim().slice(0, 80)
  const empty: SearchResponse = { q, people: [], leads: [], projects: [], tasks: [], chats: [], files: [], meetings: [] }
  if (q.length < 2) {
    res.json(empty)
    return
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, role: true, companyId: true, departmentId: true, department: { select: { type: true, layout: true } } } })
  const like = { contains: q, mode: 'insensitive' as const }
  const isAdmin = me.role === 'SUPER_ADMIN'
  const dept = me.department?.type

  const [projectIds, myConvs] = await Promise.all([
    visibleProjectIds({ id: me.id, role: me.role }, true),
    prisma.chatMember.findMany({ where: { userId: me.id }, select: { conversationId: true } }),
  ])
  const convIds = myConvs.map((c) => c.conversationId)

  const [leadHits, people, projects, pmTasks, mktTasks, ecomTasks, todos, workLog, convs, messages, chatFiles, pmFiles, meetings] = await Promise.all([
    searchLeads(me, q),
    prisma.user.findMany({
      where: { isActive: true, status: 'ACTIVE', id: { not: me.id }, OR: [{ name: like }, { email: like }] },
      select: { id: true, name: true, role: true, department: { select: { type: true } } },
      orderBy: { name: 'asc' },
      take: LIMIT,
    }),
    prisma.pmProject.findMany({ where: { id: { in: projectIds }, OR: [{ name: like }, { key: like }] }, select: { key: true, name: true, status: true }, take: LIMIT }),
    prisma.pmTask.findMany({
      where: { projectId: { in: projectIds }, OR: [{ title: like }, { code: like }] },
      select: { code: true, title: true, project: { select: { key: true, name: true } }, column: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: LIMIT,
    }),
    isAdmin || dept === 'MARKETING'
      ? prisma.marketingTask.findMany({ where: { title: like }, select: { id: true, title: true, discipline: true, status: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT })
      : Promise.resolve([]),
    isAdmin || dept === 'ECOMMERCE'
      ? prisma.ecommerceTask.findMany({ where: { title: like }, select: { id: true, title: true, status: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT })
      : Promise.resolve([]),
    prisma.todoItem.findMany({ where: { userId: me.id, title: like }, select: { id: true, title: true, done: true }, take: LIMIT }),
    // My To-Do entries (own only), with the day, week, month or year they belong to.
    prisma.workLogEntry.findMany({
      where: { userId: me.id, OR: [{ title: like }, { details: like }, { tag: like }, { notes: { some: { body: like } } }] },
      select: { id: true, title: true, period: true, periodStart: true, status: true },
      orderBy: { periodStart: 'desc' },
      take: LIMIT,
    }),
    prisma.chatConversation.findMany({ where: { id: { in: convIds }, name: like }, select: { id: true, name: true, type: true }, take: LIMIT }),
    prisma.chatMessage.findMany({
      where: { conversationId: { in: convIds }, deletedAt: null, body: like },
      select: { id: true, body: true, conversationId: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { seq: 'desc' },
      take: LIMIT,
    }),
    prisma.chatMessage.findMany({
      where: { conversationId: { in: convIds }, deletedAt: null, fileStoredName: { not: null }, fileName: like },
      select: { id: true, fileName: true, conversationId: true, user: { select: { name: true } } },
      orderBy: { seq: 'desc' },
      take: LIMIT,
    }),
    prisma.pmAttachment.findMany({
      where: { task: { projectId: { in: projectIds } }, originalName: like },
      select: { id: true, originalName: true, task: { select: { code: true, title: true, project: { select: { key: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
    }),
    prisma.meeting.findMany({
      where: { cancelledAt: null, title: like, ...(isAdmin ? {} : { OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }] }) },
      select: { id: true, title: true, startsAt: true },
      orderBy: { startsAt: 'desc' },
      take: LIMIT,
    }),
  ])

  // Names for the chats that messages and files came from (a direct chat is named after the other person).
  const chatIds = [...new Set([...messages.map((m) => m.conversationId), ...chatFiles.map((m) => m.conversationId)])]
  const chatInfo = chatIds.length
    ? await prisma.chatConversation.findMany({
      where: { id: { in: chatIds } },
      select: { id: true, type: true, name: true, project: { select: { key: true } }, members: { where: { userId: { not: me.id } }, select: { user: { select: { name: true } } }, take: 1 } },
    })
    : []
  const chatName = (id: string) => {
    const c = chatInfo.find((x) => x.id === id)
    if (!c) return 'Chat'
    if (c.type === 'DIRECT') return c.members[0]?.user.name ?? 'Direct message'
    return c.name ?? c.project?.key ?? 'Group'
  }

  /** "Day · Wed 12 Aug 2026", "Week of 10 Aug 2026", "Month · August 2026", "Year · 2026". */
  const wlWhen = (period: string, day: string) => {
    const d = DateTime.fromISO(day)
    return period === 'DAY' ? `Day · ${d.toFormat('ccc d LLL yyyy')}` : period === 'WEEK' ? `Week of ${d.toFormat('d LLL yyyy')}` : period === 'MONTH' ? `Month · ${d.toFormat('LLLL yyyy')}` : `Year · ${d.toFormat('yyyy')}`
  }
  const MKT_HOME: Record<string, string> = { SOCIAL: 'Social', CONTENT: 'Content', SEO: 'SEO' }
  const out: SearchResponse = {
    q,
    people: people.map((p) => ({
      id: p.id,
      userId: p.id,
      title: p.name,
      sub: [p.department ? DEPT_LABEL[p.department.type] : null, p.role === 'TEAM_LEAD' ? 'Team Lead' : p.role === 'SUPER_ADMIN' ? 'Admin' : p.role === 'QA' || p.role === 'QA_LEAD' ? 'QA' : null].filter(Boolean).join(' · ') || undefined,
      link: `/app/chat?dm=${encodeURIComponent(p.id)}`,
    })),
    leads: leadHits,
    projects: projects.map((p) => ({ id: p.key, title: p.name, sub: `${p.key}${p.status === 'ARCHIVED' ? ' · archived' : ''}`, link: `/app/projects/${encodeURIComponent(p.key)}` })),
    tasks: [
      ...pmTasks.map((t) => ({ id: t.code, title: t.title, sub: `${t.code} · ${t.project.name} · ${t.column.name}`, link: `/app/projects/${encodeURIComponent(t.project.key)}?task=${encodeURIComponent(t.code)}` })),
      ...mktTasks.map((t) => ({ id: t.id, title: t.title, sub: `Marketing · ${MKT_HOME[t.discipline] ?? t.discipline}`, link: `/app/marketing/board?task=${encodeURIComponent(t.id)}` })),
      ...ecomTasks.map((t) => ({ id: t.id, title: t.title, sub: 'Ecommerce task board', link: `/app/ecommerce/board?task=${encodeURIComponent(t.id)}` })),
      ...workLog.map((e) => {
        const day = dateStringFromDb(e.periodStart)
        return {
          id: e.id, title: snippet(e.title, q),
          sub: `My To-Do · ${wlWhen(e.period, day)}${e.status === 'DONE' ? ' · done' : e.status === 'IN_PROGRESS' ? ' · in progress' : ''}`,
          link: `/app/todo?period=${e.period}&date=${day}&entry=${encodeURIComponent(e.id)}`,
        }
      }),
      ...todos.map((t) => ({ id: t.id, title: t.title, sub: t.done ? 'Quick checklist · done' : 'Quick checklist', link: '/app/todo' })),
    ].slice(0, LIMIT + 4),
    chats: [
      ...convs.map((c) => ({ id: c.id, title: c.name ?? 'Group', sub: c.type === 'PROJECT' ? 'Project channel' : 'Group chat', link: `/app/chat?c=${encodeURIComponent(c.id)}` })),
      ...messages.map((m) => ({ id: m.id, title: snippet(m.body, q), sub: `${m.user.name} in ${chatName(m.conversationId)} · ${m.createdAt.toISOString().slice(0, 10)}`, link: `/app/chat?c=${encodeURIComponent(m.conversationId)}` })),
    ].slice(0, LIMIT + 2),
    files: [
      ...chatFiles.map((f) => ({ id: f.id, title: f.fileName ?? 'File', sub: `${f.user.name} in ${chatName(f.conversationId)}`, link: `/app/chat?c=${encodeURIComponent(f.conversationId)}` })),
      ...pmFiles.map((f) => ({ id: f.id, title: f.originalName, sub: `${f.task.code} · ${f.task.title}`, link: `/app/projects/${encodeURIComponent(f.task.project.key)}?task=${encodeURIComponent(f.task.code)}` })),
    ].slice(0, LIMIT),
    meetings: meetings.map((m) => ({ id: m.id, title: m.title, sub: m.startsAt.toISOString().slice(0, 10), link: `/app/meetings/${encodeURIComponent(m.id)}` })),
  }
  res.json(out)
}

// ------------------------------------------------------------------ Lead Dialer leads

/**
 * Leads this person can open in the Lead Dialer, matching the words: the company, the contact,
 * an email, a CRM id, a city, or a phone number written any way ("(555) 123-4567",
 * "555-123-4567" and "+1 555 123 4567" all match 5551234567). Reps find their own leads; an ITAD
 * team lead finds the team's; the Super Admin finds every lead. A department with the Lead Dialer
 * in its menu (Department Studio) works the same way for its own people.
 */
async function searchLeads(me: { id: string; role: Role; companyId: string; departmentId: string | null; department: { type: DepartmentType; layout: unknown } | null }, q: string): Promise<SearchHit[]> {
  const admin = me.role === 'SUPER_ADMIN'
  let owners: string[] | null = null // null = every lead (Super Admin)
  if (!admin) {
    const home = me.department?.type === 'ITAD'
    const blocks = home ? null : await personBlocks(me)
    if (!home && !blocks?.includes('itad-dialer')) return []
    if (me.role !== 'TEAM_LEAD') owners = [me.id]
    else owners = (await prisma.user.findMany({ where: home ? { department: { type: 'ITAD' } } : { departmentId: me.departmentId ?? '__none__' }, select: { id: true } })).map((u) => u.id).concat(me.id)
  }
  const like = { contains: q, mode: 'insensitive' as const }
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5)
  // Phone numbers are kept as typed: compare digits only (the last 10 when there is a +1 in front).
  const digits = q.replace(/\D/g, '')
  const looksLikePhone = digits.length >= 4 && /^[\d\s()+.\-]+$/.test(q)
  const phoneIds: string[] = []
  if (looksLikePhone) {
    const d = digits.length > 10 ? digits.slice(-10) : digits
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "DialerLead"
      WHERE "companyId" = ${me.companyId}
        ${owners ? Prisma.sql`AND "ownerId" IN (${Prisma.join(owners)})` : Prisma.empty}
        AND (regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE ${'%' + d + '%'}
          OR regexp_replace(COALESCE("phone2", ''), '[^0-9]', '', 'g') LIKE ${'%' + d + '%'})
      LIMIT 20`)
    phoneIds.push(...rows.map((r) => r.id))
  }
  const ci = (w: string) => ({ contains: w, mode: 'insensitive' as const })
  const textMatch = words.length > 1
    ? { AND: words.map((w) => ({ OR: [{ company: ci(w) }, { contactName: ci(w) }, { city: ci(w) }, { email: ci(w) }] })) }
    : { OR: [{ company: like }, { contactName: like }, { email: like }, { email2: like }, { externalId: like }, { city: like }, { linkedin: like }] }
  const leads = await prisma.dialerLead.findMany({
    where: { ...(owners ? { ownerId: { in: owners } } : {}), OR: [textMatch, ...(phoneIds.length ? [{ id: { in: phoneIds } }] : [])] },
    select: { id: true, company: true, contactName: true, phone: true, email: true, status: true, ownerId: true, owner: { select: { name: true } } },
    orderBy: [{ inLatestImport: 'desc' }, { updatedAt: 'desc' }],
    take: LIMIT + 2,
  })
  return leads.map((l) => ({
    id: l.id,
    title: l.contactName ? `${l.company} · ${l.contactName}` : l.company,
    sub: [l.status, l.phone, l.email, l.ownerId !== me.id ? l.owner.name : null].filter(Boolean).join(' · '),
    link: `/app/itad/dialer?${l.ownerId !== me.id ? `rep=${encodeURIComponent(l.ownerId)}&` : ''}lead=${encodeURIComponent(l.id)}`,
  }))
}
