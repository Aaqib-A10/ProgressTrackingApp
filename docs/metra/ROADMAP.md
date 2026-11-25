# Metra roadmap: from "works for ITAD" to "knows all of Metriq"

Written 15 Nov 2026. Companion to `DESIGN.md` (how Metra works today).

## 1. Where Metra stands today (measured)

Metriq has 150 data tables and 51 screens. Metra knows them unevenly:

| What | Covered today |
|---|---|
| Search index (what people wrote) | about 30 of the 150 tables feed it, as 23 kinds of record |
| Guide lines (where the exact numbers of a screen live) | roughly 18 of the 51 screens |
| Purpose-built readers (count and filter in code, not by the model) | Lead Dialer, Deal Tracker, Leads, project tasks, to-dos, meetings |
| Everything else | one generic reader that hands the model the screen's raw data |

Search itself is strong: on 1,000 live questions the right record is among the 8 shown 97% of the time.

The weak part is coverage. I asked six questions on the test copy as an e-commerce member and as inventory staff:

| Question | Result | Why |
|---|---|---|
| Which products have stock issues right now? | Wrong: told to "open the Stock tracking screen" | No guide line for Stock tracking, so it read the task board |
| What was written in our last meeting notes? | Wrong: "couldn't find any" | E-commerce meeting notes are not indexed and have no reader |
| How many listings did I add this month? | Wrong: "no total available" | Read a one-day page and could not add up a month |
| What is on my calendar this week? | Right only for meetings | Leave, holidays, task due dates and note deadlines are not part of "calendar" |
| How many items are low in stock? | Right, after two rounds | Found the page through the generic guide |
| Any pending stock requests? | Answered, not verified | Raw data handed to the model; counting was the model's |

So the cause is not the model and not search. Each area was added by hand (a guide line here, a reader there), and the areas nobody wrote by hand fail. Fixing them one by one is the patch-push cycle again.

## 2. The architecture: one catalog, everything generated from it

Today, knowledge about a screen is spread over five places: the guide in `agent.ts`, the guide in `departmentTools.ts`, the readers, `sources.ts`, and the check script. Nothing forces a new screen to be in all five.

The change is one registry, the **Metriq catalog**: one entry per screen or data set. Everything else is generated from it.

```
                       ┌──────────────────────────────┐
                       │  CATALOG (one entry per       │
                       │  screen / data set)           │
                       └──────────────┬───────────────┘
        ┌──────────────┬──────────────┼──────────────┬───────────────┐
        ▼              ▼              ▼              ▼               ▼
   Guide for the   Reader         Search index   Action cards    Check questions
   model (only     (totals and    (free text,    (changes the    (asked before
   what fits the   filters in     with the       person          every deploy,
   question and    code)          app's access   confirms)       truth from the
   the person)                    rules)                         app's own API)
```

### What an entry holds

```ts
{
  key: 'inventory.items',
  screen: { label: 'Stock list', path: '/app/inventory/items' },   // the words on the sidebar
  says: ['stock', 'inventory', 'low stock', 'items in stock', 'maal', 'kitna stock'], // how people ask, English and Roman Urdu
  who: (asker) => ...,                                             // same rule as the screen itself
  read: {                                                          // where the exact data is
    path: '/api/inventory/items', rows: 'items',
    columns: ['name', 'category', 'quantity', 'minimum', 'location'],
    filters: { category: 'text', low: (row) => row.quantity <= row.minimum },
    totals: ['count', 'low'],
  },
  text: { ... },        // optional: the free text to index, and who may read it
  actions: [ ... ],     // optional: changes Metra may propose on a card
  checks: [ { as: 'inventory.member', ask: 'how many items are low in stock?', truth: (api) => ... } ],
}
```

### The five things generated from it

1. **Guide, picked per question.** Today the whole guide is in every prompt and grows with every area. Instead, the entries that fit the question are found by the search Metra already has (over `says` and the screen name), plus the screen the person is on, plus their personal entries (my tasks, to-dos, meetings). Only those 5 or so go in the prompt. This keeps the prompt small and stops the model picking a wrong line because it shares a word, which is what happened with "my task".
2. **One reader for every data set.** A single tool, `metriq_data(what, filter, person, from, to, group_by)`, driven by the entry. It counts, sums, groups and filters in code, tolerates sloppy input (wrong case, own name, dates nobody asked for), and always prints totals before rows. This is the Deal Tracker and Lead Dialer pattern made generic, so a new area costs a 30-line entry, not a new tool.
3. **Search index.** The entry's `text` becomes a source, with access labels from the screen's own rule.
4. **Action cards.** The same confirm-on-a-card flow as today, declared per entry.
5. **Check questions.** `metra:check` asks every entry's questions as the right kind of person and compares with the app's API.

