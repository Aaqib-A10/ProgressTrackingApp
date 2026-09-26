import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import type { BadgeTone } from '../components/ui/Badge'
import { rangeQuery } from './range'

export type Discipline = 'SEO' | 'SOCIAL' | 'CONTENT'
export type TaskStatus = 'BACKLOG' | 'IN_PROGRESS' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED'
export type ContentType = 'BLOG' | 'LANDING_PAGE' | 'SOCIAL_COPY' | 'VIDEO_SCRIPT' | 'EMAIL' | 'OTHER'
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface MarketingTask {
  id: string
  title: string
  description: string
  discipline: Discipline
  status: TaskStatus
  priority: Priority
  order: number
  assignee: { id: string; name: string } | null
  brand: { id: string; name: string } | null
  contentType: ContentType | null
  platform: SocialPlatform | null
  wordCount: number | null
  wordTarget: number | null
  dueDate: string | null
  dueAt: string | null
  scheduledDate: string | null
  publishedDate: string | null
  commentCount: number
  attachmentCount: number
}

export interface TaskAttachment {
  id: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
  downloadUrl: string
}

export interface BoardColumn {
  status: TaskStatus
  label: string
  tasks: MarketingTask[]
}

export interface BoardViewer {
  id: string
  isLead: boolean
  role: string
  subDeptSlug: string | null
}

export interface BoardResponse {
  columns: BoardColumn[]
  members: { id: string; name: string }[]
  viewer: BoardViewer
}

export interface CreateTaskInput {
  title: string
  discipline: Discipline
  status?: TaskStatus
  priority?: Priority
  assigneeId?: string | null
  brandId?: string | null
  platform?: SocialPlatform | null
  description?: string
  dueDate?: string | null
  dueAt?: string | null
  scheduledDate?: string | null
}

export type UpdateTaskInput = Partial<{
  title: string
  description: string | null
  discipline: Discipline
  status: TaskStatus
  priority: Priority
  order: number
  assigneeId: string | null
  brandId: string | null
  platform: SocialPlatform | null
  dueDate: string | null
  dueAt: string | null
  scheduledDate: string | null
  publishedDate: string | null
}>

export interface TaskComment {
  id: string
  body: string
  mentions: string[]
  createdAt: string
  author: { id: string; name: string }
}

export interface TeamMember {
  id: string
  name: string
  role: string
  subDeptSlug: string | null
  openTasks: number
  totalTasks: number
}
export interface TeamGroup {
  slug: string
  name: string
  lead: { id: string; name: string } | null
  members: TeamMember[]
}

export function getBoard(discipline?: Discipline) {
  return api.get<BoardResponse>(`/marketing/board${discipline ? `?discipline=${discipline}` : ''}`)
}
export function createTask(input: CreateTaskInput) {
  return api.post<{ task: MarketingTask }>('/marketing/tasks', input)
}
export function getTask(id: string) {
  return api.get<{ task: MarketingTask; comments: TaskComment[]; attachments: TaskAttachment[] }>(`/marketing/tasks/${id}`)
}
export function listTaskAttachments(taskId: string) {
  return api.get<{ attachments: TaskAttachment[] }>(`/marketing/tasks/${taskId}/attachments`)
}
export function uploadTaskAttachment(taskId: string, file: File) {
  return api.postRaw<{ attachment: TaskAttachment }>(`/marketing/tasks/${taskId}/attachments?name=${encodeURIComponent(file.name)}`, file, file.type || 'application/octet-stream')
}
export function deleteTaskAttachment(id: string) {
  return api.del(`/marketing/attachments/${id}`)
}
export function updateTask(id: string, patch: UpdateTaskInput) {
  return api.patch<{ task: MarketingTask }>(`/marketing/tasks/${id}`, patch)
}
export function addTaskComment(id: string, body: string, mentions: string[]) {
  return api.post<{ comment: TaskComment }>(`/marketing/tasks/${id}/comments`, { body, mentions })
}
export function deleteTask(id: string) {
  return api.del(`/marketing/tasks/${id}`)
}
export function getMarketingTeam() {
  return api.get<{ groups: TeamGroup[] }>('/marketing/team')
}

