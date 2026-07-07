import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { healthRouter } from './routes/health'
import { authRouter } from './routes/auth'
import { itadRouter } from './routes/itad'
import { leadgenRouter } from './routes/leadgen'
import { dashboardRouter } from './routes/dashboard'
import { reportsRouter } from './routes/reports'
import { marketingRouter } from './routes/marketing'
import { ecommerceRouter } from './routes/ecommerce'
import { attendanceRouter } from './routes/attendance'
import { adminRouter } from './routes/admin'
import { notificationsRouter } from './routes/notifications'
import { membersRouter } from './routes/members'
import { feedbackRouter } from './routes/feedback'
import { qaRouter } from './routes/qa'
import { attachmentsRouter } from './routes/attachments'

/**
 * Builds the Express app. Kept separate from index.ts so tests can import
 * the app without binding a port.
 */
export function createApp(): Express {
  const app = express()

  // Behind the Traefik gateway (TLS terminated there) + Nginx, trust forwarded
  // headers so req.secure / req.protocol reflect the original HTTPS request
  // (X-Forwarded-Proto). Needed for the `secure` auth cookie to behave correctly.
  app.set('trust proxy', true)

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  )
  app.use(express.json())
  app.use(cookieParser())

  // All API routes are mounted under /api (matches the Vite dev proxy).
  app.use('/api', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/itad', itadRouter)
  app.use('/api/leadgen', leadgenRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/marketing', marketingRouter)
  app.use('/api/ecommerce', ecommerceRouter)
  app.use('/api/attendance', attendanceRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/members', membersRouter)
  app.use('/api/feedback', feedbackRouter)
  app.use('/api/qa', qaRouter)
  app.use('/api/attachments', attachmentsRouter)

  // Fallback 404 for unknown API paths.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Centralized error handler — unexpected throws become 500s.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[server] Unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
