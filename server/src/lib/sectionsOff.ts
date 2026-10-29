import { prisma } from './prisma'
import { SECTION_KEYS } from './sections'

/**
 * The sections a company has turned off (any of its departments), cached for a few seconds:
 * read on every saving request, changed rarely. A change in Company Settings clears it at once.
 */
const TTL = 30_000
const cache = new Map<string, { at: number; off: string[] }>()

export async function companySectionsOff(companyId: string): Promise<string[]> {
  const hit = cache.get(companyId)
  if (hit && Date.now() - hit.at < TTL) return hit.off
  const rows = await prisma.department.findMany({ where: { companyId, NOT: { sectionsOff: { isEmpty: true } } }, select: { sectionsOff: true } })
  const off = [...new Set(rows.flatMap((r) => r.sectionsOff))].filter((k) => SECTION_KEYS.includes(k))
  cache.set(companyId, { at: Date.now(), off })
  return off
}

export function forgetSections(): void {
  cache.clear()
}
