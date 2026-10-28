import type { CurrentUser } from './types'

/**
 * The financial system is for people with the finance power (Phase 1, step 4), not for the
 * Super Admin role, so no other admin at 99 Technologies sees it. The server decides who has it
 * (server/src/lib/permissions.ts) and sends it with the signed-in person.
 */
export function canViewFinance(user: Pick<CurrentUser, 'permissions'> | null | undefined): boolean {
  return !!user?.permissions?.includes('finance')
}
