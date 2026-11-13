import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { adminFeedback, adminProblems, chat, decideAction, deleteConversation, feedback, getConversation, listConversations, listInsights, listMemories, deleteMemory, reindex, sendFeedback, setFeedbackHandled, status, updateConversation, updateInsight } from '../controllers/metraController'

/** Metra, the AI assistant (docs/metra/DESIGN.md). Every signed-in person; behind the company switch `metra`. */
export const metraRouter = Router()

metraRouter.use(requireAuth)
// A person's chats are theirs alone: no browser, proxy or CDN may keep an answer and hand it to the next person.
metraRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('Vary', 'Cookie, Authorization'); next() })
metraRouter.get('/status', asyncHandler(status))
metraRouter.post('/chat', asyncHandler(chat))
metraRouter.get('/conversations', asyncHandler(listConversations))
metraRouter.get('/conversations/:id', asyncHandler(getConversation))
metraRouter.patch('/conversations/:id', asyncHandler(updateConversation))
metraRouter.delete('/conversations/:id', asyncHandler(deleteConversation))
metraRouter.post('/messages/:id/feedback', asyncHandler(feedback))
metraRouter.post('/messages/:id/actions/:actionId', asyncHandler(decideAction))
metraRouter.post('/feedback', asyncHandler(sendFeedback))
metraRouter.post('/admin/reindex', asyncHandler(reindex))
metraRouter.get('/admin/feedback', asyncHandler(adminFeedback))
metraRouter.get('/admin/problems', asyncHandler(adminProblems))
metraRouter.patch('/admin/feedback/:id', asyncHandler(setFeedbackHandled))
metraRouter.get('/insights', asyncHandler(listInsights))
metraRouter.patch('/insights/:id', asyncHandler(updateInsight))
metraRouter.get('/memories', asyncHandler(listMemories))
metraRouter.delete('/memories/:id', asyncHandler(deleteMemory))
