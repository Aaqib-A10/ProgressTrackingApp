import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import cron from 'node-cron'
import type { Router } from 'express'
import type { AuditState, CheckResult, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { signToken } from '../auth'
import { vapidKeys } from '../push'
import { AUDIT_HEADER, AUDIT_SECRET, PROBE_HEADER, takeProbe } from './auditContext'
import { alertDevelopers } from './alerts'
import { JOBS, runTracked } from './jobs'
import { lastUptimePing, uptimeConfigured } from './uptime'

/**
 * The hourly self check. It calls every API endpoint the app has (read ones as they are; write
 * ones with an empty request, in test mode, so nothing is ever saved), then looks at the
 * database, the server, outside services, background jobs, the data and the website.
 * Each run is kept with what newly broke and what got fixed since the run before.
 */

export interface CheckRow {
  category: string
  name: string
  result: CheckResult
  ms?: number | null
  status?: number | null
  detail?: string | null
}

const SLOW_MS = Number(process.env.HEALTH_SLOW_MS) || 3000
const REQUEST_TIMEOUT_MS = 20_000
const STALE_RUN_MS = 15 * 60 * 1000
const DUMMY = 'audit-probe-0000000000000000'

let mounts: [string, Router][] = []
let baseUrl = `http://127.0.0.1:${Number(process.env.PORT) || 4000}`

/** app.ts hands over its list of routers (avoids an import loop). */
export function registerApiMounts(m: [string, Router][]): void { mounts = m }
/** index.ts says where the API listens once it has started. */
export function setAuditBaseUrl(url: string): void { baseUrl = url }
/** Where this server answers itself (the AI connectors call the API through it, as the person). */
export const apiBaseUrl = (): string => baseUrl

// --- Which endpoints exist ---------------------------------------------------------------

interface Endpoint { method: string; path: string }

interface Layer { route?: { path: string | string[]; methods: Record<string, boolean> } }

export function listEndpoints(): Endpoint[] {
  const out = new Map<string, Endpoint>()
  for (const [base, router] of mounts) {
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (!layer.route) continue
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const p of paths) {
        if (typeof p !== 'string') continue
        for (const m of Object.keys(layer.route.methods)) {
          if (m === '_all') continue
          const method = m.toUpperCase()
          const full = `${base}${p === '/' ? '' : p}` || '/'
          out.set(`${method} ${full}`, { method, path: full })
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/** Endpoints the self check leaves alone, and why. */
const SKIP: { re: RegExp; writesOnly?: boolean; why: string }[] = [
  { re: /^\/api\/auth\//, writesOnly: true, why: 'Sign-in endpoints are left alone (rate limits)' },
  { re: /^\/api\/mcp\b/, why: "Claude's connector has its own tests and needs a key" },
  { re: /^\/api\/guest\b/, why: 'Public guest call links' },
  { re: /^\/api\/system-health\b/, writesOnly: true, why: 'Part of System Health itself' },
  { re: /^\/api\/push\/test$/, why: 'Sends a test pop-up' },
]

function skipReason(e: Endpoint): string | null {
  for (const s of SKIP) if (s.re.test(e.path) && (!s.writesOnly || e.method !== 'GET')) return s.why
  return null
}

const fillParams = (p: string) => p.replace(/:([A-Za-z0-9_]+)\??/g, DUMMY)

// --- Calling the API in test mode --------------------------------------------------------

async function probe(e: Endpoint, token: string): Promise<CheckRow> {
  const category = e.method === 'GET' ? 'api-read' : 'api-write'
  const name = `${e.method} ${e.path}`
  const id = randomUUID()
  const start = Date.now()
  let status: number | null = null
  let text = ''
  try {
    const res = await fetch(baseUrl + fillParams(e.path), {
      method: e.method,
      headers: {
        Authorization: `Bearer ${token}`,
        [AUDIT_HEADER]: AUDIT_SECRET,
        [PROBE_HEADER]: id,
        Accept: 'application/json',
        ...(e.method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      body: e.method === 'GET' ? undefined : '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    })
    status = res.status
    text = (await res.text()).slice(0, 400)
  } catch (err) {
    takeProbe(id)
    const timeout = (err as Error).name === 'TimeoutError'
    return { category, name, result: 'FAIL', ms: Date.now() - start, status: null, detail: timeout ? `No answer within ${REQUEST_TIMEOUT_MS / 1000}s` : `Could not call it: ${(err as Error).message}` }
  }
  const ms = Date.now() - start
  const p = takeProbe(id)
  const blocked = p?.blockedWrite ? `Reached a save (${p.blockedWrite}), stopped by test mode` : null
  if (status >= 500 && !blocked) {
    let msg = p?.error?.message ?? ''
    if (!msg) { try { msg = (JSON.parse(text) as { error?: string }).error ?? '' } catch { msg = text } }
    const where = p?.error?.stack?.split('\n').slice(1).find((l) => !/node_modules|node:internal/.test(l))?.trim()
    return { category, name, result: 'FAIL', ms, status, detail: `${msg || `Answered ${status}`}${where ? ` | ${where}` : ''}`.slice(0, 500) }
  }
  if (ms >= SLOW_MS) return { category, name, result: 'WARN', ms, status, detail: `Slow: took ${(ms / 1000).toFixed(1)}s` }
  return { category, name, result: 'PASS', ms, status, detail: blocked ?? `Answered ${status}` }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

async function auditIdentity(): Promise<{ id: string; role: 'SUPER_ADMIN' } | null> {
  const u = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true, status: 'ACTIVE' },
    orderBy: [{ isDeveloper: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  return u ? { id: u.id, role: 'SUPER_ADMIN' } : null
}

async function apiChecks(concurrency: number): Promise<CheckRow[]> {
  const who = await auditIdentity()
  const endpoints = listEndpoints()
  if (!who) return [{ category: 'api-read', name: 'All endpoints', result: 'WARN', detail: 'No active Super Admin to run the checks as' }]
  const token = signToken({ sub: who.id, role: who.role })
  const todo: Endpoint[] = []
  const rows: CheckRow[] = []
  for (const e of endpoints) {
    const why = skipReason(e)
    if (why) rows.push({ category: e.method === 'GET' ? 'api-read' : 'api-write', name: `${e.method} ${e.path}`, result: 'SKIP', detail: why })
    else todo.push(e)
  }
  rows.push(...await pool(todo, concurrency, (e) => probe(e, token)))
  return rows
}

// --- Database, server, services, jobs, data, website --------------------------------------

async function timed<T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const s = Date.now()
  const v = await fn()
  return { v, ms: Date.now() - s }
}

async function safe(category: string, name: string, fn: () => Promise<CheckRow | CheckRow[]>): Promise<CheckRow[]> {
  try {
    const r = await fn()
    return Array.isArray(r) ? r : [r]
  } catch (e) {
    return [{ category, name, result: 'FAIL', detail: (e as Error).message.slice(0, 300) }]
  }
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`
const mb = (n: number) => `${Math.round(n / 1024 ** 2)} MB`
const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : ms < 48 * 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 86400_000)} days`)

async function databaseChecks(): Promise<CheckRow[]> {
  const C = 'database'
  return [
    ...await safe(C, 'Connection', async () => {
      const { ms } = await timed(() => prisma.$queryRaw`SELECT 1`)
      return { category: C, name: 'Connection', result: ms > 500 ? 'WARN' : 'PASS', ms, detail: ms > 500 ? `Slow to answer (${ms} ms)` : `Answered in ${ms} ms` }
    }),
    ...await safe(C, 'Migrations', async () => {
      const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`
      const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at)
      if (failed.length) return { category: C, name: 'Migrations', result: 'FAIL', detail: `Failed or half applied: ${failed.map((r) => r.migration_name).join(', ')}` }
      const applied = new Set(rows.filter((r) => r.finished_at).map((r) => r.migration_name))
      let folders: string[] = []
      try { folders = (await fs.readdir(path.resolve('prisma', 'migrations'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* not shipped with the build */ }
      const missing = folders.filter((f) => !applied.has(f))
      if (missing.length) return { category: C, name: 'Migrations', result: 'FAIL', detail: `Not applied yet: ${missing.join(', ')}` }
      return { category: C, name: 'Migrations', result: 'PASS', detail: `${applied.size} applied, none waiting` }
    }),
    ...await safe(C, 'Size and connections', async () => {
      const [size] = await prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`
      const [conn] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`
      const n = Number(conn.n)
      return { category: C, name: 'Size and connections', result: n > 80 ? 'WARN' : 'PASS', detail: `${gb(Number(size.size))} used, ${n} open connections` }
    }),
  ]
}

async function serverChecks(): Promise<CheckRow[]> {
  const C = 'server'
  const rows: CheckRow[] = []
  const up = process.uptime() * 1000
  rows.push({ category: C, name: 'App running', result: 'PASS', detail: `Up for ${ago(up)}, Node ${process.version}` })
  const rss = process.memoryUsage().rss
  rows.push({ category: C, name: 'App memory', result: rss > 3 * 1024 ** 3 ? 'FAIL' : rss > 1.5 * 1024 ** 3 ? 'WARN' : 'PASS', detail: `${mb(rss)} in use` })
  const freePct = (os.freemem() / os.totalmem()) * 100
  rows.push({ category: C, name: 'Server memory', result: freePct < 5 ? 'WARN' : 'PASS', detail: `${gb(os.freemem())} free of ${gb(os.totalmem())}` })
  const load = os.loadavg()[0]
  const cpus = os.cpus().length || 1
  rows.push({ category: C, name: 'CPU load', result: load > cpus * 1.5 ? 'WARN' : 'PASS', detail: `${load.toFixed(2)} on ${cpus} cores` })
  rows.push(...await safe(C, 'Disk space', async () => {
    const st = await fs.statfs(process.cwd())
    const free = Number(st.bavail) * Number(st.bsize)
    const total = Number(st.blocks) * Number(st.bsize)
    const pct = total ? (free / total) * 100 : 100
    return { category: C, name: 'Disk space', result: pct < 5 ? 'FAIL' : pct < 10 ? 'WARN' : 'PASS', detail: `${gb(free)} free of ${gb(total)} (${pct.toFixed(0)}%)` }
  }))
  rows.push(...await safe(C, 'Uploads folder', async () => {
    const dir = path.resolve('uploads')
    await fs.mkdir(dir, { recursive: true })
    const f = path.join(dir, `.health-${process.pid}`)
    await fs.writeFile(f, 'ok')
    await fs.unlink(f)
    return { category: C, name: 'Uploads folder', result: 'PASS', detail: 'Files can be saved' }
  }))
  return rows
}

async function reachable(url: string): Promise<boolean> {
  try { await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) }); return true } catch { return false }
}

async function serviceChecks(): Promise<CheckRow[]> {
  const C = 'services'
  const rows: CheckRow[] = []
  if (!process.env.MAILTRAP_API_TOKEN) rows.push({ category: C, name: 'Email (Mailtrap)', result: 'WARN', detail: 'MAILTRAP_API_TOKEN is not set, so no emails are sent' })
  else {
    const { v, ms } = await timed(() => reachable('https://send.api.mailtrap.io'))
    rows.push({ category: C, name: 'Email (Mailtrap)', result: v ? 'PASS' : 'FAIL', ms, detail: v ? 'Set up and reachable' : 'Mailtrap cannot be reached from the server' })
  }
  rows.push(...await safe(C, 'Pop-up notifications', async () => {
    await vapidKeys()
    const n = await prisma.pushSubscription.count()
    return { category: C, name: 'Pop-up notifications', result: 'PASS', detail: `Keys ready, ${n} devices signed up` }
  }))
  const turn = (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) || process.env.TURN_URLS
  rows.push({ category: C, name: 'Call relay (TURN)', result: turn ? 'PASS' : 'WARN', detail: turn ? 'Set up' : 'Off: people outside the office may get stuck on "Connecting"' })
  const ai = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY
  rows.push({ category: C, name: 'AI meeting notes', result: ai ? 'PASS' : 'WARN', detail: ai ? 'Set up' : 'No AI key set, so meeting notes are off' })
  return rows
}

async function jobChecks(): Promise<CheckRow[]> {
  const C = 'jobs'
  const beats = new Map((await prisma.jobHeartbeat.findMany()).map((b) => [b.name, b]))
  const up = process.uptime() * 1000
  const now = Date.now()
  const rows: CheckRow[] = []
  for (const j of JOBS) {
    if (j.name === 'health-audit') continue
    const b = beats.get(j.name)
    if (!b) {
      const due = j.everyMs !== null && up > j.everyMs * 2
      rows.push({ category: C, name: j.label, result: due ? 'WARN' : 'SKIP', detail: due ? 'Has not run since the app started' : 'Has not run yet' })
      continue
    }
    const since = now - b.lastRunAt.getTime()
    if (b.lastError) rows.push({ category: C, name: j.label, result: 'FAIL', ms: b.lastDurationMs, detail: `Failing: ${b.lastError}`.slice(0, 300) })
    else if (j.everyMs !== null && since > j.everyMs * 3 + 60_000) rows.push({ category: C, name: j.label, result: 'FAIL', detail: `Stopped: last ran ${ago(since)} ago` })
    else rows.push({ category: C, name: j.label, result: 'PASS', ms: b.lastDurationMs, detail: `Last ran ${ago(since)} ago` })
  }
  return rows
}

async function dataChecks(): Promise<CheckRow[]> {
  const C = 'data'
  const day = 86400_000
  return [
    ...await safe(C, 'Check-ins left open', async () => {
      const n = await prisma.attendanceDay.count({ where: { checkInAt: { not: null, lt: new Date(Date.now() - day) }, checkOutAt: null } })
      return { category: C, name: 'Check-ins left open', result: n ? 'WARN' : 'PASS', detail: n ? `${n} check-in${n === 1 ? '' : 's'} open for over 24 hours` : 'None open over 24 hours' }
    }),
    ...await safe(C, 'Project files on disk', async () => {
      const files = await prisma.pmAttachment.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { storedName: true, originalName: true } })
      const dir = path.resolve('uploads', 'projects')
      const missing: string[] = []
      for (const f of files) { try { await fs.access(path.join(dir, f.storedName)) } catch { missing.push(f.originalName) } }
      return { category: C, name: 'Project files on disk', result: missing.length ? 'WARN' : 'PASS', detail: missing.length ? `${missing.length} of the last ${files.length} files are missing, e.g. ${missing.slice(0, 2).join(', ')}` : `Last ${files.length} files all present` }
    }),
    ...await safe(C, 'People without a department', async () => {
      const n = await prisma.user.count({ where: { isActive: true, status: 'ACTIVE', role: { in: ['MEMBER', 'TEAM_LEAD', 'SUB_DEPT_LEAD'] }, departmentId: null } })
      return { category: C, name: 'People without a department', result: n ? 'WARN' : 'PASS', detail: n ? `${n} active ${n === 1 ? 'person has' : 'people have'} no department, so their menus are empty` : 'Everyone has a department' }
    }),
    ...await safe(C, 'Sign-ups waiting', async () => {
      const n = await prisma.user.count({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 3 * day) } } })
      return { category: C, name: 'Sign-ups waiting', result: n ? 'WARN' : 'PASS', detail: n ? `${n} Team Lead sign-up${n === 1 ? '' : 's'} waiting over 3 days` : 'None waiting long' }
    }),
  ]
}

function certDaysLeft(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = s.getPeerCertificate()
      s.end()
      if (!cert?.valid_to) return reject(new Error('No certificate'))
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400_000))
    })
    s.on('error', reject)
    s.on('timeout', () => { s.destroy(); reject(new Error('Timed out')) })
  })
}

async function websiteChecks(): Promise<CheckRow[]> {
  const C = 'website'
  const rows: CheckRow[] = []
  const site = (process.env.APP_URL || '').replace(/\/+$/, '')
  if (!site || process.env.NODE_ENV === 'test') {
    rows.push({ category: C, name: 'Website', result: 'SKIP', detail: 'APP_URL is not set' })
  } else {
    rows.push(...await safe(C, 'Home page', async () => {
      const { v: res, ms } = await timed(() => fetch(site + '/', { signal: AbortSignal.timeout(10_000) }))
      const html = await res.text()
      if (!res.ok || !html.includes('id="root"')) return { category: C, name: 'Home page', result: 'FAIL', ms, status: res.status, detail: `The page did not load properly (${res.status})` }
      const out: CheckRow[] = [{ category: C, name: 'Home page', result: ms > SLOW_MS ? 'WARN' : 'PASS', ms, status: res.status, detail: `Loads in ${ms} ms` }]
      const js = html.match(/<script[^>]+src="([^"]+\.(?:js|tsx?))"/)?.[1]
      if (js) {
        const a = await fetch(new URL(js, site + '/').toString(), { signal: AbortSignal.timeout(10_000) })
        out.push({ category: C, name: 'App files', result: a.ok ? 'PASS' : 'FAIL', status: a.status, detail: a.ok ? 'The app code loads' : `The app code did not load (${a.status}), people may see a blank page` })
      }
      return out
    }))
    rows.push(...await safe(C, 'API through the public address', async () => {
      const { v: res, ms } = await timed(() => fetch(site + '/api/health', { signal: AbortSignal.timeout(10_000) }))
      const body = (await res.json().catch(() => ({}))) as { status?: string; db?: string }
      const ok = res.ok && body.status === 'ok' && body.db === 'up'
      return { category: C, name: 'API through the public address', result: ok ? 'PASS' : 'FAIL', ms, status: res.status, detail: ok ? 'Reachable' : `Not answering properly (${res.status})` }
    }))
    if (site.startsWith('https://')) {
      rows.push(...await safe(C, 'SSL certificate', async () => {
        const days = await certDaysLeft(new URL(site).hostname)
        return { category: C, name: 'SSL certificate', result: days < 3 ? 'FAIL' : days < 14 ? 'WARN' : 'PASS', detail: `${days} days left` }
      }))
    }
  }
  if (!uptimeConfigured()) rows.push({ category: C, name: 'Outside uptime check', result: 'SKIP', detail: 'Not set up yet (UPTIME_TOKEN)' })
  else {
    const last = lastUptimePing()
    const since = last ? Date.now() - last.getTime() : null
    rows.push({ category: C, name: 'Outside uptime check', result: since !== null && since < 10 * 60_000 ? 'PASS' : 'WARN', detail: since === null ? 'No word from the outside checker since the app started' : `Last heard ${ago(since)} ago` })
  }
  return rows
}

// --- A run ----------------------------------------------------------------------------------

const isProblem = (r: CheckResult) => r === 'FAIL' || r === 'WARN'

let current: Promise<string> | null = null

export interface StartOpts { trigger: 'schedule' | 'manual' | 'claude'; startedById?: string | null; concurrency?: number }

/** Start a run in the background. If one is already going, its id comes back instead. */
export async function startAudit(opts: StartOpts): Promise<{ runId: string; already: boolean }> {
  const going = await prisma.auditRun.findFirst({ where: { state: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } }, orderBy: { startedAt: 'desc' } })
  if (going) return { runId: going.id, already: true }
  await prisma.auditRun.updateMany({ where: { state: 'RUNNING' }, data: { state: 'FAILED', finishedAt: new Date() } })
  const run = await prisma.auditRun.create({ data: { trigger: opts.trigger, startedById: opts.startedById ?? null } })
  current = finishRun(run.id, opts).finally(() => { current = null })
  current.catch((e) => console.error('[health] self check failed', e)) // eslint-disable-line no-console
  return { runId: run.id, already: false }
}

/** Start a run and wait for it (the schedule and tests use this). */
export async function runAuditNow(opts: StartOpts): Promise<string> {
  const { runId, already } = await startAudit(opts)
  if (!already && current) await current
  return runId
}

async function finishRun(runId: string, opts: StartOpts): Promise<string> {
  const started = Date.now()
  const checks: CheckRow[] = []
  checks.push(...await databaseChecks())
  checks.push(...await serverChecks())
  checks.push(...await serviceChecks())
  checks.push(...await jobChecks())
  checks.push(...await dataChecks())
  checks.push(...await websiteChecks())
  checks.push(...await apiChecks(opts.concurrency ?? 4))

  // Compare with the run before: what newly broke, what got fixed.
  const prev = await prisma.auditRun.findFirst({ where: { id: { not: runId }, state: { not: 'RUNNING' }, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: { id: true, state: true } })
  const before = new Map<string, CheckResult>()
  if (prev) for (const c of await prisma.auditCheck.findMany({ where: { runId: prev.id }, select: { category: true, name: true, result: true } })) before.set(`${c.category}|${c.name}`, c.result)
  const rows: Prisma.AuditCheckCreateManyInput[] = checks.map((c) => {
    const was = before.get(`${c.category}|${c.name}`)
    const isNew = isProblem(c.result) && (prev ? !was || !isProblem(was) || (c.result === 'FAIL' && was === 'WARN') : c.result === 'FAIL')
    const fixed = c.result === 'PASS' && !!was && isProblem(was)
    return { runId, category: c.category, name: c.name.slice(0, 300), result: c.result, ms: c.ms ?? null, status: c.status ?? null, detail: c.detail?.slice(0, 500) ?? null, isNew, fixed }
  })
  await prisma.auditCheck.createMany({ data: rows })

  const count = (r: CheckResult) => rows.filter((x) => x.result === r).length
  const failed = count('FAIL')
  const warned = count('WARN')
  const state: AuditState = failed ? 'FAILED' : warned ? 'WARN' : 'PASSED'
  const newFails = rows.filter((r) => r.isNew && r.result === 'FAIL')
  await prisma.auditRun.update({
    where: { id: runId },
    data: {
      state, finishedAt: new Date(), durationMs: Date.now() - started, total: rows.length,
      passed: count('PASS'), warned, failed, skipped: count('SKIP'),
      newProblems: rows.filter((r) => r.isNew).length, fixed: rows.filter((r) => r.fixed).length,
    },
  })

  if (newFails.length) {
    await alertDevelopers({
      title: `Self check: ${newFails.length} new problem${newFails.length === 1 ? '' : 's'}`,
      body: newFails.slice(0, 2).map((r) => `${r.name}${r.detail ? `: ${r.detail}` : ''}`).join(' · ').slice(0, 180),
      link: `/app/admin/health?run=${runId}`,
      key: `audit:${newFails.map((r) => r.name).sort().join('|')}`,
    })
  } else if (prev?.state === 'FAILED' && !failed) {
    await alertDevelopers({ title: 'Self check: all clear again', body: 'Every check that was failing passes now.', link: `/app/admin/health?run=${runId}`, key: `audit:clear:${runId}` })
  }

  await pruneHealth().catch(() => undefined)
  return runId
}

/** Keep the log small: 30 days of errors and runs, and only problems for runs older than 3 days. */
export async function pruneHealth(): Promise<void> {
  const day = 86400_000
  const now = Date.now()
  await prisma.errorEvent.deleteMany({ where: { at: { lt: new Date(now - 30 * day) } } })
  await prisma.errorGroup.deleteMany({ where: { state: { in: ['RESOLVED', 'IGNORED'] }, lastSeenAt: { lt: new Date(now - 60 * day) } } })
  await prisma.auditCheck.deleteMany({ where: { result: { in: ['PASS', 'SKIP'] }, run: { startedAt: { lt: new Date(now - 3 * day) } } } })
  await prisma.auditRun.deleteMany({ where: { startedAt: { lt: new Date(now - 30 * day) } } })
  await prisma.uptimeEvent.deleteMany({ where: { downAt: { lt: new Date(now - 90 * day) } } })
}

/** When the next scheduled run is (minute 17 of every hour). */
export function nextRunAt(now = new Date()): Date {
  const d = new Date(now)
  d.setUTCSeconds(0, 0)
  if (d.getUTCMinutes() >= 17) d.setUTCHours(d.getUTCHours() + 1)
  d.setUTCMinutes(17)
  return d
}

/** Every hour at :17, and once 3 minutes after the app starts (so a deploy gets checked). */
export function startHealthAudit(): void {
  if (process.env.HEALTH_AUDIT === 'off') return
  const run = () => { runTracked('health-audit', () => runAuditNow({ trigger: 'schedule' })).catch(() => undefined) }
  cron.schedule('17 * * * *', run)
  setTimeout(run, 3 * 60_000).unref()
  console.log('[health] hourly self check started (every hour at :17)') // eslint-disable-line no-console
}
