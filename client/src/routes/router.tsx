import { Suspense, lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import Login from '../pages/auth/Login'
import NotFound from '../pages/NotFound'
import { RequireAuth, RequireRole, RequireFinance, AppShellRoute, RequireHealth, RequirePower, RequireFlag } from './guards'
import { RouteError } from './RouteError'
import { pageModule } from '../lib/staleChunks'

// Public pages people open rarely load on demand (Login stays in the main bundle: it is
// the page most people land on).
const Landing = lazy(pageModule(() => import('../pages/Landing')))
const Pricing = lazy(pageModule(() => import('../pages/marketing/Pricing')))
const Security = lazy(pageModule(() => import('../pages/marketing/Security')))
const Signup = lazy(pageModule(() => import('../pages/auth/Signup')))
const ForgotPassword = lazy(pageModule(() => import('../pages/auth/ForgotPassword')))
const ResetPassword = lazy(pageModule(() => import('../pages/auth/ResetPassword')))
const ResetSuccess = lazy(pageModule(() => import('../pages/auth/ResetSuccess')))
const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense>

// App screens are code-split — the public landing/auth pages don't pull in
// Recharts/dnd-kit. Suspense boundary lives in <AppShell>.
const DashboardIndex = lazy(pageModule(() => import('../pages/app/DashboardIndex')))
const MyReports = lazy(pageModule(() => import('../pages/app/MyReports')))
const ReportsMonthly = lazy(pageModule(() => import('../pages/app/ReportsMonthly')))
const MyPerformance = lazy(pageModule(() => import('../pages/app/MyPerformance')))
const Settings = lazy(pageModule(() => import('../pages/app/Settings')))
const NotSubmitted = lazy(pageModule(() => import('../pages/app/NotSubmitted')))
const TeamMembers = lazy(pageModule(() => import('../pages/app/TeamMembers')))
const MemberProfile = lazy(pageModule(() => import('../pages/app/MemberProfile')))
const Feedback = lazy(pageModule(() => import('../pages/app/Feedback')))
const Connectors = lazy(pageModule(() => import('../pages/app/Connectors')))
const FeedbackThread = lazy(pageModule(() => import('../pages/app/FeedbackThread')))
const QaEvaluate = lazy(pageModule(() => import('../pages/app/qa/QaEvaluate')))
const QaScorecards = lazy(pageModule(() => import('../pages/app/qa/QaScorecards')))
const QaTeam = lazy(pageModule(() => import('../pages/app/qa/QaTeam')))
const QaEvaluators = lazy(pageModule(() => import('../pages/app/qa/QaEvaluators')))
const QaEvaluationEdit = lazy(pageModule(() => import('../pages/app/qa/QaEvaluationEdit')))
const MyQaScores = lazy(pageModule(() => import('../pages/app/qa/MyQaScores')))
const QaEvaluationsList = lazy(pageModule(() => import('../pages/app/qa/QaEvaluationsList')))
const QaEvaluationDetail = lazy(pageModule(() => import('../pages/app/qa/QaEvaluationDetail')))
const ItadDailyLog = lazy(pageModule(() => import('../pages/app/itad/ItadDailyLog')))
const ItadTeamView = lazy(pageModule(() => import('../pages/app/itad/ItadTeamView')))
const ItadAnalytics = lazy(pageModule(() => import('../pages/app/itad/ItadAnalytics')))
const BidTracker = lazy(pageModule(() => import('../pages/app/itad/BidTracker')))
const LeadGenDailyForm = lazy(pageModule(() => import('../pages/app/leadgen/LeadGenDailyForm')))
const LeadGenTeamView = lazy(pageModule(() => import('../pages/app/leadgen/LeadGenTeamView')))
const LeadGenBreakdown = lazy(pageModule(() => import('../pages/app/leadgen/LeadGenBreakdown')))
const LeadGenAnalytics = lazy(pageModule(() => import('../pages/app/leadgen/LeadGenAnalytics')))
const EcommerceDailyLog = lazy(pageModule(() => import('../pages/app/ecommerce/EcommerceDailyLog')))
const EcommerceTeamView = lazy(pageModule(() => import('../pages/app/ecommerce/EcommerceTeamView')))
const EcommerceBoard = lazy(pageModule(() => import('../pages/app/ecommerce/EcommerceBoard')))
const EcommerceStock = lazy(pageModule(() => import('../pages/app/ecommerce/EcommerceStock')))
const InventoryList = lazy(pageModule(() => import('../pages/app/inventory/InventoryList')))
const InventoryRequests = lazy(pageModule(() => import('../pages/app/inventory/InventoryRequests')))
const InventoryTeam = lazy(pageModule(() => import('../pages/app/inventory/InventoryTeam')))
const RdpRecords = lazy(pageModule(() => import('../pages/app/ecommerce/RdpRecords')))
const DocsLinks = lazy(pageModule(() => import('../pages/app/itad/DocsLinks')))
const LeadDialer = lazy(pageModule(() => import('../pages/app/itad/dialer/LeadDialer')))
const MarketingTaskRedirect = lazy(pageModule(() => import('../pages/app/marketing/MarketingTaskRedirect')))
const MarketingTeam = lazy(pageModule(() => import('../pages/app/marketing/MarketingTeam')))
const SeoActivity = lazy(pageModule(() => import('../pages/app/marketing/SeoActivity')))
const ContentActivity = lazy(pageModule(() => import('../pages/app/marketing/ContentActivity')))
const ContentDailyLog = lazy(pageModule(() => import('../pages/app/marketing/ContentDailyLog')))
const SocialPlanner = lazy(pageModule(() => import('../pages/app/marketing/SocialPlanner')))
const AdsCampaigns = lazy(pageModule(() => import('../pages/app/marketing/AdsCampaigns')))
const EmailMarketing = lazy(pageModule(() => import('../pages/app/marketing/EmailMarketing')))
const MarketingAnalytics = lazy(pageModule(() => import('../pages/app/marketing/MarketingAnalytics')))
const MarketingBrands = lazy(pageModule(() => import('../pages/app/marketing/MarketingBrands')))
const MarketingProfiles = lazy(pageModule(() => import('../pages/app/marketing/MarketingProfiles')))
const SocialMonthly = lazy(pageModule(() => import('../pages/app/marketing/SocialMonthly')))
const SocialAnalytics = lazy(pageModule(() => import('../pages/app/marketing/SocialAnalytics')))
const MarketingBlogs = lazy(pageModule(() => import('../pages/app/marketing/MarketingBlogs')))
const MasterPlan = lazy(pageModule(() => import('../pages/app/marketing/MasterPlan')))
const MyAttendance = lazy(pageModule(() => import('../pages/app/attendance/MyAttendance')))
const TeamAttendance = lazy(pageModule(() => import('../pages/app/attendance/TeamAttendance')))
const MyTodo = lazy(pageModule(() => import('../pages/app/MyTodo')))
const MyTasks = lazy(pageModule(() => import('../pages/app/MyTasks')))
const MeetingNotes = lazy(pageModule(() => import('../pages/app/ecommerce/MeetingNotes')))
const AdminUsers = lazy(pageModule(() => import('../pages/app/admin/AdminUsers')))
const AdminTargets = lazy(pageModule(() => import('../pages/app/admin/AdminTargets')))
const AdminTags = lazy(pageModule(() => import('../pages/app/admin/AdminTags')))
const AdminLeave = lazy(pageModule(() => import('../pages/app/admin/AdminLeave')))
const AdminNetworks = lazy(pageModule(() => import('../pages/app/admin/AdminNetworks')))
const Start = lazy(pageModule(() => import('../pages/auth/Start')))
const Setup = lazy(pageModule(() => import('../pages/app/Setup')))
const Billing = lazy(pageModule(() => import('../pages/app/billing/Billing')))
const TestCheckout = lazy(pageModule(() => import('../pages/app/billing/TestCheckout')))
const InvoiceView = lazy(pageModule(() => import('../pages/app/billing/InvoiceView')))
const VerifyEmail = lazy(pageModule(() => import('../pages/auth/VerifyEmail')))
const CompanySettings = lazy(pageModule(() => import('../pages/app/admin/CompanySettings')))
const MyDailyReport = lazy(pageModule(() => import('../pages/app/dailyReport/MyDailyReport')))
const TeamDailyReport = lazy(pageModule(() => import('../pages/app/dailyReport/TeamDailyReport')))
const ReportForms = lazy(pageModule(() => import('../pages/app/dailyReport/ReportForms')))
const FinancialReports = lazy(pageModule(() => import('../pages/app/admin/FinancialReports')))
const AdminActivity = lazy(pageModule(() => import('../pages/app/admin/AdminActivity')))
const SystemHealth = lazy(pageModule(() => import('../pages/app/admin/SystemHealth')))
const OwnerApp = lazy(pageModule(() => import('../pages/owner/OwnerApp')))
const HelpPage = lazy(pageModule(() => import('../pages/app/HelpPage')))
const ProjectsList = lazy(pageModule(() => import('../pages/app/projects/ProjectsList')))
const ProjectBoard = lazy(pageModule(() => import('../pages/app/projects/ProjectBoard')))
const ProjectSettings = lazy(pageModule(() => import('../pages/app/projects/ProjectSettings')))
const ProjectsDashboard = lazy(pageModule(() => import('../pages/app/projects/ProjectsDashboard')))
const ChatPage = lazy(pageModule(() => import('../pages/app/chat/ChatPage')))
const CalendarPage = lazy(pageModule(() => import('../pages/app/meetings/CalendarPage')))
const MeetingPage = lazy(pageModule(() => import('../pages/app/meetings/MeetingPage')))
const GuestJoin = lazy(pageModule(() => import('../pages/GuestJoin')))
const Notifications = lazy(pageModule(() => import('../pages/app/Notifications')))

// See CLAUDE.md "Screen map". Public auth routes + protected /app/* under the shell.
export const router = createBrowserRouter([
  { path: '/', element: <Page><Landing /></Page> },
  { path: '/pricing', element: <Page><Pricing /></Page> },
  { path: '/security', element: <Page><Security /></Page> },

  // Public auth
  { path: '/login', element: <Login /> },
  { path: '/c/:slug', element: <Login /> },
  { path: '/start', element: <Page><Start /></Page> },
  { path: '/verify-email', element: <Page><VerifyEmail /></Page> },
  { path: '/signup', element: <Page><Signup /></Page> },
  { path: '/forgot-password', element: <Page><ForgotPassword /></Page> },
  { path: '/reset-password', element: <Page><ResetPassword /></Page> },
  { path: '/reset-success', element: <Page><ResetSuccess /></Page> },

  // The owner console (erp, step 0): only the Metriq owner signs in here.
  { path: '/owner/*', errorElement: <RouteError />, element: <Suspense fallback={null}><OwnerApp /></Suspense> },

  // People outside Metriq joining a call by link (no login)
  { path: '/join/:token', element: <Suspense fallback={null}><GuestJoin /></Suspense> },

  // Authenticated app shell
  {
    path: '/app',
    errorElement: <RouteError />,
    element: (
      <RequireAuth>
        <AppShellRoute />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardIndex /> },
      { path: 'reports', element: <MyReports /> },
      { path: 'analytics', element: <MyPerformance /> },
      { path: 'todo', element: <MyTodo /> },
      { path: 'setup', element: <RequirePower power="company.settings"><Setup /></RequirePower> },
      { path: 'billing', element: <RequirePower power="company.settings"><Billing /></RequirePower> },
      { path: 'billing/test-checkout', element: <RequirePower power="company.settings"><TestCheckout /></RequirePower> },
      { path: 'billing/invoices/:id', element: <RequirePower power="company.settings"><InvoiceView /></RequirePower> },
      { path: 'daily-report', element: <RequireFlag flag="daily-report"><MyDailyReport /></RequireFlag> },
      { path: 'daily-report/team', element: <RequireFlag flag="daily-report"><TeamDailyReport /></RequireFlag> },
      { path: 'daily-report/forms', element: <RequireFlag flag="daily-report"><ReportForms /></RequireFlag> },
      { path: 'tasks', element: <MyTasks /> },
      { path: 'settings', element: <Settings /> },
      { path: 'profile', element: <Settings /> },

      // Team submission status + per-member profiles (TL/Admin)
      { path: 'team/members', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><TeamMembers /></RequireRole> },
      { path: 'reports/monthly', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ReportsMonthly /></RequireRole> },
      { path: 'team/not-submitted', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><NotSubmitted /></RequireRole> },
      { path: 'members/:id', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><MemberProfile /></RequireRole> },

      // Feedback (all roles — members receive, leads author & receive replies)
      { path: 'feedback', element: <Feedback /> },
      { path: 'connectors', element: <Connectors /> },
      { path: 'connectors/:id', element: <Connectors /> },
      { path: 'feedback/:id', element: <FeedbackThread /> },
      { path: 'help', element: <HelpPage /> },

      // Quality Assurance
      { path: 'qa/evaluate', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaEvaluate /></RequireRole> },
      { path: 'qa/scorecards', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaScorecards /></RequireRole> },
      { path: 'qa/analytics', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN', 'TEAM_LEAD']}><QaTeam /></RequireRole> },
      { path: 'qa/evaluators', element: <RequireRole roles={['QA_LEAD', 'SUPER_ADMIN']}><QaEvaluators /></RequireRole> },
      { path: 'qa/my', element: <MyQaScores /> },
      { path: 'qa/evaluations', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN', 'TEAM_LEAD']}><QaEvaluationsList /></RequireRole> },
      { path: 'qa/evaluations/:id', element: <QaEvaluationDetail /> },
      { path: 'qa/evaluations/:id/edit', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaEvaluationEdit /></RequireRole> },

      // ITAD
      { path: 'itad/log', element: <ItadDailyLog /> },
      { path: 'itad/bids', element: <BidTracker /> },
      { path: 'itad/docs', element: <DocsLinks /> },
      { path: 'itad/dialer', element: <LeadDialer /> },
      { path: 'itad/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ItadTeamView /></RequireRole> },
      { path: 'itad/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ItadAnalytics /></RequireRole> },

      // Lead Generation
      { path: 'leadgen/log', element: <LeadGenDailyForm /> },
      { path: 'leadgen/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><LeadGenTeamView /></RequireRole> },
      { path: 'leadgen/breakdown', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><LeadGenBreakdown /></RequireRole> },
      { path: 'leadgen/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><LeadGenAnalytics /></RequireRole> },


      // Ecommerce
      { path: 'ecommerce/log', element: <EcommerceDailyLog /> },
      { path: 'ecommerce/board', element: <EcommerceBoard /> },
      { path: 'ecommerce/stock', element: <EcommerceStock /> },
      { path: 'ecommerce/team', element: <EcommerceTeamView /> },
      { path: 'ecommerce/notes', element: <MeetingNotes /> },
      { path: 'ecommerce/rdp', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><RdpRecords /></RequireRole> },

      // Projects + chat (membership is enforced by the API; every role can open these)
      { path: 'projects', element: <ProjectsList /> },
      { path: 'projects/dashboard', element: <ProjectsDashboard /> },
      { path: 'projects/:key', element: <ProjectBoard /> },
      { path: 'projects/:key/settings', element: <ProjectSettings /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'meetings/:id', element: <MeetingPage /> },
      { path: 'notifications', element: <Notifications /> },

      // Inventory
      { path: 'inventory', element: <InventoryList /> },
      { path: 'inventory/requests', element: <InventoryRequests /> },
      { path: 'inventory/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><InventoryTeam /></RequireRole> },

      // Marketing
      // The board was retired: old task links go on to the planner / content / SEO page.
      { path: 'marketing/board', element: <MarketingTaskRedirect /> },
      // Retired pages: old bookmarks go to where that work lives now.
      { path: 'marketing/social', element: <Navigate to="/app/marketing/social/monthly" replace /> },
      { path: 'marketing/seo/analytics', element: <Navigate to="/app/marketing/seo" replace /> },
      { path: 'marketing/team', element: <RequireRole roles={['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']}><MarketingTeam /></RequireRole> },
      // Social Planner replaces the old editorial calendar — keep the link alive.
      { path: 'marketing/calendar', element: <Navigate to="/app/marketing/planner" replace /> },
      { path: 'marketing/planner', element: <SocialPlanner /> },
      { path: 'marketing/seo', element: <SeoActivity /> },
      { path: 'marketing/social/monthly', element: <SocialMonthly /> },
      { path: 'marketing/social/analytics', element: <SocialAnalytics /> },
      { path: 'marketing/content', element: <ContentActivity /> },
      { path: 'marketing/content/log', element: <ContentDailyLog /> },
      { path: 'marketing/ads', element: <AdsCampaigns /> },
      { path: 'marketing/email', element: <EmailMarketing /> },
      { path: 'marketing/blogs', element: <MarketingBlogs /> },
      { path: 'marketing/plan', element: <MasterPlan /> },
      { path: 'marketing/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']}><MarketingAnalytics /></RequireRole> },
      { path: 'marketing/brands', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><MarketingBrands /></RequireRole> },
      { path: 'marketing/profiles', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><MarketingProfiles /></RequireRole> },

      // Attendance (all authed users; team view for TL/Admin)
      { path: 'attendance/me', element: <MyAttendance /> },
      { path: 'attendance/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><TeamAttendance /></RequireRole> },

      // Admin
      { path: 'admin/users', element: <RequireRole roles={['SUPER_ADMIN']}><AdminUsers /></RequireRole> },
      { path: 'admin/targets', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminTargets /></RequireRole> },
      { path: 'admin/tags', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminTags /></RequireRole> },
      { path: 'admin/leave', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminLeave /></RequireRole> },
      { path: 'admin/networks', element: <RequireRole roles={['SUPER_ADMIN']}><AdminNetworks /></RequireRole> },
      { path: 'admin/company', element: <RequirePower power="company.settings"><CompanySettings /></RequirePower> },
      { path: 'admin/financials', element: <RequireFinance><FinancialReports /></RequireFinance> },
      { path: 'admin/activity', element: <RequireRole roles={['SUPER_ADMIN', 'TEAM_LEAD']}><AdminActivity /></RequireRole> },
      { path: 'admin/health', element: <RequireHealth><SystemHealth /></RequireHealth> },
    ],
  },

  { path: '*', element: <NotFound /> },
])
