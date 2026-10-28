export type Person = { name?: string; email: string; department?: string; role: 'MEMBER' | 'TEAM_LEAD' }

/** People from pasted lines or a CSV: "email" or "name, email, department, role" (a header row is fine). */
export function parsePeople(text: string): Person[] {
  const out: Person[] = []
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''))
    const email = cells.find((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))
    if (!email) continue
    const others = cells.filter((c) => c && c !== email)
    const role = others.find((c) => /^(team lead|lead|tl|team_lead)$/i.test(c)) ? 'TEAM_LEAD' : 'MEMBER'
    const rest = others.filter((c) => !/^(team lead|lead|tl|team_lead|member)$/i.test(c))
    out.push({ email: email.toLowerCase(), name: rest[0], department: rest[1], role })
  }
  return out
}
