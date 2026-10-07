# Projects + Team Chat module

Project management and chat inside PulseTrack (Metriq). Same stack as the rest of the app:
Express + Prisma on the server, React + Tailwind + dnd-kit on the client. No new services.

## What it adds

| Area | Where |
|---|---|
| Projects list, per-project Kanban board (drag and drop), list view, filters in the URL | `/app/projects`, `/app/projects/:KEY` |
| Task drawer: assignees, due date, priority, labels, checklist, files, comments with @mentions, activity log, due date extensions | `/app/projects/:KEY?task=RTI-12` |
| Project settings: members and roles, columns, labels, deadline alert settings, archive | `/app/projects/:KEY/settings` |
| Projects dashboard + CSV export (on time rate, overdue by person and project) | `/app/projects/dashboard` |
| Chat: project channels (# RTI), direct messages, groups, files, replies, mentions, typing, presence, "Seen", mute, search | `/app/chat` + floating chat button on every page |
| Notifications page + "Mark all read" | `/app/notifications`, top bar bell |
| My Tasks now includes project tasks and an "Assigned by me" tab | `/app/tasks` |

## Access rules

* A project is visible only to its members and to Super Admins. Everyone else gets 404 (the API never reveals that it exists).
* Project roles: **Admin** (manage members, columns, settings, any task), **Member** (create, assign, move; edit tasks they created or are assigned to), **Viewer** (read, comment, chat).
* Only the person who assigned a task (or a project admin) can change its due date. Assignees can request an extension instead.
* Only Super Admins create and archive projects (`PROJECT_CREATOR_ROLES` in `server/src/lib/pm/access.ts`).
* Chat: only conversation members can read a conversation. Admins have no access to other people's direct messages.

## Deadline alerts (`server/src/lib/pm/deadlines.ts`, every 5 minutes)

1. **Due soon**: reminds assignees at the project's offsets (default 24 h and 1 h before). Only the nearest offset fires.
2. **Overdue**: when the due time passes and the task is not in a Done type column, alerts go to the **assignees, the person who assigned it, the project admins and the Super Admins**. One alert per person.
3. **Emails** for overdue are held during quiet hours (22:00 to 08:00, `APP_TIMEZONE`) and sent after.
4. **Repeats** every `overdueRepeatHours` (default 24 h) while still overdue, never in quiet hours.
5. Moving the task to Done, or moving the due date into the future, clears it immediately.

Every alert is claimed in `PmDispatchLog`, so a tick that runs twice never double sends, and changing the due date re-arms reminders for the new date.

## Environment variables (server/.env)

Nothing new is required. Optional:

```env
# Super Admin overdue alerts for every project:
#   true (default) = all active Super Admins, false = none,
#   or a comma separated list of emails = only those people
PM_SUPER_ADMIN_OVERDUE_ALERTS=true
```

Email uses the existing Resend setup (`RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`).

## Realtime

The board refreshes every 5 s, an open chat every 2.5 s, chat badges every 15 s, only while the tab is visible.
This avoids websocket changes to Nginx. Presence and typing are kept in memory in the single PM2 process.

## Database

One additive migration: `server/prisma/migrations/20261007180000_projects_and_chat`.
New tables are prefixed `Pm*` and `Chat*`; `NotificationType` gets new values. No existing table or column changes.

## Scripts

```bash
# Create the standard projects (RTI, LRI, MNC, 99 Technologies, Talkloop, Green Loop,
# SJ Computers, Complywise, Pulse Track). Idempotent, safe on production.
npx tsx src/scripts/seedProjects.ts owner@email.com

# LOCAL ONLY: members + 30 demo tasks (some overdue) to try everything out.
npx tsx src/scripts/seedProjectsDemo.ts
```

## Tests

* `server/src/lib/pm/pm.test.ts` (unit: ranking, metrics, helpers)
* `server/src/test/projects.integration.test.ts` (32 end to end tests: visibility, roles, task codes under concurrency,
  drag and drop ordering, completion, overdue recipients, idempotency, quiet hours, re-arming, extensions, chat privacy,
  task card visibility in chat, file type blocking, mentions, reports)

Run: `npm test -w server` and `npm run test:integration -w server`.
