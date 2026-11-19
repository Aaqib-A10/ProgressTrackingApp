import type { Response } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'

/**
 * Notes (Nov 2026, asked for by the E-commerce team): sticky notes for the day's important things, like Google
 * Keep inside Metriq. A note is text or a checklist, has a colour, tags, can be pinned, archived and given a
 * reminder, and is shared with people: read only, or allowed to edit. @mentioning someone in a note lets them
 * read it and tells them.
 *
 * Who does what:
 *  - the owner: everything (share, pin, archive, reminder, delete);
 *  - someone it is shared with to edit: the words, the checklist, the colour and the tags;
 *  - someone it is shared with to read (or mentioned): reads it, and can take it off their own list.
 * Nobody else sees a note (not even a Super Admin): notes are private, like chats.
 */

export const NOTE_COLORS = ['plain', 'yellow', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'red'] as const
const MAX_NOTES = 500

const item = z.object({ id: z.string().min(1).max(40), text: z.string().max(500), done: z.boolean() })
const share = z.object({ userId: z.string().min(1), canEdit: z.boolean() })
const tag = z.string().trim().toLowerCase().transform((t) => t.replace(/^#+/, '').replace(/\s+/g, '-')).pipe(z.string().min(1).max(30))
const content = {
  title: z.string().trim().max(200).optional(),
  body: z.string().max(20_000).optional(),
  items: z.array(item).max(200).nullable().optional(),
  color: z.enum(NOTE_COLORS).optional(),
  tags: z.array(tag).max(20).optional(),
  mentions: z.array(z.string()).max(50).optional(),
}
const createSchema = z.object({
  ...content,
  pinned: z.boolean().optional(),
  remindAt: z.string().datetime({ offset: true }).nullable().optional(),
  shares: z.array(share).max(50).optional(),
})
const updateSchema = z.object({
  ...content,
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  remindAt: z.string().datetime({ offset: true }).nullable().optional(),
})

const include = {
  owner: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  shares: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.NoteInclude
type Loaded = Prisma.NoteGetPayload<{ include: typeof include }>
type Access = 'owner' | 'edit' | 'view'

function accessOf(n: Loaded, userId: string): Access | null {
  if (n.ownerId === userId) return 'owner'
  const s = n.shares.find((x) => x.userId === userId)
  return s ? (s.canEdit ? 'edit' : 'view') : null
}

function view(n: Loaded, userId: string) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    items: (n.items as { id: string; text: string; done: boolean }[] | null) ?? null,
    color: n.color,
    tags: n.tags,
    mentions: n.mentions,
    pinned: n.pinned,
    archived: n.archived,
    remindAt: n.remindAt?.toISOString() ?? null,
    reminded: !!n.remindedAt,
    owner: n.owner,
    editedBy: n.editedBy,
    access: accessOf(n, userId)!,
    shares: n.shares.map((s) => ({ userId: s.userId, name: s.user.name, canEdit: s.canEdit })),
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }
}

/** Load a note the person may see, with their access; null when it does not exist for them. */
async function loadFor(id: string, userId: string): Promise<{ note: Loaded; access: Access } | null> {
  const note = await prisma.note.findUnique({ where: { id }, include })
  if (!note) return null
  const access = accessOf(note, userId)
  return access ? { note, access } : null
}

/** Only active people of this company (the company wall keeps the lookup to it). */
async function activeIds(ids: string[], not: string): Promise<string[]> {
  const want = [...new Set(ids)].filter((x) => x !== not)
  if (!want.length) return []
  const ok = await prisma.user.findMany({ where: { id: { in: want }, isActive: true, status: 'ACTIVE' }, select: { id: true } })
  return ok.map((u) => u.id)
}

const label = (n: { title: string; body: string; items: unknown }) => {
  const t = n.title.trim() || n.body.trim().split('\n')[0] || ((n.items as { text: string }[] | null)?.[0]?.text ?? '')
  return t.length > 60 ? `${t.slice(0, 57)}...` : t || 'a note'
}

async function tell(type: 'NOTE_SHARED' | 'NOTE_MENTION', userIds: string[], actor: { id: string; name: string }, note: { id: string; title: string; body: string; items: unknown }, canEdit?: boolean) {
  if (!userIds.length) return
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      actorId: actor.id,
      type,
      title: type === 'NOTE_MENTION' ? `${actor.name} mentioned you in a note` : `${actor.name} shared a note with you`,
      body: `"${label(note)}"${type === 'NOTE_SHARED' ? (canEdit ? ' · you can edit it' : ' · you can read it') : ''}`,
      link: `/app/notes?note=${note.id}`,
      entityType: 'Note',
      entityId: note.id,
    })),
  })
}

