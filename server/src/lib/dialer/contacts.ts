import { prisma } from '../prisma'
import { findContacts } from './ezNotes'

/**
 * A note that names a new person with an email, phone or LinkedIn link (a purchasing manager a colleague added,
 * say) offers that person as a second contact on the lead, for the agent to accept or ignore (ITAD update
 * 12 Nov, section 2). The lead's own details are left out; the same person found again is offered once
 * (and never again once accepted or ignored).
 */
export async function suggestContactsFromNote(
  lead: { id: string; email: string | null; email2: string | null; phone: string | null; phone2: string | null; altPhones: string[]; linkedin: string | null },
  note: { id: string; text: string },
): Promise<number> {
  const found = findContacts(note.text, [lead.email, lead.email2, lead.phone, lead.phone2, ...lead.altPhones, lead.linkedin])
  if (!found.length) return 0
  const r = await prisma.dialerContact.createMany({
    data: found.map((c) => ({ leadId: lead.id, name: c.name, title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin, noteId: note.id, key: c.key })),
    skipDuplicates: true,
  })
  return r.count
}

export const contactView = (c: { id: string; name: string | null; title: string | null; email: string | null; phone: string | null; linkedin: string | null; state: string; noteId: string | null; createdAt: Date }) => ({
  id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin, state: c.state, noteId: c.noteId, createdAt: c.createdAt.toISOString(),
})
