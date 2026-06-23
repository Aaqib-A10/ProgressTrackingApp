# CLAUDE.md — PulseTrack Progress Tracking App

This file gives Claude Code the context to build this project. Read it fully before starting work.

## What we're building

**PulseTrack** is an internal B2B web app that replaces manual daily/weekly/monthly progress reports. Employees submit structured daily progress; Team Leads see their whole team live; each department has analytics dashboards that show whether the team is improving over time (rolling 3-month comparison).

Three departments, each with different data:
- **ITAD** — outbound calling (dials, connects, voicemail, emails, interested, working on, closed, RFQs)
- **Lead Generation** — leads by industry vertical, MQL→SQL funnel
- **Marketing** — sub-departments SEO, Social Media, Content Creation, plus a Kanban board and editorial calendar

**The functional spec is in `Progress_Tracking_App_Plan.md` — that is the source of truth for what each screen does, every field, and every KPI formula. Always cross-check screens against it.**

## Reference materials in this repo

- `Progress_Tracking_App_Plan.md` — full functional plan (roles, departments, fields, KPIs, dashboards, reporting, build phases).
- `/design-reference/` — the exported Stitch UI (one folder per screen, HTML + Tailwind). This is the visual source of truth for layout and styling. Use it to match the design exactly; do not invent new layouts.
- **Stitch MCP** (connected) — project ID `2706168248646785389`. Use `get_screen_code` and `get_screen_image` to pull the live markup/screenshot for any screen if the local copy is unclear or you want the rendered image.
- **Pexels** (API key in `PEXELS_API_KEY` env var) — for sourcing royalty-free images/videos for the landing page and placeholders. See "Media" section below.

## Tech stack (CONFIRMED — PERN)

PERN stack (PostgreSQL + Express + React + Node), TypeScript end to end:
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS (matches the Stitch export, which is already Tailwind)
- **Charts:** Recharts (KPI trends, funnels, stacked bars, burn-down)
- **Routing:** React Router
- **Backend:** Node.js + Express + TypeScript (REST JSON API)
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** JWT-based auth (email/password + Google SSO) with role-based access control (RBAC) enforced on every protected route
- **Drag & drop:** dnd-kit (for the Marketing Kanban board)

## Folder structure (target)

```
/client                     # React + Vite + TS frontend
  /src
    /pages                  # one folder per screen (see screen map below)
    /components             # shared UI: StatCard, DataTable, Sidebar, TopBar, charts
    /lib                    # api client, auth context, KPI formatting helpers
    /routes                 # React Router route definitions + role guards
  /public/assets/images     # Pexels / brand images
  /public/assets/videos     # Pexels / product videos
/server                     # Node + Express + TS backend
  /src
    /routes                 # Express route handlers (auth, itad, leadgen, marketing, admin)
    /controllers            # request handlers
    /middleware             # auth + RBAC middleware
    /lib                    # KPI calculations (testable), db client
  /prisma                   # schema.prisma + migrations
/design-reference           # Stitch export (read-only reference, do not ship)
Progress_Tracking_App_Plan.md
CLAUDE.md
```

> Routes in the screen map below refer to frontend (React Router) paths; each data-backed screen has a matching Express API endpoint under `/api/*`.

## Design system (from Stitch — keep consistent everywhere)

- **Font:** Inter. Tabular numerals on all metrics/tables.
- **Colors:** primary indigo `#4F46E5`, accent teal `#14B8A6`, success `#22C55E`, warning `#F59E0B`, danger `#EF4444`, bg `#F8FAFC`, card `#FFFFFF`, text `#0F172A`/`#64748B`, border `#E2E8F0`.
- **Radii:** 12px cards, 8px buttons. Pill badges. Subtle shadows.
- **Shell:** 260px left sidebar + 64px top bar. Light mode default (support dark later).
- **Reusable components:** StatCard (label + big number + ▲/▼ % vs last period), DataTable (sticky header, zebra rows, status chips), charts, pill filters, primary/secondary/ghost buttons, toasts, modals, empty states.

## Screen map (Stitch folder → route → plan section → access)

