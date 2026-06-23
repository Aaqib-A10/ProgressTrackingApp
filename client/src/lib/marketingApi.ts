import { api } from './api'
import type { RangeKey, CustomRange } from '../components/layout/RangeSelector'
import { rangeQuery } from './range'

export type Discipline = 'SEO' | 'SOCIAL' | 'CONTENT'
export type TaskStatus = 'BACKLOG' | 'IN_PROGRESS' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED'
export type ContentType = 'BLOG' | 'LANDING_PAGE' | 'SOCIAL_COPY' | 'VIDEO_SCRIPT' | 'EMAIL' | 'OTHER'

export interface MarketingTask {
  id: string
  title: string
  description: string
  discipline: Discipline
  status: TaskStatus
  order: number
  assignee: { id: string; name: string } | null
  contentType: ContentType | null
  wordCount: number | null
  wordTarget: number | null
  dueDate: string | null
  scheduledDate: string | null
  publishedDate: string | null
}

export interface BoardColumn {
  status: TaskStatus
  label: string
  tasks: MarketingTask[]
}

export interface BoardResponse {
  columns: BoardColumn[]
}

export interface CreateTaskInput {
  title: string
  discipline: Discipline
  status?: TaskStatus
  dueDate?: string | null
  scheduledDate?: string | null
}

export type UpdateTaskInput = Partial<{
  title: string
  description: string | null
  status: TaskStatus
  order: number
  assigneeId: string | null
  dueDate: string | null
  scheduledDate: string | null
  publishedDate: string | null
}>

export function getBoard(discipline?: Discipline) {
  return api.get<BoardResponse>(`/marketing/board${discipline ? `?discipline=${discipline}` : ''}`)
}
export function createTask(input: CreateTaskInput) {
  return api.post<{ task: MarketingTask }>('/marketing/tasks', input)
}
export function updateTask(id: string, patch: UpdateTaskInput) {
  return api.patch<{ task: MarketingTask }>(`/marketing/tasks/${id}`, patch)
}
export function deleteTask(id: string) {
  return api.del(`/marketing/tasks/${id}`)
}

export const DISCIPLINE_META: Record<Discipline, { label: string; color: string }> = {
  SEO: { label: 'SEO', color: '#4F46E5' },
  SOCIAL: { label: 'Social', color: '#14B8A6' },
  CONTENT: { label: 'Content', color: '#F59E0B' },
}

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
export function upsertSeoEntry(input: Partial<Record<SeoMetricKey, number>> & { status: SeoStatus; notes?: string }) {
  return api.put<{ entry: SeoEntry }>('/marketing/seo/entries', input)
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
