import type { NextFunction, Request, Response } from 'express'
import type { AuthedRequest } from '../../middleware/auth'
import { AUDIT_HEADER, AUDIT_SECRET, AuditWriteBlocked, PROBE_HEADER, auditStore, openProbe } from './auditContext'
import { captureError, normalizePath } from './errors'

/** Requests slower than this are listed as slow (System Health). */
const SLOW_MS = Number(process.env.HEALTH_SLOW_MS) || 3000

/** Uploads, downloads, imports and Claude's connector are allowed to take their time. */
const SLOW_EXEMPT = /\/api\/mcp\b|\/imports\b|\/uploads?\b|\/recordings?\b|\/chunk\b|\/piece\b|\/audio\b|\/files?\b|\/attachments\b|\/avatars\b|\/transcript\b|\/notes\/retry\b/

/** "GET /api/projects/:key" for the route that answered, or the address with ids blanked out. */
export function routeOf(req: Request): string {
  const r = (req as Request & { route?: { path?: string | string[] } }).route
  const path = r && typeof r.path === 'string' ? `${req.baseUrl}${r.path}` : normalizePath(req.originalUrl || req.url)
  return `${req.method} ${path}`
}

/**
 * The hourly self check's own requests: switch on test mode for this request only (every save
 * is stopped, nothing is emailed or pushed). Needs the secret made at start, so nobody outside
 * this process can switch it on.
 */
export function auditProbeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const secret = req.headers[AUDIT_HEADER]
  const probeId = req.headers[PROBE_HEADER]
  if (secret === AUDIT_SECRET && typeof probeId === 'string' && probeId) {
    auditStore.run(openProbe(probeId), () => next())
    return
  }
  next()
}

/** Watches every answer: a 500 sent without a throw, and slow requests, go to the error log. */
export function requestMonitor(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint()
  const probe = auditStore.getStore()
  res.on('finish', () => {
    if (probe) return // the self check reports its own requests
    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n)
    const userId = (req as AuthedRequest).user?.id ?? null
    const captured = res.locals.healthCaptured === true
    if (res.statusCode >= 500 && !captured) {
      captureError({ source: 'SERVER', message: `The API answered ${res.statusCode}`, route: routeOf(req), status: res.statusCode, userId, url: req.originalUrl, durationMs: ms })
      return
    }
    if (ms >= SLOW_MS && !SLOW_EXEMPT.test(req.originalUrl)) {
      const type = String(res.getHeader('content-type') ?? '')
      const disposition = String(res.getHeader('content-disposition') ?? '')
      if (type.includes('event-stream') || disposition.startsWith('attachment') || String(req.headers['content-type'] ?? '').startsWith('multipart/')) return
      const route = routeOf(req)
      captureError({ source: 'SLOW', message: `${route} took ${(ms / 1000).toFixed(1)}s`, route, status: res.statusCode, userId, url: req.originalUrl, durationMs: ms })
    }
  })
  next()
}

/** Central error handler: unexpected throws become 500s and land in the error log. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // body-parser errors carry a type: surface them as proper 4xx (not 500), with a clean message.
  const e = err as { type?: string }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' })
    return
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }
  // The self check's test mode stopped a save: that is the expected end of the request.
  if (err instanceof AuditWriteBlocked) {
    res.status(200).json({ auditBlocked: true })
    return
  }
  // eslint-disable-next-line no-console
  console.error('[server] Unhandled error:', err)
  const error = err instanceof Error ? err : new Error(String(err))
  res.locals.healthCaptured = true
  captureError({
    source: 'SERVER',
    message: error.message || 'Unhandled error',
    stack: error.stack,
    route: routeOf(req),
    status: 500,
    userId: (req as AuthedRequest).user?.id ?? null,
    url: req.originalUrl,
  })
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
}