### The gate that ends the patch cycle

A new script, `metra:coverage`, fails when:

- a screen in the app has no catalog entry,
- a data table is neither read, indexed, nor on the short "never" list (passwords, billing, logs),
- an entry has fewer than two check questions.

`metra:check` and `metra:coverage` both run before every deploy. A screen cannot ship without Metra knowing it.

## 3. Roadmap

Each phase ends with a deploy and a number. Sizes: S = one working session, M = two or three, L = about a week.

### Phase 0 — ship what is ready (S)
The "my tasks" fix and the Deal Tracker hardening are done and tested locally (21 of 21). Deploy them first.

### Phase 1 — the catalog, proven on the areas that fail now (L) — BUILT 15 Nov, see "Phase 1 as built" below
- Build the catalog, the generic reader, per-question guide picking, and `metra:coverage`.
- Move the existing areas into entries without changing their behaviour (Lead Dialer and Deal Tracker keep their own readers, registered as entries).
- New entries for the areas you named:
  - **E-commerce:** daily log (my listings per day, week, month, by marketplace), task board, stock tracking, team view, meeting notes (indexed and readable), remote desktops.
  - **Inventory:** stock list (quantities, low stock), movements, requests, team.
  - **Calendar:** one "my week / my day" reader that joins meetings, leave and holidays, task due dates, to-do deadlines and meeting-note deadlines.
- **Done when:** 10 check questions per area pass twice in a row, the six questions in section 1 are among them, and `metra:coverage` reports those areas complete.

### Phase 2 — every remaining screen (L)
In this order (by how many people use them):
1. Attendance, leave, work from home, shifts.
2. Marketing: Social Planner, content board and log, SEO log, blogs, ads, email, brands, master plan, monthly social numbers.
3. Lead Gen and its breakdowns; My Reports and My Analytics; targets.
4. QA scores and evaluations; Daily Report forms; feedback.
5. People: who is on which team, who leads it, who is in today.
6. Custom blocks: entries are generated from each company's own block definitions, so a block a company builds is known to Metra the same day.
- **Done when:** `metra:coverage` is clean (no screen and no table left out) and every entry's checks pass.

### Phase 3 — conversation quality (M)
- **Follow-ups:** "and last month?", "what about Ali?" are rewritten into a full question before any lookup.
- **Page context:** asked from a lead, a task or a screen, "this" means that record.
- **Roman Urdu and mixed language:** test questions for every area, and the `says` words in each entry.
- **Answer checker:** every number in the answer must appear in what the tools returned; if not, Metra redoes the answer instead of sending it. Deterministic, no extra model call.
- **Ask when unclear:** one short question instead of a guess when two entries fit equally.
- **Done when:** a 200-question conversation set (real questions from the problem log, with follow-ups) passes at an agreed rate. I propose 95%.

### Phase 4 — doing, not only answering (M)
- Action cards for every area where it is safe: stock request, leave request, task and to-do changes, meeting notes, daily log drafts.
- Morning brief per person from their own entries (what is due, overdue, waiting).
- **Done when:** each action has a check that the card does exactly what it says and nothing happens without the confirm.

### Phase 5 — scale and cost (M)
- Memory per company as more companies switch Metra on. The index is held in memory; the benchmark process used about 2 GB at 21,600 pieces with both models loaded. The live API process itself has not been measured yet.
- Cost and speed per answer on the admin page; a stronger model only for questions the checker rejects.
- Each company's problem log turned into its own check questions.

## 4. What stays as it is

- Numbers come from readers, never from counting search results.
- Every lookup runs as the person, through the app's own API, so Metra can never show what the screen would not.
- Chats stay private; admins see problems, not answers.
- Nothing is changed without the person confirming a card.

## 5. Open questions

1. **"Notes in the calendar":** the Calendar screen shows meetings (with an agenda). The E-commerce "Meeting notes" screen holds notes with a meeting date and a deadline. I assumed the person meant the second, and Phase 1 covers both, but an example of the exact question would confirm it.
2. **Pass rate for Phase 3:** 95% is my proposal; the model will not reach 100% on free-form questions.
3. **Marketing tasks that are only a link:** still needs a decision (ask the team for titles, or make the form require one).

## 6. Phases 1 and 2 as built (15 Nov 2026, not deployed)

**In the catalog now** (`server/src/lib/metra/catalog/`): 62 entries, 54 of them read and counted by `metriq_data`.

