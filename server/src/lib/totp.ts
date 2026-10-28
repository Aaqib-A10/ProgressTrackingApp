import crypto from 'node:crypto'

/**
 * Six digit sign-in codes from an authenticator app (Google or Microsoft Authenticator), as in
 * RFC 6238: a new code every 30 seconds from a shared key. Used for the owner account.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error('Not a valid key')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

/** A new random key (160 bits), shown once to put into the app. */
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

export function totpCode(secret: string, at: number = Date.now(), step = 30): string {
  const counter = Math.floor(at / 1000 / step)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const off = h[h.length - 1] & 15
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

/** Accepts the current code and the one either side of it (phone clocks drift a little). */
export function checkTotp(secret: string, code: string, at: number = Date.now()): boolean {
  const c = String(code).replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return false
  for (const d of [-1, 0, 1]) {
    const want = totpCode(secret, at + d * 30_000)
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return true
  }
  return false
}

/** The link an authenticator app reads (also shown as a QR code by most tools). */
export function otpauthUrl(secret: string, account: string, issuer = 'Metriq Owner'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
