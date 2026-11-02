import cron from 'node-cron'
import { prisma } from '../prisma'
import { forEachCompany } from '../company'
import { runTracked } from '../health/jobs'
import { isOn } from '../flags'
import { maybeCompanyId } from '../tenancy'
import { leadManagers, tellAboutLead } from './notify'

/**
 * Lead Management alerts, every 5 minutes, once per lead:
 *  - a new lead nobody has been given after the business's "assign within" time → its managers;
 *  - a lead given to a rep with no call, email or status change after "contact within" → the rep and the managers.
 */
export async function runLeadSlaTick(now = new Date()): Promise<{ unassigned: number; uncontacted: number }> {
  const companyId = maybeCompanyId()
  if (companyId && !(await isOn('lead-management', companyId))) return { unassigned: 0, uncontacted: 0 }
  const businesses = await prisma.leadBusiness.findMany({ where: { isActive: true }, select: { id: true, name: true, slaAssignMins: true, slaContactMins: true } })
  let unassigned = 0, uncontacted = 0
  for (const b of businesses) {
    if (b.slaAssignMins > 0) {
      const late = await prisma.lead.findMany({ where: { businessId: b.id, assigneeId: null, status: 'NEW', slaAssignAlertAt: null, createdAt: { lt: new Date(now.getTime() - b.slaAssignMins * 60_000) } }, take: 200, orderBy: { createdAt: 'asc' } })
      if (late.length) {
        const managers = await leadManagers(b.id)
        for (const l of late) {
          // Claim it first so two servers (or a slow tick) never alert twice.
          const c = await prisma.lead.updateMany({ where: { id: l.id, slaAssignAlertAt: null }, data: { slaAssignAlertAt: now } })
          if (c.count !== 1) continue
          unassigned++
          await tellAboutLead(managers, { type: 'LEAD_SLA', title: `Not assigned yet: ${l.name || l.email || l.phone || 'a lead'}`, body: `${b.name}: waiting more than ${fmtMins(b.slaAssignMins)} for a rep.`, leadId: l.id })
        }
      }
    }
    if (b.slaContactMins > 0) {
      const late = await prisma.lead.findMany({ where: { businessId: b.id, assigneeId: { not: null }, status: 'NEW', firstContactAt: null, slaContactAlertAt: null, assignedAt: { lt: new Date(now.getTime() - b.slaContactMins * 60_000) } }, take: 200, orderBy: { assignedAt: 'asc' } })
      if (late.length) {
        const managers = await leadManagers(b.id)
        for (const l of late) {
          const c = await prisma.lead.updateMany({ where: { id: l.id, slaContactAlertAt: null }, data: { slaContactAlertAt: now } })
          if (c.count !== 1) continue
          uncontacted++
          await tellAboutLead([l.assigneeId!, ...managers], { type: 'LEAD_SLA', title: `No contact yet: ${l.name || l.email || l.phone || 'a lead'}`, body: `${b.name}: given out more than ${fmtMins(b.slaContactMins)} ago and nobody has called or written.`, leadId: l.id })
        }
      }
    }
  }
  return { unassigned, uncontacted }
}

export function fmtMins(m: number): string {
  if (m < 60) return `${m} min`
  if (m % 60 === 0) return m === 60 ? '1 hour' : `${m / 60} hours`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function startLeadSla(): void {
  cron.schedule('*/5 * * * *', () => {
    runTracked('lead-sla', () => forEachCompany(() => runLeadSlaTick())).catch((e) => console.error('[lead-sla]', e))
  })
}
