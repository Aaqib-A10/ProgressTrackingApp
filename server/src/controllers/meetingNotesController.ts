import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString, dateStringFromDb } from '../lib/time'

/**
 * Ecommerce meeting notes — shared across the department. Any EC member (or
 * Super Admin) can read all notes and add their own; a note's author can edit or
 * delete it, and the EC Team Lead / Super Admin can manage any note.
 */

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function isEcommerce(me: Awaited<ReturnType<typeof loadUser>>): boolean {
  return me.department?.type === 'ECOMMERCE' || me.role === 'SUPER_ADMIN'
}

function isManager(me: Awaited<ReturnType<typeof loadUser>>): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'ECOMMERCE')
}

async function ecommerceDept(me: Awaited<ReturnType<typeof loadUser>>) {
  if (me.department?.type === 'ECOMMERCE') return me.department
  if (me.role === 'SUPER_ADMIN') return prisma.department.findUnique({ where: { type: 'ECOMMERCE' } })
  return null
}

type NoteRow = {
  id: string
  title: string
  body: string
  meetingDate: Date
  deadline: Date | null
  createdAt: Date
  updatedAt: Date
  author: { id: string; name: string }
}

function serialize(n: NoteRow, meId: string, canManage: boolean) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    meetingDate: dateStringFromDb(n.meetingDate),
    deadline: n.deadline ? dateStringFromDb(n.deadline) : null,
    author: n.author,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    canEdit: canManage || n.author.id === meId,
  }
}

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(''))
  .nullable()
  .optional()

/** GET /api/ecommerce/meeting-notes — all EC notes, newest meeting first. */
export async function listMeetingNotes(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const dept = await ecommerceDept(me)
  if (!dept) {
    res.status(500).json({ error: 'Ecommerce department missing' })
    return
  }
  const notes = await prisma.meetingNote.findMany({
    where: { departmentId: dept.id },
    orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
    include: { author: { select: { id: true, name: true } } },
  })
  const canManage = isManager(me)
  res.json({ notes: notes.map((n) => serialize(n, me.id, canManage)), canManage })
}

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  body: z.string().trim().min(1, 'Note body is required').max(10000),
  meetingDate: dateField,
  deadline: dateField,
})

/** POST /api/ecommerce/meeting-notes — add a note (any EC member). */
export async function createMeetingNote(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const dept = await ecommerceDept(me)
  if (!dept) {
    res.status(500).json({ error: 'Ecommerce department missing' })
    return
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const note = await prisma.meetingNote.create({
    data: {
      authorId: me.id,
      departmentId: dept.id,
      title: v.title,
      body: v.body,
      // meetingDate defaults to today (the auto submission date) when omitted.
      meetingDate: dbDateFromString(v.meetingDate || companyToday()),
      deadline: v.deadline ? dbDateFromString(v.deadline) : null,
    },
    include: { author: { select: { id: true, name: true } } },
  })
  res.status(201).json({ note: serialize(note, me.id, isManager(me)) })
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  meetingDate: dateField,
  deadline: dateField,
})

/** PATCH /api/ecommerce/meeting-notes/:id — author or EC manager. */
export async function updateMeetingNote(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const existing = await prisma.meetingNote.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  if (existing.authorId !== me.id && !isManager(me)) {
    res.status(403).json({ error: 'You can only edit your own notes' })
    return
  }
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const data: { title?: string; body?: string; meetingDate?: Date; deadline?: Date | null } = {}
  if (v.title !== undefined) data.title = v.title
  if (v.body !== undefined) data.body = v.body
  if (v.meetingDate !== undefined && v.meetingDate) data.meetingDate = dbDateFromString(v.meetingDate)
  if (v.deadline !== undefined) data.deadline = v.deadline ? dbDateFromString(v.deadline) : null
  const note = await prisma.meetingNote.update({
    where: { id: existing.id },
    data,
    include: { author: { select: { id: true, name: true } } },
  })
  res.json({ note: serialize(note, me.id, isManager(me)) })
}

/** DELETE /api/ecommerce/meeting-notes/:id — author or EC manager. */
export async function deleteMeetingNote(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  if (!isEcommerce(me)) {
    res.status(403).json({ error: 'Not an Ecommerce member' })
    return
  }
  const existing = await prisma.meetingNote.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Note not found' })
    return
  }
  if (existing.authorId !== me.id && !isManager(me)) {
    res.status(403).json({ error: 'You can only delete your own notes' })
    return
  }
  await prisma.meetingNote.delete({ where: { id: existing.id } })
  res.status(204).end()
}
