import { Router } from 'express'
import { getBoard, createTask, updateTask, deleteTask } from '../controllers/marketingController'
import { seoGet, seoUpsert, socialGet, socialUpsert, contentList } from '../controllers/marketingActivityController'
import { calendar, marketingAnalytics } from '../controllers/marketingViewsController'
import { listBrands, createBrand, updateBrand, deleteBrand } from '../controllers/marketingBrandController'
import { getMonthly, upsertMonthly, compareMonthly, crossBrand } from '../controllers/marketingSocialMonthlyController'
import { listBlogs, createBlog, updateBlog, deleteBlog, blogCounts } from '../controllers/marketingBlogController'
import { getPlan, addPlanItem, updatePlanItem, deletePlanItem } from '../controllers/marketingPlanController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const marketingRouter = Router()

marketingRouter.use(requireAuth)

// Kanban board
marketingRouter.get('/board', asyncHandler(getBoard))
marketingRouter.post('/tasks', asyncHandler(createTask))
marketingRouter.patch('/tasks/:id', asyncHandler(updateTask))
marketingRouter.delete('/tasks/:id', asyncHandler(deleteTask))

// Sub-department activity
marketingRouter.get('/seo/entries', asyncHandler(seoGet))
marketingRouter.put('/seo/entries', asyncHandler(seoUpsert))
marketingRouter.get('/social/entries', asyncHandler(socialGet))
marketingRouter.put('/social/entries', asyncHandler(socialUpsert))
marketingRouter.get('/content', asyncHandler(contentList))

// Brands / profiles
marketingRouter.get('/brands', asyncHandler(listBrands))
marketingRouter.post('/brands', asyncHandler(createBrand))
marketingRouter.patch('/brands/:id', asyncHandler(updateBrand))
marketingRouter.delete('/brands/:id', asyncHandler(deleteBrand))

// Monthly per-brand social stats
marketingRouter.get('/social/monthly', asyncHandler(getMonthly))
marketingRouter.put('/social/monthly', asyncHandler(upsertMonthly))
marketingRouter.get('/social/monthly/compare', asyncHandler(compareMonthly))
marketingRouter.get('/social/monthly/cross', asyncHandler(crossBrand))

// Blogs (content inventory + per-brand counts)
marketingRouter.get('/blogs', asyncHandler(listBlogs))
marketingRouter.get('/blogs/counts', asyncHandler(blogCounts))
marketingRouter.post('/blogs', asyncHandler(createBlog))
marketingRouter.patch('/blogs/:id', asyncHandler(updateBlog))
marketingRouter.delete('/blogs/:id', asyncHandler(deleteBlog))

// Master Plan
marketingRouter.get('/plan', asyncHandler(getPlan))
marketingRouter.post('/plan/items', asyncHandler(addPlanItem))
marketingRouter.patch('/plan/items/:id', asyncHandler(updatePlanItem))
marketingRouter.delete('/plan/items/:id', asyncHandler(deletePlanItem))

// Views
marketingRouter.get('/calendar', asyncHandler(calendar))
marketingRouter.get('/analytics', asyncHandler(marketingAnalytics))
