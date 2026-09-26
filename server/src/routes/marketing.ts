import { Router, raw } from 'express'
import {
  getBoard, createTask, updateTask, deleteTask, getTask, addComment, getTeam,
  listTaskAttachments, uploadTaskAttachment, downloadTaskAttachment, deleteTaskAttachment,
} from '../controllers/marketingController'
import { seoGet, seoUpsert, socialGet, socialUpsert, contentList, contentGet, contentUpsert } from '../controllers/marketingActivityController'
import { calendar, marketingAnalytics, socialPlanner } from '../controllers/marketingViewsController'
import { listBrands, createBrand, updateBrand, deleteBrand } from '../controllers/marketingBrandController'
import { listProfiles, createProfile, updateProfile, deleteProfile } from '../controllers/marketingProfileController'
import { listSearchTerms, createSearchTerm, updateSearchTerm, deleteSearchTerm } from '../controllers/marketingSearchTermController'
import { listBusinessSuites, createBusinessSuite, updateBusinessSuite, deleteBusinessSuite } from '../controllers/marketingBusinessSuiteController'
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

// Marketing team tree (members grouped by sub-department + task counts)
marketingRouter.get('/team', asyncHandler(getTeam))

// Board-card attachments (media/files). Upload is raw binary (express.raw), ?name= filename.
marketingRouter.get('/tasks/:id/attachments', asyncHandler(listTaskAttachments))
marketingRouter.post('/tasks/:id/attachments', raw({ type: () => true, limit: '26mb' }), asyncHandler(uploadTaskAttachment))
marketingRouter.get('/attachments/:id/download', asyncHandler(downloadTaskAttachment))
marketingRouter.delete('/attachments/:id', asyncHandler(deleteTaskAttachment))

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

// Active platform profiles per brand (Profiles & Platforms registry)
marketingRouter.get('/profiles', asyncHandler(listProfiles))
marketingRouter.post('/profiles', asyncHandler(createProfile))
marketingRouter.patch('/profiles/:id', asyncHandler(updateProfile))
marketingRouter.delete('/profiles/:id', asyncHandler(deleteProfile))

// SEO search-term landing pages per brand (target + live/total ratio)
marketingRouter.get('/search-terms', asyncHandler(listSearchTerms))
marketingRouter.post('/search-terms', asyncHandler(createSearchTerm))
marketingRouter.patch('/search-terms/:id', asyncHandler(updateSearchTerm))
marketingRouter.delete('/search-terms/:id', asyncHandler(deleteSearchTerm))

// Meta Business Suites (shared across brands; FB/IG profiles connect to one)
marketingRouter.get('/business-suites', asyncHandler(listBusinessSuites))
marketingRouter.post('/business-suites', asyncHandler(createBusinessSuite))
marketingRouter.patch('/business-suites/:id', asyncHandler(updateBusinessSuite))
marketingRouter.delete('/business-suites/:id', asyncHandler(deleteBusinessSuite))

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
