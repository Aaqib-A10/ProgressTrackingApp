import { prisma } from './prisma'

/**
 * Notifications on WhatsApp (plan 2026-11, 2.6), through Meta's WhatsApp Cloud API. A person turns it on in
 * Settings and gives their number; every bell notification they have not muted is then also sent there.
 *
 * It only works once the server has an account: WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in the server's .env, and an
 * approved message template (WHATSAPP_TEMPLATE, default "metriq_alert") whose body has two variables: the title
 * and the text. Without them nothing is sent and Settings says WhatsApp is not set up yet.
 */

const token = () => process.env.WHATSAPP_TOKEN || ''
const phoneId = () => process.env.WHATSAPP_PHONE_ID || ''
export const whatsappReady = (): boolean => !!token() && !!phoneId()

/** Digits only, with the country code ("+92 300 1234567" → "923001234567"). Null when it cannot be a number. */
export function cleanNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '').replace(/^00/, '')
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** At most this many messages to one person in a day: a busy day must not become a bill. */
export const DAILY_CAP = 40
const sentToday = new Map<string, { day: string; n: number }>()
export function underCap(userId: string, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10)
  const s = sentToday.get(userId)
  if (!s || s.day !== day) { sentToday.set(userId, { day, n: 1 }); return true }
  if (s.n >= DAILY_CAP) return false
  s.n++
  return true
}

/** What was sent in tests (nothing leaves the machine there). */
export const whatsappLog: { to: string; title: string; body: string }[] = []

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

/** Send one template message. Returns whether Meta accepted it. Never throws. */
export async function sendWhatsApp(to: string, title: string, body: string, doFetch: Fetch = fetch as unknown as Fetch): Promise<boolean> {
  const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max) || '-' // a template variable may not be empty or hold line breaks
  if (process.env.NODE_ENV === 'test' && doFetch === (fetch as unknown as Fetch)) { whatsappLog.push({ to, title, body }); return true }
  if (!whatsappReady()) return false
  try {
    const res = await doFetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v20.0'}/${phoneId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE || 'metriq_alert',
          language: { code: process.env.WHATSAPP_LANG || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: clean(title, 120) }, { type: 'text', text: clean(body, 400) }] }],
        },
      }),
    })
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error('[whatsapp] not accepted', res.status, (await res.text().catch(() => '')).slice(0, 300))
      return false
    }
    return true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] send failed:', e instanceof Error ? e.message : e)
    return false
  }
}

/** Send a notification to the people who asked for WhatsApp. The caller has already left out muted categories. */
export async function whatsappNotify(rows: { userId: string; title: string; body: string }[]): Promise<number> {
  if (!rows.length || (process.env.NODE_ENV !== 'test' && !whatsappReady())) return 0
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] }, whatsappOn: true, whatsappNumber: { not: null }, isActive: true }, select: { id: true, whatsappNumber: true } })
  const numbers = new Map(people.map((p) => [p.id, p.whatsappNumber!]))
  let sent = 0
  for (const r of rows) {
    const to = numbers.get(r.userId)
    if (!to || !underCap(r.userId)) continue
    if (await sendWhatsApp(to, r.title, r.body)) sent++
  }
  return sent
}
