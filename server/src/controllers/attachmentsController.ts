import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AttachmentKind } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { companyToday, dbDateFromString } from '../lib/time'

const UPLOAD_DIR = path.resolve('uploads')
const MAX_BYTES = 25 * 1024 * 1024 // 25 MB

// Executables are rejected; everything else (Excel, Word, PDF, CSV, images, zip…) is allowed.
const BLOCKED_EXT = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app',
])

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

function parseKind(raw: unknown): AttachmentKind | null {
  return raw === 'ITAD' || raw === 'LEAD_GEN' ? raw : null
}

/** A member may touch a kind that matches their department; Super Admin may touch any. */
function kindAllowed(me: Awaited<ReturnType<typeof loadUser>>, kind: AttachmentKind): boolean {
  if (me.role === 'SUPER_ADMIN') return true
  return me.department?.type === kind
}

function serialize(a: { id: string; originalName: string; mimeType: string; size: number; createdAt: Date }) {
  return {
    id: a.id,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    createdAt: a.createdAt.toISOString(),
    downloadUrl: `/api/attachments/${a.id}/download`,
  }
}

/** GET /api/attachments?kind=&date= — the caller's files for a kind + day. */
export async function listAttachments(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const kind = parseKind(req.query.kind)
  if (!kind || !kindAllowed(me, kind)) {
    res.status(400).json({ error: 'Invalid attachment kind' })
    return
  }
  const dateStr = (req.query.date as string) || companyToday()
  const rows = await prisma.entryAttachment.findMany({
    where: { userId: me.id, kind, date: dbDateFromString(dateStr) },
    orderBy: { createdAt: 'asc' },
  })
  res.json({ attachments: rows.map(serialize) })
}

/**
 * POST /api/attachments?kind=&date=&name= — raw binary body (express.raw).
 * The file bytes are the request body; metadata comes from the query + headers.
 */
export async function uploadAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const kind = parseKind(req.query.kind)
  if (!kind || !kindAllowed(me, kind)) {
    res.status(400).json({ error: 'Invalid attachment kind' })
    return
  }

  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    res.status(400).json({ error: 'No file received' })
    return
  }
  if (buf.length > MAX_BYTES) {
    res.status(413).json({ error: 'File is larger than 25 MB' })
    return
  }

  const originalName = String(req.query.name || 'file').slice(0, 200).replace(/[\r\n]/g, '').trim() || 'file'
  const ext = path.extname(originalName).replace('.', '').toLowerCase()
  if (BLOCKED_EXT.has(ext)) {
    res.status(415).json({ error: 'That file type is not allowed' })
    return
  }

  const dateStr = (req.query.date as string) || companyToday()
  if (dateStr > companyToday()) {
    res.status(400).json({ error: 'Cannot attach to a future date' })
    return
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)

  const row = await prisma.entryAttachment.create({
    data: {
      userId: me.id,
      kind,
      date: dbDateFromString(dateStr),
      storedName,
      originalName,
      mimeType: req.headers['content-type'] || 'application/octet-stream',
      size: buf.length,
    },
  })
  res.status(201).json({ attachment: serialize(row) })
}

/** GET /api/attachments/:id/download — owner, their dept Team Lead, or Super Admin. */
export async function downloadAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const att = await prisma.entryAttachment.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } } },
  })
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }
  const allowed =
    me.role === 'SUPER_ADMIN' ||
    me.id === att.userId ||
    (me.role === 'TEAM_LEAD' && me.departmentId != null && me.departmentId === att.user.departmentId)
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const filePath = path.join(UPLOAD_DIR, att.storedName)
  try {
    await fs.access(filePath)
  } catch {
    res.status(404).json({ error: 'File missing on server' })
    return
  }
  res.setHeader('Content-Type', att.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.originalName)}"`)
  res.sendFile(filePath)
}

/** DELETE /api/attachments/:id — owner only. */
export async function deleteAttachment(req: AuthedRequest, res: Response): Promise<void> {
  const me = await loadUser(req.user!.id)
  const att = await prisma.entryAttachment.findUnique({ where: { id: req.params.id } })
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }
  if (att.userId !== me.id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  await prisma.entryAttachment.delete({ where: { id: att.id } })
  await fs.rm(path.join(UPLOAD_DIR, att.storedName), { force: true }).catch(() => undefined)
  res.status(204).end()
}
