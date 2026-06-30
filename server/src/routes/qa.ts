import { Router, raw } from 'express'
import {
  listScorecards, getScorecard, createScorecard, updateScorecard, archiveScorecard,
  listAgents, listEvaluators, agentActivity,
  createEvaluation, updateEvaluation, getEvaluation, listEvaluations, myEvaluations, acknowledgeEvaluation, qaUnreadCount,
  qaAnalytics, qaTeamDashboard, employeeOfMonth,
  uploadRecording, downloadRecording,
} from '../controllers/qaController'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const qaRouter = Router()

qaRouter.use(requireAuth)

// Scorecards (builder) — QA / QA-lead / Super Admin
qaRouter.get('/scorecards', asyncHandler(listScorecards))
qaRouter.post('/scorecards', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), asyncHandler(createScorecard))
qaRouter.get('/scorecards/:id', asyncHandler(getScorecard))
qaRouter.put('/scorecards/:id', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), asyncHandler(updateScorecard))
qaRouter.delete('/scorecards/:id', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), asyncHandler(archiveScorecard))

// Agents to evaluate + the QA team roster (QA-lead oversight)
qaRouter.get('/agents', asyncHandler(listAgents))
qaRouter.get('/agents/:id/activity', asyncHandler(agentActivity))
qaRouter.get('/evaluators', asyncHandler(listEvaluators))

// Call recordings (raw audio body)
qaRouter.post('/recordings', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), raw({ type: '*/*', limit: '52mb' }), asyncHandler(uploadRecording))
qaRouter.get('/recordings/:id', asyncHandler(downloadRecording))

// Evaluations
qaRouter.get('/evaluations', asyncHandler(listEvaluations))
qaRouter.post('/evaluations', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), asyncHandler(createEvaluation))
qaRouter.get('/my-evaluations', asyncHandler(myEvaluations))
qaRouter.get('/unread-count', asyncHandler(qaUnreadCount))
qaRouter.get('/analytics', asyncHandler(qaAnalytics))
qaRouter.get('/team-dashboard', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN', 'TEAM_LEAD'), asyncHandler(qaTeamDashboard))
qaRouter.get('/employee-of-month', asyncHandler(employeeOfMonth))
qaRouter.get('/evaluations/:id', asyncHandler(getEvaluation))
qaRouter.put('/evaluations/:id', requireRole('QA', 'QA_LEAD', 'SUPER_ADMIN'), asyncHandler(updateEvaluation))
qaRouter.post('/evaluations/:id/acknowledge', asyncHandler(acknowledgeEvaluation))
