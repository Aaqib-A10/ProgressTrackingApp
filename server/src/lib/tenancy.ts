import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma, type PrismaClient } from '@prisma/client'

/**
 * Company walls (Phase 1, steps 2 and 3). Every table that holds a company's data has a
 * `companyId`. While a request runs for a signed-in person, every database read and write it
 * makes is limited to that person's company, here, in one place, so a page or API that forgot
 * to filter cannot show or change another company's records:
 *
 *  - reads, counts, updates and deletes get "and companyId = this company" added;
 *  - new rows (and rows created inside them) get this company's id;
 *  - changing a row's company is refused.
 *
 * The database adds the rest (trigger per table, see scripts/companyWallsSql.ts): a row that
 * points at a record of another company is refused, and a row saved without a company (a
 * background job, a script) takes the company of the record it belongs to.
 *
 * Outside a request (jobs, scripts, the owner console) nothing is limited. Jobs that work
 * company by company wrap each company in `runAsCompany`.
 *
 * The owner can turn the read walls off with the "company-walls" switch (an emergency brake
 * for while 99 Technologies is the only company); new rows still get their company.
 */

type Ctx = { companyId: string; timeZone?: string }
const als = new AsyncLocalStorage<Ctx | null>()

/**
 * Run fn (and everything it awaits) as this company. fn's result is awaited inside, because a
 * Prisma query only runs when it is awaited and must run while the company is set.
 */
export function runAsCompany<T>(companyId: string, fn: () => T | PromiseLike<T>, timeZone?: string): Promise<T> {
  const ctx: Ctx = { companyId, timeZone }
  return als.run(ctx, async () => {
    if (!ctx.timeZone) ctx.timeZone = await timeZoneOf(companyId)
    return await fn()
  })
}

// Each company's time zone, kept for a minute (the loader is set by lib/prisma).
const zones = new Map<string, { tz: string | undefined; at: number }>()
let zoneLoader: ((companyId: string) => Promise<string | undefined>) | null = null
export function setTimeZoneLoader(fn: (companyId: string) => Promise<string | undefined>): void { zoneLoader = fn }
async function timeZoneOf(companyId: string): Promise<string | undefined> {
  const hit = zones.get(companyId)
  if (hit && Date.now() - hit.at < 60_000) return hit.tz
  const tz = zoneLoader ? await zoneLoader(companyId).catch(() => undefined) : undefined
  zones.set(companyId, { tz, at: Date.now() })
  return tz
}
/** After a company's time zone changes. */
export function forgetTimeZone(companyId: string): void { zones.delete(companyId) }

/** The time zone of the company the current request runs as (set when it started), if known. */
export function contextTimeZone(): string | undefined {
  return als.getStore()?.timeZone
}

/** Run fn with no company: nothing is limited (owner console, jobs that look at every company). */
export function runAsSystem<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return als.run(null, async () => await fn())
}

/** The company the current request runs as, or null outside one. */
export function maybeCompanyId(): string | null {
  return als.getStore()?.companyId ?? null
}

/** The company the current request runs as. Throws outside a request. */
export function currentCompanyId(): string {
  const id = maybeCompanyId()
  if (!id) throw new Error('No company here: this code must run inside a signed-in request or runAsCompany()')
  return id
}

// ------------------------------------------------------------------ what the schema says

type RelField = { name: string; target: string; isList: boolean; from: string[]; to: string[] }
type ModelInfo = { tenant: boolean; rels: Map<string, RelField> }

/** Tables that have a companyId but are run by the owner, not by a company. */
export const NOT_WALLED = new Set(['FeatureFlagCompany', 'OwnerAuditLog', 'Company', 'CompanyUsage'])

const MODELS = new Map<string, ModelInfo>()
for (const m of Prisma.dmmf.datamodel.models) {
  const hasCompany = m.fields.some((f) => f.name === 'companyId' && f.kind === 'scalar')
  const rels = new Map<string, RelField>()
  for (const f of m.fields) {
    if (f.kind !== 'object') continue
    const r: RelField = { name: f.name, target: f.type, isList: f.isList, from: [...(f.relationFromFields ?? [])], to: [...(f.relationToFields ?? [])] }
    rels.set(f.name, r)
  }
  MODELS.set(m.name, { tenant: hasCompany && !NOT_WALLED.has(m.name), rels })
}

export const isWalled = (model: string | undefined): boolean => !!model && !!MODELS.get(model)?.tenant
export const walledModels = (): string[] => [...MODELS.entries()].filter(([, i]) => i.tenant).map(([n]) => n)
const companyRelName = (model: string): string | undefined => [...(MODELS.get(model)?.rels.values() ?? [])].find((r) => r.target === 'Company' && r.from[0] === 'companyId')?.name

// ------------------------------------------------------------------ the walls

export class CompanyWallError extends Error {
  status = 404
  constructor(message: string) { super(message); this.name = 'CompanyWallError' }
}

/** The database refused a row that points at another company's record (the walls trigger). */
export const isWallRefusal = (err: unknown): boolean => err instanceof CompanyWallError || (err instanceof Error && err.message.includes('metriq company wall'))

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Prisma.Decimal)
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

function addWhere(where: unknown, companyId: string): Obj {
  const w: Obj = isObj(where) ? { ...where } : {}
  const and = asList(w.AND)
  w.AND = [...and, { companyId }]
  return w
}

/**
 * Does this create data use Prisma's "checked" form (a to-one relation such as
 * `user: { connect }` instead of the scalar `userId`)? Then the company must be set as a relation
 * too; otherwise as the scalar companyId. (List relations such as `tasks: { create }` work in both.)
 */
