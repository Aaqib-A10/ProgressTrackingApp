import { Router } from 'express'
import { getMyEntry, upsertMyEntry, teamView, getBoard, createTask, updateTask, deleteTask, getTask, addComment, listStock, createStock, assignStock, resolveStock } from '../controllers/ecommerceController'
import { listMeetingNotes, createMeetingNote, updateMeetingNote, deleteMeetingNote } from '../controllers/meetingNotesController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const ecommerceRouter = Router()

ecommerceRouter.use(requireAuth)
ecommerceRouter.get('/entries', asyncHandler(getMyEntry))
ecommerceRouter.put('/entries', asyncHandler(upsertMyEntry))
ecommerceRouter.get('/team', asyncHandler(teamView))
ecommerceRouter.get('/board', asyncHandler(getBoard))
ecommerceRouter.post('/tasks', asyncHandler(createTask))
ecommerceRouter.get('/tasks/:id', asyncHandler(getTask))
ecommerceRouter.patch('/tasks/:id', asyncHandler(updateTask))
ecommerceRouter.delete('/tasks/:id', asyncHandler(deleteTask))
ecommerceRouter.post('/tasks/:id/comments', asyncHandler(addComment))
ecommerceRouter.get('/meeting-notes', asyncHandler(listMeetingNotes))
ecommerceRouter.post('/meeting-notes', asyncHandler(createMeetingNote))
ecommerceRouter.patch('/meeting-notes/:id', asyncHandler(updateMeetingNote))
ecommerceRouter.delete('/meeting-notes/:id', asyncHandler(deleteMeetingNote))
ecommerceRouter.get('/stock', asyncHandler(listStock))
ecommerceRouter.post('/stock', asyncHandler(createStock))
ecommerceRouter.patch('/stock/:id/assign', asyncHandler(assignStock))
ecommerceRouter.patch('/stock/:id/resolve', asyncHandler(resolveStock))
