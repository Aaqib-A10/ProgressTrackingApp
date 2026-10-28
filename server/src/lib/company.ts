import { prisma } from './prisma'

/**
 * Companies (erp, step 0). Until phase 1 step 2 puts a company on every record, everyone in
 * Metriq belongs to 99 Technologies, company 1. This is the one place that answers "which
 * company is this person in", so step 2 only changes it here.
 */
export const HOME_COMPANY_ID = 'company-1'

export async function companyIdOfUser(_userId: string): Promise<string> {
  return HOME_COMPANY_ID
}

/** Make sure company 1 exists (the migration adds it; this covers a fresh test database). */
export async function ensureHomeCompany() {
  return prisma.company.upsert({
    where: { id: HOME_COMPANY_ID },
    update: {},
    create: { id: HOME_COMPANY_ID, name: '99 Technologies', slug: '99-technologies', timeZone: 'Asia/Karachi', status: 'ACTIVE', plan: 'internal', helpEnabled: false },
  })
}

/** The people of a company (company 1 = everyone, until step 2). */
export function companyUserWhere(companyId: string) {
  return companyId === HOME_COMPANY_ID ? {} : { id: '__none__' }
}
