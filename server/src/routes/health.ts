import { Router } from 'express'
import { prisma } from '../lib/prisma'

export const healthRouter = Router()

// Liveness + DB reachability check. Used by the client to verify wiring.
healthRouter.get('/health', async (_req, res) => {
  let db: 'up' | 'down' = 'down'
  try {
    await prisma.$queryRaw`SELECT 1`
    db = 'up'
  } catch {
    db = 'down'
  }
  res.json({ status: 'ok', db, time: new Date().toISOString() })
})
