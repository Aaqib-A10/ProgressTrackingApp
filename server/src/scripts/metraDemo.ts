import { prisma } from '../lib/prisma'
import { runAsCompany } from '../lib/tenancy'
import { HOME_COMPANY_ID } from '../lib/company'

/**
 * Demo records for trying Metra on a local database (docs/metra/DESIGN.md §8). Everything it adds is marked "Demo"
 * so it can be removed again. Uses the company's real people: two ITAD members, the ITAD team lead, a Lead Gen
 * member and a Super Admin. Never run against production.
 *
 *   npx tsx src/scripts/metraDemo.ts            add the demo records (and print who is who, for the eval)
 *   npx tsx src/scripts/metraDemo.ts --remove   remove them
 */

const DEMO = 'Demo '
const ago = (days: number, hour = 15) => { const d = new Date(Date.now() - days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d }

async function people() {
  const itad = await prisma.user.findMany({ where: { isActive: true, role: 'MEMBER', department: { type: 'ITAD' } }, take: 2, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true } })
  const lead = await prisma.user.findFirst({ where: { isActive: true, role: 'TEAM_LEAD', department: { type: 'ITAD' } }, select: { id: true, name: true, email: true } })
  const lg = await prisma.user.findFirst({ where: { isActive: true, department: { type: 'LEAD_GEN' } }, select: { id: true, name: true, email: true } })
  const sa = await prisma.user.findFirst({ where: { isActive: true, role: 'SUPER_ADMIN' }, select: { id: true, name: true, email: true } })
  if (itad.length < 2 || !lead || !lg || !sa) throw new Error('Needs two active ITAD members, an ITAD team lead, a Lead Gen member and a Super Admin in this company.')
  return { agent: itad[0], other: itad[1], lead, leadgen: lg, admin: sa }
}

async function remove() {
  await prisma.dialerLead.deleteMany({ where: { company: { startsWith: DEMO } } })
  await prisma.chatConversation.deleteMany({ where: { name: { startsWith: DEMO } } })
  const dms = await prisma.chatMessage.findMany({ where: { body: { startsWith: '[demo]' } }, select: { conversationId: true } })
  await prisma.chatConversation.deleteMany({ where: { id: { in: [...new Set(dms.map((d) => d.conversationId))] } } })
  await prisma.meeting.deleteMany({ where: { title: { startsWith: DEMO } } })
  await prisma.pmProject.deleteMany({ where: { name: { startsWith: DEMO } } })
  await prisma.workLogEntry.deleteMany({ where: { title: { startsWith: DEMO } } })
}

