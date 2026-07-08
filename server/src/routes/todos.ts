import { Router } from 'express'
import { listTodos, createTodo, updateTodo, deleteTodo } from '../controllers/todoController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const todosRouter = Router()

todosRouter.use(requireAuth)
todosRouter.get('/', asyncHandler(listTodos))
todosRouter.post('/', asyncHandler(createTodo))
todosRouter.patch('/:id', asyncHandler(updateTodo))
todosRouter.delete('/:id', asyncHandler(deleteTodo))