export const DISCIPLINE_META: Record<Discipline, { label: string; color: string }> = {
  SEO: { label: 'SEO', color: '#4F46E5' },
  SOCIAL: { label: 'Social', color: '#14B8A6' },
  CONTENT: { label: 'Content', color: '#F59E0B' },
}

export const PRIORITY_META: Record<Priority, { label: string; tone: BadgeTone; color: string }> = {
  LOW: { label: 'Low', tone: 'neutral', color: '#64748B' },
  MEDIUM: { label: 'Medium', tone: 'primary', color: '#4F46E5' },
  HIGH: { label: 'High', tone: 'warning', color: '#F59E0B' },
  URGENT: { label: 'Urgent', tone: 'danger', color: '#EF4444' },
}
export const PRIORITY_ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

// ---------- SEO ----------
export const SEO_METRICS = [
  { key: 'keywordsTracked', label: 'Keywords Tracked' },
  { key: 'pagesOptimized', label: 'Pages Optimized' },
  { key: 'backlinksBuilt', label: 'Backlinks Built' },
  { key: 'technicalFixes', label: 'Technical Fixes' },
  { key: 'organicTraffic', label: 'Organic Traffic' },
] as const
export type SeoMetricKey = (typeof SEO_METRICS)[number]['key']
export type SeoStatus = 'SUBMITTED' | 'ON_LEAVE' | 'HOLIDAY' | 'OFF'
export interface SeoEntry extends Record<SeoMetricKey, number> {
  id: string
  date: string
  status: SeoStatus
  body: string
  notes: string
}
export interface SeoEntryResponse {
  date: string
  entry: SeoEntry | null
  stats: { avgOrganicTraffic: number }
}
export function getSeoEntry(date?: string) {
  return api.get<SeoEntryResponse>(`/marketing/seo/entries${date ? `?date=${date}` : ''}`)
}
// SEO daily is now a free-text log; metrics remain accepted (optional) for back-compat.
export function upsertSeoEntry(input: { status: SeoStatus; body?: string; notes?: string } & Partial<Record<SeoMetricKey, number>>) {
  return api.put<{ entry: SeoEntry }>('/marketing/seo/entries', input)
}

// ---------- Content daily log (free text) ----------
export interface ContentEntry {
  id: string
  date: string
  status: SeoStatus
  body: string
  notes: string
}
export function getContentEntry(date?: string) {
  return api.get<{ date: string; entry: ContentEntry | null }>(`/marketing/content/entries${date ? `?date=${date}` : ''}`)
}
export function upsertContentEntry(input: { status: SeoStatus; body?: string; notes?: string }) {
  return api.put<{ entry: ContentEntry }>('/marketing/content/entries', input)
}

// ---------- Social ----------
export const SOCIAL_METRICS = [
  { key: 'postsPublished', label: 'Posts Published' },
  { key: 'postsScheduled', label: 'Posts Scheduled' },
  { key: 'reach', label: 'Reach' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'followersGained', label: 'Followers Gained' },
] as const
export type SocialMetricKey = (typeof SOCIAL_METRICS)[number]['key']
export interface SocialEntry extends Record<SocialMetricKey, number> {
  id: string
  date: string
  status: SeoStatus
  notes: string
  platformCounts: { tagId: string; posts: number }[]
}
export interface SocialEntryResponse {
  date: string
  entry: SocialEntry | null
  platforms: { id: string; name: string }[]
}
export function getSocialEntry(date?: string) {
  return api.get<SocialEntryResponse>(`/marketing/social/entries${date ? `?date=${date}` : ''}`)
}
export function upsertSocialEntry(
  input: Partial<Record<SocialMetricKey, number>> & { status: SeoStatus; notes?: string; platformCounts?: { tagId: string; posts: number }[] },
) {
  return api.put<{ entry: SocialEntry }>('/marketing/social/entries', input)
}

