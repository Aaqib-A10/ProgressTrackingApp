import type { Asker } from '../access'
import type { Args, Entry, Row, Table } from './types'
import { get, idOf, loose, nameOf, period, reader, ymd } from './load'
import { norm } from './table'

/**
 * Marketing: the team's work (social posts, content, SEO items), the content board, blogs, ads, email, the master
 * plan, the social planner and monthly social numbers, brands and profiles, search terms, the team and its analytics.
 * Shapes are those of controllers/marketing*.ts. The main lists name their columns; the rest are read as they come.
 */

const inTeam = (a: Asker) => a.role === 'SUPER_ADMIN' || a.kinds.includes('MARKETING' as never)
const own = (a: Asker) => a.kinds.includes('MARKETING' as never)
/** YYYY-MM for screens kept by month: the month of the date asked, else the screen's own default (this month). */
const month = (a: Args): Record<string, string> => { const d = ymd(a.date) || ymd(a.from) || ymd(a.to); return d ? { month: d.slice(0, 7) } : {} }
const dyn = (unit: [string, string]): Table => ({ unit, columns: [{ key: 'value', label: unit[0] }] })

const STATUS: Record<string, string> = { BACKLOG: 'Backlog', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', SCHEDULED: 'Scheduled', PUBLISHED: 'Published' }
const KIND: Record<string, string> = { SEO: 'SEO', SOCIAL: 'Social post', CONTENT: 'Content piece' }
interface TaskT { title: string; description: string; discipline: string; status: string; priority: string; assignee: { id: string; name: string } | null; brand: { name: string } | null; contentType: string | null; platform: string | null; dueDate: string | null; scheduledDate: string | null; publishedDate: string | null; commentCount: number }
interface Brand { id: string; name: string }

/** The brand the model means, from the brands this person can see; an error text when it is not one of them. */
async function brandOf(ctx: Parameters<NonNullable<Entry['load']>>[0], a: Args): Promise<{ brand: Brand } | { error: string }> {
  const r = await get<{ brands: Brand[] }>(ctx, '/api/marketing/brands')
  if (r.error !== undefined) return { error: r.error }
  const want = norm(a.item || a.search)
  const names = r.body.brands.map((b) => b.name).join(', ')
  if (!want) return r.body.brands.length === 1 ? { brand: r.body.brands[0] } : { error: `Say which brand (pass item with its name). Brands: ${names}.` }
  const hit = r.body.brands.filter((b) => norm(b.name) === want)
  const loose2 = hit.length ? hit : r.body.brands.filter((b) => norm(b.name).includes(want) || want.includes(norm(b.name)))
  if (loose2.length === 1) return { brand: loose2[0] }
  return { error: loose2.length ? `"${a.item || a.search}" fits ${loose2.length} brands: ${loose2.map((b) => b.name).join(', ')}. Ask which one.` : `No brand is called "${a.item || a.search}". Brands: ${names}.` }
}

export const MARKETING: Entry[] = [
  {
    key: 'marketing.tasks', label: 'Marketing work', area: 'Marketing', app: '/app/marketing/content',
    about: "Everything the marketing team is working on (social posts, content pieces, SEO items) that the asker can see: its status from Backlog to Published, who has it, the brand, priority and dates. It is the team's work, not \"my tasks\".",
    says: ['marketing tasks', 'marketing work', 'social posts', 'seo tasks', 'content tasks', 'in review', 'backlog', 'scheduled posts', 'published this', 'what is the marketing team working on', 'who is working on', 'marketing board', 'content pipeline', 'marketing ka kaam'],
    who: inTeam, pin: own,
    blocks: ['mkt-seo', 'mkt-content'], apis: ['/api/marketing/board'], models: ['MarketingTask', 'MarketingTaskComment'],
    load: reader<{ columns: { tasks: TaskT[] }[] }>('/api/marketing/board', {
      rows: (b) => b.columns.flatMap((c) => c.tasks.map((t) => ({ title: t.title, kind: t.discipline, status: t.status, assignee: nameOf(t.assignee), assigneeId: idOf(t.assignee), brand: nameOf(t.brand), priority: t.priority.toLowerCase(), platform: t.platform ?? t.contentType ?? '', dueDate: t.dueDate, scheduledDate: t.scheduledDate, publishedDate: t.publishedDate, description: t.description, comments: t.commentCount }))),
    }),
    table: {
      unit: ['marketing item', 'marketing items'],
      columns: [{ key: 'title', label: 'item' }, { key: 'kind', label: 'kind' }, { key: 'status', label: 'status' }, { key: 'assignee', label: 'assigned to' }, { key: 'assigneeId', label: 'id', hidden: true }, { key: 'brand', label: 'brand' }, { key: 'priority', label: 'priority' }, { key: 'platform', label: 'platform or type' }, { key: 'dueDate', label: 'due', kind: 'date' }, { key: 'scheduledDate', label: 'scheduled', kind: 'date' }, { key: 'publishedDate', label: 'published', kind: 'date' }, { key: 'description', label: 'description', kind: 'long' }, { key: 'comments', label: 'comments', kind: 'number' }],
      people: ['assignee'], mine: 'assigneeId', status: 'status', groups: ['kind', 'brand'], date: 'dueDate', words: { status: STATUS, kind: KIND },
      flags: {
        open: { label: 'not published yet', says: ['open', 'pending', 'remaining', 'in the pipeline'], test: (r) => r.status !== 'PUBLISHED' },
        overdue: { label: 'overdue', says: ['late', 'past due'], test: (r, c) => r.status !== 'PUBLISHED' && !!r.dueDate && String(r.dueDate) < c.today },
        unassigned: { label: 'not assigned', says: ['unassigned', 'nobody'], test: (r) => r.status !== 'PUBLISHED' && !r.assignee },
        social: { label: 'social posts', says: ['social', 'posts'], test: (r) => r.kind === 'SOCIAL' },
        content: { label: 'content pieces', says: ['content'], test: (r) => r.kind === 'CONTENT' },
        seo: { label: 'SEO items', says: ['seo'], test: (r) => r.kind === 'SEO' },
      },
    },
    brief: (rows, c) => { const mine = rows.filter((r) => r.assigneeId === c.me.id && r.status !== 'PUBLISHED'); const late = mine.filter((r) => !!r.dueDate && String(r.dueDate) < c.today).length; return mine.length ? `Marketing: ${mine.length} item${mine.length === 1 ? '' : 's'} of yours not published yet${late ? `, ${late} overdue` : ''}.` : null },
    tip: 'There is no "Marketing board" screen any more: in the answer call these the Social Planner, the Content board or SEO. "My tasks" (everything given to the asker) is the My Tasks line of the guide.',
  },
  {
    key: 'marketing.team', label: 'Marketing team', area: 'Marketing', app: '/app/marketing/team',
    about: 'The marketing team by group (leadership, SEO, social, content): each person, their role and how many open and total items they have.',
    says: ['marketing team', 'who is in marketing', 'seo team', 'social team', 'content team', 'workload', 'who has the most tasks', 'open tasks per person'],
    who: inTeam,
    blocks: ['mkt-team'], apis: ['/api/marketing/team'], models: ['SubDepartment'],
    load: reader<{ groups: { name: string; lead: { name: string } | null; members: { name: string; role: string; openTasks: number; totalTasks: number }[] }[] }>('/api/marketing/team', {
      rows: (b) => b.groups.flatMap((g) => g.members.map((m) => ({ name: m.name.trim(), group: g.name, lead: nameOf(g.lead), role: m.role.replace(/_/g, ' ').toLowerCase(), open: m.openTasks, total: m.totalTasks }))),
    }),
    table: { unit: ['person', 'people'], columns: [{ key: 'name', label: 'person' }, { key: 'group', label: 'group' }, { key: 'lead', label: 'group lead' }, { key: 'role', label: 'role' }, { key: 'open', label: 'open items', kind: 'number' }, { key: 'total', label: 'all items', kind: 'number' }], people: ['name'], groups: ['group'], sums: ['open', 'total'] },
  },
  {
    key: 'marketing.content', label: 'Content board', area: 'Marketing', app: '/app/marketing/content',
    about: 'The content pieces: title, status, type, words written against the word target, due date, publish date and writer.',
    says: ['content board', 'content pieces', 'articles', 'word count', 'who is writing', 'content due', 'content published', 'content calendar', 'editorial'],
    who: inTeam,
    blocks: ['mkt-content', 'mkt-content-log'], apis: ['/api/marketing/content'], models: ['ContentDailyEntry'],
    load: reader<{ items: { title: string; status: string; contentType: string | null; wordCount: number | null; wordTarget: number | null; dueDate: string | null; publishedDate: string | null; assignee: { id: string; name: string } | null }[] }>('/api/marketing/content', {
      rows: (b) => b.items.map((t) => ({ title: t.title, status: t.status, type: t.contentType ?? '', words: t.wordCount, target: t.wordTarget, dueDate: t.dueDate, publishedDate: t.publishedDate, assignee: nameOf(t.assignee), assigneeId: idOf(t.assignee) })),
    }),
    table: {
      unit: ['content piece', 'content pieces'],
      columns: [{ key: 'title', label: 'title' }, { key: 'status', label: 'status' }, { key: 'type', label: 'type' }, { key: 'words', label: 'words', kind: 'number' }, { key: 'target', label: 'word target', kind: 'number' }, { key: 'dueDate', label: 'due', kind: 'date' }, { key: 'publishedDate', label: 'published', kind: 'date' }, { key: 'assignee', label: 'writer' }, { key: 'assigneeId', label: 'id', hidden: true }],
      people: ['assignee'], mine: 'assigneeId', status: 'status', date: 'dueDate', sums: ['words'], words: { status: STATUS },
      flags: { open: { label: 'not published yet', says: ['open', 'pending'], test: (r) => r.status !== 'PUBLISHED' }, overdue: { label: 'overdue', says: ['late'], test: (r, c) => r.status !== 'PUBLISHED' && !!r.dueDate && String(r.dueDate) < c.today } },
    },
  },
  {
    key: 'marketing.blogs', label: 'Blogs', area: 'Marketing', app: '/app/marketing/blogs',
    about: 'Blog posts: title, link, word count, status, the month, publish date, brand and author, with how many were published per brand this month.',
    says: ['blogs', 'blog', 'blog posts', 'how many blogs', 'blogs this month', 'blogs published', 'who wrote', 'blog for', 'kitne blog'],
    who: inTeam,
    blocks: ['mkt-blogs'], apis: ['/api/marketing/blogs', '/api/marketing/blogs/counts'], models: ['BlogPost'],
    async load(ctx, a) {
      const [list, counts] = await Promise.all([
        get<{ blogs: { title: string; url: string | null; wordCount: number | null; status: string; month: string; publishedAt: string | null; brand: { name: string } | null; author: { id: string; name: string } | null }[] }>(ctx, '/api/marketing/blogs', month(a)),
        get<{ month: string; total: number; counts: { name: string; count: number; delta: number }[] }>(ctx, '/api/marketing/blogs/counts', month(a)),
      ])
      if (list.error !== undefined) return { error: list.error }
      return {
        rows: list.body.blogs.map((b) => ({ title: b.title, brand: nameOf(b.brand), author: nameOf(b.author), authorId: idOf(b.author), status: b.status, words: b.wordCount, month: b.month, publishedAt: b.publishedAt, link: b.url })),
        head: counts.body ? [`Month ${counts.body.month}: ${counts.body.total} blogs published${counts.body.counts.some((c) => c.count) ? ` (${counts.body.counts.filter((c) => c.count).map((c) => `${c.name} ${c.count}`).join(', ')})` : ''}.`] : [],
      }
    },
    table: {
      unit: ['blog post', 'blog posts'],
      columns: [{ key: 'title', label: 'title' }, { key: 'brand', label: 'brand' }, { key: 'author', label: 'author' }, { key: 'authorId', label: 'id', hidden: true }, { key: 'status', label: 'status' }, { key: 'words', label: 'words', kind: 'number' }, { key: 'month', label: 'month' }, { key: 'publishedAt', label: 'published', kind: 'date' }, { key: 'link', label: 'link' }],
      people: ['author'], mine: 'authorId', status: 'status', groups: ['brand', 'month'], date: 'publishedAt', sums: ['words'], words: { status: { PUBLISHED: 'Published', DRAFT: 'Draft', IN_REVIEW: 'In Review' } },
    },
  },
  {
    key: 'marketing.ads', label: 'Ads campaigns', area: 'Marketing', app: '/app/marketing/ads',
    about: 'Paid campaigns: title, brand, platform (Google, Meta...), type, status, month, leads, business leads, spend, cost per lead, impressions and clicks; with the totals and the best campaign.',
    says: ['ads', 'ad campaigns', 'campaigns', 'paid campaigns', 'ad spend', 'spend', 'cost per lead', 'cpl', 'google ads', 'meta ads', 'facebook ads', 'best campaign', 'leads from ads', 'impressions', 'clicks'],
    who: inTeam,
    blocks: ['mkt-ads'], apis: ['/api/marketing/ads', '/api/marketing/ads/summary'], models: ['AdCampaign'],
    async load(ctx, a) {
      const q = { ...month(a), ...(ymd(a.from) && ymd(a.to) ? { from: ymd(a.from), to: ymd(a.to) } : {}) }
      const [list, sum] = await Promise.all([
        get<{ campaigns: { title: string; brand: { name: string } | null; platform: string; campaignType: string | null; status: string; month: string; leads: number; businessLeads: number; spend: number; avgCostPerLead: number | null; impressions: number; clicks: number }[] }>(ctx, '/api/marketing/ads', q),
        get<{ month: string; activeCampaigns: number; totalCampaigns: number; bestPerforming: { title: string; leads: number } | null; bestCpl: { title: string; cpl: number } | null; totalLeads: number; totalBusinessLeads: number; totalSpend: number; avgCostPerLead: number }>(ctx, '/api/marketing/ads/summary', q),
      ])
      if (list.error !== undefined) return { error: list.error }
      const s = sum.body
      const two = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100)
      return {
        rows: list.body.campaigns.map((c) => ({ title: c.title, brand: nameOf(c.brand), platform: c.platform, type: c.campaignType ?? '', status: c.status, month: c.month, leads: c.leads, businessLeads: c.businessLeads, spend: c.spend, cpl: two(c.avgCostPerLead), impressions: c.impressions, clicks: c.clicks })),
        dated: true,
        head: s ? [`The Ads screen's own totals: ${s.activeCampaigns} active of ${s.totalCampaigns} campaigns; ${s.totalLeads} leads (${s.totalBusinessLeads} business leads); spend ${s.totalSpend}; average cost per lead ${two(s.avgCostPerLead)}.${s.bestPerforming ? ` Most leads: "${s.bestPerforming.title}" (${s.bestPerforming.leads}).` : ''}${s.bestCpl ? ` Lowest cost per lead: "${s.bestCpl.title}" (${two(s.bestCpl.cpl)}).` : ''}`] : [],
      }
    },
    table: {
      unit: ['campaign', 'campaigns'],
      columns: [{ key: 'title', label: 'campaign' }, { key: 'brand', label: 'brand' }, { key: 'platform', label: 'platform' }, { key: 'type', label: 'type' }, { key: 'status', label: 'status' }, { key: 'month', label: 'month' }, { key: 'leads', label: 'leads', kind: 'number' }, { key: 'businessLeads', label: 'business leads', kind: 'number' }, { key: 'spend', label: 'spend', kind: 'money' }, { key: 'cpl', label: 'cost per lead', kind: 'money' }, { key: 'impressions', label: 'impressions', kind: 'number' }, { key: 'clicks', label: 'clicks', kind: 'number' }],
      status: 'status', groups: ['brand', 'platform', 'month'], sums: ['leads', 'businessLeads', 'spend'],
      flags: { active: { label: 'active', says: ['running', 'live', 'on'], test: (r) => r.status === 'ACTIVE' } },
    },
  },
  {
    key: 'marketing.email', label: 'Email marketing', area: 'Marketing', app: '/app/marketing/email',
    about: 'Email campaigns and their numbers (sent, opens, clicks...), by brand.',
    says: ['email marketing', 'email campaigns', 'newsletter', 'newsletters', 'open rate', 'emails sent', 'email campaign'],
    who: inTeam,
    blocks: ['mkt-email'], apis: ['/api/marketing/email'], models: [],
    async load(ctx) {
      const r = await get<{ campaigns: unknown[]; stats: Record<string, unknown> | null }>(ctx, '/api/marketing/email')
      if (r.error !== undefined) return { error: r.error }
      const t = loose(r.body.campaigns, ['email campaign', 'email campaigns'], { groups: ['brand'], date: 'sentAt' })
      return { ...t, head: r.body.stats ? [`The screen's own totals: ${Object.entries(r.body.stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(', ')}.`] : [] }
    },
    table: dyn(['email campaign', 'email campaigns']),
  },
  {
    key: 'marketing.plan', label: 'Master Plan', area: 'Marketing', app: '/app/marketing/plan',
    about: "The marketing master plan of a month: its items, who owns each, whether it is done, and the month's progress.",
    says: ['master plan', 'marketing plan', 'plan for the month', 'plan items', 'plan progress', 'monthly plan'],
    who: inTeam,
    blocks: ['mkt-plan'], apis: ['/api/marketing/plan'], models: ['MarketingPlan', 'MarketingPlanItem'],
    async load(ctx, a) {
      const r = await get<{ month: string; plan: Record<string, unknown> | null; items: unknown[]; progress: { done: number; total: number; pct: number } }>(ctx, '/api/marketing/plan', month(a))
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.items, ['plan item', 'plan items'], { people: ['owner', 'assignee'], date: 'dueDate' }), dated: true, head: [`Master plan for ${r.body.month}: ${r.body.plan ? `${r.body.progress.done} of ${r.body.progress.total} items done (${r.body.progress.pct}%)` : 'no plan has been written for this month'}.`] }
    },
    table: dyn(['plan item', 'plan items']),
  },
  {
    key: 'marketing.planner', label: 'Social Planner', area: 'Marketing', app: '/app/marketing/planner',
    about: 'The social posts planned for a month: what, which platform and brand, which day, its status and who has it.',
    says: ['social planner', 'planned posts', 'posts this month', 'posts planned', 'social calendar', 'what are we posting', 'instagram posts', 'linkedin posts', 'facebook posts'],
    who: inTeam,
    blocks: ['mkt-planner'], apis: ['/api/marketing/social/planner'], models: ['SocialDailyEntry', 'SocialPlatformCount'],
    async load(ctx, a) {
      const r = await get<{ month: string; posts: unknown[] }>(ctx, '/api/marketing/social/planner', month(a))
      if (r.error !== undefined) return { error: r.error }
      return { ...loose(r.body.posts, ['social post', 'social posts'], { people: ['assignee'], groups: ['platform', 'brand'], date: 'scheduledDate' }), dated: true, head: [`Social Planner for ${r.body.month}.`] }
    },
    table: dyn(['social post', 'social posts']),
  },
  {
    key: 'marketing.brands', label: 'Brands', area: 'Marketing', app: '/app/marketing/brands',
    about: 'The brands the team markets: name, website, tier, owner, how many social profiles each has, its search terms, and whether its CRM and search tools are connected.',
    says: ['brands', 'our brands', 'which brands', 'brand list', 'how many brands', 'brand owner', 'tier 1', 'website of'],
    who: inTeam,
    blocks: ['mkt-brands'], apis: ['/api/marketing/brands'], models: ['Brand', 'BrandSeoDaily'],
    async load(ctx) {
      const r = await get<{ brands: unknown[] }>(ctx, '/api/marketing/brands')
      if (r.error !== undefined) return { error: r.error }
      return loose(r.body.brands, ['brand', 'brands'], { people: ['ownerName'], groups: ['tier'], sums: ['profileCount', 'searchTermsTotal'], drop: /^(slug|crmAccount|crmNote|gscSiteUrl|ga4PropertyId|crmCheckedAt|seoSyncedAt)$/ })
    },
    table: dyn(['brand', 'brands']),
  },
  {
    key: 'marketing.profiles', label: 'Profiles & Platforms', area: 'Marketing', app: '/app/marketing/profiles',
    about: 'The social media profiles of each brand: platform, handle, link, whether it is active, how it is managed and who owns it; and the business suites that hold them.',
    says: ['social profiles', 'profiles', 'platforms', 'which platforms', 'instagram handle', 'facebook page', 'business suite', 'who manages', 'linkedin page'],
    who: inTeam,
    blocks: ['mkt-profiles'], apis: ['/api/marketing/brands', '/api/marketing/profiles', '/api/marketing/business-suites'], models: ['BrandProfile', 'BusinessSuite'],
    async load(ctx) {
      const [p, b, s] = await Promise.all([get<{ profiles: Record<string, unknown>[] }>(ctx, '/api/marketing/profiles'), get<{ brands: Brand[] }>(ctx, '/api/marketing/brands'), get<{ suites: { name: string; profileCount: number }[] }>(ctx, '/api/marketing/business-suites')])
      if (p.error !== undefined) return { error: p.error }
      const brand = new Map((b.body?.brands ?? []).map((x) => [x.id, x.name]))
      return { ...loose(p.body.profiles.map((x) => ({ brand: brand.get(String(x.brandId)) ?? '', ...x })), ['social profile', 'social profiles'], { people: ['ownerName'], groups: ['brand', 'platform'], drop: /^(updatedAt)$/ }), head: s.body?.suites.length ? [`Business suites: ${s.body.suites.map((x) => `${x.name} (${x.profileCount} profiles)`).join(', ')}.`] : [] }
    },
    table: dyn(['social profile', 'social profiles']),
  },
  {
    key: 'marketing.social', label: 'Social Reports', area: 'Marketing', app: '/app/marketing/social/monthly',
    about: 'The monthly social media numbers of ONE brand, per platform: followers, new followers, reach, impressions, engagement, posts, clicks, views.',
    says: ['social report', 'social reports', 'social numbers', 'followers', 'reach', 'engagement', 'social analytics', 'monthly social', 'instagram followers', 'how many followers'],
    who: (a) => a.role === 'SUPER_ADMIN' || (inTeam(a) && (a.role === 'TEAM_LEAD' || a.principals.has('sub:social'))), takes: ['item'],
    blocks: ['mkt-social-monthly', 'mkt-social-analytics'], apis: ['/api/marketing/brands', '/api/marketing/social/monthly'], models: ['BrandSocialMonthly'],
    async load(ctx, a) {
      const b = await brandOf(ctx, a)
      if ('error' in b) return { error: b.error }
      const r = await get<{ brand: Brand; month: string; platforms: Record<string, unknown>[] }>(ctx, '/api/marketing/social/monthly', { brandId: b.brand.id, ...month(a) })
      if (r.error !== undefined) return { error: r.error }
      const t = loose(r.body.platforms.map((p) => ({ ...p, hasData: p.hasData ? 'Entered' : 'Nothing entered' })), ['platform', 'platforms'], { status: 'hasData', sums: ['followers', 'newFollowers', 'reach', 'impressions', 'engagement', 'posts', 'clicks', 'views'], drop: /^(source)$/ })
      return { ...t, dated: true, head: [`Social numbers of ${r.body.brand.name} for ${r.body.month}.`] }
    },
    table: dyn(['platform', 'platforms']),
    tip: 'One brand at a time: pass item with the brand name. A platform with "Nothing entered" has no numbers for that month, which is not the same as zero.',
  },
  {
    key: 'marketing.search_terms', label: 'Search terms', area: 'Marketing', app: '/app/marketing/seo',
    about: 'The search terms (keywords) tracked for ONE brand and the page each one targets.',
    says: ['search terms', 'keywords', 'keyword', 'ranking for', 'target keywords', 'seo keywords', 'which page targets'],
    who: inTeam, takes: ['item'],
    blocks: ['mkt-seo'], apis: ['/api/marketing/brands', '/api/marketing/search-terms'], models: ['SearchTermPage', 'SeoDailyEntry'],
    async load(ctx, a) {
      const b = await brandOf(ctx, a)
      if ('error' in b) return { error: b.error }
      const r = await get<Record<string, unknown>>(ctx, '/api/marketing/search-terms', { brandId: b.brand.id })
      if (r.error !== undefined) return { error: r.error }
      const list = Object.values(r.body).find((v) => Array.isArray(v)) as unknown[] | undefined
      return { ...loose(list ?? [], ['search term', 'search terms']), head: [`Search terms of ${b.brand.name}.`] }
    },
    table: dyn(['search term', 'search terms']),
  },
  {
    key: 'marketing.analytics', label: 'Marketing analytics', area: 'Marketing', app: '/app/marketing/analytics',
    about: "The marketing team's headline numbers for a period (what was published, against the period before) and how many content pieces are in each stage.",
    says: ['marketing analytics', 'marketing numbers', 'how much did marketing publish', 'published this month', 'marketing performance', 'content pipeline numbers'],
    who: inTeam, takes: ['range'],
    blocks: ['mkt-analytics'], apis: ['/api/marketing/analytics'], models: [],
    load: reader<{ range: { startDate: string; endDate: string }; kpis: { label: string; value: number; delta: number }[]; content: { pipeline: { status: string; count: number }[]; publishedThisPeriod: number } }>('/api/marketing/analytics', {
      query: (a, c) => period(a, c),
      rows: (b): Row[] => b.content.pipeline.map((p) => ({ stage: p.status, count: p.count })),
      head: (b) => [`Period read: ${b.range.startDate} to ${b.range.endDate}.`, `Headline numbers: ${b.kpis.map((k) => `${k.label} ${k.value}${k.delta ? ` (${k.delta > 0 ? '+' : ''}${Math.round(k.delta * 100)}% vs the period before)` : ''}`).join('; ')}.`, `Content pieces published in the period: ${b.content.publishedThisPeriod}.`],
      dated: true,
    }),
    table: { unit: ['stage', 'stages'], columns: [{ key: 'stage', label: 'content stage' }, { key: 'count', label: 'pieces', kind: 'number' }], words: { stage: STATUS }, sums: ['count'] },
  },
]
