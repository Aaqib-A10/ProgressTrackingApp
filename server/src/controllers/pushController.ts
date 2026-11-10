import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { parse, viewer } from '../lib/pm/http'
import { HttpError } from '../lib/pm/access'
import { sendPush, vapidKeys } from '../lib/push'
import { nativePushConfigured } from '../lib/nativePush'
import { runAsSystem } from '../lib/tenancy'

/** GET /api/push/key — the public key browsers need to subscribe. */
export async function pushKey(_req: AuthedRequest, res: Response): Promise<void> {
  // nativePush: the server can reach the Metriq phone app (the app registers its device only then).
  res.json({ publicKey: (await vapidKeys()).publicKey, nativePush: nativePushConfigured() })
}

const deviceSchema = z.object({
  token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:\-.=+/]+$/, 'Bad token'),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().max(40).optional(),
})

/** POST /api/push/device — the Metriq phone app on this phone wants my notifications (re-sent on every app start). */
export async function registerDevice(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const b = parse(deviceSchema, req.body)
  // The same phone signed in as someone else now (maybe in another company): the notifications follow the new person.
  await runAsSystem(() => prisma.pushDevice.deleteMany({ where: { token: b.token, NOT: { userId: me.id } } }))
  await prisma.pushDevice.upsert({
    where: { token: b.token },
    create: { userId: me.id, token: b.token, platform: b.platform, appVersion: b.appVersion ?? null },
    update: { userId: me.id, platform: b.platform, appVersion: b.appVersion ?? null },
  })
  // A person has at most 10 phones; the oldest go first.
  const all = await prisma.pushDevice.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (all.length > 10) await prisma.pushDevice.deleteMany({ where: { id: { in: all.slice(10).map((x) => x.id) } } })
  res.json({ ok: true })
}

/** POST /api/push/device/remove { token } — stop notifications on this phone (sign-out, or turned off in the app). */
export async function removeDevice(req: AuthedRequest, res: Response): Promise<void> {
  const me = viewer(req)
  const { token } = parse(z.object({ token: z.string().max(4096) }), req.body)
  await prisma.pushDevice.deleteMany({ where: { token, userId: me.id } })
  res.json({ ok: true })
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
  // The same browser signed in as someone else now: the pop-ups follow the new person. That
  // person can be in another company (one browser, two accounts): the company walls hide the
  // old row, so the upsert below would not find it and would trip on the unique endpoint.
  // Clear this browser from everyone else first, in every company.
  await runAsSystem(() => prisma.pushSubscription.deleteMany({ where: { endpoint: b.endpoint, NOT: { userId: me.id } } }))
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
  const n = (await prisma.pushSubscription.count({ where: { userId: me.id } })) + (nativePushConfigured() ? await prisma.pushDevice.count({ where: { userId: me.id } }) : 0)
  if (!n) throw new HttpError(422, 'Pop-ups are not turned on for any of your devices yet')
  const sent = await sendPush([me.id], { kind: 'test', title: 'PulseTrack notifications work', body: 'You will get calls and messages like this, even when PulseTrack is closed.', tag: 'pt-test', url: '/app/chat' }, { evenIfActive: true, ttl: 120 })
  res.json({ devices: n, sent })
}
