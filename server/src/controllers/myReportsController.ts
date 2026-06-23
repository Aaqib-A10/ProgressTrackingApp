import type { Response } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { dbDateFromString, dateStringFromDb, periodRange, type RangeKey, type DateRange } from '../lib/time'

const inRange = (r: DateRange) => ({ gte: dbDateFromString(r.startDate), lte: dbDateFromString(r.endDate) })

type Col = { key: string; label: string }
const ITAD_COLS: Col[] = [
  { key: 'callsDialed', label: 'Dials' }, { key: 'connected', label: 'Conn.' }, { key: 'voicemail', label: 'VM' },
  { key: 'emailsSent', label: 'Emails' }, { key: 'interested', label: 'Interested' }, { key: 'workingOn', label: 'Working' },
  { key: 'closed', label: 'Closed' }, { key: 'rfqs', label: 'RFQs' },
]
const LEADGEN_COLS: Col[] = [
  { key: 'leadsGenerated', label: 'Leads' }, { key: 'accountsResearched', label: 'Researched' }, { key: 'contactsFound', label: 'Contacts' },
  { key: 'qualifiedMql', label: 'Qualified' }, { key: 'handedToSql', label: 'Handed' },
]
const SEO_COLS: Col[] = [
  { key: 'keywordsTracked', label: 'Keywords' }, { key: 'pagesOptimized', label: 'Pages' }, { key: 'backlinksBuilt', label: 'Backlinks' },
  { key: 'technicalFixes', label: 'Fixes' }, { key: 'organicTraffic', label: 'Traffic' },
]
const SOCIAL_COLS: Col[] = [
  { key: 'postsPublished', label: 'Posts' }, { key: 'postsScheduled', label: 'Scheduled' }, { key: 'reach', label: 'Reach' },
  { key: 'engagement', label: 'Engagement' }, { key: 'followersGained', label: 'Followers' },
]

function build(entries: Array<{ date: Date; status: string } & Record<string, unknown>>, cols: Col[]) {
  const rows = entries.map((e) => ({
    date: dateStringFromDb(e.date),
    status: e.status,
    values: Object.fromEntries(cols.map((c) => [c.key, (e[c.key] as number) ?? 0])),
  }))
  const totals: Record<string, number> = {}
  for (const c of cols) totals[c.key] = entries.reduce((a, e) => (e.status === 'SUBMITTED' ? a + ((e[c.key] as number) ?? 0) : a), 0)
  return { rows, totals }
}

/** GET /api/reports/me?range= — the caller's own submission history. */
export async function myReports(req: AuthedRequest, res: Response): Promise<void> {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { department: true, subDepartment: true } })
  const rangeKey = ((req.query.range as RangeKey) || 'month') as RangeKey
  let range: DateRange
  try {
    range = periodRange(rangeKey, { start: req.query.start as string, end: req.query.end as string })
  } catch {
    range = periodRange('month')
  }
  const where = { userId: me.id, date: inRange(range) }
  const order = { orderBy: { date: 'desc' as const } }

  const dept = me.department?.type
  const sub = me.subDepartment?.slug

  let cols: Col[] = []
  let entries: Array<{ date: Date; status: string } & Record<string, unknown>> = []

  if (dept === 'ITAD') {
    cols = ITAD_COLS
    entries = await prisma.itadDailyEntry.findMany({ where, ...order })
  } else if (dept === 'LEAD_GEN') {
    cols = LEADGEN_COLS
    entries = await prisma.leadGenDailyEntry.findMany({ where, ...order })
  } else if (dept === 'MARKETING' && sub === 'seo') {
    cols = SEO_COLS
    entries = await prisma.seoDailyEntry.findMany({ where, ...order })
  } else if (dept === 'MARKETING' && sub === 'social') {
    cols = SOCIAL_COLS
    entries = await prisma.socialDailyEntry.findMany({ where, ...order })
  }

  const { rows, totals } = build(entries, cols)
  res.json({ department: dept ?? null, subDepartment: sub ?? null, range: { ...range, key: rangeKey }, columns: cols, rows, totals })
}