// ---------- Content ----------
export interface ContentItem {
  id: string
  title: string
  status: TaskStatus
  contentType: ContentType | null
  wordCount: number | null
  wordTarget: number | null
  dueDate: string | null
  publishedDate: string | null
  assignee: { id: string; name: string } | null
}
export function getContentList() {
  return api.get<{ items: ContentItem[] }>('/marketing/content')
}

// ---------- Calendar ----------
export interface CalendarEvent {
  id: string
  title: string
  discipline: Discipline
  date: string
  type: 'scheduled' | 'published' | 'due'
}
export interface CalendarResponse {
  month: string
  startDate: string
  endDate: string
  events: CalendarEvent[]
}
export function getCalendar(month?: string) {
  return api.get<CalendarResponse>(`/marketing/calendar${month ? `?month=${month}` : ''}`)
}

// ---------- Analytics ----------
export interface MktKpi {
  label: string
  value: number
  format: 'number' | 'percent'
  delta: number
}
export interface MktTrendPoint {
  label: string
  value: number
  target?: number
}
export interface MarketingAnalyticsData {
  range: { startDate: string; endDate: string; key: string }
  seo: { kpis: MktKpi[]; trafficTrend: MktTrendPoint[] }
  social: { kpis: MktKpi[]; engagementTrend: MktTrendPoint[] }
  content: { pipeline: { status: TaskStatus; count: number }[]; publishedThisPeriod: number }
  velocity: { metricLabel: string; points: MktTrendPoint[] }
}
export function getMarketingAnalytics(range: RangeKey, custom?: CustomRange | null) {
  return api.get<MarketingAnalyticsData>(`/marketing/analytics?${rangeQuery(range, custom)}`)
}

// ---------- Brands / profiles ----------
export type ServiceTier = 'TIER_1' | 'TIER_2' | 'MAINTENANCE'
export type CrmProvider = 'HUBSPOT' | 'SALESFORCE' | 'ZOHO' | 'PIPEDRIVE' | 'MONDAY' | 'OTHER'
export type CrmStatus = 'NONE' | 'PLANNED' | 'IN_PROGRESS' | 'CONNECTED'

export interface Brand {
  id: string
  name: string
  slug: string
  website: string | null
  isActive: boolean
  tier: ServiceTier
  ownerId: string | null
  ownerName: string | null
  // CRM connection tracker (registry only)
  crmProvider: CrmProvider | null
  crmStatus: CrmStatus
  crmAccount: string | null
  crmNote: string | null
  crmConnected: boolean
  crmCheckedAt: string | null
  // Platform profile counts
  profileCount: number
  activeProfiles: number
  // SEO search-term landing pages: goal + live count for the ratio
  searchTermTarget: number | null
  searchTermsTotal: number
  searchTermsLive: number
  // SEO (Google Search Console + GA4) connection
  gscSiteUrl: string | null
  ga4PropertyId: string | null
  seoConnected: boolean
  seoSyncedAt: string | null
}

export interface BrandInput {
  name?: string
  website?: string | null
  isActive?: boolean
  tier?: ServiceTier
  ownerId?: string | null
  crmProvider?: CrmProvider | null
  crmStatus?: CrmStatus
  crmAccount?: string | null
  crmNote?: string | null
  searchTermTarget?: number | null
  gscSiteUrl?: string | null
  ga4PropertyId?: string | null
}

export function listBrands(all = false) {
  return api.get<{ brands: Brand[] }>(`/marketing/brands${all ? '?all=1' : ''}`)
}
export function createBrand(input: BrandInput & { name: string }) {
  return api.post<{ brand: Brand }>('/marketing/brands', input)
}
export function updateBrand(id: string, patch: BrandInput) {
  return api.patch<{ brand: Brand }>(`/marketing/brands/${id}`, patch)
}
export function deleteBrand(id: string) {
  return api.del(`/marketing/brands/${id}`)
}

