import { inAudit } from './health/auditContext'

// Best-effort transactional email through Mailtrap (Email API, transactional stream).
// Never throws into request flow: if MAILTRAP_API_TOKEN is unset or the send fails, we log
// and continue. The "from" address must be on the domain verified in Mailtrap
// (pulsetrack.online).

const MAILTRAP_API_TOKEN = process.env.MAILTRAP_API_TOKEN
const FROM = process.env.MAIL_FROM || 'PulseTrack <noreply@pulsetrack.online>'
const REPLY_TO = process.env.MAIL_REPLY_TO || 'noreply@pulsetrack.online'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

interface SendOpts {
  to: string | string[]
  subject: string
  html: string
  text: string // plain-text alternative — improves inbox placement vs HTML-only
  /** Groups emails in Mailtrap's stats (e.g. "Invite", "Attendance"). */
  category?: string
}

/** "PulseTrack <noreply@pulsetrack.online>" -> { name, email } */
export function parseAddress(raw: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<\s*([^>\s]+)\s*>\s*$/.exec(raw)
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { email: m[2] }
  return { email: raw.trim() }
}

export async function sendMail({ to, subject, html, text, category }: SendOpts): Promise<void> {
  if (inAudit()) return // the self check's test requests never send email
  if (!MAILTRAP_API_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn('[mail] MAILTRAP_API_TOKEN not set — skipping email')
    return
  }
  try {
    const res = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MAILTRAP_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: parseAddress(FROM),
        to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })),
        reply_to: parseAddress(REPLY_TO),
        subject,
        text,
        html,
        category: (category || 'PulseTrack').slice(0, 255),
      }),
    })
    const bodyText = await res.text().catch(() => '')
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error('[mail] Mailtrap error', res.status, bodyText.slice(0, 500))
      return
    }
    // Don't log the recipient address (PII/data-minimization); the message id is enough to trace.
    // eslint-disable-next-line no-console
    console.log('[mail] sent -', bodyText.slice(0, 200))
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] send failed:', e)
  }
}

const shell = (title: string, body: string) => `
  <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
    <div style="display:flex;align-items:center;gap:8px;padding:16px 0">
      <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#4F46E5"></span>
      <strong style="font-size:18px">Metriq</strong>
    </div>
    <h1 style="font-size:20px;margin:8px 0">${title}</h1>
    ${body}
    <p style="color:#64748B;font-size:12px;margin-top:24px">If you didn't expect this email, you can ignore it.</p>
  </div>`

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin:12px 0">${label}</a>`

/** Invite an employee/lead to set their password and join. */
export function sendInviteEmail(opts: { to: string; name: string; token: string; inviterName?: string; tempPassword?: string }): Promise<void> {
  const link = `${APP_URL}/reset-password?token=${encodeURIComponent(opts.token)}`
  const intro = opts.inviterName ? `${opts.inviterName} has added you to Metriq.` : 'You have been added to Metriq.'
  const tempLine = opts.tempPassword
    ? `<p style="color:#64748B;font-size:13px">Or log in with a temporary password: <code style="background:#F1F5F9;padding:2px 6px;border-radius:4px">${opts.tempPassword}</code></p>`
    : ''
  const html = shell(
    `Welcome, ${opts.name}!`,
    `<p style="font-size:14px;line-height:1.5">${intro} Click below to set your password and get started.</p>${button(link, 'Set password & join')}${tempLine}<p style="font-size:13px;color:#64748B">This link is valid for 7 days.</p>`,
  )
  const text = [
    `Welcome, ${opts.name}!`,
    '',
    `${intro} Set your password and get started:`,
    link,
    opts.tempPassword ? `\nOr log in with a temporary password: ${opts.tempPassword}` : '',
    '',
    'This link is valid for 7 days. If you didn\'t expect this email, you can ignore it.',
  ].filter((l) => l !== '').join('\n')
  return sendMail({ to: opts.to, subject: 'You are invited to Metriq', html, text, category: 'Invite' })
}

