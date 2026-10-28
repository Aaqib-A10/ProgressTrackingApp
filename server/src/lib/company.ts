import { prisma } from './prisma'
import { runAsCompany } from './tenancy'

/**
 * Companies. 99 Technologies is company 1 ('company-1'); every record has a company (Phase 1,
 * step 2) and lib/tenancy keeps each company inside its own walls.
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

/** The people of a company. */
export function companyUserWhere(companyId: string) {
  return { companyId }
}

/**
 * Background jobs (reminders, alerts, auto check-out…) run once for each company, inside that
 * company's walls (lib/tenancy), so a job never mixes two companies (a reminder to one
 * company's Super Admin about another company's people). Paused companies are skipped. One
 * company's failure does not stop the others; it is reported at the end.
 */
export async function forEachCompany(fn: (companyId: string) => Promise<unknown>): Promise<void> {
  const companies = await prisma.company.findMany({ where: { status: { not: 'SUSPENDED' } }, select: { id: true, timeZone: true }, orderBy: { createdAt: 'asc' } })
  const failed: string[] = []
  let first: unknown = null
  for (const c of companies) {
    try { await runAsCompany(c.id, () => fn(c.id), c.timeZone) } catch (e) { failed.push(c.id); first ??= e }
  }
  if (first) {
    const e = first instanceof Error ? first : new Error(String(first))
    if (failed.length > 1) e.message = `${e.message} (in ${failed.length} companies)`
    throw e
  }
}