export const SERVICE_TIERS = [
  { key: 'TIER_1', label: 'Tier 1', tone: 'success' },
  { key: 'TIER_2', label: 'Tier 2', tone: 'primary' },
  { key: 'MAINTENANCE', label: 'Maintenance', tone: 'neutral' },
] as const

export const CRM_PROVIDERS = [
  { key: 'HUBSPOT', label: 'HubSpot' },
  { key: 'SALESFORCE', label: 'Salesforce' },
  { key: 'ZOHO', label: 'Zoho' },
  { key: 'PIPEDRIVE', label: 'Pipedrive' },
  { key: 'MONDAY', label: 'monday.com' },
  { key: 'OTHER', label: 'Other' },
] as const

export const CRM_STATUSES = [
  { key: 'NONE', label: 'Not connected', tone: 'neutral' },
  { key: 'PLANNED', label: 'Planned', tone: 'neutral' },
  { key: 'IN_PROGRESS', label: 'In progress', tone: 'warning' },
  { key: 'CONNECTED', label: 'Connected', tone: 'success' },
] as const

// ---------- Platform profiles (Profiles & Platforms registry) ----------
export type ProfilePlatform =
  | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'X' | 'REDDIT' | 'YOUTUBE' | 'TIKTOK' | 'WEBSITE' | 'GOOGLE_BUSINESS' | 'OTHER'
export type ProfileStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type ManagedVia = 'MIXPOST' | 'MANUAL'

export interface BrandProfile {
  id: string
  brandId: string
  platform: ProfilePlatform
  handle: string | null
  url: string | null
  status: ProfileStatus
  managedVia: ManagedVia
  businessSuiteId: string | null
  businessSuiteName: string | null
  ownerId: string | null
  ownerName: string | null
  note: string | null
  updatedAt: string
}

export interface ProfileInput {
  platform?: ProfilePlatform
  handle?: string | null
  url?: string | null
  status?: ProfileStatus
  managedVia?: ManagedVia
  businessSuiteId?: string | null
  ownerId?: string | null
  note?: string | null
}

export function listProfiles(brandId?: string, all = false) {
  const q = new URLSearchParams()
  if (brandId) q.set('brandId', brandId)
  if (all) q.set('all', '1')
  const qs = q.toString()
  return api.get<{ profiles: BrandProfile[] }>(`/marketing/profiles${qs ? `?${qs}` : ''}`)
}
export function createProfile(input: ProfileInput & { brandId: string; platform: ProfilePlatform }) {
  return api.post<{ profile: BrandProfile }>('/marketing/profiles', input)
}
export function updateProfile(id: string, patch: ProfileInput) {
  return api.patch<{ profile: BrandProfile }>(`/marketing/profiles/${id}`, patch)
}
export function deleteProfile(id: string) {
  return api.del(`/marketing/profiles/${id}`)
}

export const PROFILE_PLATFORMS = [
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'INSTAGRAM', label: 'Instagram' },
  { key: 'LINKEDIN', label: 'LinkedIn' },
  { key: 'X', label: 'X (Twitter)' },
  { key: 'REDDIT', label: 'Reddit' },
  { key: 'YOUTUBE', label: 'YouTube' },
  { key: 'TIKTOK', label: 'TikTok' },
  { key: 'WEBSITE', label: 'Website' },
  { key: 'GOOGLE_BUSINESS', label: 'Google Business' },
  { key: 'OTHER', label: 'Other' },
] as const

export const PROFILE_STATUSES = [
  { key: 'ACTIVE', label: 'Active', tone: 'success' },
  { key: 'PAUSED', label: 'Paused', tone: 'warning' },
  { key: 'ARCHIVED', label: 'Archived', tone: 'neutral' },
] as const

export const MANAGED_VIA = [
  { key: 'MIXPOST', label: 'Mixpost', tone: 'accent' },
  { key: 'MANUAL', label: 'Manual', tone: 'neutral' },
] as const

// Platforms that live under a Meta Business Suite / Business Manager.
export const META_PLATFORMS: ProfilePlatform[] = ['FACEBOOK', 'INSTAGRAM']