| Stitch screen | Route | Plan § | Who sees it |
|---|---|---|---|
| marketing_landing_page | `/` | §1 | Public |
| login | `/login` | §2 | Public |
| sign_up | `/signup` | §2 | Public |
| forgot_password | `/forgot-password` | §2 | Public |
| reset_password | `/reset-password` | §2 | Public |
| reset_success | `/reset-success` | §2 | Public |
| onboarding_step_1_role | `/onboarding/role` | §5 (plan) | New user |
| onboarding_step_2_team | `/onboarding/team` | §5 | New user |
| onboarding_step_3_targets | `/onboarding/targets` | §5 | TL/Admin |
| app_shell | layout for `/app/*` | §6 (plan) | Authed |
| team_lead_dashboard | `/app/dashboard` (TL view) | §7 | TL |
| executive_dashboard | `/app/dashboard` (admin view) | §17/§7 | Super Admin |
| itad_daily_entry_form | `/app/itad/log` | §4.1 | ITAD member |
| itad_team_view_dashboard | `/app/itad/team` | §4.3 | ITAD TL |
| itad_analytics_dashboard | `/app/itad/analytics` | §4.2, §7 | ITAD TL/Admin |
| lead_gen_daily_form | `/app/leadgen/log` | §5.1 | Lead Gen member |
| lead_gen_team_dashboard | `/app/leadgen/team` | §5.2/5.3 | Lead Gen TL |
| marketing_kanban_board | `/app/marketing/board` | §6.4 | Marketing |
| editorial_calendar | `/app/marketing/calendar` | §6.4 | Marketing |
| marketing_activity_seo | `/app/marketing/seo` | §6.1 | SEO |
| marketing_activity_content | `/app/marketing/content` | §6.3 | Content |
| marketing_activity_social_media | `/app/marketing/social` | §6.2 | Social |
| marketing_analytics_dashboard | `/app/marketing/analytics` | §6, §7 | Marketing TL |
| admin_user_management | `/app/admin/users` | §2, §9 | Super Admin |
| admin_target_setting | `/app/admin/targets` | §3 | TL/Admin |
| admin_tag_management | `/app/admin/tags` | §9 | TL/Admin |
| admin_holidays_leave | `/app/admin/leave` | §3 | TL/Admin |
| empty_state_reports | empty state component | §20 (prompt) | — |
| loading_skeleton | loading component | §20 | — |
| 404_not_found | `not-found.tsx` | §20 | — |
| mobile_daily_entry | responsive `/app/*/log` | §20 | Members |

**Not yet in Stitch — build later:** Profile / Settings / Notifications screen (`/app/settings`). Generate it in Stitch or build to match the design system.
**Ignore:** `*_wireframe` folders (rough drafts — use the finished versions) and `a_clean_minimal_professional_3d_checkmark_icon` (just an asset).

## Domain rules that affect logic (read `Progress_Tracking_App_Plan.md` for detail)

- **Roles:** Member (own data only), Team Lead (whole department), Sub-Dept Lead (Marketing sub-dept only), Super Admin (everything). Enforce on every API route and view.
- **One entry per user per day**; re-submitting updates, never duplicates.
- **Leave-aware:** "On Leave / Off" days are excluded from averages and target calculations.
- **KPIs are calculated, never entered** (e.g. Connect Rate = Connected ÷ Dialed). Formulas are in Appendix A of the plan.
- **Trend/progress:** every dashboard supports Today / Week / Month / Custom / Rolling 3-month, with period-over-period ▲/▼ % deltas and target reference lines.
- **Targets** set by TL/Admin drive the green/amber/red status logic.
- **Weekly/monthly reports** roll up automatically from daily entries — no manual totals.

## Media (Pexels) conventions

- Read the key from `PEXELS_API_KEY` env var — **never hardcode it in source.**
- Images: `GET https://api.pexels.com/v1/search` · Videos: `GET https://api.pexels.com/videos/search` — both with `Authorization: <key>` header.
- Save downloads to `/public/assets/images` and `/public/assets/videos` with descriptive names (`hero-video.mp4`, `dashboard-preview.png`).
- Search terms per placeholder are in the Stitch prompt pack (`Stitch_UI_Prompts.md`). Use stock only for marketing/landing imagery; for in-app dashboard previews, prefer our own screenshots once screens exist.

## Build order (from plan §10)

1. **Phase 1 — Core:** auth + roles + app shell; ITAD and Lead Gen daily forms + team views; targets; leave handling.
2. **Phase 2 — Dashboards & trends:** KPI calcs, 3-month trends, period comparisons, auto weekly/monthly reports + export.
3. **Phase 3 — Marketing:** sub-dept forms, Kanban, editorial calendar, marketing dashboards.
4. **Phase 4 — Polish/integrations:** landing page media, executive dashboard, optional GA4/Search Console/social integrations, scheduled report emails.

## Working conventions

- Match `/design-reference/` layouts closely; pull from the Stitch MCP if a local file is ambiguous.
- Build reusable components first (StatCard, DataTable, charts, Sidebar/TopBar shell) — they repeat across most screens.
- TypeScript throughout; keep KPI math in `/lib` so it's testable.
- Don't commit secrets. Use `.env` (gitignored) for `PEXELS_API_KEY`, DB URL, auth secrets.
- When a screen's behavior isn't obvious from the design, the plan doc wins.
