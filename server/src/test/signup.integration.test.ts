import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest'
import request from 'supertest'
import { app, prisma, seedWorld } from './helpers'
import { ensureHomeCompany, HOME_COMPANY_ID } from '../lib/company'
import { slugify } from '../lib/signup'
import { setFlag } from '../lib/flags'

// Phase 1, step 7: companies and solo users sign up on their own, confirm their email, go
// through the setup wizard, invite their people, and get a 14-day free trial.

const EMAILS = ['founder@hotel.local.test', 'solo@india.local.test', 'g.user@juliet.local.test', 'ms.user@kilo.local.test']
const cleanup = async () => {
  const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { companyId: true } })
  const ids = [...new Set(users.map((u) => u.companyId))].filter((id) => id !== HOME_COMPANY_ID)
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

beforeAll(async () => {
  await seedWorld()
  await ensureHomeCompany()
  await cleanup()
})
afterAll(async () => {
  await cleanup()
  await prisma.featureFlag.deleteMany({ where: { key: 'new-companies' } })
  await prisma.$disconnect()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('sign up', () => {
  let agent: ReturnType<typeof request.agent>
  let verifyToken = ''

  it('closed until the owner opens it ("New companies can sign up" is off by default)', async () => {
    await prisma.featureFlag.deleteMany({ where: { key: 'new-companies' } })
    await setFlag('new-companies', false, 'test')
    expect((await request(app).get('/api/auth/open').expect(200)).body).toEqual({ newCompanies: false })
    const r = await request(app).post('/api/auth/start').send({ mode: 'team', name: 'Hana Hotel', email: 'founder@hotel.local.test', password: 'Hotel2026x', companyName: 'Hotel Bravo' }).expect(403)
    expect(r.body.error).toMatch(/not open/)
    expect(await prisma.user.count({ where: { email: 'founder@hotel.local.test' } })).toBe(0)
    await setFlag('new-companies', true, 'test')
    expect((await request(app).get('/api/auth/open').expect(200)).body).toEqual({ newCompanies: true })
  })

  it('"For my team": a company on a 14-day trial, its own address, the founder as Super Admin', async () => {
    agent = request.agent(app)
    await agent.post('/api/auth/start').send({ mode: 'team', name: 'Hana Hotel', email: 'founder@hotel.local.test', password: 'short' }).expect(400)
    const r = await agent.post('/api/auth/start').send({ mode: 'team', name: 'Hana Hotel', email: 'founder@hotel.local.test', password: 'Hotel2026x', companyName: 'Hotel Bravo & Co.', timeZone: 'Asia/Dubai' }).expect(201)
    expect(r.body).toMatchObject({ company: { name: 'Hotel Bravo & Co.', slug: 'hotel-bravo-co', kind: 'TEAM' }, next: '/app/setup' })
    verifyToken = r.body.devVerifyToken
    const me = (await agent.get('/api/auth/me').expect(200)).body.user
    expect(me).toMatchObject({ role: 'SUPER_ADMIN', emailCheckPending: true, company: { kind: 'TEAM', plan: 'business', status: 'TRIAL', setupDone: false, timeZone: 'Asia/Dubai' } })
    const days = (new Date(me.company.trialEndsAt).getTime() - Date.now()) / 86400_000
    expect(Math.round(days)).toBe(14)
    // The same email again: sign in instead.
    await request(app).post('/api/auth/start').send({ mode: 'team', name: 'Xavier', email: 'founder@hotel.local.test', password: 'Hotel2026x', companyName: 'Other' }).expect(409)
    // Its own sign-in page.
    expect((await request(app).get('/api/auth/company/hotel-bravo-co').expect(200)).body.company.name).toBe('Hotel Bravo & Co.')
    await request(app).get('/api/auth/company/nope-nope').expect(404)
  })

  it('people can be invited only after the email is confirmed', async () => {
    await agent.post('/api/company/invites').send({ people: [{ email: 'a@hotel.local.test' }] }).expect(403)
    await request(app).post('/api/auth/verify-email').send({ token: 'bad' }).expect(400)
    await request(app).post('/api/auth/verify-email').send({ token: verifyToken }).expect(200)
    expect((await agent.get('/api/auth/me')).body.user.emailCheckPending).toBe(false)
  })

  it('the setup wizard: departments, a daily form from a template, people, sample data', async () => {
    const s = (await agent.get('/api/setup').expect(200)).body
    expect(s.templates.map((t: { key: string }) => t.key)).toEqual(['general', 'sales', 'support', 'solo'])
    const d = (await agent.post('/api/setup/departments').send({ departments: [{ name: 'Front desk' }, { name: 'Housekeeping' }, { name: 'front desk' }] }).expect(200)).body
    expect(d.departments.map((x: { name: string }) => x.name)).toEqual(['Front desk', 'Housekeeping'])
    const frontDesk = d.departments[0].id
    await agent.post('/api/setup/daily-form').send({ template: 'support', departmentId: frontDesk }).expect(201)
    const forms = (await agent.get('/api/daily-report/forms').expect(200)).body.forms
    expect(forms[0]).toMatchObject({ name: 'Support daily', department: 'Front desk' })
    const inv = (await agent.post('/api/company/invites').send({ people: [
      { email: 'Amy.Desk@hotel.local.test', departmentId: frontDesk },
      { email: 'amy.desk@hotel.local.test' },
      { email: 'lead.desk@hotel.local.test', name: 'Lee Desk', role: 'TEAM_LEAD', departmentId: frontDesk },
      { email: 'itad.member@test.local' },
    ] }).expect(201)).body
    expect(inv.added.map((a: { email: string; name: string }) => [a.email, a.name])).toEqual([['amy.desk@hotel.local.test', 'Amy Desk'], ['lead.desk@hotel.local.test', 'Lee Desk']])
    expect(inv.skipped).toEqual(['itad.member@test.local'])
    const amy = await prisma.user.findUniqueOrThrow({ where: { email: 'amy.desk@hotel.local.test' } })
    expect(amy.companyId).toBe(s.company.id)
    expect(amy.departmentId).toBe(frontDesk)
    // Sample data in, and out again.
    await agent.post('/api/setup/sample').send({ on: true }).expect(201)
    expect(await prisma.pmProject.count({ where: { companyId: s.company.id } })).toBe(1)
    expect(await prisma.reportEntry.count({ where: { companyId: s.company.id } })).toBeGreaterThan(3)
    await agent.post('/api/setup/sample').send({ on: false }).expect(200)
    expect(await prisma.pmProject.count({ where: { companyId: s.company.id } })).toBe(0)
    expect(await prisma.reportForm.count({ where: { companyId: s.company.id } })).toBe(1)
    await agent.post('/api/setup/done').expect(200)
    expect((await agent.get('/api/auth/me')).body.user.company.setupDone).toBe(true)
    await prisma.user.deleteMany({ where: { email: { in: ['amy.desk@hotel.local.test', 'lead.desk@hotel.local.test'] } } })
  })

  it('when the trial ends: everything can be looked at, nothing new saved until a plan is chosen', async () => {
    const me = (await agent.get('/api/auth/me')).body.user
    await prisma.company.update({ where: { id: me.company.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } })
    await agent.get('/api/todos').expect(200)
    const r = await agent.post('/api/todos').send({ title: 'After the trial' }).expect(402)
    expect(r.body).toMatchObject({ trialEnded: true })
    await agent.post('/api/auth/logout').expect(204)
  })

  it('"Just me": a personal workspace, the Personal plan, team parts left out', async () => {
    const a = request.agent(app)
    await a.post('/api/auth/start').send({ mode: 'solo', name: 'India Solo', email: 'solo@india.local.test', password: 'Solo2026xx' }).expect(201)
    const me = (await a.get('/api/auth/me')).body.user
    expect(me.company).toMatchObject({ kind: 'PERSONAL', plan: 'personal', name: "India's workspace" })
    expect(me.areasOff).toEqual(expect.arrayContaining(['itad', 'dialer', 'marketing', 'qa']))
    await a.get('/api/dialer/data').expect(403)
  })

  it("a company's address is made from its name", () => {
    expect(slugify('  Ünïcode Café!! ')).toBe('unicode-cafe')
    expect(slugify('***')).toBe('company')
  })
})

describe('Google and Microsoft', () => {
  const env = { ...process.env }
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-value'
    process.env.MICROSOFT_CLIENT_ID = 'test-ms-id'
    process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-value'
  })
  afterAll(() => { process.env = env })

  async function through(provider: 'google' | 'microsoft', query: string, profile: Record<string, unknown>) {
    const a = request.agent(app)
    const go = await a.get(`/api/auth/oauth/${provider}/start?${query}`).expect(302)
    const state = new URL(go.headers.location).searchParams.get('state')!
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('token')) return new Response(JSON.stringify({ access_token: 'at', id_token: 'x.e30.y' }), { status: 200 })
      return new Response(JSON.stringify(profile), { status: 200 })
    }))
    const back = await a.get(`/api/auth/oauth/${provider}/callback?code=c&state=${encodeURIComponent(state)}`).expect(302)
    return { a, to: back.headers.location as string }
  }

  it('lists the buttons only when their keys are on the server', async () => {
    expect((await request(app).get('/api/auth/oauth/providers').expect(200)).body.providers.map((p: { key: string }) => p.key)).toEqual(['google', 'microsoft'])
  })

  it('Google: sign up makes the company; Google confirms the email', async () => {
    const { a, to } = await through('google', 'intent=signup&mode=team&company=Juliet%20Ltd', { email: 'g.user@juliet.local.test', email_verified: true, name: 'Gina User', sub: 'g-123' })
    expect(to).toBe('/app/setup')
    const me = (await a.get('/api/auth/me').expect(200)).body.user
    expect(me).toMatchObject({ name: 'Gina User', emailCheckPending: false, company: { name: 'Juliet Ltd' } })
    // Signing in again later opens the same account.
    const again = await through('google', 'intent=signin', { email: 'g.user@juliet.local.test', email_verified: true, name: 'Gina User', sub: 'g-123' })
    expect(again.to).toBe('/app/dashboard')
  })

  it('Google with an email it has not confirmed is refused', async () => {
    const { to } = await through('google', 'intent=signup&mode=solo', { email: 'nobody@juliet.local.test', email_verified: false, name: 'N', sub: 'g-999' })
    expect(to).toMatch(/^\/login\?error=/)
  })

  it('Microsoft never opens an account made another way (even with the same email)', async () => {
    const { to } = await through('microsoft', 'intent=signin', { mail: 'itad.member@test.local', displayName: 'Imposter', id: 'ms-1' })
    expect(decodeURIComponent(to)).toMatch(/Sign in with your password|no Metriq account/)
    const made = await through('microsoft', 'intent=signup&mode=solo', { mail: 'ms.user@kilo.local.test', displayName: 'Kilo User', id: 'ms-2' })
    expect(made.to).toBe('/app/setup')
    const again = await through('microsoft', 'intent=signin', { mail: 'ms.user@kilo.local.test', displayName: 'Kilo User', id: 'ms-2' })
    expect(again.to).toBe('/app/dashboard')
  })

  it('an answer that did not start in this browser is refused', async () => {
    const a = request.agent(app)
    const go = await a.get('/api/auth/oauth/google/start?intent=signup').expect(302)
    const state = new URL(go.headers.location).searchParams.get('state')!
    const r = await request(app).get(`/api/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`).expect(302)
    expect(decodeURIComponent(r.headers.location)).toMatch(/did not come from this browser/)
  })
})