// ---------- Meta Business Suites (shared across brands) ----------
export interface BusinessSuite {
  id: string
  name: string
  businessManagerId: string | null
  url: string | null
  profileCount: number
}
export interface BusinessSuiteInput {
  name?: string
  businessManagerId?: string | null
  url?: string | null
}
export function listBusinessSuites() {
  return api.get<{ suites: BusinessSuite[] }>('/marketing/business-suites')
}
export function createBusinessSuite(input: BusinessSuiteInput & { name: string }) {
  return api.post<{ suite: BusinessSuite }>('/marketing/business-suites', input)
}
export function updateBusinessSuite(id: string, patch: BusinessSuiteInput) {
  return api.patch<{ suite: BusinessSuite }>(`/marketing/business-suites/${id}`, patch)
}
export function deleteBusinessSuite(id: string) {
  return api.del(`/marketing/business-suites/${id}`)
}

// ---------- SEO search-term landing pages (per brand) ----------
export type SearchTermStatus = 'PLANNED' | 'IN_PROGRESS' | 'LIVE'

export interface SearchTermPage {
  id: string
  brandId: string
  term: string
  url: string | null
  status: SearchTermStatus
  note: string | null
  updatedAt: string
}

export interface SearchTermInput {
  term?: string
  url?: string | null
  status?: SearchTermStatus
  note?: string | null
}

export function listSearchTerms(brandId: string) {
  return api.get<{ pages: SearchTermPage[] }>(`/marketing/search-terms?brandId=${brandId}`)
}
export function createSearchTerm(input: SearchTermInput & { brandId: string; term: string }) {
  return api.post<{ page: SearchTermPage }>('/marketing/search-terms', input)
}
export function updateSearchTerm(id: string, patch: SearchTermInput) {
  return api.patch<{ page: SearchTermPage }>(`/marketing/search-terms/${id}`, patch)
}
export function deleteSearchTerm(id: string) {
  return api.del(`/marketing/search-terms/${id}`)
}

export const SEARCH_TERM_STATUSES = [
  { key: 'PLANNED', label: 'Planned', tone: 'neutral' },
  { key: 'IN_PROGRESS', label: 'In progress', tone: 'warning' },
  { key: 'LIVE', label: 'Live', tone: 'success' },
] as const

// ---------- SEO (Google Search Console + GA4) ----------
export interface SeoSyncResult { brandId: string; name: string; from: string; to: string; days: number; errors: string[] }
export function syncSeo(input: { brandId?: string; days?: number } = {}) {
  return api.post<{ from: string; to: string; results: SeoSyncResult[] }>('/marketing/seo/sync', input)
}
export interface SeoUploadResult { brandId: string; rowsImported: number; from: string; to: string }
/** Upload a Search Console / GA4 CSV export as the manual fallback to auto-sync. */
export function uploadSeoCsv(brandId: string, file: File) {
  return api.postRaw<SeoUploadResult>(`/marketing/seo/upload?brandId=${brandId}`, file, 'text/csv')
}

// ---------- Monthly per-brand social stats ----------
export const SOCIAL_PLATFORMS = [
  { key: 'INSTAGRAM', label: 'Instagram' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'LINKEDIN', label: 'LinkedIn' },
  { key: 'X', label: 'X (Twitter)' },
  { key: 'TIKTOK', label: 'TikTok' },
  { key: 'YOUTUBE', label: 'YouTube' },
  { key: 'GOOGLE_BUSINESS', label: 'Google Business' },
  { key: 'OTHER', label: 'Other' },
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]['key']
export const MONTHLY_METRICS = [
  { key: 'followers', label: 'Followers' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'reach', label: 'Reach' },
  { key: 'posts', label: 'Posts' },
] as const
export type MonthlyMetricKey = (typeof MONTHLY_METRICS)[number]['key']

