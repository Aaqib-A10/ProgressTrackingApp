import type { Response } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from './prisma'
import { walledTables } from '../scripts/companyWallsSql'

/**
 * A company's own data: hand all of it out as one file, and remove all of it for good. Used by the owner console
 * and by the company's own admins (Company settings → Your data), so both give exactly the same file.
 */

/** Never handed out: passwords, sign-in secrets and keys. Everything else the company made is theirs to take. */
const SECRET_FIELDS = new Set(['passwordHash', 'tokenHash', 'totpSecret', 'twoStepRecovery', 'token', 'guestToken', 'secret'])

/**
 * Stream every record of the company as one JSON file: { exportedAt, company, tables: { <Table>: [rows] } }.
 * Tables are read a thousand rows at a time, so a big company does not fill the server's memory.
 */
export async function streamCompanyExport(res: Response, c: { id: string; slug: string } & Record<string, unknown>): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="metriq-${c.slug}-${new Date().toISOString().slice(0, 10)}.json"`)
  res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"company":${JSON.stringify(c)},"tables":{`)
  let first = true
  for (const t of walledTables()) {
    const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Record<string, unknown>[]> }>)[t.table[0].toLowerCase() + t.table.slice(1)]
    res.write(`${first ? '' : ','}${JSON.stringify(t.table)}:[`)
    first = false
    let skip = 0
    for (;;) {
      const rows = await delegate.findMany({ where: { companyId: c.id }, take: 1000, skip })
      rows.forEach((r, i) => {
        const safe = Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_FIELDS.has(k)))
        res.write(`${skip + i ? ',' : ''}${JSON.stringify(safe)}`)
      })
      if (rows.length < 1000) break
      skip += rows.length
    }
    res.write(']')
  }
  res.end('}}')
}

/** Remove a company and everything it has, for good: its records (they hang off the company) and its files. */
export async function removeCompany(companyId: string): Promise<void> {
  await prisma.company.delete({ where: { id: companyId } })
  for (const area of ['', 'chat', 'projects', 'docs']) await fs.rm(path.resolve('uploads', area, companyId), { recursive: true, force: true }).catch(() => undefined)
}
