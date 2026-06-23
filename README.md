# PulseTrack

Internal progress-tracking app (PERN — PostgreSQL · Express · React · Node, TypeScript end to end).
See [CLAUDE.md](CLAUDE.md) for build context and [Progress_Tracking_App_Plan.md](Progress_Tracking_App_Plan.md) for the functional spec.

## Structure

- `client/` — React + Vite + TypeScript + Tailwind + React Router + Recharts
- `server/` — Node + Express + TypeScript + Prisma + PostgreSQL
- `design-reference/` — Stitch UI export (visual source of truth; not present yet — pulled via Stitch MCP)

## Getting started

```bash
# 1. Install all workspaces
npm install

# 2. Configure env (copy from .env.example)
#    create server/.env and client/.env, fill DATABASE_URL, JWT_SECRET, PEXELS_API_KEY
cp .env.example server/.env   # then edit
cp .env.example client/.env   # then keep only VITE_API_URL

# 3. Generate Prisma client + run the first migration (needs a reachable Postgres)
npm run prisma:generate
npm run prisma:migrate

# 4. Run client + server together
npm run dev
```

Client: http://localhost:5173 · API: http://localhost:4000/api · Health check: `GET /api/health`

## Scripts (root)

| Script | Does |
|---|---|
| `npm run dev` | Runs client (Vite) and server (tsx watch) together |
| `npm run build` | Builds server then client |
| `npm test` | Runs server unit tests (Vitest) — KPI math lives in `server/src/lib` |
| `npm run prisma:migrate` | Applies Prisma migrations |
| `npm run prisma:studio` | Opens Prisma Studio |