export interface MonthlyStatRow {
  platform: SocialPlatform
  followers: number
  impressions: number
  engagement: number
  reach: number
  posts: number
  // Extended metrics (from platform exports).
  newFollowers: number
  visitors: number
  engagementRate: number
  clicks: number
  reactions: number
  views: number
  source: 'MANUAL' | 'API'
  hasData: boolean
}
export interface MonthlyGridResponse {
  brand: { id: string; name: string }
  month: string
  platforms: MonthlyStatRow[]
}
export function getMonthlySocial(brandId: string, month: string) {
  return api.get<MonthlyGridResponse>(`/marketing/social/monthly?brandId=${brandId}&month=${month}`)
}
export function upsertMonthlySocial(input: { brandId: string; month: string; rows: Array<{ platform: SocialPlatform } & Record<MonthlyMetricKey, number>> }) {
  return api.put<MonthlyGridResponse>('/marketing/social/monthly', input)
}

export interface ComparePlatform {
  platform: SocialPlatform
  followers: number
  followersDelta: number
  followersGrowth: number
  impressions: number
  impressionsDelta: number
  engagement: number
  engagementDelta: number
  // Extended metrics.
  newFollowers: number
  visitors: number
  engagementRate: number
  engagementRatePp: number
  clicks: number
  reactions: number
  hadPrev: boolean
}
export interface CompareResponse {
  brand: { id: string; name: string }
  month: string
  prevMonth: string
  platforms: ComparePlatform[]
  totals: {
    followers: number
    followersDelta: number
    impressions: number
    impressionsDelta: number
    engagement: number
    engagementDelta: number
    // Extended metrics.
    newFollowers: number
    newFollowersDelta: number
    visitors: number
    visitorsDelta: number
    clicks: number
    clicksDelta: number
    reactions: number
    reactionsDelta: number
    engagementRate: number
    engagementRatePp: number
    hadPrev: boolean
  }
  trends: {
    followers: MktTrendPoint[]
    engagement: MktTrendPoint[]
    impressions: MktTrendPoint[]
    newFollowers: MktTrendPoint[]
    engagementRate: MktTrendPoint[]
  }
  targets: {
    followers: TargetBand | null
    impressions: TargetBand | null
    engagement: TargetBand | null
  }
}
export interface TargetBand {
  min: number
  max: number
  band: 'green' | 'amber' | 'red'
}
export function compareMonthlySocial(brandId: string, month: string, months = 6) {
  return api.get<CompareResponse>(`/marketing/social/monthly/compare?brandId=${brandId}&month=${month}&months=${months}`)
}
// Metrics selectable in the cross-brand comparison (superset of the entry grid).
export const CROSS_METRICS = [
  { key: 'followers', label: 'Followers' },
  { key: 'newFollowers', label: 'New Followers' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'engagementRate', label: 'Engagement Rate' },
  { key: 'reach', label: 'Reach' },
  { key: 'visitors', label: 'Visitors' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'posts', label: 'Posts' },
] as const
export type CrossMetricKey = (typeof CROSS_METRICS)[number]['key']
export interface CrossBrandResponse {
  month: string
  metric: CrossMetricKey
  brands: { brandId: string; name: string; value: number; delta: number }[]
}
export function crossBrandSocial(month: string, metric: CrossMetricKey = 'followers') {
  return api.get<CrossBrandResponse>(`/marketing/social/monthly/cross?month=${month}&metric=${metric}`)
}

