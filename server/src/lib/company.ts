import { prisma } from './prisma'

/**
 * Companies (erp, step 0). Until phase 1 step 2 puts a company on every record, everyone in
 * Metriq belongs to 99 Technologies, company 1. This is the one place that answers "which
 * company is this person in", so step 2 only changes it here.
 */
export const HOME_COMPANY_ID = 'company-1'

export async function companyIdOfUser(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  return u?.companyId ?? HOME_COMPANY_ID
}

/** Make sure company 1 exists (the migration adds it; this covers a fresh test database). */
export async function ensureHomeCompany() {
  return prisma.company.upsert({
    where: { id: HOME_COMPANY_ID },
    update: {},
    create: { id: HOME_COMPANY_ID, name: '99 Technologies', slug: '99-technologies', timeZone: 'Asia/Karachi', status: 'ACTIVE', plan: 'internal', helpEnabled: false },
  })
}

/** The people of a company. Company 1 also has everyone whose company is still empty (until step 2 fills it). */
export function companyUserWhere(companyId: string) {
  return companyId === HOME_COMPANY_ID ? { OR: [{ companyId: null }, { companyId: HOME_COMPANY_ID }] } : { companyId }
}
