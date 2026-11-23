# Metriq

Metriq is a team-operations platform for companies of 10 to 300 people: daily reports, attendance and leave, tasks and
projects, chat and calls, a CRM with a lead dialer and deal tracker, marketing and e-commerce tools, and Metra, an
assistant that answers from the company's own live data. Many companies use one installation; each sees only its own
records.

- Plan and status: [docs/PLAN-2026-11.md](docs/PLAN-2026-11.md)
- Metra: [docs/metra/DESIGN.md](docs/metra/DESIGN.md), [docs/metra/ROADMAP.md](docs/metra/ROADMAP.md)
- Projects module: [docs/pm-module/README.md](docs/pm-module/README.md)
- Going live: [DEPLOY.md](DEPLOY.md)

`CLAUDE.md` and `AUDIT_REPORT.md` describe an early single-company version. Trust the code and the plan above.

## What is in the repository

| Folder | What |
|---|---|
| `client/` | The web app: React, Vite, TypeScript, Tailwind, React Router, Recharts |
| `server/` | The API: Node, Express, TypeScript, Prisma, PostgreSQL |
| `server/prisma/` | The database schema and its migrations |
| `mobile/` | The Android app (a shell around the web app, with push notifications) |
| `scripts/` | Server scripts: deploy, nightly backup, restore test, uptime check |
| `docs/` | Plans and designs |

## Run it on your computer

You need Node 20 or newer and PostgreSQL.

```bash
npm install
# server/.env needs at least DATABASE_URL and JWT_SECRET (see "Settings" below)
npm run prisma:generate
npm run prisma:migrate
npm run seed:test-users -w server   # test accounts for every role
npm run dev
```

The app is at http://localhost:5173 and the API at http://localhost:4000/api (`GET /api/health` answers when it is up).

`npm run dev:erp` runs the `erp` branch against its own database (`pulsetrack_erp`), so work in progress never touches
your main local database. It applies new migrations by itself.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | Server unit tests, and that every colour on screen comes from the theme |
| `npm run test:integration -w server` | The API against a test database (`pulsetrack_test`, made and migrated by itself) |
| `npx tsc --noEmit -p server` and `-p client` | Types |
| `npm run metra:coverage -w server -- --erp` | Every screen and table is known to Metra, or named with the reason it is not |
| `npm run metra:check -w server` | Metra's answers to a fixed set of questions (needs a model key; run before any change to Metra goes live) |

Do not run a test while `prisma generate` is running, or the other way round: both use the same generated files.

## Settings (`server/.env`)

Only names are listed here. Values never go into code, commits or chat.

| Name | For |
|---|---|
| `DATABASE_URL`, `JWT_SECRET`, `PORT`, `APP_URL`, `CLIENT_ORIGIN` | Required to run |
| `APP_TIMEZONE` | The first company's time zone (every other company sets its own in Company settings) |
| `MAILTRAP_API_TOKEN`, `MAIL_FROM`, `MAIL_REPLY_TO` | Sending email (invites, password resets, reminders). Without a token nothing is sent |
| `BILLING_PROVIDER` and its keys | Online payment (Stripe or Paddle). Without it, plans are paid by bank transfer and recorded in the owner console |
| `GROQ_API_KEY` | Meeting notes and Metra |
| `BACKUP_REMOTE`, `BACKUP_REMOTE_KEEP_DAYS` | An off-server copy of the nightly backup (an rclone destination) |

## How the pieces fit

- **Companies.** Every record carries its company. The server adds and checks it on every query
  (`server/src/lib/tenancy.ts`) and the database refuses a mix-up on its own (one trigger per table). A new table needs
  its trigger: `npx tsx src/scripts/companyWallsSql.ts` in `server/`; a test fails without it.
- **Owner console** (`/owner`): companies, plans, payments recorded by hand, sign-up invites, switches, support.
- **Switches** (`server/src/lib/flags.ts`): parts of the product turned on or off per company, without a deploy.
- **A new screen** needs: its API mount in `server/src/app.ts`, its place in the menu (`navConfig.ts`) and access list
  (`client/src/lib/access.ts`), and an entry in Metra's catalog. Tests compare the server and client lists.
- **Background jobs** run per company (`forEachCompany`) and report to System Health (`runTracked`).

## Going live

`erp` is fast-forwarded into `main`, and the server pulls `main` and runs `scripts/server-deploy.sh`, which installs,
migrates, builds and restarts. Code is never edited on the server and the live database is never changed by hand:
schema changes are Prisma migrations. See [DEPLOY.md](DEPLOY.md).
