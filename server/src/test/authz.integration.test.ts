import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app, prisma, auth, seedWorld, type SeededWorld } from './helpers'

// API-level authorization matrix. Runs against the isolated pulsetrack_test DB
// (see globalSetup + testDbUrl). Locks down the RBAC / ownership / tenant-scope
// invariants that were audited (AUDIT_REPORT.md §2.1, §2.9, §3.1, §3.2).

let w: SeededWorld

beforeAll(async () => {
  w = await seedWorld()
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('authentication', () => {
  it('rejects unauthenticated access to a protected route (401)', async () => {
    await request(app).get('/api/admin/users').expect(401)
  })
  it('rejects a garbage token (401)', async () => {
    await request(app).get('/api/admin/users').set('Authorization', 'Bearer not-a-real-token').expect(401)
  })
})

describe('admin surface is Super-Admin only', () => {
  it('MEMBER cannot list users (403)', async () => {
    await request(app).get('/api/admin/users').set(...auth(w.itadMember)).expect(403)
  })
  it('TEAM_LEAD cannot list users (403)', async () => {
    await request(app).get('/api/admin/users').set(...auth(w.itadLead)).expect(403)
  })
  it('SUPER_ADMIN can list users (200)', async () => {
    await request(app).get('/api/admin/users').set(...auth(w.superAdmin)).expect(200)
  })
  it('MEMBER cannot create a user (403)', async () => {
    await request(app)
      .post('/api/admin/users')
      .set(...auth(w.itadMember))
      .send({ name: 'x', email: 'x@test.local', role: 'MEMBER' })
      .expect(403)
  })
})

describe('financials are Super-Admin only (router-level guard)', () => {
  it('TEAM_LEAD is forbidden (403)', async () => {
    await request(app).get('/api/financials').set(...auth(w.itadLead)).expect(403)
  })
  it('MEMBER is forbidden (403)', async () => {
    await request(app).get('/api/financials').set(...auth(w.itadMember)).expect(403)
  })
  it('SUPER_ADMIN is allowed (200)', async () => {
    await request(app).get('/api/financials').set(...auth(w.superAdmin)).expect(200)
  })
})

describe('router-level RBAC guards (AUDIT §2.9/§3.1)', () => {
  // TL/SA surfaces: a plain MEMBER is blocked at the router.
  it.each(['/api/admin/team-members', '/api/admin/targets', '/api/admin/tags', '/api/admin/leave'])(
    'MEMBER is forbidden on %s (403)',
    async (path) => {
      await request(app).get(path).set(...auth(w.itadMember)).expect(403)
    },
  )
  it.each(['/api/admin/team-members', '/api/admin/targets', '/api/admin/tags', '/api/admin/leave'])(
    'TEAM_LEAD is allowed on %s (200)',
    async (path) => {
      await request(app).get(path).set(...auth(w.itadLead)).expect(200)
    },
  )
  // SA-only surfaces: a TEAM_LEAD is blocked at the router.
  it.each(['/api/admin/office-networks', '/api/admin/login-events', '/api/admin/audit-log'])(
    'TEAM_LEAD is forbidden on %s (403)',
    async (path) => {
      await request(app).get(path).set(...auth(w.itadLead)).expect(403)
    },
  )
  // Company-wide read stays open to any authenticated user.
  it('any authenticated user can read the holiday calendar (200)', async () => {
    await request(app).get('/api/admin/holidays').set(...auth(w.itadMember)).expect(200)
  })
})

describe('member profile — ownership + department scope (IDOR)', () => {
  it('a member can view their OWN profile (200)', async () => {
    await request(app).get(`/api/members/${w.itadMember.id}`).set(...auth(w.itadMember)).expect(200)
  })
  it('a member CANNOT view another department member (403)', async () => {
    await request(app).get(`/api/members/${w.leadgenMember.id}`).set(...auth(w.itadMember)).expect(403)
  })
  it('a member CANNOT view a same-department peer (403)', async () => {
    // itadLead is in ITAD too, but the viewer is a plain MEMBER → only self allowed.
    await request(app).get(`/api/members/${w.itadLead.id}`).set(...auth(w.itadMember)).expect(403)
  })
  it('a TEAM_LEAD can view a member IN their department (200)', async () => {
    await request(app).get(`/api/members/${w.itadMember.id}`).set(...auth(w.itadLead)).expect(200)
  })
  it('a TEAM_LEAD CANNOT view a member in ANOTHER department (403)', async () => {
    await request(app).get(`/api/members/${w.leadgenMember.id}`).set(...auth(w.itadLead)).expect(403)
  })
  it('a SUPER_ADMIN can view any member (200)', async () => {
    await request(app).get(`/api/members/${w.leadgenMember.id}`).set(...auth(w.superAdmin)).expect(200)
  })
})

describe('attendance device gate — desktop-mode-on-phone bypass', () => {
  // A phone using Chrome "Request Desktop Site" sends a DESKTOP User-Agent, but the
  // client still reports a touch device via X-Client-Mobile. The gate must block it.
  const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

  it('blocks a desktop-UA request that reports a touch device (403)', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(...auth(w.itadMember))
      .set('User-Agent', DESKTOP_UA)
      .set('X-Client-Mobile', '1')
      .expect(403)
    expect(res.body.error).toMatch(/laptop or desktop/i)
  })

  it('allows a genuine desktop (desktop UA, no touch hint) — not device-blocked', async () => {
    // leadgenMember (unused elsewhere) so this check-in doesn't collide with other tests.
    await request(app)
      .post('/api/attendance/check-in')
      .set(...auth(w.leadgenMember))
      .set('User-Agent', DESKTOP_UA)
      .set('X-Client-Mobile', '0')
      .expect(200)
  })
})

describe('public signup cannot mint a privileged account (AUDIT §2.1 regression)', () => {
  it('a department signup is created PENDING, is NOT signed in, and cannot authenticate', async () => {
    const email = 'regression.signup@test.local'
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Regression Signup', email, password: 'Password123!', department: 'ITAD' })
      .expect(201)

    // No session issued …
    expect(res.body.pending).toBe(true)
    expect(res.body.user).toBeUndefined()
    expect(res.headers['set-cookie']).toBeUndefined()

    // … and the account is inert (PENDING) in the DB.
    const created = await prisma.user.findUnique({ where: { email } })
    expect(created?.status).toBe('PENDING')

    // A PENDING account is rejected by requireAuth even with a valid token.
    await request(app).get('/api/auth/me').set(...auth({ id: created!.id, role: created!.role })).expect(401)
  })
})
