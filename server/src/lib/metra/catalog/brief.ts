import { DateTime } from 'luxon'
import type { Role } from '@prisma/client'
import type { Asker } from '../access'
import { ENTRIES, ctxOf, entriesFor } from './index'

/**
 * "Your day" (docs/metra/ROADMAP.md phase 4): a short brief for anyone, made from their own data sets with no model
 * involved, so it can never say something the screens do not. Today's meetings, what is due, their to-dos, a holiday,
 * what is overdue from before, and one line from each data set of their own team that has something to say (stock
 * that ran out, requests waiting, who is off). Nothing to say means no brief.
 *
 * ITAD agents keep their shift brief (lib/metra/insights.ts); this one is for everybody else.
 */
export async function dayBrief(a: Asker, me: { id: string; role: Role; name: string }, now = new Date()): Promise<{ text: string; lines: string[] } | null> {
  const ctx = ctxOf(a, me, now)
  const lines: string[] = []
  const calendar = ENTRIES.find((e) => e.key === 'calendar.my')
  const today = await calendar?.load?.(ctx, { from: ctx.today, to: ctx.today }).catch(() => null)
  if (today && !('error' in today)) {
    const of = (...kinds: string[]) => today.rows.filter((r) => kinds.includes(String(r.kind)))
    const holiday = of('Holiday')
    if (holiday.length) lines.push(`Today is a holiday: ${holiday.map((r) => r.title).join(', ')}.`)
    const off = of('Leave', 'Day off', 'Work from home')
    if (off.length) lines.push(`You are marked: ${off.map((r) => String(r.kind).toLowerCase()).join(', ')}.`)
    const meetings = of('Meeting')
    if (meetings.length) lines.push(`${meetings.length === 1 ? 'Meeting' : 'Meetings'} today: ${meetings.map((r) => `${r.title} (${r.time})`).join('; ')}.`)
    const due = of('Task due', 'Personal to-do due', 'Deadline from a meeting note')
    if (due.length) lines.push(`Due today: ${due.map((r) => r.title).join('; ')}.`)
    const todos = of('To-do')
    const open = todos.filter((r) => !String(r.detail ?? '').split('; ').includes('done'))
    if (todos.length) lines.push(`To-dos for today: ${todos.length}${open.length < todos.length ? `, ${todos.length - open.length} done` : ''}${open.length ? `; still to do: ${open.slice(0, 6).map((r) => r.title).join('; ')}${open.length > 6 ? ` and ${open.length - 6} more` : ''}` : ''}.`)
    const overdue = (today.head ?? []).find((h) => h.startsWith('Also still overdue'))
    if (overdue) lines.push(overdue.replace('Also still overdue from before these days', 'Overdue from before'))
  }
  // One line from each data set that is this person's own team's and has something to say.
  for (const e of entriesFor(a)) {
    if (!e.brief || !e.load || !e.pin?.(a)) continue
    const d = await e.load(ctx, {}).catch(() => null)
    if (!d || 'error' in d) continue
    const line = e.brief(d.rows, ctx)
    if (line) lines.push(line)
  }
  if (!lines.length) return null
  const day = DateTime.fromISO(ctx.today).toFormat('cccc d LLLL')
  return { lines, text: [`Hello ${me.name.trim().split(/\s+/)[0]}. Your day, ${day}:`, ...lines.map((l) => `- ${l}`)].join('\n') }
}
