import { Router } from 'express'
import { search } from '../controllers/searchController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const searchRouter = Router()

searchRouter.use(requireAuth)
searchRouter.get('/', asyncHandler(search))
