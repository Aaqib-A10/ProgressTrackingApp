import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { cleanInput, fromFields, hasSubstance } from '../lib/leads/intake'
import { emailToLead, isAutomatic, encryptSecret, decryptSecret } from '../lib/leads/inbox'

describe('website form fields become a lead', () => {
  it('finds the name, email and phone under the names forms use', () => {
    const l = fromFields({ 'your-name': 'Ada Lovelace', 'E-Mail': 'ada@example.com', tel: '+1 555 0101', 'Company Name': 'Engines Ltd', 'your-message': 'Hello', zip: '55401', utm_source: 'google', utm_campaign: 'fall' })
    expect(l).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 555 0101', organization: 'Engines Ltd', message: 'Hello', location: '55401', utmSource: 'google', utmCampaign: 'fall' })
  })
  it('joins first and last name, and keeps unknown fields in the message', () => {
    const l = fromFields({ fname: 'Grace', lname: 'Hopper', email: 'g@example.com', 'Number of laptops': 40, services: ['Pickup', 'Data wipe'] })
    expect(l.name).toBe('Grace Hopper')
    expect(l.message).toContain('Number of laptops: 40')
    expect(l.message).toContain('services: Pickup, Data wipe')
  })
  it('never shows the form controls (_redirect, the hidden bot field, captcha)', () => {
    const l = fromFields({ email: 'a@example.com', _redirect: 'https://x', _hp: '', 'g-recaptcha-response': 'tok', submit: 'Send' })
    expect(l.message).toBe('')
    expect(Object.keys(l.raw ?? {})).toEqual(['email'])
  })
  it('drops a bad email and needs a way to reach the person', () => {
    expect(cleanInput({ email: 'not-an-email' }).email).toBeNull()
    expect(hasSubstance(cleanInput({ name: 'Only a name' }))).toBe(false)
    expect(hasSubstance(cleanInput({ phone: '612 555 0101' }))).toBe(true)
    expect(hasSubstance(cleanInput({ name: 'A', message: 'Call me' }))).toBe(true)
  })
})

describe('an email becomes a lead', () => {
  const addr = (address: string, name = '') => ({ value: [{ address, name }], html: '', text: '' })
  it('a plain email: the sender (or Reply-To) is the person', () => {
    const l = emailToLead({ from: addr('noreply@site.example'), replyTo: addr('ada@example.com', 'Ada L'), subject: 'Quote for 40 laptops', text: 'Hi, we have 40 laptops.\n> old quoted text', messageId: '<m1@x>' }, 'sales@example.com')
    expect(l).toMatchObject({ name: 'Ada L', email: 'ada@example.com', sourceDetail: 'Quote for 40 laptops', externalId: '<m1@x>' })
    expect(l.message).toContain('Hi, we have 40 laptops.')
    expect(l.message).not.toContain('old quoted text')
  })
  it('a "new form entry" email: its Label: value lines fill the lead', () => {
    const l = emailToLead({ from: addr('wordpress@site.example'), subject: 'New submission', text: 'Name: Grace Hopper\nEmail: grace@example.com\nPhone: 612-555-0199\nCompany: Navy\nMessage: Servers to recycle', messageId: '<m2@x>' }, 'sales@example.com')
    expect(l).toMatchObject({ name: 'Grace Hopper', email: 'grace@example.com', phone: '612-555-0199', organization: 'Navy' })
  })
  it('out-of-office replies and bounces are not leads', () => {
    const h = (o: Record<string, string>) => new Map(Object.entries(o)) as never
    expect(isAutomatic({ headers: h({ 'auto-submitted': 'auto-replied' }), from: addr('a@example.com') })).toBe(true)
    expect(isAutomatic({ headers: h({ precedence: 'bulk' }), from: addr('a@example.com') })).toBe(true)
    expect(isAutomatic({ headers: h({}), from: addr('mailer-daemon@example.com') })).toBe(true)
    expect(isAutomatic({ headers: h({}), from: addr('ada@example.com') })).toBe(false)
  })
})

describe('inbox password', () => {
  it('is encrypted, different every time, and reads back', async () => {
    process.env.LEADS_INBOX_KEY = crypto.randomBytes(32).toString('base64')
    const a = await encryptSecret('Pass-for-tests-9')
    const b = await encryptSecret('Pass-for-tests-9')
    expect(a).not.toBe(b)
    expect(a).not.toContain('Pass-for-tests-9')
    expect(await decryptSecret(a)).toBe('Pass-for-tests-9')
    const [v, iv, tag, ct] = a.split(':')
    const bad = Buffer.from(ct, 'base64'); bad[0] ^= 1
    await expect(decryptSecret([v, iv, tag, bad.toString('base64')].join(':'))).rejects.toThrow()
  })
})
