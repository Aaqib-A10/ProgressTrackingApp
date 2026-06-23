import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  signResetToken,
  verifyResetToken,
} from './auth'

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Sup3rSecret!')
    expect(hash).not.toBe('Sup3rSecret!')
    expect(await verifyPassword('Sup3rSecret!', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('session jwt', () => {
  it('round-trips sub + role', () => {
    const token = signToken({ sub: 'user-1', role: 'TEAM_LEAD' })
    const payload = verifyToken(token)
    expect(payload.sub).toBe('user-1')
    expect(payload.role).toBe('TEAM_LEAD')
  })
})

describe('reset token', () => {
  it('round-trips the user id', () => {
    const token = signResetToken('user-9')
    expect(verifyResetToken(token)).toBe('user-9')
  })
  it('rejects a normal session token used as a reset token', () => {
    const session = signToken({ sub: 'user-9', role: 'MEMBER' })
    expect(() => verifyResetToken(session)).toThrow()
  })
})
