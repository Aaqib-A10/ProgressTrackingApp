import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { parse, viewer } from '../lib/pm/http'
import { HttpError } from '../lib/pm/access'
import { sendPush, vapidKeys } from '../lib/push'

/** GET /api/push/key — the public key browsers need to subscribe. */
export async function pushKey(_req: AuthedRequest, res: Response): Promise<void> {
  res.json({ publicKey: (await vapidKeys()).publicKey })
}

const subSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Bad endpoint'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
})

/** POST /api/push/subscribe — this browser wants pop-ups for me (re-sent on every app start). */
export async function subscribe(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const b = parse(subSchema, req.body)
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300) || null
  // The same browser signed in as someone else now: the pop-ups follow the new person.
  await prisma.pushSubscription.upsert({
    where: { endpoint: b.endpoint },
    create: { userId: me.id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: ua },
    update: { userId: me.id, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: ua },
  })
  // A person has at most 10 devices; the oldest go first.
  const all = await prisma.pushSubscription.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (all.length > 10) await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(10).map((x) => x.id) } } })
  res.json({ ok: true })
}

/** POST /api/push/unsubscribe { endpoint } — stop pop-ups on this browser. */
export async function unsubscribe(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body)
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: me.id } })
  res.json({ ok: true })
}

/** POST /api/push/test — send myself a test pop-up (to every device I turned it on for). */
export async function testPush(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const n = await prisma.pushSubscription.count({ where: { userId: me.id } })
  if (!n) throw new HttpError(422, 'Pop-ups are not turned on for any of your devices yet')
  const sent = await sendPush([me.id], { kind: 'test', title: 'PulseTrack notifications work', body: 'You will get calls and messages like this, even when PulseTrack is closed.', tag: 'pt-test', url: '/app/chat' }, { evenIfActive: true, ttl: 120 })
  res.json({ devices: n, sent })
}
