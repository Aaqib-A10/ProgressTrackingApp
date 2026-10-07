import type { NotificationType } from '@prisma/client'
import { DateTime } from 'luxon'
import { prisma } from '../prisma'
import { sendMail } from '../mail'
import { COMPANY_TZ } from '../time'

/**
 * Notification fan out for the Projects module: one in-app Notification row per
 * recipient (shown in the top bar bell) plus an optional email, gated by the
 * recipient's PmNotifyPref. Always de-duplicated and never notifies the actor
 * about their own action. Best effort: failures are logged, never thrown into
 * the request that triggered them.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/** Default email preferences (a missing row means these). */
export const DEFAULT_PREFS = { emailAssigned: true, emailMention: true, emailComment: false, emailDueSoon: true }

export type EmailPrefKey = 'emailAssigned' | 'emailMention' | 'emailComment' | 'emailDueSoon' | 'always'

export interface PmNotifyInput {
  userIds: (string | null | undefined)[]
  actorId?: string | null
  type: NotificationType
  title: string
  body: string
  link: string
  taskId?: string
  /** Which preference gates the email. 'always' = cannot be turned off (overdue). Omit for in-app only. */
  email?: { pref: EmailPrefKey; subject: string; heading: string; lines: string[]; cta: string }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const trunc = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** "7 Oct, 6:00 PM" in the company timezone. */
export function fmtDue(d: Date | null | undefined): string {
  if (!d) return ''
  return DateTime.fromJSDate(d).setZone(COMPANY_TZ).toFormat('d LLL, h:mm a')
}

/** "2 hours", "3 days" (rounded down, min 1 minute). */
export function fmtDuration(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60000))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

export function taskLink(projectKey: string, code: string): string {
  return `/app/projects/${encodeURIComponent(projectKey)}?task=${encodeURIComponent(code)}`
}

function emailHtml(heading: string, lines: string[], href: string, cta: string): string {
  const body = lines.map((l) => `<p style="font-size:14px;line-height:1.5;margin:6px 0">${esc(l)}</p>`).join('')
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
    <div style="padding:16px 0"><strong style="font-size:18px">PulseTrack Projects</strong></div>
    <h1 style="font-size:19px;margin:8px 0">${esc(heading)}</h1>
    ${body}
    <a href="${href}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin:14px 0">${esc(cta)}</a>
    <p style="color:#64748B;font-size:12px;margin-top:24px">You can change which project emails you get under Projects, Notification settings: <a href="${APP_URL}/app/projects?settings=notifications" style="color:#64748B">${APP_URL}/app/projects</a></p>
  </div>`
}

export async function pmNotify(input: PmNotifyInput): Promise<string[]> {
  const recipients = [...new Set(input.userIds.filter((x): x is string => !!x))].filter((id) => id !== input.actorId)
  if (!recipients.length) return []
  try {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: input.type,
        actorId: input.actorId ?? null,
        title: input.title,
        body: input.body,
        link: input.link,
        entityType: input.taskId ? 'PmTask' : null,
        entityId: input.taskId ?? null,
      })),
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pm-notify] in-app failed:', e)
  }

  if (input.email) {
    const em = input.email
    void (async () => {
      const users = await prisma.user.findMany({
        where: { id: { in: recipients }, isActive: true },
        select: { id: true, email: true, name: true, pmNotifyPref: true },
      })
      const href = `${APP_URL}${input.link}`
      for (const u of users) {
        const pref = u.pmNotifyPref ?? DEFAULT_PREFS
        const allowed = em.pref === 'always' || pref[em.pref] === true
        if (!allowed) continue
        const lines = [`Hi ${u.name},`, ...em.lines]
        await sendMail({
          to: u.email,
          subject: em.subject,
          html: emailHtml(em.heading, lines, href, em.cta),
          text: [...lines, '', href].join('\n'),
        })
      }
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[pm-notify] email failed:', e)
    })
  }
  return recipients
}
