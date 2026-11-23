import express, { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import * as I from '../controllers/importController'

/** Imports from a CSV file: people and tasks (controllers/importController). */
export const importRouter = Router()
importRouter.use(requireAuth)
importRouter.use(express.json({ limit: '3mb' }))
importRouter.get('/template/:what', asyncHandler(I.importTemplate))
importRouter.post('/people', asyncHandler(I.importPeople))
importRouter.post('/tasks', asyncHandler(I.importTasks))
