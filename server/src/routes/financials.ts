import { Router } from 'express'
import {
  getFinancialReport, exportFinancialCsv,
  listSalaries, createSalary, updateSalary, deleteSalary,
} from '../controllers/financialsController'
import { requireAuth } from '../middleware/auth'
import { requireFinanceAccess } from '../lib/financeAccess'
import { asyncHandler } from '../lib/asyncHandler'

export const financialsRouter = Router()

// Financials expose salary + cost/revenue figures — restricted to specific people
// (Aqib) by identity, not just the SUPER_ADMIN role. See lib/financeAccess.ts.
financialsRouter.use(requireAuth, requireFinanceAccess)

// The literal .csv route must precede any param routes.
financialsRouter.get('/report.csv', asyncHandler(exportFinancialCsv))
financialsRouter.get('/', asyncHandler(getFinancialReport))

financialsRouter.get('/salaries', asyncHandler(listSalaries))
financialsRouter.post('/salaries', asyncHandler(createSalary))
financialsRouter.patch('/salaries/:id', asyncHandler(updateSalary))
financialsRouter.delete('/salaries/:id', asyncHandler(deleteSalary))
