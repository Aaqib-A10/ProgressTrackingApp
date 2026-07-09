import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { ipInCidr, ipAllowed, isValidCidr, isLoopback, getClientIp } from './ip'

describe('getClientIp', () => {
  const mk = (headers: Record<string, string>, ip?: string): Request =>
    ({ headers, ip, socket: { remoteAddress: ip } } as unknown as Request)

  it('prefers CF-Connecting-IP behind Cloudflare', () => {
    expect(getClientIp(mk({ 'cf-connecting-ip': '119.156.230.29' }, '127.0.0.1'))).toBe('119.156.230.29')
  })
  it('falls back to req.ip when no CF header', () => {
    expect(getClientIp(mk({}, '203.0.113.9'))).toBe('203.0.113.9')
  })
  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(getClientIp(mk({}, '::ffff:203.0.113.9'))).toBe('203.0.113.9')
  })
})

describe('ipInCidr', () => {
  it('matches a bare IP as /32', () => {
    expect(ipInCidr('203.0.113.7', '203.0.113.7')).toBe(true)
    expect(ipInCidr('203.0.113.8', '203.0.113.7')).toBe(false)
  })

  it('matches within a /24 range', () => {
    expect(ipInCidr('203.0.113.55', '203.0.113.0/24')).toBe(true)
    expect(ipInCidr('203.0.113.255', '203.0.113.0/24')).toBe(true)
    expect(ipInCidr('203.0.114.1', '203.0.113.0/24')).toBe(false)
  })

  it('handles /16 and /8', () => {
    expect(ipInCidr('10.4.9.2', '10.4.0.0/16')).toBe(true)
    expect(ipInCidr('10.5.0.1', '10.4.0.0/16')).toBe(false)
    expect(ipInCidr('10.99.99.99', '10.0.0.0/8')).toBe(true)
  })

  it('/0 matches everything, /32 is exact', () => {
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true)
    expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).toBe(true)
    expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).toBe(false)
  })

  it('rejects malformed input safely', () => {
    expect(ipInCidr('not-an-ip', '203.0.113.0/24')).toBe(false)
    expect(ipInCidr('203.0.113.7', 'garbage')).toBe(false)
    expect(ipInCidr('203.0.113.7', '203.0.113.0/40')).toBe(false)
    expect(ipInCidr('999.0.0.1', '999.0.0.0/24')).toBe(false)
  })
})

describe('ipAllowed', () => {
  it('passes when any CIDR matches', () => {
    expect(ipAllowed('203.0.113.7', ['198.51.100.0/24', '203.0.113.0/24'])).toBe(true)
    expect(ipAllowed('8.8.8.8', ['198.51.100.0/24', '203.0.113.0/24'])).toBe(false)
    expect(ipAllowed('8.8.8.8', [])).toBe(false)
  })
})

describe('isLoopback', () => {
  it('recognizes loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('203.0.113.7')).toBe(false)
  })
})

describe('isValidCidr', () => {
  it('accepts valid IPs and CIDRs', () => {
    expect(isValidCidr('203.0.113.7')).toBe(true)
    expect(isValidCidr('203.0.113.0/24')).toBe(true)
    expect(isValidCidr('10.0.0.0/8')).toBe(true)
  })
  it('rejects invalid ones', () => {
    expect(isValidCidr('203.0.113')).toBe(false)
    expect(isValidCidr('203.0.113.0/33')).toBe(false)
    expect(isValidCidr('hello')).toBe(false)
  })
})