| Area | Data sets |
|---|---|
| Calendar | my calendar (meetings with the notes written on them, holidays, leave, tasks due, to-dos, note deadlines) |
| Attendance | team now, team over a period, my attendance, leave and days off, work-from-home requests |
| People | everyone, teams, team changes, targets, reports not submitted, my notifications |
| Numbers | my numbers, ITAD team, Lead Gen team, Lead Gen breakdown, today's reports, monthly report |
| Marketing | work by status, team, content board, blogs, ads, email, master plan, social planner, brands, profiles, social reports, search terms, analytics |
| E-commerce | listings, my daily log, task board, one task's comments, stock tracking, stock history, meeting notes, remote desktops, their users and history |
| Inventory | stock list, requests, team, one item's history |
| Quality and the rest | my QA scores, QA evaluations, QA dashboard, scorecards, feedback, the team's to-dos, ITAD docs, my chats, custom blocks |

Still with their own tools (already counted in code): My Tasks, My To-Do, Projects, Lead Dialer, Deal Tracker, the executive dashboard and the Daily Report forms.

**What the gate says** (`npm run metra:coverage -w server -- --erp`): all 51 screens accounted for (43 read and counted, 7 with a tool of their own, 1 settings screen); 75 read routes of the finished areas each belong to an entry or are left out with a reason; 313 reads succeed as 14 kinds of test people; 443 reads of screens a person may not open are refused by the app.

**Not done yet, said plainly:**
- **Model answers are not verified on this code.** The go-live check has 82 questions. Of the Phase 1 ones, 21 of 22 passed on first run; the calendar questions and every Phase 2 question have not been answered by the model yet, and the 21 older questions must be asked again because the guide changed for everyone. The local test key allows 200,000 tokens a day (about 15 questions). Nothing goes live until `metra:check` passes twice.
- **18 tables are shown by no entry**: project extras (checklists, labels, reviews, extension requests, activity, watchers), chat reactions, Lead Dialer contacts, touches and settings, company roles, and Lead Management's businesses, events, unmatched calls, list entries and daily report. Their main records are reached through the existing ticket, dialer and lead tools.
- **No new search sources in phase 2**: blogs, ads, plan items and QA comments are read through their data sets (which take search words) but are not in the meaning search.
- **Daily Report forms** still use the older raw reader (the feature is switched off on the test copy, so its shapes could not be probed).
- **Screens whose columns are read as they come** (email campaigns, master plan, social planner, brands, profiles, social reports, search terms, QA dashboard, docs, work-from-home requests, chats, custom blocks) have plain column names taken from the data; several had no rows on the test copy, so only their empty state was exercised.

## 7. Phases 3, 4 and 5 as built (15 Nov 2026, not deployed)

How each works is in `DESIGN.md` §14. What was built against the plan in section 3:

| Planned | Built | Not built, or different |
|---|---|---|
| Follow-ups rewritten into a full question | The follow-up is said to the model with the earlier question, and the earlier data sets are picked again | No separate model call rewrites the question |
| Page context | The app sends the screen; the model is told the screen and the record on it | Only records the address names: a task code, a project, a meeting, a lead, a day |
| Roman Urdu | Common words mapped to English for matching; Roman Urdu questions in the check for each area | The word list is hand-written, about 60 words |
| Answer checker | Every number needs a source; one rewrite; recorded with the answer | Numbers under 10 are not checked. A number the model worked out itself triggers a rewrite |
| Ask when unclear | The model is told when two data sets fit equally, and to read both | It asks a question only if it chooses to |
| 200-question conversation set at 95% | 82 questions in `metra:check`, three of them follow-ups | The 200-question set is not written |
| Action cards for every safe area | Stock request, stock problem, meeting notes, e-commerce task, work-from-home request, leave, ticket create / comment / move | No daily-log drafts; no marketing or QA actions |
| Morning brief per person | "Your day", made on first opening Metra each day, no model | Not sent anywhere; it shows in Metra only |
| Memory per company | A total cap with least-recently-used dropping | Not load-tested with many companies |
| Cost and speed on the admin page | Time, tokens, lookups, rewrites, cost when prices are set | Prices are typed into `.env`, not read from the provider |
| Stronger model for rejected answers | `METRA_STRONG_MODEL` | Off until set |
| Problem log into check questions | "Copy as test questions" and `metra:check --extra` | Only questions a person shared with a note; no right answers are known for them |

**Verified without the model:** 299 unit tests, the action and brief integration tests (11), the coverage gate.
**Not verified:** any model answer on this code. `metra:check` (82 questions then; 97 after the audit in section 8), twice, is the gate before a deploy.

## 8. The full-app audit (15 Nov 2026, not deployed)

Asked for after phases 1 to 5: "check all the stuff, full app, so we do not leave anything". The audit was done by
machine, not by reading: every address of the web app, every read route of every router and every table, against the
catalog. It found that the gate of phase 1 only looked at the areas called finished, so the rest was unguarded.

