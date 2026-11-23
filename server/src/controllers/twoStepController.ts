import type { Request, Response } from 'express'
import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'
import { verifyTwoStepTicket } from '../lib/auth'
import { checkTotp, newTotpSecret, otpauthUrl } from '../lib/totp'
import { recordActivity } from '../lib/audit'
import { completeSignIn } from './authController'

/**
 * Two-step sign-in for company users: after the password, a 6-digit code from an authenticator app (Google
 * Authenticator, Microsoft Authenticator, Authy, 1Password and the like).
 *
 *  - A person turns it on in Settings: start (a secret to scan), confirm (a first code proves the app works), and
 *    they get 8 recovery codes, shown once. Each recovery code signs in once when the phone is not at hand.
 *  - A company can require it (Company settings): until a person has set it up, they can sign in but only reach the
 *    setup (enforced in middleware/auth).
 *  - A Super Admin can turn it off for someone who lost their phone; that is written to the Activity Log.
 *
 * Nothing here ever returns the secret or a recovery code after setup, and none of it is logged.
 */

const RECOVERY_COUNT = 8
const tidy = (code: string) => code.replace(/[^a-z0-9]/gi, '').toLowerCase()
const hashCode = (code: string) => createHash('sha256').update(tidy(code)).digest('hex')

/** Eight codes like "k7m2p-9xq4r": letters and digits that are hard to misread (no 0/o, 1/l/i). */
function newRecoveryCodes(): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = randomBytes(10)
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
}

type Holder = { id: string; totpSecret: string | null; twoStepRecovery: string[] }

/** Does this code open the account? A 6-digit app code, or a recovery code (which is used up when it works). */
async function acceptCode(user: Holder, raw: string): Promise<'app' | 'recovery' | null> {
  const code = raw.trim()
  if (!user.totpSecret) return null
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) return checkTotp(user.totpSecret, code.replace(/\s/g, '')) ? 'app' : null
  const hash = hashCode(code)
  if (tidy(code).length !== 10 || !user.twoStepRecovery.includes(hash)) return null
  await prisma.user.update({ where: { id: user.id }, data: { twoStepRecovery: user.twoStepRecovery.filter((h) => h !== hash) } })
  return 'recovery'
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) })

/** POST /api/auth/login/two-step { ticket, code } — the second step of signing in. */
export async function loginTwoStep(req: Request, res: Response): Promise<void> {
  const parsed = z.object({ ticket: z.string().min(1), code: z.string().trim().min(6).max(20) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app.' }); return }
  let userId: string
  try { userId = verifyTwoStepTicket(parsed.data.ticket) } catch { res.status(401).json({ error: 'That took too long. Sign in again.' }); return }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, status: true, totpSecret: true, twoStepOn: true, twoStepRecovery: true } })
  if (!user || !user.isActive || user.status !== 'ACTIVE' || !user.twoStepOn) { res.status(401).json({ error: 'Sign in again.' }); return }
  const how = await acceptCode(user, parsed.data.code)
  if (!how) { res.status(401).json({ error: 'That code is not right. Check the app and try again.' }); return }
  await completeSignIn(req, res, user, how === 'recovery' ? { recoveryLeft: user.twoStepRecovery.length - 1 } : {})
}

async function holder(req: AuthedRequest) {
  return prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, email: true, totpSecret: true, twoStepOn: true, twoStepRecovery: true, company: { select: { name: true, requireTwoStep: true } } } })
}

/** GET /api/auth/me/two-step — is it on, since when, how many recovery codes are left, does the company require it. */
export async function twoStepStatus(req: AuthedRequest, res: Response): Promise<void> {
  const u = await holder(req)
  res.json({ on: !!u.twoStepOn, since: u.twoStepOn, recoveryLeft: u.twoStepOn ? u.twoStepRecovery.length : 0, required: u.company.requireTwoStep })
}