function usesRelations(model: string, data: Obj): boolean {
  const info = MODELS.get(model)
  if (!info) return false
  const keys = Object.keys(data)
  const scalarFks = new Set([...info.rels.values()].flatMap((r) => r.from))
  if (keys.some((k) => scalarFks.has(k))) return false
  return keys.some((k) => { const r = info.rels.get(k); return !!r && !r.isList })
}

/** Put the company on a row being created and on every row created inside it. */
function prepareCreate(model: string, data: unknown, companyId: string): Obj {
  if (!isObj(data)) return data as Obj
  const out: Obj = { ...data }
  const info = MODELS.get(model)
  if (info?.tenant) {
    const rel = companyRelName(model)
    if (out.companyId !== undefined && out.companyId !== companyId) throw new CompanyWallError('That belongs to another company')
    const relVal = rel ? out[rel] : undefined
    if (isObj(relVal)) {
      const c = isObj(relVal.connect) ? relVal.connect.id : undefined
      if (c !== companyId) throw new CompanyWallError('That belongs to another company')
    } else if (out.companyId === undefined) {
      if (rel && usesRelations(model, out)) out[rel] = { connect: { id: companyId } }
      else out.companyId = companyId
    }
  }
  walkRelations(model, out, companyId)
  return out
}

function prepareUpdate(model: string, data: unknown, companyId: string): Obj {
  if (!isObj(data)) return data as Obj
  const out: Obj = { ...data }
  const info = MODELS.get(model)
  if (info?.tenant) {
    const rel = companyRelName(model)
    const cv = out.companyId
    const setTo = isObj(cv) ? cv.set : cv
    if (setTo !== undefined && setTo !== companyId) throw new CompanyWallError('A record cannot be moved to another company')
    if (rel && out[rel] !== undefined) throw new CompanyWallError('A record cannot be moved to another company')
  }
  walkRelations(model, out, companyId)
  return out
}

/** Nested writes: rows created inside other rows get the company too. */
function walkRelations(model: string, out: Obj, companyId: string): void {
  const info = MODELS.get(model)
  if (!info) return
  for (const [key, value] of Object.entries(out)) {
    const r = info.rels.get(key)
    if (!r || !isObj(value) || r.target === 'Company') continue
    const v: Obj = { ...value }
    const t = r.target
    if (v.create !== undefined) v.create = Array.isArray(v.create) ? v.create.map((d) => prepareCreate(t, d, companyId)) : prepareCreate(t, v.create, companyId)
    if (isObj(v.createMany) && Array.isArray(v.createMany.data)) v.createMany = { ...v.createMany, data: v.createMany.data.map((d) => prepareCreate(t, d, companyId)) }
    if (v.connectOrCreate !== undefined) {
      const one = (x: unknown) => (isObj(x) ? { ...x, create: prepareCreate(t, x.create, companyId), where: isWalled(t) ? addWhere(x.where, companyId) : x.where } : x)
      v.connectOrCreate = Array.isArray(v.connectOrCreate) ? v.connectOrCreate.map(one) : one(v.connectOrCreate)
    }
    if (v.upsert !== undefined) {
      const one = (x: unknown) => (isObj(x) ? { ...x, create: prepareCreate(t, x.create, companyId), update: prepareUpdate(t, x.update, companyId) } : x)
      v.upsert = Array.isArray(v.upsert) ? v.upsert.map(one) : one(v.upsert)
    }
    if (v.update !== undefined) {
      const one = (x: unknown) => (isObj(x) && 'data' in x ? { ...x, data: prepareUpdate(t, x.data, companyId) } : prepareUpdate(t, x, companyId))
      v.update = Array.isArray(v.update) ? v.update.map(one) : one(v.update)
    }
    out[key] = v
  }
}

// ------------------------------------------------------------------ the switch

// Read without waiting: the hook never waits for a database connection of its own (inside a
// transaction that could wait for ever when every connection is busy). Starts on.
let walls = { on: true, at: 0, loading: false }
function wallsOn(base: PrismaClient): boolean {
  if (!walls.loading && Date.now() - walls.at > 15_000) {
    walls.loading = true
    base.featureFlag.findUnique({ where: { key: 'company-walls' }, select: { enabled: true } })
      .then((r) => { walls = { on: r?.enabled ?? true, at: Date.now(), loading: false } })
      .catch(() => { walls = { ...walls, at: Date.now(), loading: false } })
  }
  return walls.on
}
/** Tests and the owner's switch: read the switch again now. */
export async function refreshWalls(base: PrismaClient): Promise<boolean> {
  const r = await base.featureFlag.findUnique({ where: { key: 'company-walls' }, select: { enabled: true } }).catch(() => null)
  walls = { on: r?.enabled ?? true, at: Date.now(), loading: false }
  return walls.on
}

const READS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])
const WHERE_WRITES = new Set(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert'])

/** The walls, as a step in the Prisma query hook (lib/prisma). `base` is the plain client. */
export function applyWalls(base: PrismaClient, model: string | undefined, operation: string, args: Obj): Obj {
  const companyId = maybeCompanyId()
  if (!companyId || !model || !MODELS.has(model)) return args
  const a: Obj = { ...args }
  if (isWalled(model) && wallsOn(base) && (READS.has(operation) || WHERE_WRITES.has(operation))) a.where = addWhere(a.where, companyId)
  if (operation === 'create') a.data = prepareCreate(model, a.data, companyId)
  else if (operation === 'createMany' || operation === 'createManyAndReturn') a.data = asList(a.data).map((d) => prepareCreate(model, d, companyId))
  else if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') a.data = prepareUpdate(model, a.data, companyId)
  else if (operation === 'upsert') { a.create = prepareCreate(model, a.create, companyId); a.update = prepareUpdate(model, a.update, companyId) }
  return a
}
