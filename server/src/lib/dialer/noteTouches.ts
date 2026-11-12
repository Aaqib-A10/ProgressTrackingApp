/**
 * Touch counting with notes, and follow-ups that close themselves (ITAD update 12 Nov 2026, section 4).
 * Pure functions, no database: tested in noteTouches.test.ts against every bullet of the section.
 *
 *  - A contact by the agent is the lead owner's own note (any source: Earth Zone, Metriq, Claude), and, when
 *    `manualTouchesCount` is on, their own logged call (an outcome chip or Add touch). A colleague's note never
 *    counts, so it never resets the lead's clock.
 *  - Two contacts on the same day count as one touch.
 *  - Last touched = the latest contact. Updated At is only the fallback for leads with no contacts.
 *  - Tries, same status = contact days after the status last changed.
 *  - A follow-up closes by itself when the agent made contact after it was created (or reopened):
 *      own note or own logged call;
 *      a status change (import or by the agent), but not for Pipeline and Interested leads, which need a note;
 *      for a lead with no notes, new activity from Earth Zone (a re-attempt the import found: assignment batches
 *      and bulk date changes are already left out there).
 */

export interface ContactNote { userId: string | null; at: Date; source: string }
export interface ContactTouch { userId: string | null; at: Date; source: string; kind: string }
export interface Contact { at: Date; day: string; what: 'NOTE' | 'CALL'; source: string }

const PKT_MS = 5 * 3600_000
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The work day of a contact. An Earth Zone note only has a date, which is taken as written. Anything logged in
 * Metriq belongs to the agent's shift day, which starts at noon Pakistan time, so a night shift is one day.
 */
export function contactDay(at: Date, source: string): string {
  if (source === 'EARTHZONE') return iso(at)
  return iso(new Date(at.getTime() + PKT_MS - 12 * 3600_000))
}

/** The agent's own contacts on a lead, oldest first. */
export function agentContacts(ownerId: string, notes: ContactNote[], touches: ContactTouch[], manualTouchesCount = true): Contact[] {
  const out: Contact[] = []
  for (const n of notes) if (n.userId === ownerId) out.push({ at: n.at, day: contactDay(n.at, n.source), what: 'NOTE', source: n.source })
  if (manualTouchesCount) for (const t of touches) if (t.source === 'MANUAL' && t.userId === ownerId) out.push({ at: t.at, day: contactDay(t.at, 'METRIQ'), what: 'CALL', source: 'METRIQ' })
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

export interface NoteTouchStats {
  /** The latest contact (null: the lead has none, Updated At is used). */
  lastContactAt: Date | null
  /** Distinct contact days. */
  days: number
  /** Distinct contact days after the status last changed ("4 tries, same status"). */
  tries: number
}

/** `since`: when the status last changed (ms); 0 = every contact counts (the status is the first one Metriq saw). */
export function noteTouchStats(contacts: Contact[], since: number): NoteTouchStats {
  if (!contacts.length) return { lastContactAt: null, days: 0, tries: 0 }
  const days = new Set<string>()
  const triesDays = new Set<string>()
  let last: Contact = contacts[0]
  for (const c of contacts) {
    days.add(c.day)
    if (c.at.getTime() > since) triesDays.add(c.day)
    if (c.at.getTime() >= last.at.getTime()) last = c
  }
  return { lastContactAt: last.at, days: days.size, tries: triesDays.size }
}

/**
 * Did this contact come after the follow-up? An Earth Zone date has no time and is a US calendar date, so it is
 * compared with the follow-up's own calendar date (UTC, within hours of US time): a note dated that day counts.
 */
const after = (c: { at: Date; source: string }, since: Date): boolean =>
  c.source === 'EARTHZONE' ? iso(c.at) >= iso(since) : c.at.getTime() > since.getTime()

export interface StatusChangeLite { at: Date; fromStatus?: string | null; toStatus: string; byOwner: boolean }
export interface ImportTouchLite { at: Date; kind: string }

export interface AutoCloseInput {
  /** When the follow-up was created, or reopened. */
  since: Date
  leadStatus: string
  contacts: Contact[]
  /** Status changes by an import or by the agent (a manager's change is left out by the caller). */
  statusChanges: StatusChangeLite[]
  /** Touches an import found (status change or re-attempt). */
  importTouches: ImportTouchLite[]
  /** Statuses where a status change alone does not close a follow-up. */
  noteOnly?: string[]
}

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const SOURCE_LABEL: Record<string, string> = { EARTHZONE: 'Earth Zone', CLAUDE: 'Claude', METRIQ: 'Metriq' }

/** The first contact by the agent that closes this follow-up, as a short line for Task history; null = still open. */
export function autoCloseBy(i: AutoCloseInput): { at: Date; text: string } | null {
  const found: { at: Date; text: string }[] = []
  const c = i.contacts.find((x) => after(x, i.since))
  if (c) found.push({ at: c.at, text: c.what === 'NOTE' ? `Note on ${fmt(c.at)} (${SOURCE_LABEL[c.source] ?? c.source})` : `Call logged on ${fmt(c.at)}` })
  // A status change closes it, unless the lead was a Pipeline or Interested lead when it changed: those need the
  // agent's own note (a status moved in Earth Zone alone does not show the agent reached them).
  const noteOnly = i.noteOnly ?? ['Pipeline', 'Interested']
  const s = i.statusChanges
    .filter((x) => x.byOwner && x.at.getTime() > i.since.getTime() && !noteOnly.includes(x.fromStatus ?? i.leadStatus))
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
  if (s) found.push({ at: s.at, text: `Status changed to ${s.toStatus} on ${fmt(s.at)}` })
  // A lead with no notes at all: new activity in Earth Zone (Updated At moved) is the agent's contact.
  if (!i.contacts.some((x) => x.what === 'NOTE')) {
    const t = i.importTouches.filter((x) => x.kind === 'RE_ATTEMPT' && x.at.getTime() > i.since.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0]
    if (t) found.push({ at: t.at, text: `New activity in Earth Zone on ${fmt(t.at)}` })
  }
  return found.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
}
