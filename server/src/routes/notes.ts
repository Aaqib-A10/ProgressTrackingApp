import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { listNotes, getNote, createNote, updateNote, setShares, deleteNote, notePeople } from '../controllers/notesController'

/** Notes: sticky notes, shared with people (controllers/notesController). Everyone has them. */
export const notesRouter = Router()
notesRouter.use(requireAuth)
notesRouter.get('/', asyncHandler(listNotes))
notesRouter.get('/people', asyncHandler(notePeople))
notesRouter.get('/:id', asyncHandler(getNote))
notesRouter.post('/', asyncHandler(createNote))
notesRouter.patch('/:id', asyncHandler(updateNote))
notesRouter.put('/:id/shares', asyncHandler(setShares))
notesRouter.delete('/:id', asyncHandler(deleteNote))