async function add() {
  const p = await people()
  await remove()
  // Lead Dialer: the agent's leads with Earth Zone style notes, and the other agent's (which the agent must not see).
  const mk = async (ownerId: string, company: string, status: string, stage: number, notes: [number, string, string][], extra: Record<string, unknown> = {}) => {
    const l = await prisma.dialerLead.create({ data: { ownerId, matchKey: `demo:${company}`, company, status, stage, maxStage: stage, state: 'Texas', region: 'CT', lastActivityAt: ago(notes[notes.length - 1]?.[0] ?? 30), ...extra } })
    for (const [days, authorId, text] of notes) await prisma.dialerNote.create({ data: { leadId: l.id, userId: authorId, text, source: 'EARTHZONE', authorName: null, createdAt: ago(days) } })
    return l
  }
  await mk(p.agent.id, 'Demo Acme Printing', 'Pipeline', 4, [
    [40, p.agent.id, 'Called main line, left VM with receptionist.'],
    [21, p.agent.id, 'Spoke with CFO Linda Park: they have 400 laptops and 60 servers to retire in Q1. Wants a quote with data destruction certificates. Will call back Thursday.'],
    [9, p.other.id, 'Team update: Acme moved their warehouse to Plano.'],
  ], { contactName: 'Linda Park', jobTitle: 'CFO', altPhones: ['(972) 555-0142'] })
  await mk(p.agent.id, 'Demo Birch Logistics', 'Interested', 4, [
    [12, p.agent.id, 'IT manager Omar Reyes interested in on-site shredding for 2,000 hard drives. Asked for references from other logistics clients. Follow up next week.'],
  ])
  await mk(p.agent.id, 'Demo Cedar Clinic', 'Connected', 3, [
    [5, p.agent.id, 'Practice manager said they use a vendor today (SafeShred) but contract ends in December. Send info pack by email.'],
  ])
  await mk(p.other.id, 'Demo Delta Bank', 'Pipeline', 4, [
    [3, p.other.id, 'Delta Bank wants pricing of 4.50 per pound for e-waste pickup, confidential, do not share outside the team.'],
  ])

  // A private chat between the agent and a Lead Gen member (the Super Admin and team lead must never see it).
  const dm = await prisma.chatConversation.create({ data: { type: 'DIRECT', directKey: `demo:${p.agent.id}:${p.leadgen.id}`, members: { create: [{ userId: p.agent.id }, { userId: p.leadgen.id }] } } })
  await prisma.chatMessage.create({ data: { conversationId: dm.id, seq: 1, userId: p.leadgen.id, body: '[demo] I found two more contacts at Acme: procurement head Raj Mehta, raj.mehta@acme-demo.test', createdAt: ago(8) } })
  await prisma.chatMessage.create({ data: { conversationId: dm.id, seq: 2, userId: p.agent.id, body: '[demo] Thanks! Also the offsite surprise party is on the 28th, keep it secret.', createdAt: ago(8, 16) } })

  // A project task the agent is a member of, and a meeting with AI notes.
  const proj = await prisma.pmProject.create({ data: { name: `${DEMO}Q1 Push`, key: `DQ${Math.floor(Math.random() * 900 + 100)}`, ownerId: p.lead.id, members: { create: [{ userId: p.agent.id, role: 'MEMBER' }, { userId: p.lead.id, role: 'ADMIN' }] }, columns: { create: [{ name: 'To do', position: 1, category: 'TODO' }] } }, include: { columns: true } })
  await prisma.pmTask.create({ data: { projectId: proj.id, code: `${proj.key}-1`, title: 'Build the data destruction certificate template', description: 'Clients like Acme ask for NIST 800-88 certificates per serial number.', columnId: proj.columns[0].id, position: 1, createdById: p.lead.id, dueAt: ago(-3) } })
  const group = await prisma.chatConversation.create({ data: { type: 'GROUP', name: `${DEMO}ITAD weekly`, members: { create: [{ userId: p.agent.id }, { userId: p.other.id }, { userId: p.lead.id }] } } })
  const meeting = await prisma.meeting.create({ data: { title: `${DEMO}ITAD weekly review`, agenda: 'Pipeline, targets, Q1 push', startsAt: ago(2, 14), endsAt: ago(2, 15), organizerId: p.lead.id, conversationId: group.id, attendees: { create: [{ userId: p.agent.id, response: 'YES' }, { userId: p.other.id, response: 'YES' }] } } })
  await prisma.chatCall.create({ data: { conversationId: group.id, startedById: p.lead.id, startedAt: ago(2, 14), endedAt: ago(2, 15), joinedIds: [p.lead.id, p.agent.id, p.other.id], meetingId: meeting.id, noteTaker: true, notesStatus: 'done', notes: { summary: 'Team agreed the daily dial target goes up to 120 from next Monday.', keyPoints: ['Pipeline is strongest in Texas', 'Certificates template needed'], decisions: ['Daily dial target 120 from Monday'], actionItems: [{ owner: p.agent.name, task: 'Send Acme the certificate sample', due: 'Friday' }], openQuestions: [] } } })

  // My To-Do: one private, one shared with the team lead.
  const today = new Date(new Date().toISOString().slice(0, 10))
  await prisma.workLogEntry.create({ data: { userId: p.agent.id, period: 'DAY', periodStart: today, title: `${DEMO}Prepare my appraisal self-review`, private: true } })
  await prisma.workLogEntry.create({ data: { userId: p.agent.id, period: 'DAY', periodStart: today, title: `${DEMO}Update Acme quote with shredding line items`, details: 'Add on-site shredding at 8 dollars per drive.' } })
  return p
}

async function main() {
  const removing = process.argv.includes('--remove')
  await runAsCompany(process.env.METRA_DEMO_COMPANY || HOME_COMPANY_ID, async () => {
    if (removing) { await remove(); console.log('Demo records removed.'); return }
    const p = await add()
    console.log('Demo records added. Who is who (for the eval and for trying it):')
    for (const [k, v] of Object.entries(p)) console.log(`  ${k.padEnd(8)} ${v.name} <${v.email}>`)
  })
  await prisma.$disconnect()
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1) })
export { people as demoPeople }
