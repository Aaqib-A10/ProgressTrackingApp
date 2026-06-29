import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'
import ForgotPassword from '../pages/auth/ForgotPassword'
import ResetPassword from '../pages/auth/ResetPassword'
import ResetSuccess from '../pages/auth/ResetSuccess'
import Landing from '../pages/Landing'
import NotFound from '../pages/NotFound'
import { RequireAuth, RequireRole, AppShellRoute } from './guards'

// App screens are code-split — the public landing/auth pages don't pull in
// Recharts/dnd-kit. Suspense boundary lives in <AppShell>.
const DashboardIndex = lazy(() => import('../pages/app/DashboardIndex'))
const MyReports = lazy(() => import('../pages/app/MyReports'))
const ReportsMonthly = lazy(() => import('../pages/app/ReportsMonthly'))
const MyPerformance = lazy(() => import('../pages/app/MyPerformance'))
const Settings = lazy(() => import('../pages/app/Settings'))
const NotSubmitted = lazy(() => import('../pages/app/NotSubmitted'))
const TeamMembers = lazy(() => import('../pages/app/TeamMembers'))
const MemberProfile = lazy(() => import('../pages/app/MemberProfile'))
const Feedback = lazy(() => import('../pages/app/Feedback'))
const FeedbackThread = lazy(() => import('../pages/app/FeedbackThread'))
const QaEvaluate = lazy(() => import('../pages/app/qa/QaEvaluate'))
const QaScorecards = lazy(() => import('../pages/app/qa/QaScorecards'))
const QaAnalytics = lazy(() => import('../pages/app/qa/QaAnalytics'))
const QaTeam = lazy(() => import('../pages/app/qa/QaTeam'))
const QaEvaluators = lazy(() => import('../pages/app/qa/QaEvaluators'))
const QaEvaluationEdit = lazy(() => import('../pages/app/qa/QaEvaluationEdit'))
const MyQaScores = lazy(() => import('../pages/app/qa/MyQaScores'))
const QaEvaluationsList = lazy(() => import('../pages/app/qa/QaEvaluationsList'))
const QaEvaluationDetail = lazy(() => import('../pages/app/qa/QaEvaluationDetail'))
const ItadDailyLog = lazy(() => import('../pages/app/itad/ItadDailyLog'))
const ItadTeamView = lazy(() => import('../pages/app/itad/ItadTeamView'))
const ItadAnalytics = lazy(() => import('../pages/app/itad/ItadAnalytics'))
const LeadGenDailyForm = lazy(() => import('../pages/app/leadgen/LeadGenDailyForm'))
const LeadGenTeamView = lazy(() => import('../pages/app/leadgen/LeadGenTeamView'))
const LeadGenAnalytics = lazy(() => import('../pages/app/leadgen/LeadGenAnalytics'))
const MarketingBoard = lazy(() => import('../pages/app/marketing/MarketingBoard'))
const SeoActivity = lazy(() => import('../pages/app/marketing/SeoActivity'))
const SocialActivity = lazy(() => import('../pages/app/marketing/SocialActivity'))
const ContentActivity = lazy(() => import('../pages/app/marketing/ContentActivity'))
const EditorialCalendar = lazy(() => import('../pages/app/marketing/EditorialCalendar'))
const MarketingAnalytics = lazy(() => import('../pages/app/marketing/MarketingAnalytics'))
const AdminUsers = lazy(() => import('../pages/app/admin/AdminUsers'))
const AdminTargets = lazy(() => import('../pages/app/admin/AdminTargets'))
const AdminTags = lazy(() => import('../pages/app/admin/AdminTags'))
const AdminLeave = lazy(() => import('../pages/app/admin/AdminLeave'))

// See CLAUDE.md "Screen map". Public auth routes + protected /app/* under the shell.
export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },

  // Public auth
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/reset-success', element: <ResetSuccess /> },

  // Authenticated app shell
  {
    path: '/app',
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
      { path: 'settings', element: <Settings /> },
      { path: 'profile', element: <Settings /> },

      // Team submission status + per-member profiles (TL/Admin)
      { path: 'team/members', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><TeamMembers /></RequireRole> },
      { path: 'reports/monthly', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ReportsMonthly /></RequireRole> },
      { path: 'team/not-submitted', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><NotSubmitted /></RequireRole> },
      { path: 'members/:id', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><MemberProfile /></RequireRole> },

      // Feedback (all roles — members receive, leads author & receive replies)
      { path: 'feedback', element: <Feedback /> },
      { path: 'feedback/:id', element: <FeedbackThread /> },

      // Quality Assurance
      { path: 'qa/evaluate', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaEvaluate /></RequireRole> },
      { path: 'qa/scorecards', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaScorecards /></RequireRole> },
      { path: 'qa/analytics', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN', 'TEAM_LEAD']}><QaAnalytics /></RequireRole> },
      { path: 'qa/team', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN', 'TEAM_LEAD']}><QaTeam /></RequireRole> },
      { path: 'qa/evaluators', element: <RequireRole roles={['QA_LEAD', 'SUPER_ADMIN']}><QaEvaluators /></RequireRole> },
      { path: 'qa/my', element: <MyQaScores /> },
      { path: 'qa/evaluations', element: <RequireRole roles={['QA', 'SUPER_ADMIN', 'TEAM_LEAD']}><QaEvaluationsList /></RequireRole> },
      { path: 'qa/evaluations/:id', element: <QaEvaluationDetail /> },
      { path: 'qa/evaluations/:id/edit', element: <RequireRole roles={['QA', 'QA_LEAD', 'SUPER_ADMIN']}><QaEvaluationEdit /></RequireRole> },

      // ITAD
      { path: 'itad/log', element: <ItadDailyLog /> },
      { path: 'itad/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ItadTeamView /></RequireRole> },
      { path: 'itad/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><ItadAnalytics /></RequireRole> },

      // Lead Generation
      { path: 'leadgen/log', element: <LeadGenDailyForm /> },
      { path: 'leadgen/team', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><LeadGenTeamView /></RequireRole> },
      { path: 'leadgen/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><LeadGenAnalytics /></RequireRole> },

      // Marketing
      { path: 'marketing/board', element: <MarketingBoard /> },
      { path: 'marketing/calendar', element: <EditorialCalendar /> },
      { path: 'marketing/seo', element: <SeoActivity /> },
      { path: 'marketing/social', element: <SocialActivity /> },
      { path: 'marketing/content', element: <ContentActivity /> },
      { path: 'marketing/analytics', element: <RequireRole roles={['TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN']}><MarketingAnalytics /></RequireRole> },

      // Admin
      { path: 'admin/users', element: <RequireRole roles={['SUPER_ADMIN']}><AdminUsers /></RequireRole> },
      { path: 'admin/targets', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminTargets /></RequireRole> },
      { path: 'admin/tags', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminTags /></RequireRole> },
      { path: 'admin/leave', element: <RequireRole roles={['TEAM_LEAD', 'SUPER_ADMIN']}><AdminLeave /></RequireRole> },
    ],
  },

  { path: '*', element: <NotFound /> },
])
