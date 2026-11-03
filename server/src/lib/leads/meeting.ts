import { DateTime } from 'luxon'
import { sendMail, appUrl } from '../mail'
import { threeTimes } from './pipeline'

/**
 * The meeting invite (step 7 of the flow): a calendar file (.ics) that opens in Outlook, Teams
 * and Google Calendar, with the three times written out in the body, sent to the prospect, Jesse
 * and the copy address (Aaqib). The Teams link is pasted by the SDR until the Microsoft keys arrive.
 */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const stamp = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'")

export function buildIcs(opts: { uid: string; title: string; description: string; startsAt: Date; minutes: number; organizerEmail: string; organizerName: string; attendees: { email: string; name: string }[]; location?: string }): string {
  const end = new Date(opts.startsAt.getTime() + opts.minutes * 60_000)
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Metriq//CMR//EN', 'METHOD:REQUEST', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(opts.startsAt)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(opts.title)}`, `DESCRIPTION:${esc(opts.description)}`,
    ...(opts.location ? [`LOCATION:${esc(opts.location)}`] : []),
    `ORGANIZER;CN=${esc(opts.organizerName)}:mailto:${opts.organizerEmail}`,
    ...opts.attendees.map((a) => `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    'STATUS:CONFIRMED', 'SEQUENCE:0',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  // Folded at 75 bytes as the standard asks.
  return lines.map((l) => l.replace(/(.{73})(?=.)/g, '$1\r\n ')).join('\r\n') + '\r\n'
}

export async function sendMeetingInvite(opts: {
  leadId: string; company: string; contact: string | null; prospectEmail: string; prospectZone: string; business: string
  at: Date; minutes: number; link: string | null
  sdr: { name: string; email: string }; head: { name: string; email: string } | null; copy: { name: string; email: string } | null
}): Promise<{ to: string[]; times: ReturnType<typeof threeTimes> }> {
  const times = threeTimes(opts.at, opts.prospectZone)
  const title = `${opts.business} × ${opts.company}: alkaline battery recycling`
  const who = [opts.head ? `${opts.head.name} (${opts.business})` : opts.business, opts.contact ? `${opts.contact} (${opts.company})` : opts.company].join(' and ')
  const description = [
    `A short call between ${who} about ${opts.business} buying ${opts.company}'s sorted alkaline batteries.`,
    '',
    `When: ${times.prospect} (your time)`,
    `       ${times.phoenix} (Phoenix)`,
    `       ${times.pacific} (Pacific)`,
    opts.link ? `Join: ${opts.link}` : `Join: a Teams link follows from ${opts.business}.`,
    '',
    `Set up by ${opts.sdr.name}, ${opts.business}.`,
  ].join('\n')
  const attendees = [{ email: opts.prospectEmail, name: opts.contact || opts.company }, ...(opts.head ? [opts.head] : []), ...(opts.copy?.email ? [opts.copy] : [])]
  const ics = buildIcs({ uid: `cmr-${opts.leadId}-${opts.at.getTime()}@metriq`, title, description, startsAt: opts.at, minutes: opts.minutes, organizerEmail: opts.sdr.email, organizerName: opts.sdr.name, attendees, location: opts.link ?? undefined })
  const to = attendees.map((a) => a.email)
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#0F172A"><h2 style="font-size:18px">${title}</h2><p>${description.replace(/\n/g, '<br>')}</p><p style="color:#64748B;font-size:12px">The calendar invite is attached. Sent from Metriq (${appUrl()}).</p></div>`
  await sendMail({ to, subject: title, html, text: description, category: 'Lead meeting', replyTo: opts.sdr.email, attachments: [{ filename: 'invite.ics', type: 'text/calendar; method=REQUEST', content: Buffer.from(ics, 'utf8').toString('base64') }] })
  return { to, times }
}
