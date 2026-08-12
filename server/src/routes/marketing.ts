import { Router, raw } from 'express'
import { getBoard, createTask, updateTask, deleteTask, getTask, addComment } from '../controllers/marketingController'
import { seoGet, seoUpsert, socialGet, socialUpsert, contentList, contentGet, contentUpsert } from '../controllers/marketingActivityController'
import { calendar, marketingAnalytics, socialPlanner } from '../controllers/marketingViewsController'
import { listBrands, createBrand, updateBrand, deleteBrand } from '../controllers/marketingBrandController'
import { getMonthly, upsertMonthly, compareMonthly, crossBrand } from '../controllers/marketingSocialMonthlyController'
import { syncSeo, uploadSeoCsv } from '../controllers/marketingSeoController'
import { listBlogs, createBlog, updateBlog, deleteBlog, blogCounts } from '../controllers/marketingBlogController'
import { listAds, adsSummary, createAd, updateAd, deleteAd } from '../controllers/marketingAdsController'
import { getPlan, addPlanItem, updatePlanItem, deletePlanItem } from '../controllers/marketingPlanController'
import { emailOverview } from '../controllers/marketingEmailController'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'

export const marketingRouter = Router()

marketingRouter.use(requireAuth)

// Kanban board
marketingRouter.get('/board', asyncHandler(getBoard))
marketingRouter.post('/tasks', asyncHandler(createTask))
marketingRouter.get('/tasks/:id', asyncHandler(getTask))
marketingRouter.patch('/tasks/:id', asyncHandler(updateTask))
marketingRouter.delete('/tasks/:id', asyncHandler(deleteTask))
marketingRouter.post('/tasks/:id/comments', asyncHandler(addComment))

// Sub-department activity
marketingRouter.get('/seo/entries', asyncHandler(seoGet))
marketingRouter.put('/seo/entries', asyncHandler(seoUpsert))
marketingRouter.get('/social/entries', asyncHandler(socialGet))
marketingRouter.put('/social/entries', asyncHandler(socialUpsert))
marketingRouter.get('/content', asyncHandler(contentList))
marketingRouter.get('/content/entries', asyncHandler(contentGet))
marketingRouter.put('/content/entries', asyncHandler(contentUpsert))

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

// SEO — Google Search Console + GA4 sync (Phase 1) + manual CSV upload fallback
marketingRouter.post('/seo/sync', asyncHandler(syncSeo))
marketingRouter.post('/seo/upload', raw({ type: '*/*', limit: '10mb' }), asyncHandler(uploadSeoCsv))

// Blogs (content inventory + per-brand counts)
marketingRouter.get('/blogs', asyncHandler(listBlogs))
marketingRouter.get('/blogs/counts', asyncHandler(blogCounts))
marketingRouter.post('/blogs', asyncHandler(createBlog))
marketingRouter.patch('/blogs/:id', asyncHandler(updateBlog))
marketingRouter.delete('/blogs/:id', asyncHandler(deleteBlog))

// ADS Campaign (per-campaign records + computed summary)
marketingRouter.get('/ads', asyncHandler(listAds))
marketingRouter.get('/ads/summary', asyncHandler(adsSummary))
marketingRouter.post('/ads', asyncHandler(createAd))
marketingRouter.patch('/ads/:id', asyncHandler(updateAd))
marketingRouter.delete('/ads/:id', asyncHandler(deleteAd))

// Email Marketing (placeholder overview)
marketingRouter.get('/email', asyncHandler(emailOverview))

// Master Plan
marketingRouter.get('/plan', asyncHandler(getPlan))
marketingRouter.post('/plan/items', asyncHandler(addPlanItem))
marketingRouter.patch('/plan/items/:id', asyncHandler(updatePlanItem))
marketingRouter.delete('/plan/items/:id', asyncHandler(deletePlanItem))

// Views
marketingRouter.get('/calendar', asyncHandler(calendar))
marketingRouter.get('/social/planner', asyncHandler(socialPlanner))
marketingRouter.get('/analytics', asyncHandler(marketingAnalytics))