// ---------- Blogs ----------
export type BlogStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'
export const BLOG_STATUSES: { key: BlogStatus; label: string; tone: 'neutral' | 'warning' | 'success' }[] = [
  { key: 'DRAFT', label: 'Draft', tone: 'neutral' },
  { key: 'SCHEDULED', label: 'Scheduled', tone: 'warning' },
  { key: 'PUBLISHED', label: 'Published', tone: 'success' },
]
export interface BlogPost {
  id: string
  title: string
  url: string | null
  wordCount: number | null
  status: BlogStatus
  month: string
  publishedAt: string | null
  brand: { id: string; name: string }
  author: { id: string; name: string } | null
}
export function listBlogs(params: { brandId?: string; month?: string } = {}) {
  const q = new URLSearchParams()
  if (params.brandId) q.set('brandId', params.brandId)
  if (params.month) q.set('month', params.month)
  const qs = q.toString()
  return api.get<{ blogs: BlogPost[] }>(`/marketing/blogs${qs ? `?${qs}` : ''}`)
}
export function createBlog(input: { brandId: string; title: string; url?: string; wordCount?: number; status?: BlogStatus; publishedAt?: string }) {
  return api.post<{ blog: BlogPost }>('/marketing/blogs', input)
}
export function updateBlog(id: string, patch: { status?: BlogStatus; title?: string; url?: string | null; wordCount?: number | null; publishedAt?: string }) {
  return api.patch<{ blog: BlogPost }>(`/marketing/blogs/${id}`, patch)
}
export function deleteBlog(id: string) {
  return api.del(`/marketing/blogs/${id}`)
}
export interface BlogCounts {
  month: string
  total: number
  counts: { brandId: string; name: string; count: number; delta: number }[]
}
export function getBlogCounts(month: string) {
  return api.get<BlogCounts>(`/marketing/blogs/counts?month=${month}`)
}

// ---------- Master Plan ----------
export type PlanItemStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'PENDING'
export const PLAN_STATUSES: { key: PlanItemStatus; label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' }[] = [
  { key: 'PLANNED', label: 'Planned', tone: 'neutral' },
  { key: 'IN_PROGRESS', label: 'In Progress', tone: 'primary' },
  { key: 'COMPLETED', label: 'Completed', tone: 'success' },
  { key: 'PENDING', label: 'Pending', tone: 'warning' },
]
export interface PlanItem {
  id: string
  title: string
  taskType: string | null
  brand: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  stakeholder: string | null
  status: PlanItemStatus
  plannedDate: string | null
  completionDate: string | null
  documentLink: string | null
  order: number
}
export interface PlanResponse {
  month: string
  plan: { id: string; month: string; title: string | null } | null
  items: PlanItem[]
  progress: { done: number; total: number; pct: number }
  canEdit: boolean
}
export function getPlan(month: string) {
  return api.get<PlanResponse>(`/marketing/plan?month=${month}`)
}
export interface PlanItemInput {
  month: string
  title: string
  taskType?: string | null
  brandId?: string | null
  stakeholder?: string | null
  status?: PlanItemStatus
  plannedDate?: string | null
  completionDate?: string | null
  documentLink?: string | null
}
export function addPlanItem(input: PlanItemInput) {
  return api.post<{ item: PlanItem }>('/marketing/plan/items', input)
}
export function updatePlanItem(id: string, patch: Partial<Omit<PlanItemInput, 'month'>>) {
  return api.patch<{ item: PlanItem }>(`/marketing/plan/items/${id}`, patch)
}
export function deletePlanItem(id: string) {
  return api.del(`/marketing/plan/items/${id}`)
}

// ---------- Social Planner (per-brand / per-platform scheduled social content) ----------
export interface PlannerPost {
  id: string
  title: string
  status: TaskStatus
  platform: SocialPlatform | null
  scheduledDate: string | null
  brand: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
}
export interface PlannerResponse {
  month: string
  startDate: string
  endDate: string
  posts: PlannerPost[]
}
export function getSocialPlanner(params: { month?: string; brandId?: string } = {}) {
  const q = new URLSearchParams()
  if (params.month) q.set('month', params.month)
  if (params.brandId) q.set('brandId', params.brandId)
  const qs = q.toString()
  return api.get<PlannerResponse>(`/marketing/social/planner${qs ? `?${qs}` : ''}`)
}
// Planner posts are SOCIAL MarketingTasks — reuse the task endpoints.
export function createPlannerPost(input: { title: string; platform: SocialPlatform; brandId?: string | null; scheduledDate: string; status?: TaskStatus }) {
  return createTask({ ...input, discipline: 'SOCIAL' })
}
export function updatePlannerPost(id: string, patch: { title?: string; platform?: SocialPlatform | null; brandId?: string | null; scheduledDate?: string | null; status?: TaskStatus }) {
  return updateTask(id, patch)
}
export function deletePlannerPost(id: string) {
  return deleteTask(id)
}

