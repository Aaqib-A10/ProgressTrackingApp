import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { maybeCompanyId } from './tenancy'
import { HOME_COMPANY_ID } from './company'

/**
 * Files people upload are kept per company (Phase 1, step 3): another company's files go in a
 * folder of their own (uploads/<area>/<companyId>/...). 99 Technologies keeps the layout it
 * always had, so none of its files move. The stored name (saved in the database) includes the
 * folder, so reading a file back works the same everywhere.
 */
export function companyFileName(ext?: string | null, prefix = ''): string {
  const name = `${prefix}${randomUUID()}${ext ? `.${ext}` : ''}`
  const companyId = maybeCompanyId()
  return companyId && companyId !== HOME_COMPANY_ID ? `${companyId}/${name}` : name
}

/** Make sure the folder for this stored name exists. */
export async function ensureFolderFor(dir: string, storedName: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(dir, storedName)), { recursive: true })
}
