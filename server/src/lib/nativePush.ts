import crypto from 'node:crypto'
import fs from 'node:fs'
import { prisma } from './prisma'
import { runAsSystem } from './tenancy'
import type { PushPayload } from './push'

/**
 * Push notifications to the Metriq phone app (the native shell, mobile phase B).
 *
 * Android phones are reached through Google's Firebase Cloud Messaging (FCM). The key that lets
 * the server send is a "service account" file from the Firebase project. It lives ONLY on the
 * server, outside the code: FCM_SERVICE_ACCOUNT_FILE=/path/to/file.json in the server's .env
 * (or the whole JSON in FCM_SERVICE_ACCOUNT_JSON). Without it nothing is sent and nothing breaks.
 *
 * iPhones need Apple's push key (from the Apple Developer account); that sender is added when
 * the account exists. iPhone tokens are stored already, so nothing has to change in the app.
 */

interface ServiceAccount { project_id: string; client_email: string; private_key: string }
export interface NativeMessage { token: string; platform: string; payload: PushPayload; urgent: boolean; ttlSeconds: number }
/** ok: delivered to Google. gone: the app was removed or the token is dead (forget it). failed: try again another time. */
export type NativeResult = 'ok' | 'gone' | 'failed'
export type NativeSender = (m: NativeMessage) => Promise<NativeResult>

let account: ServiceAccount | null | undefined
function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account
  account = null
  try {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON || (process.env.FCM_SERVICE_ACCOUNT_FILE ? fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, 'utf8') : '')
    if (raw) {
      const j = JSON.parse(raw) as Partial<ServiceAccount>
      if (j.project_id && j.client_email && j.private_key) account = { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key }
      else console.warn('[native-push] the FCM service account is missing project_id, client_email or private_key')
    }
  } catch (e) {
    console.warn('[native-push] could not read the FCM service account:', (e as Error).message)
  }
  return account
}

/** Tests put a stub here, so nothing touches the network. */
let override: NativeSender | null = null
export function useNativeSenderForTests(fn: NativeSender | null): void { override = fn }

/** Can the server reach Android phones (is the FCM key set)? */
export const nativePushConfigured = (): boolean => !!override || !!serviceAccount()

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let access: { token: string; until: number } | null = null
/** Google's short-lived access token for the service account (kept until a minute before it ends). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (access && access.until > Date.now() + 60_000) return access.token
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Google sign-in for push failed (${res.status})`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  access = { token: j.access_token, until: Date.now() + j.expires_in * 1000 }
  return access.token
}

/** What goes to the phone. Everything in `data` is text: the app reads the address to open from it. */
export function fcmBody(m: NativeMessage): Record<string, unknown> {
  const p = m.payload
  const data: Record<string, string> = { kind: p.kind, url: p.url, tag: p.tag }
  if (p.type) data.type = p.type
  if (p.nid) data.nid = p.nid
  if (p.callId) data.callId = p.callId
  if (p.conversationId) data.conversationId = p.conversationId
  if (p.messageId) data.messageId = p.messageId
  return {
    message: {
      token: m.token,
      notification: { title: p.title, body: p.body },
      data,
      android: {
        priority: m.urgent ? 'HIGH' : 'NORMAL',
        ttl: `${Math.max(0, Math.round(m.ttlSeconds))}s`,
        // The same tag replaces the earlier notification (one per chat, one per call, one per alert).
        notification: { channel_id: 'metriq_alerts', tag: p.tag, default_sound: true },
      },
    },
  }
}

async function sendFcm(m: NativeMessage): Promise<NativeResult> {
  const sa = serviceAccount()
  if (!sa || m.platform !== 'android') return 'failed'
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmBody(m)),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return 'ok'
  // 404 UNREGISTERED: the app was removed. 400 with a bad token: the token is not a real one.
  if (res.status === 404) return 'gone'
  if (res.status === 400) {
    const text = await res.text().catch(() => '')
    if (/registration token|INVALID_ARGUMENT.*token/i.test(text)) return 'gone'
  }
  if (res.status === 401 || res.status === 403) access = null
  console.warn('[native-push] FCM answered', res.status)
  return 'failed'
}

/**
 * Send to every phone app of these people. Never throws; a token the phone gave up is forgotten.
 * Returns how many phones were reached.
 */
export async function sendNativePush(userIds: string[], payload: PushPayload, opts: { urgent?: boolean; ttlSeconds?: number } = {}): Promise<number> {
  const send = override ?? (serviceAccount() ? sendFcm : null)
  if (!send || !userIds.length) return 0
  try {
    // People of any company: this runs outside a signed-in request (schedulers) as well as inside one.
    const devices = await runAsSystem(() => prisma.pushDevice.findMany({ where: { userId: { in: userIds }, ...(override ? {} : { platform: 'android' }) } }))
    let sent = 0
    await Promise.all(devices.map(async (d) => {
      try {
        const r = await send({ token: d.token, platform: d.platform, payload, urgent: !!opts.urgent, ttlSeconds: opts.ttlSeconds ?? 3600 })
        if (r === 'ok') {
          sent++
          void runAsSystem(() => prisma.pushDevice.update({ where: { id: d.id }, data: { lastOkAt: new Date() } })).catch(() => undefined)
        } else if (r === 'gone') {
          await runAsSystem(() => prisma.pushDevice.deleteMany({ where: { id: d.id } })).catch(() => undefined)
        }
      } catch (e) {
        console.warn('[native-push] send failed', (e as Error).message)
      }
    }))
    return sent
  } catch (e) {
    console.warn('[native-push] failed', (e as Error).message)
    return 0
  }
}
