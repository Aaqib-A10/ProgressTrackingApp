import { describe, it, expect } from 'vitest'
import { parseUserAgent } from './userAgent'

describe('parseUserAgent', () => {
  it('Chrome on Windows desktop', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')
    expect(r).toEqual({ browser: 'Chrome', os: 'Windows', device: 'Desktop' })
  })
  it('Safari on iPhone → Mobile', () => {
    const r = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
    expect(r).toEqual({ browser: 'Safari', os: 'iOS', device: 'Mobile' })
  })
  it('Firefox on macOS desktop', () => {
    const r = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0')
    expect(r).toEqual({ browser: 'Firefox', os: 'macOS', device: 'Desktop' })
  })
  it('Edge on Windows', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0').browser).toBe('Edge')
  })
  it('Chrome on Android → Mobile', () => {
    const r = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')
    expect(r).toEqual({ browser: 'Chrome', os: 'Android', device: 'Mobile' })
  })
  it('empty / unknown → nulls', () => {
    expect(parseUserAgent(undefined)).toEqual({ browser: null, os: null, device: null })
    expect(parseUserAgent('')).toEqual({ browser: null, os: null, device: null })
  })
})
