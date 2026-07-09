// Best-effort transactional email via Resend. Never throws into request flow —
// if RESEND_API_KEY is unset or the send fails, we log and continue.

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.MAIL_FROM || 'PulseTrack <noreply@pulsetrack.online>'
const REPLY_TO = process.env.MAIL_REPLY_TO || 'noreply@pulsetrack.online'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

interface SendOpts {
  to: string | string[]
  subject: string
  html: string
  text: string // plain-text alternative — improves inbox placement vs HTML-only
}

export async function sendMail({ to, subject, html, text }: SendOpts): Promise<void> {
  if (!RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[mail] RESEND_API_KEY not set — skipping email to', to)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html, text, reply_to: REPLY_TO }),
    })
    const bodyText = await res.text().catch(() => '')
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error('[mail] Resend error', res.status, bodyText)
      return
    }
    // eslint-disable-next-line no-console
    console.log('[mail] sent to', to, '-', bodyText)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] send failed:', e)
  }
}

const shell = (title: string, body: string) => `
  <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
    <div style="display:flex;align-items:center;gap:8px;padding:16px 0">
      <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#4F46E5"></span>
      <strong style="font-size:18px">PulseTrack</strong>
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
  const intro = opts.inviterName ? `${opts.inviterName} has added you to PulseTrack.` : 'You have been added to PulseTrack.'
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
  return sendMail({ to: opts.to, subject: 'You are invited to PulseTrack', html, text })
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
  return sendMail({ to: opts.to, subject: isIn ? 'Reminder: check in for your shift' : 'Reminder: check out of your shift', html, text })
}
