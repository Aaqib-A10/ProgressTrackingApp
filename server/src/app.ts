import express, { type Express, type Router } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { healthRouter } from './routes/health'
import { authRouter } from './routes/auth'
import { itadRouter } from './routes/itad'
import { dialerRouter, dialerHookRouter } from './routes/dialer'
import { leadgenRouter } from './routes/leadgen'
import { dashboardRouter } from './routes/dashboard'
import { reportsRouter } from './routes/reports'
import { marketingRouter } from './routes/marketing'
import { ecommerceRouter } from './routes/ecommerce'
import { attendanceRouter } from './routes/attendance'
import { rdpRouter } from './routes/rdp'
import { adminRouter } from './routes/admin'
import { notificationsRouter } from './routes/notifications'
import { membersRouter } from './routes/members'
import { feedbackRouter } from './routes/feedback'
import { qaRouter } from './routes/qa'
import { attachmentsRouter } from './routes/attachments'
import { todosRouter } from './routes/todos'
import { worklogRouter } from './routes/worklog'
import { customRouter } from './routes/customBlocks'
import { tasksRouter } from './routes/tasks'
import { financialsRouter } from './routes/financials'
import { pushRouter } from './routes/push'
import { guestRouter } from './routes/guest'
import { searchRouter } from './routes/search'
import { docsRouter } from './routes/docs'
import { inventoryRouter } from './routes/inventory'
import { projectsRouter } from './routes/projects'
import { chatRouter } from './routes/chat'
import { meetingsRouter } from './routes/meetings'
import { avatarsRouter } from './routes/avatars'
import { leadInRouter, leadsRouter } from './routes/leads'
import { claudeRouter, mcpRouter } from './routes/claude'
import { systemHealthRouter } from './routes/systemHealth'
import { auditProbeMiddleware, errorHandler, requestMonitor } from './lib/health/monitor'
import { registerApiMounts } from './lib/health/audit'
import { supportRouter } from './routes/support'
import { ownerRouter } from './routes/owner'
import { flagsRouter } from './routes/flags'
import { companyRouter } from './routes/company'
import { dailyReportRouter } from './routes/dailyReport'
import { setupRouter } from './routes/setup'
import { billingRouter } from './routes/billing'
import { metraRouter } from './routes/metra'

/**
 * Every API router and where it lives. The hourly self check (System Health) walks this list
 * to find each endpoint, so a new router added here is checked automatically.
 */
export const API_MOUNTS: [string, Router][] = [
  ['/api', healthRouter],
  ['/api/auth', authRouter],
  ['/api/itad', itadRouter],
  ['/api/dialer', dialerRouter],
  ['/api/leadgen', leadgenRouter],
  ['/api/dashboard', dashboardRouter],
  ['/api/reports', reportsRouter],
  ['/api/marketing', marketingRouter],
  ['/api/ecommerce', ecommerceRouter],
  ['/api/attendance', attendanceRouter],
  ['/api/rdp', rdpRouter],
  ['/api/admin', adminRouter],
  ['/api/notifications', notificationsRouter],
  ['/api/members', membersRouter],
  ['/api/feedback', feedbackRouter],
  ['/api/qa', qaRouter],
  ['/api/attachments', attachmentsRouter],
  ['/api/todos', todosRouter],
  ['/api/worklog', worklogRouter],
  ['/api/custom', customRouter],
  ['/api/tasks', tasksRouter],
  ['/api/financials', financialsRouter],
  ['/api/inventory', inventoryRouter],
  ['/api/projects', projectsRouter],
  ['/api/chat', chatRouter],
  ['/api/meetings', meetingsRouter],
  ['/api/avatars', avatarsRouter],
  ['/api/push', pushRouter],
  ['/api/guest', guestRouter],
  ['/api/search', searchRouter],
  ['/api/docs', docsRouter],
  ['/api/claude', claudeRouter],
  ['/api/mcp', mcpRouter],
  ['/api/metra', metraRouter],
  ['/api/dialer-hook', dialerHookRouter],
  ['/api/leads', leadsRouter],
  ['/api/system-health', systemHealthRouter],
  ['/api/support', supportRouter],
  ['/api/owner', ownerRouter],
  ['/api/flags', flagsRouter],
  ['/api/company', companyRouter],
  ['/api/daily-report', dailyReportRouter],
  ['/api/setup', setupRouter],
  ['/api/billing', billingRouter],
]

/**
 * Builds the Express app. Kept separate from index.ts so tests can import
 * the app without binding a port.
 */
export function createApp(): Express {
  const app = express()

  // Trust proxy = number of proxy hops in front of Node, so req.ip is the REAL
  // client IP (used by the office-network attendance check) and req.secure /
  // req.protocol reflect the original HTTPS request (for the secure auth cookie).
  //
  // SECURITY: never use `true` here — it trusts any client-supplied
  // X-Forwarded-For, letting anyone spoof their IP and bypass the office-network
  // restriction. Set TRUST_PROXY to the exact hop count instead:
  //   direct (no proxy)      → leave unset  (req.ip = socket)
  //   Nginx only             → TRUST_PROXY=1
  //   Nginx + Traefik/CDN    → TRUST_PROXY=2
  const tp = process.env.TRUST_PROXY
  if (tp && /^\d+$/.test(tp)) app.set('trust proxy', Number(tp))
  else if (tp) app.set('trust proxy', tp) // e.g. a specific subnet like "10.0.0.0/8"

  // Security headers (HSTS, X-Content-Type-Options: nosniff, X-Frame-Options,
  // Referrer-Policy, etc.). This is a JSON API (no HTML), so the CSP is disabled
  // here — the real CSP belongs on the nginx-served frontend, and helmet's default
  // CSP would otherwise apply pointlessly to API responses.
  app.use(helmet({ contentSecurityPolicy: false }))

  // Website forms send leads from other sites: its own CORS rule, before the app's.
  app.use('/api/lead-in', leadInRouter)

  // CLIENT_ORIGIN takes a comma-separated list: the website, and later the phone app's own
  // origins (capacitor://localhost on iPhone, http://localhost on Android).
  app.use(
    cors({
      origin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean),
      credentials: true,
      exposedHeaders: ['X-PT-User'], // whose answer it is (see middleware/auth.ts); a page on another origin may read it
    }),
  )
  // Cap JSON bodies to blunt memory-pressure DoS from oversized payloads.
  // Lead Dialer imports carry a whole CRM export (a few thousand rows), so they get a bigger limit.
  app.use('/api/dialer/imports', express.json({ limit: '25mb' }))
  // The one-time Earth Zone sync carries every lead's notes timeline.
  app.use('/api/dialer/ez-sync', express.json({ limit: '25mb' }))
  app.use('/api/leads/import', express.json({ limit: '25mb' }))
  app.use('/api/leads/import-sheet', express.json({ limit: '25mb' }))
  app.use('/api/leads/businesses', express.json({ limit: '10mb' }))
  // Payment providers sign the exact bytes they send: keep them as they are (Phase 1, step 8).
  app.use('/api/billing/webhook', express.raw({ type: () => true, limit: '1mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  // The self check's test mode (only its own requests), then the error and slow-request log.
  app.use(auditProbeMiddleware)
  app.use(requestMonitor)

  // All API routes are mounted under /api (matches the Vite dev proxy).
  for (const [path, router] of API_MOUNTS) app.use(path, router)
  registerApiMounts(API_MOUNTS)

  // Fallback 404 for unknown API paths.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Centralized error handler: unexpected throws become 500s and go to the error log.
  app.use(errorHandler)

  return app
}