// ---------- ADS Campaign (per-campaign records + computed summary) ----------
export type AdPlatform = 'GOOGLE' | 'META'
export const AD_PLATFORMS: { key: AdPlatform; label: string }[] = [
  { key: 'GOOGLE', label: 'Google Ads' },
  { key: 'META', label: 'Meta Ads' },
]
export type AdCampaignType = 'SEARCH' | 'DISPLAY' | 'VIDEO' | 'SHOPPING' | 'PERFORMANCE_MAX' | 'OTHER'
export const AD_CAMPAIGN_TYPES: { key: AdCampaignType; label: string }[] = [
  { key: 'SEARCH', label: 'Search' },
  { key: 'DISPLAY', label: 'Display' },
  { key: 'VIDEO', label: 'Video' },
  { key: 'SHOPPING', label: 'Shopping' },
  { key: 'PERFORMANCE_MAX', label: 'Performance Max' },
  { key: 'OTHER', label: 'Other' },
]
export type AdCampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED'
export const AD_STATUSES: { key: AdCampaignStatus; label: string; tone: 'success' | 'warning' | 'neutral' }[] = [
  { key: 'ACTIVE', label: 'Active', tone: 'success' },
  { key: 'PAUSED', label: 'Paused', tone: 'warning' },
  { key: 'ENDED', label: 'Ended', tone: 'neutral' },
]
export interface AdCampaign {
  id: string
  brandId: string
  brand?: { id: string; name: string }
  platform: AdPlatform
  month: string
  date: string
  title: string
  campaignType: AdCampaignType
  status: AdCampaignStatus
  leads: number
  businessLeads: number
  spend: number
  avgCostPerLead: number | null
  impressions: number
  clicks: number
}
export interface AdsSummary {
  month: string | null
  activeCampaigns: number
  totalCampaigns: number
  bestPerforming: { title: string; leads: number } | null
  bestCpl: { title: string; cpl: number } | null
  totalLeads: number
  totalBusinessLeads: number
  totalSpend: number
  avgCostPerLead: number | null
}
export type AdCampaignInput = {
  brandId: string
  platform: AdPlatform
  month?: string
  date?: string
  title: string
  campaignType?: AdCampaignType
  status?: AdCampaignStatus
  leads?: number
  businessLeads?: number
  spend?: number
  impressions?: number
  clicks?: number
}
export type AdsFilter = { brandId?: string; platform?: AdPlatform; month?: string; from?: string; to?: string }
function adsQuery(params: AdsFilter) {
  const q = new URLSearchParams()
  if (params.brandId) q.set('brandId', params.brandId)
  if (params.platform) q.set('platform', params.platform)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.month && !params.from && !params.to) q.set('month', params.month)
  return q.toString()
}
export function listAds(params: AdsFilter = {}) {
  const qs = adsQuery(params)
  return api.get<{ campaigns: AdCampaign[] }>(`/marketing/ads${qs ? `?${qs}` : ''}`)
}
export function getAdsSummary(params: AdsFilter = {}) {
  const qs = adsQuery(params)
  return api.get<AdsSummary>(`/marketing/ads/summary${qs ? `?${qs}` : ''}`)
}
export function createAd(input: AdCampaignInput) {
  return api.post<{ campaign: AdCampaign }>('/marketing/ads', input)
}
export function updateAd(id: string, patch: Partial<AdCampaignInput>) {
  return api.patch<{ campaign: AdCampaign }>(`/marketing/ads/${id}`, patch)
}
export function deleteAd(id: string) {
  return api.del(`/marketing/ads/${id}`)
}

// ---------- Email Marketing (placeholder) ----------
export interface EmailOverview {
  brands: { id: string; name: string }[]
  campaigns: unknown[]
  stats: null
  canWrite: boolean
}
export function getEmailOverview() {
  return api.get<EmailOverview>('/marketing/email')
}
