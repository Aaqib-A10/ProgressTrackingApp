import type { Request } from 'express'

/**
 * Client-IP + CIDR helpers for office-network attendance enforcement.
 * Assumes DIRECT hosting (no proxy) — the socket address is the real client.
 * If you later put the app behind a proxy/CDN, set `app.set('trust proxy', …)`
 * and this keeps working via req.ip.
 */

/** The caller's IP, normalized (strips the IPv4-mapped-IPv6 `::ffff:` prefix). */
export function getClientIp(req: Request): string {
  // Behind Cloudflare (Tunnel/proxy), CF-Connecting-IP is the true client IP and
  // cannot be spoofed by the client — Cloudflare overwrites any supplied value.
  // The origin is only reachable via the tunnel, so this header is trustworthy.
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.trim()) return cf.trim().replace(/^::ffff:/, '')
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

/** IPv6 text (with :: shortening, optional %zone, optional embedded IPv4 tail) → 128-bit BigInt, or null. */
function ipv6ToBig(ip: string): bigint | null {
  let s = ip.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  if (!s.includes(':')) return null
  // Embedded IPv4 tail, e.g. ::ffff:1.2.3.4
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const n = ipv4ToInt(v4[1])
    if (n === null) return null
    s = s.slice(0, -v4[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16))
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    n = (n << 16n) | BigInt(parseInt(g, 16))
  }
  return n
}

/** An address as { v, n, bits }: version, numeric value, and full width (32 or 128). */
function parseIp(ip: string): { v: 4 | 6; n: bigint; bits: number } | null {
  const a = ipv4ToInt(ip.trim())
  if (a !== null) return { v: 4, n: BigInt(a), bits: 32 }
  const b = ipv6ToBig(ip)
  if (b === null) return null
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is really an IPv4 address.
  if (b >> 32n === 0xffffn) return { v: 4, n: b & 0xffffffffn, bits: 32 }
  return { v: 6, n: b, bits: 128 }
}

/**
 * Does `ip` fall inside `cidr`? `cidr` may be a bare address (a single host) or
 * `address/prefix`. Works for IPv4 and IPv6 (Cloudflare passes the visitor's IPv6
 * when the office line has it, so an office may need its IPv6 prefix, e.g. /64).
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.trim().split('/')
  const a = parseIp(ip)
  const r = parseIp(range)
  if (!a || !r || a.v !== r.v) return false
  const bits = bitsStr === undefined ? r.bits : Number(bitsStr)
  if (!/^\d+$/.test(String(bits)) || bits < 0 || bits > r.bits) return false
  if (bits === 0) return true
  const shift = BigInt(r.bits - bits)
  return a.n >> shift === r.n >> shift
}

/** True if `ip` matches any active CIDR in the allowlist. */
export function ipAllowed(ip: string, cidrs: string[]): boolean {
  return cidrs.some((c) => ipInCidr(ip, c))
}

/** Basic validity check for an admin-entered IP or CIDR (IPv4 or IPv6). */
export function isValidCidr(cidr: string): boolean {
  const [range, bitsStr, extra] = cidr.trim().split('/')
  if (extra !== undefined) return false
  const r = parseIp(range)
  if (!r) return false
  if (bitsStr !== undefined) {
    if (!/^\d+$/.test(bitsStr)) return false
    const bits = Number(bitsStr)
    if (bits < 0 || bits > r.bits) return false
  }
  return true
}

/**
 * The usual range an office address belongs to: the /24 for IPv4 (a provider that changes
 * the address usually stays in it) and the /64 for IPv6 (one office line). Null if malformed.
 */
export function suggestRange(ip: string): string | null {
  const a = parseIp(ip)
  if (!a) return null
  if (a.v === 4) {
    const n = Number(a.n)
    return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.0/24`
  }
  const top = a.n >> 64n
  const groups = [48n, 32n, 16n, 0n].map((s) => ((top >> s) & 0xffffn).toString(16))
  return `${groups.join(':')}::/64`
}