/** POST /api/auth/me/two-step/start — a new secret to scan. It does nothing until a first code confirms it. */
export async function twoStepStart(req: AuthedRequest, res: Response): Promise<void> {
  const u = await holder(req)
  if (u.twoStepOn) { res.status(409).json({ error: 'Two-step sign-in is already on.' }); return }
  const secret = newTotpSecret()
  await prisma.user.update({ where: { id: u.id }, data: { totpSecret: secret, twoStepRecovery: [] } })
  res.json({ secret, url: otpauthUrl(secret, u.email, 'Metriq') })
}

/** POST /api/auth/me/two-step/confirm { code } — the app works: turn it on and hand out the recovery codes (once). */
export async function twoStepConfirm(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = codeSchema.safeParse(req.body)
  const u = await holder(req)
  if (u.twoStepOn) { res.status(409).json({ error: 'Two-step sign-in is already on.' }); return }
  if (!parsed.success || !u.totpSecret || !checkTotp(u.totpSecret, parsed.data.code.replace(/\s/g, ''))) {
    res.status(400).json({ error: 'That code is not right. Enter the 6 digits your app shows now.' })
    return
  }
  const codes = newRecoveryCodes()
  await prisma.user.update({ where: { id: u.id }, data: { twoStepOn: new Date(), twoStepRecovery: codes.map(hashCode) } })
  await recordActivity(u.id, 'TWO_STEP_ON', 'User', u.id)
  res.json({ on: true, recoveryCodes: codes })
}

/** POST /api/auth/me/two-step/recovery { code } — a fresh set of recovery codes (the old ones stop working). */
export async function twoStepNewRecovery(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = codeSchema.safeParse(req.body)
  const u = await holder(req)
  if (!u.twoStepOn) { res.status(409).json({ error: 'Two-step sign-in is off.' }); return }
  if (!parsed.success || (await acceptCode(u, parsed.data.code)) !== 'app') { res.status(400).json({ error: 'Enter the 6-digit code from your app.' }); return }
  const codes = newRecoveryCodes()
  await prisma.user.update({ where: { id: u.id }, data: { twoStepRecovery: codes.map(hashCode) } })
  await recordActivity(u.id, 'TWO_STEP_RECOVERY_RENEWED', 'User', u.id)
  res.json({ recoveryCodes: codes })
}

/** POST /api/auth/me/two-step/off { code } — turn it off (an app code or a recovery code proves it is them). */
export async function twoStepOff(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = codeSchema.safeParse(req.body)
  const u = await holder(req)
  if (!u.twoStepOn) { res.json({ on: false }); return }
  if (!parsed.success || !(await acceptCode(u, parsed.data.code))) { res.status(400).json({ error: 'That code is not right.' }); return }
  await prisma.user.update({ where: { id: u.id }, data: { totpSecret: null, twoStepOn: null, twoStepRecovery: [] } })
  await recordActivity(u.id, 'TWO_STEP_OFF', 'User', u.id)
  res.json({ on: false, required: u.company.requireTwoStep })
}

/**
 * POST /api/admin/users/:id/two-step-off — a Super Admin turns it off for someone who lost their phone. The person
 * signs in with their password alone until they set it up again (at once, when the company requires it).
 */
export async function adminTwoStepOff(req: AuthedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Forbidden' }); return }
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, twoStepOn: true } })
  if (!target) { res.status(404).json({ error: 'User not found' }); return }
  if (target.id === req.user!.id) { res.status(400).json({ error: 'Turn your own two-step sign-in off from Settings.' }); return }
  if (target.twoStepOn) {
    await prisma.user.update({ where: { id: target.id }, data: { totpSecret: null, twoStepOn: null, twoStepRecovery: [] } })
    await recordActivity(req.user!.id, 'TWO_STEP_OFF_BY_ADMIN', 'User', target.id, { after: { name: target.name } })
  }
  res.json({ ok: true })
}
