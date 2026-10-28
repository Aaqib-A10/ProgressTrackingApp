// The owner account of the Metriq owner console (erp, step 0). Run ON THE SERVER, never in code:
//   cd ~/pulsetrack/server && npx tsx src/scripts/owner.ts create        set up the owner (once)
//   cd ~/pulsetrack/server && npx tsx src/scripts/owner.ts password      choose a new password
//   cd ~/pulsetrack/server && npx tsx src/scripts/owner.ts new-code      new authenticator key (lost phone)
//   cd ~/pulsetrack/server && npx tsx src/scripts/owner.ts unlock        lift a lock after wrong tries
// The password is typed here (hidden) and stored only as a hash. Every change ends open sessions.
import readline from 'node:readline'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { newTotpSecret, checkTotp, otpauthUrl } from '../lib/totp'

const prisma = new PrismaClient()

/** At least 12 characters, not one of the obvious ones, not mostly one character. */
export function passwordProblem(pw: string, email = ''): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.'
  if (pw.length > 200) return 'That is too long.'
  const lower = pw.toLowerCase()
  if (new Set(lower).size < 6) return 'Use more different characters.'
  const name = email.split('@')[0]?.toLowerCase()
  if (name && name.length >= 3 && lower.includes(name)) return 'Do not use your name or email in it.'
  if (/^(password|metriq|pulsetrack|admin|owner|qwerty|123456|anees)/.test(lower)) return 'That is too easy to guess.'
  return null
}

function ask(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((resolve) => {
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
      out._writeToOutput = (s: string) => { if (s.includes(q)) out.output.write(s); else out.output.write('*') }
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()) })
  })
}

async function choosePassword(email: string): Promise<string> {
  for (;;) {
    const a = await ask('New password (hidden, 12+ characters): ', true)
    const bad = passwordProblem(a, email)
    if (bad) { console.log(bad); continue }
    const b = await ask('Type it again: ', true)
    if (a !== b) { console.log('They do not match. Try again.'); continue }
    return a
  }
}

async function setUpCode(email: string): Promise<string> {
  const secret = newTotpSecret()
  console.log('\nOpen Google Authenticator or Microsoft Authenticator on your phone:')
  console.log('  + (add) > Enter a setup key')
  console.log(`  Account: Metriq Owner (${email})`)
  console.log(`  Key:     ${secret.replace(/(.{4})/g, '$1 ').trim()}`)
  console.log('  Type:    Time based')
  console.log(`  (or a QR code tool can use: ${otpauthUrl(secret, email)})\n`)
  for (;;) {
    const code = await ask('Type the 6 digit code the app shows now: ')
    if (checkTotp(secret, code)) return secret
    console.log('That code does not match. Check the key was typed exactly, then try the newest code.')
  }
}

async function main() {
  const cmd = process.argv[2]
  const existing = await prisma.platformOwner.findFirst()
  if (cmd === 'create') {
    if (existing) { console.log(`The owner already exists (${existing.email}). Use "password" or "new-code" to change it.`); return }
    const name = (await ask('Your name: ')) || 'Owner'
    const email = (await ask('Your email (to sign in): ')).toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.log('That is not an email address. Nothing was saved.'); return }
    const password = await choosePassword(email)
    const totpSecret = await setUpCode(email)
    await prisma.platformOwner.create({ data: { name, email, passwordHash: await hashPassword(password), totpSecret } })
    await prisma.ownerAuditLog.create({ data: { action: 'OWNER_CREATED', target: email } })
    console.log('\nDone. Sign in at /owner (on your PC: http://localhost:5173/owner; live: https://pulsetrack.online/owner) with your email, password and the code from the app.')
    return
  }
  if (!existing) { console.log('There is no owner yet. Run: npx tsx src/scripts/owner.ts create'); return }
  if (cmd === 'password') {
    const password = await choosePassword(existing.email)
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), sessionsFrom: new Date(), failedLogins: 0, lockedUntil: null } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'PASSWORD_CHANGED' } })
    console.log('Password changed. Any open owner session was signed out.')
  } else if (cmd === 'new-code') {
    const totpSecret = await setUpCode(existing.email)
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { totpSecret, sessionsFrom: new Date() } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'CODE_RESET' } })
    console.log('The new authenticator key is saved; the old one no longer works.')
  } else if (cmd === 'unlock') {
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { failedLogins: 0, lockedUntil: null } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'UNLOCKED' } })
    console.log('Unlocked. You can sign in again.')
  } else {
    console.log('Use one of: create, password, new-code, unlock')
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
}