/** Remind an employee to check in or check out. Best-effort (no-ops without a key). */
export function sendAttendanceReminderEmail(opts: {
  to: string
  name: string
  kind: 'CHECK_IN' | 'CHECK_OUT'
  shiftLabel: string
}): Promise<void> {
  const isIn = opts.kind === 'CHECK_IN'
  const link = `${APP_URL}/app/attendance/me`
  const title = isIn ? `Don't forget to check in` : `Remember to check out`
  const line = isIn
    ? `Your shift (${opts.shiftLabel}) has started and we haven't seen your check-in yet. Tap below to clock in.`
    : `Your shift (${opts.shiftLabel}) has ended and you're still clocked in. Tap below to check out.`
  const html = shell(
    `Hi ${opts.name},`,
    `<p style="font-size:14px;line-height:1.5">${line}</p>${button(link, isIn ? 'Check in now' : 'Check out now')}`,
  )
  const text = [`Hi ${opts.name},`, '', line, link].join('\n')
  return sendMail({ to: opts.to, subject: isIn ? 'Reminder: check in for your shift' : 'Reminder: check out of your shift', html, text, category: 'Attendance' })
}

/** Notify an assignee that a marketing board task was assigned to them. */
export function sendTaskAssignedEmail(opts: { to: string; name: string; taskTitle: string; taskId: string; assignerName: string; dueLabel?: string | null }): Promise<void> {
  const link = `${APP_URL}/app/marketing/board?task=${encodeURIComponent(opts.taskId)}`
  const dueLine = opts.dueLabel ? `<p style="font-size:13px;color:#64748B">Due: ${opts.dueLabel}</p>` : ''
  const html = shell(
    `Hi ${opts.name},`,
    `<p style="font-size:14px;line-height:1.5">${opts.assignerName} assigned you a task: <strong>${opts.taskTitle}</strong>.</p>${dueLine}${button(link, 'Open the task')}`,
  )
  const text = [`Hi ${opts.name},`, '', `${opts.assignerName} assigned you a task: ${opts.taskTitle}`, opts.dueLabel ? `Due: ${opts.dueLabel}` : '', link].filter((l) => l !== '').join('\n')
  return sendMail({ to: opts.to, subject: `New task assigned: ${opts.taskTitle}`, html, text, category: 'Tasks' })
}

/** Remind an assignee that an urgent task is due within the hour. */
export function sendTaskDueSoonEmail(opts: { to: string; name: string; taskTitle: string; taskId: string; dueLabel: string }): Promise<void> {
  const link = `${APP_URL}/app/marketing/board?task=${encodeURIComponent(opts.taskId)}`
  const html = shell(
    `Hi ${opts.name},`,
    `<p style="font-size:14px;line-height:1.5">Your urgent task <strong>${opts.taskTitle}</strong> is due at <strong>${opts.dueLabel}</strong> — within the hour.</p>${button(link, 'Open the task')}`,
  )
  const text = [`Hi ${opts.name},`, '', `Your urgent task "${opts.taskTitle}" is due at ${opts.dueLabel} (within the hour).`, link].join('\n')
  return sendMail({ to: opts.to, subject: `Due soon: ${opts.taskTitle}`, html, text, category: 'Tasks' })
}

/** Confirm the email of someone who signed up on their own (Phase 1, step 7). */
export function sendVerifyEmail(opts: { to: string; name: string; token: string }): Promise<void> {
  const link = `${APP_URL}/verify-email?token=${encodeURIComponent(opts.token)}`
  const html = shell(`Confirm your email, ${opts.name}`, `<p style="font-size:14px;line-height:1.5">One click and your Metriq is ready to invite your people.</p>${button(link, 'Confirm my email')}<p style="font-size:13px;color:#64748B">This link is valid for 3 days.</p>`)
  const text = [`Confirm your email, ${opts.name}`, '', 'One click and your Metriq is ready to invite your people:', link, '', 'This link is valid for 3 days.'].join('\n')
  return sendMail({ to: opts.to, subject: 'Confirm your email for Metriq', html, text, category: 'Sign up' })
}

/** The address of the app (links in emails, sign-in pages). */
export const appUrl = (): string => APP_URL
