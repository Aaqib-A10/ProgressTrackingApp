import type { Request } from 'express'
import rateLimit from 'express-rate-limit'
import { getClientIp } from '../lib/ip'

// Throttle only in production so local dev / automated tests aren't limited.
const enabled = process.env.NODE_ENV === 'production'

// Key on the REAL client IP. TRUST_PROXY is not set on prod, so req.ip is the
// proxy/socket address; getClientIp reads Cloudflare's CF-Connecting-IP (which
// CF overwrites and the client can't spoof) — consistent with the rest of the app.
const base = {
  standardHeaders: true as const,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getClientIp(req),
  // Custom CF-aware key + no trust-proxy config → disable the library's startup
  // validations (they assume req.ip) so they don't warn/throw at boot.
  validate: false as const,
  skip: () => !enabled,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
}

/** Login — blunts online password brute-force. */
export const loginLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 10 })

/**
 * Account-mutating public endpoints (signup, forgot-password, reset-password):
 * tighter cap over a longer window to slow reset-token guessing and signup spam.
 */
export const sensitiveAuthLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 8 })
