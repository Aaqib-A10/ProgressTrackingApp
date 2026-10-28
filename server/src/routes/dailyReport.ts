import { Router, type NextFunction, type Response } from 'express'
import { requireAuth, type AuthedRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { isOn } from '../lib/flags'
import * as D from '../controllers/dailyReportController'

// /api/daily-report — the Daily Report builder (Phase 1, step 5). Behind the company-wise
// "daily-report" switch (off for 99 Technologies until the side-by-side week).
export const dailyReportRouter = Router()
dailyReportRouter.use(requireAuth, asyncHandler(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!(await isOn('daily-report', req.user!.companyId))) { res.status(403).json({ error: 'The Daily Report is not switched on for your company.' }); return }
  next()
}))
dailyReportRouter.get('/forms', asyncHandler(D.listForms))
dailyReportRouter.post('/forms', asyncHandler(D.createForm))
dailyReportRouter.put('/forms/:id', asyncHandler(D.updateForm))
dailyReportRouter.delete('/forms/:id', asyncHandler(D.deleteForm))
dailyReportRouter.get('/forms/:id/entry', asyncHandler(D.myEntry))
dailyReportRouter.put('/forms/:id/entry', asyncHandler(D.saveEntry))
dailyReportRouter.get('/forms/:id/team', asyncHandler(D.teamDay))
dailyReportRouter.get('/forms/:id/trend', asyncHandler(D.trend))
dailyReportRouter.get('/forms/:id/monthly', asyncHandler(D.monthlyReport))
dailyReportRouter.get('/forms/:id/monthly.csv', asyncHandler(D.monthlyCsv))