**What was missing, and is in now** (29 entries in `catalog/more.ts`; 91 entries in all, 83 read by `metriq_data`):

| Area | Data sets added |
|---|---|
| Lead Management (was not covered at all beyond the two lead tools) | `leads.dashboard`, `leads.board`, `leads.contacts`, `leads.tasks`, `leads.calls`, `leads.report`, `leads.businesses` (`leads.queue` was removed with the Jesse Queue, 25 Nov 2026) |
| Projects | `projects.overview` (the dashboard; a person who is not a project admin gets their own numbers), `projects.reviews`, `projects.ticket_history` |
| People and attendance | `people.profile`, `people.top` (employee of the month), `attendance.register` (each person, each day) |
| Daily numbers | `itad.trend`, `leadgen.trend` (months side by side, rates, funnel), `itad.my_day`, `leadgen.my_day`, `marketing.my_day` (one day's own log) |
| Lead Dialer | `dialer.imports` (and duplicates), `dialer.history` (finished follow-ups, notes, what Claude or the Earth Zone sync wrote) |
| Quality | `qa.evaluation` (one evaluation in full), `qa.scorecard` (its questions), `qa.people` |
| Marketing | `marketing.task` (one item with its comments and files), `marketing.social_compare` |
| Daily Report | `daily_report.entries` (my day; for a lead the team's day, the month and the last 30 days) |
| Other | `notifications.history`, `admin.tags` |

**Wrong things the audit found in what was already built, now fixed:**

- 22 entries listed routes they never read (so those routes looked covered and were not), and 9 read routes they did
  not list. Every entry's list is now exactly what it reads, and the gate checks it on every run, both ways.
- Five entries pointed to screen addresses that do not exist (`/app/team`, `/app/qa/my-scores`, `/app/qa/team`).
- Social numbers were offered to every marketing person; the app gives them to the social team and the leads only.
- The Super Admin could never read a custom block (the entry looked for a field the app does not send).
- A Lead Dialer manager got only their own imports, notes and finished follow-ups, not the team's.
- Metra did not know 34 screens (Lead Management, Quality Assurance, Admin, Notifications, Settings, Help): it could
  not say where they are, and did not know which page a person was on there. They are in `catalog/screens.ts`.

**The gate now covers the whole app** (`npm run metra:coverage -w server -- --erp`). It fails when:

- the web app has a screen that is in neither `lib/blocks.ts` nor `catalog/screens.ts` (104 addresses checked);
- a read route of any router is read by no entry and no tool, and is not named with its reason (237 routes: 116 read
  by an entry, 17 by a tool of their own or by search, 54 not data, 50 left out on purpose);
- a table is shown by no entry, is not in the search index and is not named with its reason (150 tables);
- an entry does not read a route it lists, or reads one it does not list;
- an entry's screen address is not a real screen;
- a person can read an entry of a screen they may not open (616 refusals checked; where the app gives everyone "their
  own", a person with nothing must get nothing: 66 checked).

Lead Management, the Deal Board, the review flow, the Daily Report and Department Studio are switched off for the
test company. The
gate and `metra:check` switch them on while they run, put them back after, and use their own test rows
(`scripts/metraSeedMore.ts`: one business with six leads, tasks and calls; a second one with the review flow, a
lead waiting for the head and a rep's daily report; one Daily Report form with three days of reports; one Lead
Dialer import; one custom block). `metra:check --unseed` takes them out.

**Left out on purpose** (the gate prints the list with each reason; these are decisions, and each can be changed):

| Left out | Why |
|---|---|
| Financial Reports and salaries | Money and salaries. Metra reads neither, for anyone |
| Activity Log (sign-ins, changes), office networks, blocked check-ins | They hold IP addresses |
| System Health | Errors and checks of the software, for the developers |
| Billing, the owner console, support messages | Not the company's working data |
| Keys of connected assistants, Metra's own chats | Secrets, and private chats |
| Files: recordings, downloads, attachments, CSV exports | Metra reads records, not files |
| Settings screens (Lead Dialer settings, notification settings, Company Settings, Lead Settings lists) | Settings, not data to ask about. Where each screen is, Metra knows |

**Verified without the model:** 308 unit tests, the whole-app gate (reads as 14 kinds of person), and an integration
test of the new areas (`metraWholeApp.integration.test.ts`: a rep reads only their own leads, a manager the
business, a person outside it nothing; the same for the Daily Report, a custom block and the dialer's imports).
**Not verified:** any model answer. `metra:check` has 97 questions now (15 new, for the areas above).
