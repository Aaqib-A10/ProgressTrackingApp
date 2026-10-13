import type { Response } from 'express'
import { z } from 'zod'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { SavedDoc } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { contentDisposition } from '../lib/contentDisposition'

/**
 * Docs & Links: each person's own place to keep important documents and links, with the
 * brand they belong to, a category and notes. Everything here is private to its owner.
 */

const UPLOAD_DIR = path.resolve('uploads', 'docs')
const MAX_BYTES = 25 * 1024 * 1024
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app', 'html', 'htm', 'svg'])
export const DOC_CATEGORIES = ['CONTRACT', 'PRICE_LIST', 'CERTIFICATE', 'PROPOSAL', 'PORTAL', 'SOP', 'OTHER'] as const

function serialize(d: SavedDoc) {
  return {
    id: d.id,
    title: d.title,
    url: d.url,
    file: d.fileStoredName ? { name: d.fileName ?? 'file', mime: d.fileMime, size: d.fileSize, downloadUrl: `/api/docs/${d.id}/file` } : null,
    brand: d.brand ?? '',
    category: d.category,
    notes: d.notes ?? '',
    pinned: d.pinned,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

/** Only http(s) links are kept (no javascript: or file: addresses). */
const safeUrl = z.string().trim().max(2000).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links must start with http:// or https://')

const bodySchema = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(200),
  url: safeUrl.optional().nullable(),
  brand: z.string().trim().max(120).optional().nullable(),
  category: z.enum(DOC_CATEGORIES).optional(),
  notes: z.string().max(4000).optional().nullable(),
  pinned: z.boolean().optional(),
})

const mine = (req: AuthedRequest, id: string) => prisma.savedDoc.findFirst({ where: { id, userId: req.user!.id } })

/** GET /api/docs — my docs and links, pinned first, newest first. */
export async function listDocs(req: AuthedRequest, res: Response): Promise<void> {
  const docs = await prisma.savedDoc.findMany({ where: { userId: req.user!.id }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] })
  res.json({ docs: docs.map(serialize) })
}

/** POST /api/docs — save a link (a file is added with POST /api/docs/:id/file). */
export async function createDoc(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const doc = await prisma.savedDoc.create({
    data: { userId: req.user!.id, title: v.title, url: v.url || null, brand: v.brand || null, category: v.category ?? 'OTHER', notes: v.notes || null, pinned: v.pinned ?? false },
  })
  res.status(201).json({ doc: serialize(doc) })
}

/** PATCH /api/docs/:id */
export async function updateDoc(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await mine(req, req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const parsed = bodySchema.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const v = parsed.data
  const doc = await prisma.savedDoc.update({
    where: { id: existing.id },
    data: {
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.url !== undefined ? { url: v.url || null } : {}),
      ...(v.brand !== undefined ? { brand: v.brand || null } : {}),
      ...(v.category !== undefined ? { category: v.category } : {}),
      ...(v.notes !== undefined ? { notes: v.notes || null } : {}),
      ...(v.pinned !== undefined ? { pinned: v.pinned } : {}),
    },
  })
  res.json({ doc: serialize(doc) })
}

async function removeFile(stored: string | null) {
  if (stored) await fs.unlink(path.join(UPLOAD_DIR, stored)).catch(() => undefined)
}

/** DELETE /api/docs/:id */
export async function deleteDoc(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await mine(req, req.params.id)
  if (existing) {
    await prisma.savedDoc.delete({ where: { id: existing.id } })
    await removeFile(existing.fileStoredName)
  }
  res.status(204).end()
}

/** POST /api/docs/:id/file?name= — attach (or replace) the document's file. Raw body. */
export async function uploadDocFile(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await mine(req, req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
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
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf)
  const doc = await prisma.savedDoc.update({
    where: { id: existing.id },
    data: { fileStoredName: storedName, fileName: originalName, fileMime: String(req.query.type || req.headers['content-type'] || 'application/octet-stream').slice(0, 120), fileSize: buf.length },
  })
  await removeFile(existing.fileStoredName)
  res.json({ doc: serialize(doc) })
}

/** GET /api/docs/:id/file — download my file. */
export async function downloadDocFile(req: AuthedRequest, res: Response): Promise<void> {
  const existing = await mine(req, req.params.id)
  if (!existing?.fileStoredName) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  const filePath = path.join(UPLOAD_DIR, existing.fileStoredName)
  try { await fs.access(filePath) } catch { res.status(404).json({ error: 'File missing on server' }); return }
  res.setHeader('Content-Type', existing.fileMime || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', contentDisposition('attachment', existing.fileName ?? 'file'))
  res.sendFile(filePath)
}
