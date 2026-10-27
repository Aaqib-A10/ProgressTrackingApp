import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, auth, prisma, seedWorld, type SeededWorld } from './helpers'
import { contactNameFor, contactNameFromRaw, fillContactsFromRaw, websiteFromRaw } from '../lib/dialerRaw'

// ITAD, Oct 2026: "when we upload the sheet the name and the website is not coming".
// CRM exports with First Name + Last Name or "Website URL" came in with no name and no website.

let w: SeededWorld
beforeAll(async () => { w = await seedWorld() })
afterAll(async () => { await prisma.$disconnect() })

describe('finding the name and website in a CRM row', () => {
  it('reads first + last name, full-name columns and website columns under many spellings', () => {
    expect(contactNameFromRaw({ 'First Name': 'Ann', 'Last Name': 'Lee', Company: 'Harbor' })).toBe('Ann Lee')
    expect(contactNameFromRaw({ first_name: 'Ann', LAST_NAME: 'Lee' })).toBe('Ann Lee')
    expect(contactNameFromRaw({ 'Full Name': 'Bob Stone' })).toBe('Bob Stone')
    expect(contactNameFromRaw({ 'Contact Person': 'Cy Dale' })).toBe('Cy Dale')
    // A "Name" column that is really the company is not taken as the person.
    expect(contactNameFromRaw({ Name: 'Harbor Cold Storage' }, 'Harbor Cold Storage')).toBeNull()
    // A phone or an email under "Contact" is not a name.
    expect(contactNameFromRaw({ Contact: '404-555-0101' })).toBeNull()
    expect(contactNameFromRaw({ Contact: 'ann@harbor.com' })).toBeNull()
    expect(websiteFromRaw({ 'Website URL': 'https://harbor.com' })).toBe('https://harbor.com')
    expect(websiteFromRaw({ 'Web Address': 'www.apex.io' })).toBe('www.apex.io')
    expect(websiteFromRaw({ 'Company Domain': 'mesa.net' })).toBe('mesa.net')
    expect(websiteFromRaw({ Site: 'Main office' })).toBeNull()
    expect(websiteFromRaw({ Website: 'ann@harbor.com' })).toBeNull()
    // "Contact name" picked as the First Name column: the last name is added.
    expect(contactNameFor('Ann', 'First Name', { 'First Name': 'Ann', 'Last Name': 'Lee' }, 'Harbor')).toBe('Ann Lee')
    expect(contactNameFor('Ann Lee', 'Contact', { Contact: 'Ann Lee' }, 'Harbor')).toBe('Ann Lee')
  })
})

describe('import', () => {
  it('keeps the name and website when the export has First Name, Last Name and Website URL', async () => {
    const headers = ['Lead ID', 'Company', 'First Name', 'Last Name', 'Email', 'Phone', 'State', 'Lead Status', 'Website URL']
    // The import screen could not map a single contact-name or website column for this export.
    const mapping = { leadId: 'Lead ID', company: 'Company', contactName: null, email: 'Email', phone: 'Phone', state: 'State', status: 'Lead Status', website: null }
    await request(app).post('/api/dialer/imports').set(...auth(w.itadLead)).send({
      fileName: 'earthzone.csv', headers, mapping,
      rows: [
        ['C1', 'Harbor Cold Storage', 'Ann', 'Lee', 'ann@harbor.com', '404-555-0101', 'GA', 'Assigned', 'https://harbor.com'],
        ['C2', 'Apex Precision', 'Bob', '', 'bob@apex.com', '216-555-0102', 'OH', 'Assigned', 'apex.io'],
        ['C3', 'No Name Co', '', '', 'x@noname.com', '305-555-0103', 'FL', 'Assigned', ''],
      ],
    }).expect(201)
    const d = await request(app).get('/api/dialer/data?rep=me').set(...auth(w.itadLead)).expect(200)
    const by = Object.fromEntries((d.body.leads as { company: string; contactName: string | null; website: string | null }[]).map((l) => [l.company, l]))
    expect(by['Harbor Cold Storage']).toMatchObject({ contactName: 'Ann Lee', website: 'https://harbor.com' })
    expect(by['Apex Precision']).toMatchObject({ contactName: 'Bob', website: 'apex.io' })
    expect(by['No Name Co']).toMatchObject({ contactName: null, website: null })
  })
})

describe('leads imported before the fix', () => {
  it('get their name and website from the row they came with, without touching typed values', async () => {
    const base = { ownerId: w.itadLead.id, status: 'Assigned', stage: 1, maxStage: 1, listName: 'CRM', statusChangedAt: new Date() }
    const old = await prisma.dialerLead.create({ data: { ...base, matchKey: 'id:old-1', company: 'Old Co', raw: { 'First Name': 'Dee', 'Last Name': 'Ray', 'Web Address': 'oldco.com', Company: 'Old Co' } } })
    const typed = await prisma.dialerLead.create({ data: { ...base, matchKey: 'id:old-2', company: 'Typed Co', contactName: 'Typed Person', raw: { 'First Name': 'Other', 'Last Name': 'Name', Website: 'typed.com' } } })
    const none = await prisma.dialerLead.create({ data: { ...base, matchKey: 'id:old-3', company: 'Bare Co' } })
    expect(await fillContactsFromRaw()).toBeGreaterThanOrEqual(2)
    expect(await prisma.dialerLead.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ contactName: 'Dee Ray', website: 'oldco.com' })
    expect(await prisma.dialerLead.findUniqueOrThrow({ where: { id: typed.id } })).toMatchObject({ contactName: 'Typed Person', website: 'typed.com' })
    expect(await prisma.dialerLead.findUniqueOrThrow({ where: { id: none.id } })).toMatchObject({ contactName: null, website: null })
    // Running it again changes nothing.
    expect(await fillContactsFromRaw()).toBe(0)
  })
})
