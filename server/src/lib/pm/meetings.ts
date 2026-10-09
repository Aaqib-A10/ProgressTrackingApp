import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from '../prisma'
import { COMPANY_TZ } from '../time'
import { pmNotify } from './pmNotify'

/**
 * Scheduled meetings: helpers + the reminder that goes out 10 minutes before.
 * Each meeting (or repeating series) has its own group chat; starting a call in that
 * chat is "joining the meeting", and it rings everyone in it.
 */

export const REMINDER_MIN = 10

/** "Fri 10 Oct, 3:00 PM" (company time zone). */
export function fmtWhen(d: Date): string {
  return DateTime.fromJSDate(d).setZone(COMPANY_TZ).toFormat('ccc d LLL, h:mm a')
}

/** "3:00 PM to 3:30 PM" or across days. */
export function fmtRange(a: Date, b: Date): string {
  const x = DateTime.fromJSDate(a).setZone(COMPANY_TZ)
  const y = DateTime.fromJSDate(b).setZone(COMPANY_TZ)
  return x.hasSame(y, 'day') ? `${x.toFormat('ccc d LLL, h:mm a')} to ${y.toFormat('h:mm a')}` : `${x.toFormat('ccc d LLL, h:mm a')} to ${y.toFormat('ccc d LLL, h:mm a')}`
}

export const meetingLink = (id: string) => `/app/meetings/${encodeURIComponent(id)}`

/** Which meeting a call in this chat belongs to (the one happening around now). */
export async function meetingFor(conversationId: string, now = new Date()): Promise<string | null> {
  const list = await prisma.meeting.findMany({
    where: { conversationId, cancelledAt: null, startsAt: { lte: new Date(now.getTime() + 60 * 60_000) }, endsAt: { gte: new Date(now.getTime() - 3 * 3600_000) } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true },
  })
  if (!list.length) return null
  // Closest start time to now.
  return list.reduce((best, m) => (Math.abs(m.startsAt.getTime() - now.getTime()) < Math.abs(best.startsAt.getTime() - now.getTime()) ? m : best)).id
}

/** Start times for a repeating meeting (max 52 occurrences). */
export function occurrences(start: Date, repeat: 'none' | 'daily' | 'weekdays' | 'weekly', count: number): Date[] {
  const n = repeat === 'none' ? 1 : Math.min(Math.max(count, 1), 52)
  const out: Date[] = []
  let d = DateTime.fromJSDate(start).setZone(COMPANY_TZ)
  while (out.length < n) {
    if (repeat !== 'weekdays' || d.weekday <= 5) out.push(d.toJSDate())
    d = repeat === 'weekly' ? d.plus({ weeks: 1 }) : d.plus({ days: 1 })
  }
  return out
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)

/** An .ics file so people can add the meeting to Outlook or Google Calendar. */
export function buildIcs(m: { id: string; title: string; agenda: string; startsAt: Date; endsAt: Date; organizer: { name: string; email: string }; attendees: { name: string; email: string }[]; cancelled: boolean; url: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PulseTrack//Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${m.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${m.id}@pulsetrack`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.startsAt)}`,
    `DTEND:${icsDate(m.endsAt)}`,
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText(`${m.agenda ? m.agenda + '\n\n' : ''}Join in PulseTrack: ${m.url}`)}`,
    `URL:${m.url}`,
    `LOCATION:${icsText('PulseTrack meeting')}`,
    `ORGANIZER;CN=${icsText(m.organizer.name)}:mailto:${m.organizer.email}`,
    ...m.attendees.map((a) => `ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT:mailto:${a.email}`),
    `STATUS:${m.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(m.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // Lines longer than 75 octets must be folded.
  return lines.map((l) => (l.length > 74 ? l.match(/.{1,73}/g)!.join('\r\n ') : l)).join('\r\n') + '\r\n'
}

/** Send the "starts in 10 minutes" reminder once per meeting. */
export async function runMeetingReminders(now = new Date()): Promise<number> {
  const due = await prisma.meeting.findMany({
    where: { cancelledAt: null, reminderSentAt: null, startsAt: { gt: new Date(now.getTime() - 60_000), lte: new Date(now.getTime() + REMINDER_MIN * 60_000) } },
    include: { attendees: { select: { userId: true, response: true } } },
    take: 200,
  })
  let sent = 0
  for (const m of due) {
    const claim = await prisma.meeting.updateMany({ where: { id: m.id, reminderSentAt: null }, data: { reminderSentAt: now } })
    if (!claim.count) continue
    const mins = Math.max(1, Math.round((m.startsAt.getTime() - now.getTime()) / 60_000))
    const people = [m.organizerId, ...m.attendees.filter((a) => a.response !== 'DECLINED').map((a) => a.userId)]
    await pmNotify({
      userIds: people,
      type: 'MEETING',
      title: `Starts in ${mins} min: ${m.title}`,
      body: `${fmtWhen(m.startsAt)}. Open the meeting to join.`,
      link: meetingLink(m.id),
    })
    sent++
  }
  return sent
}

export function startMeetingReminders(): void {
  cron.schedule('* * * * *', () => {
    runMeetingReminders().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[meetings] reminder tick failed:', e)
    })
  })
  // eslint-disable-next-line no-console
  console.log(`[meetings] reminders started (${REMINDER_MIN} min before each meeting)`)
}
