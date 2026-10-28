import { prisma } from './prisma'
import { HOME_COMPANY_ID } from './company'
import { AREA_KEYS, type AreaKey } from './permissions'
import { maybeCompanyId } from './tenancy'

/**
 * Plans (Phase 1, step 6): how many people, how much file space and how many hours of AI
 * meeting notes a company has, and which parts of Metriq come with it. Prices live in billing
 * (step 8). 99 Technologies is on "internal": no limits, everything on, never billed.
 */

export type PlanKey = 'personal' | 'starter' | 'business' | 'internal'
export interface Plan {
  key: PlanKey
  label: string
  /** null = no limit */
  people: number | null
  storageGb: number | null
  aiHours: number | null
  /** Parts of Metriq that do not come with this plan (the owner can still switch parts on or off per company). */
  areasOff: AreaKey[]
  /** Monthly and yearly price in US dollars per company (billing, step 8). */
  priceMonthly: number
  priceYearly: number
  sellable: boolean
}

const SALES: AreaKey[] = ['itad', 'dialer', 'leadgen', 'marketing', 'ecommerce', 'inventory', 'qa']

export const PLANS: Record<PlanKey, Plan> = {
  personal: { key: 'personal', label: 'Personal', people: 1, storageGb: 2, aiHours: 2, areasOff: [...SALES, 'feedback', 'reports'], priceMonthly: 5, priceYearly: 50, sellable: true },
  starter: { key: 'starter', label: 'Starter', people: 10, storageGb: 20, aiHours: 10, areasOff: ['dialer', 'qa'], priceMonthly: 29, priceYearly: 290, sellable: true },
  business: { key: 'business', label: 'Business', people: 50, storageGb: 100, aiHours: 40, areasOff: [], priceMonthly: 99, priceYearly: 990, sellable: true },
  internal: { key: 'internal', label: 'Internal', people: null, storageGb: null, aiHours: null, areasOff: [], priceMonthly: 0, priceYearly: 0, sellable: false },
}
export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[]
export const planOf = (key: string | null | undefined): Plan => PLANS[(key ?? '') as PlanKey] ?? PLANS.starter

/** The parts of Metriq switched off for a company: what its plan leaves out, plus the owner's own choices. */
export function companyAreasOff(c: { id: string; plan: string; modulesOff: string[]; modulesOn: string[] }): AreaKey[] {
  if (c.id === HOME_COMPANY_ID) return AREA_KEYS.filter((k) => c.modulesOff.includes(k))
  const off = new Set<string>([...planOf(c.plan).areasOff, ...c.modulesOff])
  for (const k of c.modulesOn) off.delete(k)
  return AREA_KEYS.filter((k) => off.has(k))
}

// ------------------------------------------------------------------ what a company uses

const thisMonth = () => new Date().toISOString().slice(0, 7)

/** Bytes of files a company keeps (tasks, chat, documents, entries, call recordings). */
export async function storageBytes(companyId: string): Promise<number> {
  const where = { companyId }
  const [a, b, c, d, e] = await Promise.all([
    prisma.pmAttachment.aggregate({ where, _sum: { size: true } }),
    prisma.entryAttachment.aggregate({ where, _sum: { size: true } }),
    prisma.chatMessage.aggregate({ where, _sum: { fileSize: true } }),
    prisma.savedDoc.aggregate({ where, _sum: { fileSize: true } }),
    prisma.callRecording.aggregate({ where, _sum: { size: true } }),
  ])
  return (a._sum.size ?? 0) + (b._sum.size ?? 0) + (c._sum.fileSize ?? 0) + (d._sum.fileSize ?? 0) + (e._sum.size ?? 0)
}

export async function aiSecondsThisMonth(companyId: string): Promise<number> {
  return (await prisma.companyUsage.findUnique({ where: { companyId_month: { companyId, month: thisMonth() } } }))?.aiSeconds ?? 0
}

/** Count seconds of speech turned into meeting notes. */
export async function addAiSeconds(companyId: string, seconds: number): Promise<void> {
  if (!(seconds > 0)) return
  await prisma.companyUsage.upsert({
    where: { companyId_month: { companyId, month: thisMonth() } },
    update: { aiSeconds: { increment: Math.round(seconds) } },
    create: { companyId, month: thisMonth(), aiSeconds: Math.round(seconds) },
  })
}

export async function activePeople(companyId: string): Promise<number> {
  return prisma.user.count({ where: { companyId, isActive: true, status: { in: ['ACTIVE', 'PENDING'] } } })
}

export async function usageOf(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { plan: true } })
  const plan = planOf(c.plan)
  const [people, bytes, aiSeconds] = await Promise.all([activePeople(companyId), storageBytes(companyId), aiSecondsThisMonth(companyId)])
  return {
    plan: plan.key,
    people: { used: people, limit: plan.people },
    storage: { usedBytes: bytes, limitBytes: plan.storageGb === null ? null : plan.storageGb * 1024 ** 3 },
    aiHours: { used: Math.round((aiSeconds / 3600) * 10) / 10, limit: plan.aiHours },
  }
}

export class PlanLimit extends Error {
  status = 402
  constructor(message: string) { super(message); this.name = 'PlanLimit' }
}

/** Before adding people: is there room on the plan? */
export async function checkPeopleRoom(adding = 1, companyId = maybeCompanyId()): Promise<void> {
  if (!companyId) return
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } })
  const limit = planOf(c?.plan).people
  if (limit === null) return
  const now = await activePeople(companyId)
  if (now + adding > limit) throw new PlanLimit(`Your plan has room for ${limit} ${limit === 1 ? 'person' : 'people'}. Upgrade in Billing to add more.`)
}

/** Before saving a file: is there space left on the plan? */
export async function checkStorageRoom(bytes: number, companyId = maybeCompanyId()): Promise<void> {
  if (!companyId) return
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } })
  const gb = planOf(c?.plan).storageGb
  if (gb === null) return
  if ((await storageBytes(companyId)) + bytes > gb * 1024 ** 3) throw new PlanLimit(`Your plan's ${gb} GB of files is full. Remove old files or upgrade in Billing.`)
}

/** Are AI meeting notes still within this month's hours? */
export async function aiRoomLeft(companyId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } })
  const hours = planOf(c?.plan).aiHours
  if (hours === null) return true
  return (await aiSecondsThisMonth(companyId)) < hours * 3600
}
