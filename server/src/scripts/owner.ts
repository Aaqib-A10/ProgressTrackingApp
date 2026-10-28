// The owner account of the Metriq owner console (erp, step 0). Run with a command, never in code:
//   npx tsx src/scripts/owner.ts create      set up the owner (once): name, email, password
//   npx tsx src/scripts/owner.ts password    choose a new password
//   npx tsx src/scripts/owner.ts code-on     also ask for a 6 digit code from a phone app at sign in
//   npx tsx src/scripts/owner.ts code-off    password only again
//   npx tsx src/scripts/owner.ts unlock      lift a lock after wrong tries
// On your PC: npm run dev:erp -- owner create   (same commands after "owner")
// The password is typed here (hidden) and stored only as a hash. Every change ends open sessions.
import readline from 'node:readline'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { newTotpSecret, checkTotp, otpauthUrl } from '../lib/totp'

const prisma = new PrismaClient()

/** At least 8 characters with letters and numbers (Anees, Oct 2026: keep it simple for now). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (pw.length > 200) return 'That is too long.'
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use letters and numbers.'
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

async function choosePassword(): Promise<string> {
  for (;;) {
    const a = await ask('New password (hidden, 8+ characters, letters and numbers): ', true)
    const bad = passwordProblem(a)
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
    if (existing) { console.log(`The owner already exists (${existing.email}). Use "password" to change the password.`); return }
    const name = (await ask('Your name: ')) || 'Owner'
    const email = (await ask('Your email (to sign in): ')).toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.log('That is not an email address. Nothing was saved.'); return }
    const password = await choosePassword()
    await prisma.platformOwner.create({ data: { name, email, passwordHash: await hashPassword(password) } })
    await prisma.ownerAuditLog.create({ data: { action: 'OWNER_CREATED', target: email } })
    console.log('\nDone. Sign in at /owner (on your PC: http://localhost:5173/owner) with your email and password.')
    return
  }
  if (!existing) { console.log('There is no owner yet. Run: npx tsx src/scripts/owner.ts create'); return }
  if (cmd === 'password') {
    const password = await choosePassword()
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), sessionsFrom: new Date(), failedLogins: 0, lockedUntil: null } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'PASSWORD_CHANGED' } })
    console.log('Password changed. Any open owner session was signed out.')
  } else if (cmd === 'code-on' || cmd === 'new-code') {
    const totpSecret = await setUpCode(existing.email)
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { totpSecret, sessionsFrom: new Date() } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'CODE_RESET' } })
    console.log('Done. Sign in now asks for the 6 digit code from the phone app too.')
  } else if (cmd === 'code-off') {
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { totpSecret: null } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'CODE_OFF' } })
    console.log('Done. Sign in asks for the password only.')
  } else if (cmd === 'unlock') {
    await prisma.platformOwner.update({ where: { id: existing.id }, data: { failedLogins: 0, lockedUntil: null } })
    await prisma.ownerAuditLog.create({ data: { ownerId: existing.id, action: 'UNLOCKED' } })
    console.log('Unlocked. You can sign in again.')
  } else {
    console.log('Use one of: create, password, code-on, code-off, unlock')
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
}
