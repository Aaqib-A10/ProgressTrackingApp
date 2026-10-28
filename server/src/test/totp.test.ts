import { describe, it, expect } from 'vitest'
import { base32Encode, base32Decode, totpCode, checkTotp, newTotpSecret } from '../lib/totp'

// The owner console's sign in codes must match what Google/Microsoft Authenticator show.
describe('authenticator codes', () => {
  // RFC 6238 test key "12345678901234567890" (SHA1), cut to 6 digits.
  const key = base32Encode(Buffer.from('12345678901234567890'))
  it('match the published RFC 6238 examples', () => {
    expect(totpCode(key, 59_000)).toBe('287082')
    expect(totpCode(key, 1_111_111_109_000)).toBe('081804')
    expect(totpCode(key, 2_000_000_000_000)).toBe('279037')
  })
  it('accept the code either side of now (clock drift), nothing older, nothing malformed', () => {
    const s = newTotpSecret()
    const now = 1_800_000_000_000
    expect(checkTotp(s, totpCode(s, now), now)).toBe(true)
    expect(checkTotp(s, totpCode(s, now - 30_000), now)).toBe(true)
    expect(checkTotp(s, totpCode(s, now - 90_000), now)).toBe(false)
    expect(checkTotp(s, '12345', now)).toBe(false)
    expect(checkTotp(s, 'abcdef', now)).toBe(false)
  })
  it('keys survive base32 both ways', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 128, 64])
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true)
  })
})
