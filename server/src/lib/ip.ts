import type { Request } from 'express'

/**
 * Client-IP + CIDR helpers for office-network attendance enforcement.
 * Assumes DIRECT hosting (no proxy) — the socket address is the real client.
 * If you later put the app behind a proxy/CDN, set `app.set('trust proxy', …)`
 * and this keeps working via req.ip.
 */

/** The caller's IP, normalized (strips the IPv4-mapped-IPv6 `::ffff:` prefix). */
export function getClientIp(req: Request): string {
  const raw = req.ip || req.socket.remoteAddress || ''
  return raw.replace(/^::ffff:/, '')
}

/** Loopback is always allowed (same machine — local dev / health checks). */
export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')
}

/** IPv4 dotted-quad → unsigned 32-bit int, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const b = Number(p)
    if (!Number.isInteger(b) || b < 0 || b > 255 || !/^\d+$/.test(p)) return null
    n = (n << 8) | b
  }
  return n >>> 0
}

/**
 * Does `ip` fall inside `cidr`? `cidr` may be a bare IPv4 (treated as /32) or
 * `a.b.c.d/nn`. IPv4 only (offices use IPv4 public IPs); returns false otherwise.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.trim().split('/')
  const bits = bitsStr === undefined ? 32 : Number(bitsStr)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}

/** True if `ip` matches any active CIDR in the allowlist. */
export function ipAllowed(ip: string, cidrs: string[]): boolean {
  return cidrs.some((c) => ipInCidr(ip, c))
}

/** Basic validity check for an admin-entered IP or CIDR (IPv4). */
export function isValidCidr(cidr: string): boolean {
  const [range, bitsStr] = cidr.trim().split('/')
  if (bitsStr !== undefined) {
    const bits = Number(bitsStr)
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  }
  return ipv4ToInt(range) !== null
}
