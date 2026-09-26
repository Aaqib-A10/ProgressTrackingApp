import type { CurrentUser } from './types'

/**
 * The financial system is restricted to specific people (Aqib) by identity — not to the
 * SUPER_ADMIN role — so no other admin sees it. Mirrors the server allowlist in
 * server/src/lib/financeAccess.ts (keep the two in sync).
 */
export const FINANCE_EMAILS = ['aqibalishehzad3@gmail.com']

export function canViewFinance(user: CurrentUser | null | undefined): boolean {
  return !!user && FINANCE_EMAILS.includes(user.email.toLowerCase())
}
