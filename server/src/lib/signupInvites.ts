import { randomBytes } from 'crypto'
import type { SignupInvite } from '@prisma/client'
import { prisma } from './prisma'
import { isOn } from './flags'

/**
 * Sign-up by invite. While the owner's switch "New companies can sign up" is off, a person can still start a
 * company with an invite link the owner made (owner console → Invites): /start?invite=<code>. A link has a note
 * (who it is for), a number of uses, and optionally a last day. Using it is counted, so a link for one company
 * cannot start five.
 */

const clean = (code: unknown) => (typeof code === 'string' ? code.trim().slice(0, 80) : '')

/** A code that is easy to send and hard to guess. */
export const newInviteCode = (): string => randomBytes(9).toString('base64url')

/** The invite behind a code when it can still be used: it exists, was not withdrawn, has not run out and has uses left. */
export async function usableInvite(code: unknown, now = new Date()): Promise<SignupInvite | null> {
  const c = clean(code)
  if (!c) return null
  const inv = await prisma.signupInvite.findUnique({ where: { code: c } })
  if (!inv || inv.revokedAt || inv.uses >= inv.maxUses || (inv.expiresAt && inv.expiresAt < now)) return null
  return inv
}

/** May a new company sign up right now: the switch is on, or this invite code is good. */
export async function signupAllowed(code: unknown): Promise<{ allowed: boolean; invite: SignupInvite | null }> {
  if (await isOn('new-companies')) return { allowed: true, invite: null }
  const invite = await usableInvite(code)
  return { allowed: !!invite, invite }
}

/**
 * Take one use of the invite (before the company is made). False when someone else just took the last one: two
 * sign-ups at the same moment cannot both get through on a one-use link.
 */
export async function spendInvite(invite: SignupInvite): Promise<boolean> {
  const r = await prisma.signupInvite.updateMany({ where: { id: invite.id, revokedAt: null, uses: { lt: invite.maxUses } }, data: { uses: { increment: 1 } } })
  return r.count === 1
}

/** Give the use back when the sign-up did not happen after all. */
export async function returnInvite(invite: SignupInvite): Promise<void> {
  await prisma.signupInvite.updateMany({ where: { id: invite.id, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } }).catch(() => undefined)
}