/**
 * New @mentions: the people mentioned for the first time get a read share (when they had none) and a notice.
 * Returns the cleaned list to store.
 */
async function applyMentions(noteId: string, ownerId: string, before: string[], wanted: string[] | undefined, actor: { id: string; name: string }, note: { id: string; title: string; body: string; items: unknown }): Promise<string[] | undefined> {
  if (wanted === undefined) return undefined
  const ids = await activeIds(wanted, ownerId)
  const fresh = ids.filter((id) => !before.includes(id) && id !== actor.id)
  if (fresh.length) {
    await prisma.noteShare.createMany({ data: fresh.map((userId) => ({ noteId, userId, canEdit: false })), skipDuplicates: true })
    await tell('NOTE_MENTION', fresh, actor, note)
  }
  return ids
}

const me = (req: AuthedRequest) => prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true } })
const bad = (res: Response, e: z.ZodError) => res.status(400).json({ error: e.issues[0]?.message ?? 'Invalid note' })

/** GET /api/notes — my notes and the ones shared with me (archived ones too: the page has an Archive). */
export async function listNotes(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user!.id
  const rows = await prisma.note.findMany({
    where: { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] },
    include,
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: MAX_NOTES,
  })
  res.json({ notes: rows.map((n) => view(n, userId)) })
}

/** GET /api/notes/:id — one note I can see. */
export async function getNote(req: AuthedRequest, res: Response): Promise<void> {
  const found = await loadFor(req.params.id, req.user!.id)
  if (!found) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  res.json({ note: view(found.note, req.user!.id) })
}

/** POST /api/notes — a new note (with its shares and @mentions). */
export async function createNote(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) { bad(res, parsed.error); return }
  const d = parsed.data
  if (!d.title?.trim() && !d.body?.trim() && !d.items?.some((i) => i.text.trim())) {
    res.status(400).json({ error: 'Write something first.' })
    return
  }
  const actor = await me(req)
  const shareIds = await activeIds((d.shares ?? []).map((s) => s.userId), actor.id)
  const shares = (d.shares ?? []).filter((s) => shareIds.includes(s.userId))
  const created = await prisma.note.create({
    data: {
      ownerId: actor.id,
      editedById: actor.id,
      title: d.title ?? '',
      body: d.body ?? '',
      items: d.items ?? Prisma.DbNull,
      color: d.color ?? 'yellow',
      tags: [...new Set(d.tags ?? [])],
      pinned: d.pinned ?? false,
      remindAt: d.remindAt ? new Date(d.remindAt) : null,
      shares: { create: [...new Map(shares.map((s) => [s.userId, s])).values()].map((s) => ({ userId: s.userId, canEdit: s.canEdit })) },
    },
  })
  if (shares.length) {
    const edit = shares.filter((s) => s.canEdit).map((s) => s.userId)
    await tell('NOTE_SHARED', edit, actor, created, true)
    await tell('NOTE_SHARED', shares.filter((s) => !s.canEdit).map((s) => s.userId), actor, created, false)
  }
  const mentions = await applyMentions(created.id, actor.id, shares.map((s) => s.userId), d.mentions, actor, created)
  if (mentions?.length) await prisma.note.update({ where: { id: created.id }, data: { mentions } })
  const found = await loadFor(created.id, actor.id)
  res.status(201).json({ note: view(found!.note, actor.id) })
}

/** PATCH /api/notes/:id — change a note (what each person may change: see the top of this file). */
export async function updateNote(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) { bad(res, parsed.error); return }
  const actor = await me(req)
  const found = await loadFor(req.params.id, actor.id)
  if (!found) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  const { note, access } = found
  const d = parsed.data
  if (access === 'view') {
    res.status(403).json({ error: 'This note was shared with you to read. Ask its owner to let you edit it.' })
    return
  }
  const ownerOnly = (['pinned', 'archived', 'remindAt'] as const).filter((k) => d[k] !== undefined)
  if (access !== 'owner' && ownerOnly.length) {
    res.status(403).json({ error: 'Only the owner can pin, archive or set a reminder on this note.' })
    return
  }
  const data: Prisma.NoteUpdateInput = { editedBy: { connect: { id: actor.id } } }
  if (d.title !== undefined) data.title = d.title
  if (d.body !== undefined) data.body = d.body
  if (d.items !== undefined) data.items = d.items ?? Prisma.DbNull
  if (d.color !== undefined) data.color = d.color
  if (d.tags !== undefined) data.tags = [...new Set(d.tags)]
  if (d.pinned !== undefined) data.pinned = d.pinned
  if (d.archived !== undefined) data.archived = d.archived
  if (d.remindAt !== undefined) {
    data.remindAt = d.remindAt ? new Date(d.remindAt) : null
    data.remindedAt = null // a new reminder time is reminded again
  }
  const next = { id: note.id, title: d.title ?? note.title, body: d.body ?? note.body, items: d.items === undefined ? note.items : d.items }
  const mentions = await applyMentions(note.id, note.ownerId, [...note.mentions, ...note.shares.map((s) => s.userId)], d.mentions, actor, next)
  if (mentions !== undefined) data.mentions = mentions
  await prisma.note.update({ where: { id: note.id }, data })
  const after = await loadFor(note.id, actor.id)
  res.json({ note: view(after!.note, actor.id) })
}

