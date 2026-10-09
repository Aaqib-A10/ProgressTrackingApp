import type { Response } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { HttpError } from '../lib/pm/access'
import { viewer } from '../lib/pm/http'

/**
 * /api/avatars — profile pictures for people, projects (also their chat channel) and
 * group chats. The browser crops and shrinks the picture to a 256px square JPEG before
 * uploading, so the server just checks it and stores it.
 */

const DIR = path.resolve('uploads', 'avatars')
const MAX_BYTES = 1024 * 1024
type Kind = 'user' | 'project' | 'chat'

const fileFor = (kind: Kind, dbId: string) => path.join(DIR, `${kind}-${dbId}.jpg`)

function kindOf(raw: string): Kind {
  if (raw === 'user' || raw === 'project' || raw === 'chat') return raw
  throw new HttpError(404, 'Unknown picture type')
}

/** Resolve the row (projects are addressed by key) and whether I may change its picture. */
async function target(kind: Kind, idOrKey: string, me: { id: string; role: string }) {
  if (kind === 'user') {
    const u = await prisma.user.findUnique({ where: { id: idOrKey }, select: { id: true, avatarAt: true } })
    if (!u) throw new HttpError(404, 'Person not found')
    return { dbId: u.id, avatarAt: u.avatarAt, canEdit: u.id === me.id || me.role === 'SUPER_ADMIN' }
  }
  if (kind === 'project') {
    const p = await prisma.pmProject.findUnique({ where: { key: idOrKey.toUpperCase() }, select: { id: true, avatarAt: true } })
    if (!p) throw new HttpError(404, 'Project not found')
    const admin = me.role === 'SUPER_ADMIN' || !!(await prisma.pmProjectMember.findFirst({ where: { projectId: p.id, userId: me.id, role: 'ADMIN' }, select: { id: true } }))
    return { dbId: p.id, avatarAt: p.avatarAt, canEdit: admin }
  }
  const c = await prisma.chatConversation.findUnique({ where: { id: idOrKey }, select: { id: true, type: true, avatarAt: true, createdById: true } })
  if (!c) throw new HttpError(404, 'Chat not found')
  const mem = await prisma.chatMember.findUnique({ where: { conversationId_userId: { conversationId: c.id, userId: me.id } }, select: { isAdmin: true } })
  return { dbId: c.id, avatarAt: c.avatarAt, canEdit: c.type === 'GROUP' && !!mem && (mem.isAdmin || c.createdById === me.id) }
}

/** GET /api/avatars — who has a picture (and its version, for caching). */
export async function avatarIndex(_req: AuthedRequest, res: Response): Promise<void> {
  const [users, projects, chats] = await Promise.all([
    prisma.user.findMany({ where: { avatarAt: { not: null } }, select: { id: true, avatarAt: true } }),
    prisma.pmProject.findMany({ where: { avatarAt: { not: null } }, select: { key: true, avatarAt: true } }),
    prisma.chatConversation.findMany({ where: { avatarAt: { not: null } }, select: { id: true, avatarAt: true } }),
  ])
  res.setHeader('Cache-Control', 'private, no-cache')
  res.json({
    users: Object.fromEntries(users.map((u) => [u.id, u.avatarAt!.getTime()])),
    projects: Object.fromEntries(projects.map((p) => [p.key, p.avatarAt!.getTime()])),
    chats: Object.fromEntries(chats.map((c) => [c.id, c.avatarAt!.getTime()])),
  })
}

/** GET /api/avatars/:kind/:id — the picture (versioned URLs, so it can be cached for long). */
export async function avatarFile(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const kind = kindOf(req.params.kind)
  const t = await target(kind, req.params.id, me)
  if (!t.avatarAt) throw new HttpError(404, 'No picture')
  const file = fileFor(kind, t.dbId)
  try { await fs.access(file) } catch { throw new HttpError(404, 'No picture') }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.sendFile(file)
}

/** POST /api/avatars/:kind/:id — raw JPEG body (already cropped by the browser). */
export async function uploadAvatar(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const kind = kindOf(req.params.kind)
  const t = await target(kind, req.params.id, me)
  if (!t.canEdit) throw new HttpError(403, 'You cannot change this picture')
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw new HttpError(400, 'No picture received')
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'Picture is too large')
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new HttpError(415, 'Send the picture as a JPEG')
  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(fileFor(kind, t.dbId), buf)
  const avatarAt = new Date()
  if (kind === 'user') await prisma.user.update({ where: { id: t.dbId }, data: { avatarAt } })
  else if (kind === 'project') await prisma.pmProject.update({ where: { id: t.dbId }, data: { avatarAt } })
  else await prisma.chatConversation.update({ where: { id: t.dbId }, data: { avatarAt } })
  res.json({ version: avatarAt.getTime() })
}

/** DELETE /api/avatars/:kind/:id — back to initials. */
export async function deleteAvatar(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const kind = kindOf(req.params.kind)
  const t = await target(kind, req.params.id, me)
  if (!t.canEdit) throw new HttpError(403, 'You cannot change this picture')
  await fs.rm(fileFor(kind, t.dbId), { force: true })
  if (kind === 'user') await prisma.user.update({ where: { id: t.dbId }, data: { avatarAt: null } })
  else if (kind === 'project') await prisma.pmProject.update({ where: { id: t.dbId }, data: { avatarAt: null } })
  else await prisma.chatConversation.update({ where: { id: t.dbId }, data: { avatarAt: null } })
  res.status(204).end()
}
