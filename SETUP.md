# PulseTrack — Local Setup (new machine)

Steps to get the app running on a fresh laptop, including restoring the database.

## 1. Prerequisites

Install these first:

- **Node.js 22+** (with npm)
- **PostgreSQL 18** — match the version; the DB dump was produced by PG 18
- **Git**

> On Windows the Postgres tools (`psql`, `pg_dump`) may not be on your `PATH`.
> They live in `C:\Program Files\PostgreSQL\18\bin\`. Either add that to PATH or
> call them with the full path.

## 2. Get the code

**Option A — copy the whole project folder** (recommended). This carries the
files that are *not* in git (see step 3). You can delete `node_modules/` before
copying and reinstall fresh.

**Option B — clone from GitHub**, then manually copy the ignored files across:

```bash
git clone https://github.com/Aaqib-A10/ProgressTrackingApp.git
```

## 3. Files that are NOT in git (must be copied manually)

These are gitignored, so a clone will not include them. Copy them from the old
machine or recreate them:

- **`server/.env`** — required. Secrets + config (see step 5). The app will not
  start without it.
- `client/.env` — only if you created one (e.g. `VITE_API_URL`).
- `pulsetrack_backup.sql` — the database dump (step 4).
- `server/uploads/` — uploaded daily-log attachments (optional; runtime files).
- `.mcp.json` — MCP config (optional).
- Reference docs: `Progress_Tracking_App_Plan.md`, `design-reference/`, etc. (optional).

## 4. Restore the database

The dump is a full copy of the local `pulsetrack` DB (all tables + data).

```bash
# create an empty database
psql -U postgres -c "CREATE DATABASE pulsetrack;"

# restore into it (run from the folder containing the .sql file)
psql -U postgres -d pulsetrack -f pulsetrack_backup.sql
```

The dump uses `--clean --if-exists`, so re-running it over an existing DB is
safe (it drops and recreates objects).

**Alternative — start with a fresh schema instead of restoring data:**

```bash
cd server
npx prisma migrate deploy     # create all tables from migrations
npm run seed                  # departments, tags, targets, QA scorecards, admin account
npm run import:rdp            # load the RDP inventory from the sheet
```

Use this only if you do NOT need the existing live data — it gives you an empty
app with the seed structure and the admin login `admin@pulsetrack.app` /
`Password123!`.

## 5. Configure `server/.env`

Make sure these keys are present (copy from the old machine, then fix the DB
password to match the new machine's postgres user):

```env
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/pulsetrack?schema=public"
JWT_SECRET="<long random string>"
JWT_EXPIRES_IN="7d"
PORT=4000
CLIENT_ORIGIN="http://localhost:5173"
APP_TIMEZONE="Asia/Karachi"
NODE_ENV="development"
PEXELS_API_KEY="<key>"        # landing/media images (optional in dev)
RESEND_API_KEY="<key>"        # outbound email (optional in dev)
MAIL_FROM="<from address>"
APP_URL="http://localhost:5173"
```

## 6. Install and run

```bash
npm install                   # installs both workspaces (client + server)
npx prisma generate -w server # generate the Prisma client
npm run dev                   # starts client (:5173) and server (:4000)
```

Open <http://localhost:5173>. Log in with your existing account (restored from
the dump) or the seeded admin (`admin@pulsetrack.app` / `Password123!`).

## Handy scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run client + server (hot reload) |
| `npm run build` | Production build of both workspaces |
| `npm run seed -w server` | Idempotent seed (structure + admin) |
| `npm run import:rdp -w server` | Import/refresh RDP inventory (idempotent) |
| `npx prisma migrate dev -w server` | Create + apply a new migration in dev |
| `npx prisma studio -w server` | Browse the DB in a GUI |

## Making a new database dump later

```bash
# from the project root
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" \
  -h localhost -p 5432 -U postgres -d pulsetrack \
  --no-owner --no-privileges --clean --if-exists \
  -f pulsetrack_backup.sql
```

> `pulsetrack_backup.sql` and `*.dump` are gitignored — keep DB dumps local,
> don't commit them.