const sharesSchema = z.object({ shares: z.array(share).max(50) })

/** PUT /api/notes/:id/shares { shares: [{ userId, canEdit }] } — the owner sets who it is shared with. */
export async function setShares(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = sharesSchema.safeParse(req.body)
  if (!parsed.success) { bad(res, parsed.error); return }
  const actor = await me(req)
  const found = await loadFor(req.params.id, actor.id)
  if (!found) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  if (found.access !== 'owner') {
    res.status(403).json({ error: 'Only the owner can share this note.' })
    return
  }
  const { note } = found
  const ok = await activeIds(parsed.data.shares.map((s) => s.userId), actor.id)
  const wanted = [...new Map(parsed.data.shares.filter((s) => ok.includes(s.userId)).map((s) => [s.userId, s])).values()]
  const before = new Map(note.shares.map((s) => [s.userId, s.canEdit]))
  const removed = note.shares.filter((s) => !wanted.some((w) => w.userId === s.userId)).map((s) => s.userId)
  await prisma.$transaction([
    prisma.noteShare.deleteMany({ where: { noteId: note.id, userId: { in: removed } } }),
    ...wanted.map((w) => prisma.noteShare.upsert({
      where: { noteId_userId: { noteId: note.id, userId: w.userId } },
      update: { canEdit: w.canEdit },
      create: { noteId: note.id, userId: w.userId, canEdit: w.canEdit },
    })),
    // Someone taken off the note is no longer "mentioned" in it either (they would get it back otherwise).
    prisma.note.update({ where: { id: note.id }, data: { mentions: note.mentions.filter((m) => !removed.includes(m)) } }),
  ])
  // Told: people new to the note, and people now allowed to edit.
  const added = wanted.filter((w) => !before.has(w.userId) || (w.canEdit && !before.get(w.userId)))
  await tell('NOTE_SHARED', added.filter((w) => w.canEdit).map((w) => w.userId), actor, note, true)
  await tell('NOTE_SHARED', added.filter((w) => !w.canEdit).map((w) => w.userId), actor, note, false)
  const after = await loadFor(note.id, actor.id)
  res.json({ note: view(after!.note, actor.id) })
}

/** DELETE /api/notes/:id — the owner deletes it; someone it was shared with takes it off their own list. */
export async function deleteNote(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user!.id
  const found = await loadFor(req.params.id, userId)
  if (!found) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  if (found.access === 'owner') await prisma.note.delete({ where: { id: found.note.id } })
  else {
    await prisma.$transaction([
      prisma.noteShare.deleteMany({ where: { noteId: found.note.id, userId } }),
      prisma.note.update({ where: { id: found.note.id }, data: { mentions: found.note.mentions.filter((m) => m !== userId) } }),
    ])
  }
  res.status(204).end()
}

/** GET /api/notes/people — who a note can be shared with or mention (active people of the company). */
export async function notePeople(req: AuthedRequest, res: Response): Promise<void> {
  const people = await prisma.user.findMany({
    where: { isActive: true, status: 'ACTIVE', id: { not: req.user!.id } },
    select: { id: true, name: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({ people: people.map((p) => ({ id: p.id, name: p.name, department: p.department?.name ?? null })) })
}

/** The reminder job (lib/noteReminders): notes whose reminder time has come, each told to its owner once. */
export async function runNoteReminderTick(now: Date = new Date()): Promise<number> {
  const due = await prisma.note.findMany({ where: { remindAt: { lte: now }, remindedAt: null, archived: false }, select: { id: true, ownerId: true, title: true, body: true, items: true }, take: 200 })
  let sent = 0
  for (const n of due) {
    // Claim first, so two ticks never send it twice.
    const claim = await prisma.note.updateMany({ where: { id: n.id, remindedAt: null }, data: { remindedAt: now } })
    if (claim.count !== 1) continue
    await prisma.notification.create({
      data: { userId: n.ownerId, type: 'NOTE_REMINDER', title: 'Reminder from your notes', body: `"${label(n)}"`, link: `/app/notes?note=${n.id}`, entityType: 'Note', entityId: n.id },
    }).catch(() => undefined)
    sent++
  }
  return sent
}
