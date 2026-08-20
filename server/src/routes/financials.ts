import { Router } from 'express'
import {
  getFinancialReport, exportFinancialCsv,
  listSalaries, createSalary, updateSalary, deleteSalary,
} from '../controllers/financialsController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const financialsRouter = Router()

// Financials expose salary figures — Super Admin only, across the whole group.
financialsRouter.use(requireAuth, requireRole('SUPER_ADMIN'))

// The literal .csv route must precede any param routes.
financialsRouter.get('/report.csv', asyncHandler(exportFinancialCsv))
financialsRouter.get('/', asyncHandler(getFinancialReport))

financialsRouter.get('/salaries', asyncHandler(listSalaries))
financialsRouter.post('/salaries', asyncHandler(createSalary))
financialsRouter.patch('/salaries/:id', asyncHandler(updateSalary))
financialsRouter.delete('/salaries/:id', asyncHandler(deleteSalary))
