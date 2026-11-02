import crypto from 'node:crypto'
import cron from 'node-cron'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import type { LeadBusiness } from '@prisma/client'
import { prisma } from '../prisma'
import { forEachCompany } from '../company'
import { runTracked } from '../health/jobs'
import { isOn } from '../flags'
import { maybeCompanyId } from '../tenancy'
import { fromFields, receiveLead, type LeadInput } from './intake'

/**
 * Lead Management: an email inbox per business (any mailbox that allows IMAP: Google Workspace,
 * Microsoft 365, cPanel mail...). Every 2 minutes new emails become leads. Only emails that arrive
 * after the inbox is switched on are read; nothing is moved, marked or deleted in the mailbox.
 *
 * The mailbox password is stored encrypted (AES-256-GCM). The key comes from LEADS_INBOX_KEY in the
 * server's .env (32 bytes, base64) or, when that is not set, one the server makes once and keeps in
 * the database. It is never sent back to the browser.
 */

let keyP: Promise<Buffer> | null = null
async function loadKey(): Promise<Buffer> {
  const env = process.env.LEADS_INBOX_KEY
  if (env) {
    const k = Buffer.from(env, 'base64')
    if (k.length === 32) return k
    console.warn('[lead-inbox] LEADS_INBOX_KEY is not 32 bytes of base64; using the stored key')
  }
  const row = await prisma.appSecret.findUnique({ where: { name: 'lead-inbox-key' } })
  if (row) return Buffer.from(row.value, 'base64')
  await prisma.appSecret.createMany({ data: [{ name: 'lead-inbox-key', value: crypto.randomBytes(32).toString('base64') }], skipDuplicates: true })
  const saved = await prisma.appSecret.findUniqueOrThrow({ where: { name: 'lead-inbox-key' } })
  return Buffer.from(saved.value, 'base64')
}
function inboxKey(): Promise<Buffer> {
  if (!keyP) { keyP = loadKey(); keyP.catch(() => { keyP = null }) }
  return keyP
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', await inboxKey(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export async function decryptSecret(box: string): Promise<string> {
  const [v, iv, tag, ct] = box.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Stored password is not readable')
  const d = crypto.createDecipheriv('aes-256-gcm', await inboxKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

type InboxBusiness = Pick<LeadBusiness, 'id' | 'name' | 'inboxHost' | 'inboxPort' | 'inboxSecure' | 'inboxUser' | 'inboxPassEnc' | 'inboxFolder' | 'inboxLastUid'>

async function connect(b: Pick<InboxBusiness, 'inboxHost' | 'inboxPort' | 'inboxSecure' | 'inboxUser'>, pass: string): Promise<ImapFlow> {
  if (!b.inboxHost || !b.inboxUser) throw new Error('Mail server and user name are needed')
  const client = new ImapFlow({
    host: b.inboxHost, port: b.inboxPort, secure: b.inboxSecure, auth: { user: b.inboxUser, pass },
    logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  })
  client.on('error', () => undefined) // a dropped connection must never crash the server
  await client.connect()
  return client
}

/** Try the mailbox settings (Settings, "Test connection"). */
export async function testInbox(b: Pick<InboxBusiness, 'inboxHost' | 'inboxPort' | 'inboxSecure' | 'inboxUser' | 'inboxFolder'>, pass: string): Promise<{ messages: number }> {
  const client = await connect(b, pass)
  try {
    const box = await client.mailboxOpen(b.inboxFolder || 'INBOX', { readOnly: true })
    return { messages: box.exists }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

const LABEL_LINE = /^\s*([A-Za-z][A-Za-z0-9 _/-]{1,40})\s*[:：]\s*(.+?)\s*$/

/**
 * An email as a lead. Website "new form entry" emails usually list the fields as "Name: ...",
 * "Phone: ..." lines: those fill the lead like a form would. Otherwise the sender (or Reply-To) is
 * the person and the email is the message.
 */
export function emailToLead(mail: Pick<ParsedMail, 'from' | 'replyTo' | 'subject' | 'text' | 'messageId'>, mailbox?: string | null): LeadInput {
  const sender = mail.replyTo?.value?.[0] ?? mail.from?.value?.[0]
  const text = (mail.text ?? '').replace(/\r\n/g, '\n')
  // Leave out the quoted part of a reply.
  const body = text.split('\n').filter((l) => !l.startsWith('>')).join('\n').trim()
  const fields: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = LABEL_LINE.exec(line)
    if (m && !(m[1].toLowerCase() in fields)) fields[m[1]] = m[2]
  }
  const fromForm = Object.keys(fields).length >= 2 ? fromFields(fields) : null
  const senderEmail = sender?.address && sender.address.toLowerCase() !== (mailbox ?? '').toLowerCase() ? sender.address : null
  return {
    name: fromForm?.name || sender?.name || '',
    email: fromForm?.email || senderEmail,
    phone: fromForm?.phone || null,
    organization: fromForm?.organization || null,
    location: fromForm?.location || null,
    message: [mail.subject ? `Subject: ${mail.subject}` : '', fromForm?.message && fromForm.message !== body ? fromForm.message : body].filter(Boolean).join('\n\n').slice(0, 8000),
    sourceDetail: mail.subject ?? null,
    utmSource: fromForm?.utmSource, utmMedium: fromForm?.utmMedium, utmCampaign: fromForm?.utmCampaign, utmTerm: fromForm?.utmTerm, gclid: fromForm?.gclid,
    externalId: mail.messageId ?? null,
  }
}

/** Out-of-office replies, bounces and mailing lists are not leads. */
export function isAutomatic(mail: Pick<ParsedMail, 'headers' | 'from'>): boolean {
  const h = (k: string) => String(mail.headers?.get(k) ?? '').toLowerCase()
  const auto = h('auto-submitted')
  if (auto && auto !== 'no') return true
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(h('precedence'))) return true
  if (h('x-autoreply') || h('x-autorespond') || h('list-id') || h('list-unsubscribe')) return true
  const from = mail.from?.value?.[0]?.address?.toLowerCase() ?? ''
  return /^(mailer-daemon|postmaster|no-?reply|donotreply)@/.test(from) && !from.includes('form')
}

/** Read new emails of one business. Returns how many leads were made. */
export async function pollInbox(b: InboxBusiness): Promise<number> {
  if (!b.inboxPassEnc) throw new Error('No password saved')
  const client = await connect(b, await decryptSecret(b.inboxPassEnc))
  let made = 0
  try {
    const lock = await client.getMailboxLock(b.inboxFolder || 'INBOX', { readOnly: true })
    try {
      const box = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null
      const top = box ? Number(box.uidNext) - 1 : 0
      // First time: start from now (old emails are not leads).
      if (b.inboxLastUid === 0 || b.inboxLastUid > top) {
        await prisma.leadBusiness.update({ where: { id: b.id }, data: { inboxLastUid: Math.max(top, 0), inboxCheckedAt: new Date(), inboxError: null } })
        return 0
      }
      if (top <= b.inboxLastUid) {
        await prisma.leadBusiness.update({ where: { id: b.id }, data: { inboxCheckedAt: new Date(), inboxError: null } })
        return 0
      }
      let last = b.inboxLastUid
      let n = 0
      for await (const msg of client.fetch(`${b.inboxLastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= b.inboxLastUid) continue
        if (++n > 50) break // the rest on the next round
        last = Math.max(last, msg.uid)
        if (!msg.source) continue
        const mail = await simpleParser(msg.source)
        if (isAutomatic(mail)) continue
        const input = emailToLead(mail, b.inboxUser)
        input.externalId = input.externalId || `imap:${b.id}:${msg.uid}`
        if (!input.email && !input.phone) continue
        const r = await receiveLead(b, input, { source: 'EMAIL', mergeRepeats: true })
        if (!r.duplicate && !r.repeat) made++
      }
      await prisma.leadBusiness.update({ where: { id: b.id }, data: { inboxLastUid: last, inboxCheckedAt: new Date(), inboxError: null } })
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
  return made
}

export async function runLeadInboxTick(): Promise<void> {
  const companyId = maybeCompanyId()
  if (companyId && !(await isOn('lead-management', companyId))) return
  const list = await prisma.leadBusiness.findMany({ where: { isActive: true, inboxOn: true, inboxPassEnc: { not: null } } })
  for (const b of list) {
    try {
      await pollInbox(b)
    } catch (e) {
      const msg = ((e as { responseText?: string }).responseText || (e as Error).message || 'Could not read the inbox').slice(0, 300)
      await prisma.leadBusiness.update({ where: { id: b.id }, data: { inboxError: msg, inboxCheckedAt: new Date() } }).catch(() => undefined)
    }
  }
}

let busy = false
export function startLeadInbox(): void {
  cron.schedule('*/2 * * * *', () => {
    if (busy) return // a slow mail server: never two rounds at once
    busy = true
    runTracked('lead-inbox', () => forEachCompany(() => runLeadInboxTick())).catch((e) => console.error('[lead-inbox]', e)).finally(() => { busy = false })
  })
}
