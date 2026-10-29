import { prisma } from '../prisma'

/**
 * Plain-text views of System Health for Claude (the "Copy for Claude" button and the
 * connector tools), so both give Claude the same brief.
 */

const when = (d: Date | null | undefined) => (d ? d.toLocaleString('en-US', { timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PKT' : 'never')
const SOURCE: Record<string, string> = { SERVER: 'Server (API)', BROWSER: 'Browser (a page broke)', JOB: 'Background job', SLOW: 'Slow request' }

export async function errorBrief(id: string): Promise<string | null> {
  const g = await prisma.errorGroup.findUnique({ where: { id } })
  if (!g) return null
  const events = await prisma.errorEvent.findMany({ where: { groupId: id }, orderBy: { at: 'desc' }, take: 5 })
  const users = await prisma.user.findMany({ where: { id: { in: [...g.userIds, ...events.map((e) => e.userId ?? '')] } }, select: { id: true, name: true, company: { select: { name: true } } } })
  const names = new Map(users.map((u) => [u.id, u.name]))
  const companies = [...new Set(users.filter((u) => g.userIds.includes(u.id)).map((u) => u.company.name))]
  const out: string[] = []
  out.push(`Metriq error ${g.id}: ${g.message}`, '')
  out.push(`Where: ${SOURCE[g.source] ?? g.source}${g.route ? `, ${g.route}` : ''}${g.status ? ` (status ${g.status})` : ''}`)
  out.push(`Seen ${g.count} time${g.count === 1 ? '' : 's'}, by ${g.userIds.length} ${g.userIds.length === 1 ? 'person' : 'people'}${g.userIds.length ? ` (${g.userIds.slice(0, 5).map((u) => names.get(u) ?? 'someone').join(', ')})` : ''}`)
  if (companies.length) out.push(`Companies: ${companies.join(', ')}`)
  out.push(`First seen: ${when(g.firstSeenAt)}  |  Last seen: ${when(g.lastSeenAt)}  |  State: ${g.state.toLowerCase()}${g.reopenedAt ? ` (came back ${when(g.reopenedAt)})` : ''}`)
  out.push('Code: the PulseTrack repo (server in server/src, web app in client/src)')
  if (g.stack) out.push('', 'Stack trace:', g.stack)
  if (events.length) {
    out.push('', 'Latest times it happened:')
    for (const e of events) {
      const meta = (e.meta ?? {}) as { browser?: string; release?: string }
      out.push(`- ${when(e.at)}${e.userId ? `, ${names.get(e.userId) ?? 'someone'}` : ''}${e.url ? `, ${e.url}` : ''}${e.durationMs ? `, took ${e.durationMs} ms` : ''}${meta.browser ? `, ${meta.browser}` : ''}`)
    }
  }
  out.push('', 'Please find the cause in the code, fix it, add a test that fails without the fix, and give me a patch.')
  return out.join('\n')
}

export async function auditReport(runId?: string): Promise<string | null> {
  const run = runId
    ? await prisma.auditRun.findUnique({ where: { id: runId } })
    : await prisma.auditRun.findFirst({ where: { state: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } })
  if (!run) return null
  if (run.state === 'RUNNING') return `Self check ${run.id} is still running (started ${when(run.startedAt)}). Ask again in a minute.`
  const problems = await prisma.auditCheck.findMany({ where: { runId: run.id, result: { in: ['FAIL', 'WARN'] } }, orderBy: [{ result: 'asc' }, { category: 'asc' }, { name: 'asc' }] })
  const fixed = await prisma.auditCheck.findMany({ where: { runId: run.id, fixed: true }, select: { name: true } })
  const out: string[] = []
  out.push(`Metriq self check ${run.id}, ${when(run.startedAt)} (${run.trigger}), took ${Math.round((run.durationMs ?? 0) / 1000)}s`)
  out.push(`Result: ${run.state === 'PASSED' ? 'all clear' : run.state === 'WARN' ? 'warnings only' : 'problems found'}. ${run.passed} passed, ${run.failed} failed, ${run.warned} warnings, ${run.skipped} skipped, of ${run.total} checks.`)
  if (run.newProblems || run.fixed) out.push(`Since the run before: ${run.newProblems} new problem${run.newProblems === 1 ? '' : 's'}, ${run.fixed} fixed.`)
  const fails = problems.filter((p) => p.result === 'FAIL')
  const warns = problems.filter((p) => p.result === 'WARN')
  if (fails.length) out.push('', 'Failed:', ...fails.map((p) => `- [${p.category}] ${p.name}${p.isNew ? ' (new)' : ''}: ${p.detail ?? ''}`))
  if (warns.length) out.push('', 'Warnings:', ...warns.map((p) => `- [${p.category}] ${p.name}${p.isNew ? ' (new)' : ''}: ${p.detail ?? ''}`))
  if (fixed.length) out.push('', 'Fixed since last run:', ...fixed.map((p) => `- ${p.name}`))
  if (!fails.length && !warns.length) out.push('', 'Nothing to fix.')
  return out.join('\n')
}

export async function errorList(opts: { state?: 'OPEN' | 'RESOLVED' | 'IGNORED' | 'ALL'; take?: number }): Promise<string> {
  const rows = await prisma.errorGroup.findMany({
    where: opts.state && opts.state !== 'ALL' ? { state: opts.state } : { state: 'OPEN' },
    orderBy: { lastSeenAt: 'desc' },
    take: opts.take ?? 25,
  })
  if (!rows.length) return 'No errors in the log for that filter.'
  return rows.map((g) => `${g.id} | ${g.source.toLowerCase()} | ${g.count}x, ${g.userIds.length} people | last ${when(g.lastSeenAt)} | ${g.route ?? ''} | ${g.message.slice(0, 160)}`).join('\n')
}
