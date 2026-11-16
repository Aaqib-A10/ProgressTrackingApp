# Metra — Metriq's AI assistant (RAG over the whole app)

Ask Metra anything about your own Metriq data and it answers from that data only, with sources you can open.
It is ITAD's "Metriq AI" (§5 of the 12 Nov ITAD update) built for every department. Companion doc for the
ITAD notes work: `docs/itad-notes/DESIGN.md`.

Same stack as the rest of the app (Express + Prisma + React). **No new servers**: no vector database, no Python,
no pgvector extension (not available on the Windows dev Postgres 18 and not needed at our size). The LLM is
Groq `openai/gpt-oss-120b` (already used for meeting notes) behind one provider layer, so Claude or GPT can be
swapped in later.

## 1. The one rule: Metra can never show you what the app would not

Every indexed chunk carries **access labels** derived from the same rules the app enforces today (audited per
source, see §6). At question time Metra works out the asking person's **principals** (live, so a person removed
from a project, chat or department loses access at once, with no re-indexing) and only chunks whose labels
intersect them are ever searched. On top of that:

* company walls: chunks are per company, loaded inside `runAsCompany`, so nothing crosses companies;
* area switches: a source whose screen is switched off for the person (plan, role, department section, flag)
  is left out of the search for them;
* numbers and live lists come from **tools that call Metriq's own API as the person** (`apiAs`, the same path the
  Claude connector uses), so every existing permission check applies there too;
* Metra never changes anything by itself: it proposes **action cards** and the person confirms.

| Principal | Who has it |
|---|---|
| `u:<id>` | the person |
| `t:<memberId>` | a Team Lead, for each person currently in their department (`User.departmentId`) |
| `rt:<memberId>` | Daily Report managers, for each person they manage (memberships count there, as in the app) |
| `sa` | Super Admins |
| `chat:<conversationId>` | each chat the person is a member of |
| `proj:<projectId>` | each project the person is a member of |
| `lbm:<businessId>` | Lead Management managers and the head of each business |
| `dm:<ownerId>` | Lead Dialer managers, for each owner whose leads they may see (`itadUserIds`) |
| `dk:<KIND>` / `dept:<id>` | people who act as a department kind (own or borrowed via Department Studio) / are in a department |
| `mkt:lead`, `mkt:<discipline>` | Marketing leads / sub-department leads |
| `qa` | QA and QA Lead roles |
| `cb:<blockId>:<deptId>:lead|all` | custom block readers (only when the block is in the person's menu) |
| `all` | everyone in the company |

## 2. Workflow

```
INGESTION (in the API process; one PM2 process, as the rest of Metriq)
  Prisma write hook (lib/prisma.ts) ──► in-memory queue of (model, id)          fast path, ~seconds
  Sweep every 10 min: rows changed since the watermark; nightly full reconcile    correctness (deletes, *Many)
        │
        ▼
  Source adapters (lib/metra/sources/*): load record → text + header (type, who, when, what it belongs to)
  → chunks (1 per note/comment; chat = one conversation-day window; long text split ~1000 chars / 150 overlap)
  → access labels → content hash (unchanged = skipped) → embed (local, multilingual-e5-small, 384-dim)
  → AiChunk rows (durable) + the company's in-memory index (vectors + keyword index), updated in place

QUESTION → ANSWER   POST /api/metra/chat (streamed, server-sent events through Nginx)
  1 principals + allowed sources for this person (cached 60 s)
  2 planner (gpt-oss-120b, tool calling, max 5 rounds):
      search_metriq(query, sources?, from?, to?, person?)   ← RAG
      metriq_* / dialer_* / leads_* / tickets / todo …       ← existing connector tools, as the person
      propose_action(...)                                    ← an action card, never executed here
  3 search_metriq: vector top 50 + keyword (BM25) top 50 → RRF merge (only chunks the person may read)
     → re-rank (local cross-encoder) → minimum score → max 3 chunks per record → top 8, numbered [1]..[8]
  4 answer streamed, only from the numbered sources and tool results, with [n] citations
     → source chips open the real record (lead, task, chat, meeting…)
  5 saved: conversation, sources, tokens, latency; 👍/👎 feeds the evaluation set
  Not found → "I couldn't find that in your Metriq data" (never a guess)

PROACTIVE (ITAD first, §5 of the ITAD update)
  Daily brief job per agent, at the shift start → "AI insights" notification tab
  Next-step detector: an agent's note states a next step with a date ("call back Thursday"), nothing logged since,
  date passed → insight card with "Set call back" (confirm)
```

## 3. Data model (additive; every table walled by company, with its trigger)

* `AiChunk` — id, companyId, sourceType, sourceId, part, title, text, hash, labels[], occurredAt, link, meta Json,
  embedding Bytes (float32 × 384), model, updatedAt. Unique (sourceType, sourceId, part).
* `AiConversation` — userId, title, pinned, timestamps. Only its owner reads it.
* `AiMessage` — conversationId, role, content, sources Json, tools Json, actions Json, feedback, tokens, latency.
* `AiInsight` — userId, kind (BRIEF, NEXT_STEP…), day, payload Json, state (NEW / DONE / DISMISSED).
* `AiIndexState` — per company and source: watermark, counts, last run, last error (System Health shows it).

## 4. Vector search without a vector database

Per company, loaded lazily from `AiChunk` on the first question and kept up to date by the indexer: a packed
Float32 matrix (exact cosine; better than approximate search and fast at our size: ~30 ms for 200k chunks), a
BM25 keyword index (names, phone numbers, company names, Roman Urdu words the embedding may miss), and the labels
as small integer sets. Idle companies are dropped from memory after 30 minutes. Behind an interface
(`VectorStore`) so pgvector can replace it if Metriq ever runs as more than one process.

## 5. Models (measured on this PC, 12 Nov)

| Job | Model | Notes |
|---|---|---|
| Embeddings | `Xenova/multilingual-e5-small` (q8, 384-dim) | English, Urdu script and Roman Urdu; ~10 ms per note |
| Re-rank | `Xenova/ms-marco-MiniLM-L-6-v2` (q8) | ~100 ms for 30 candidates; clearly separates the right answer |
| Answers, planning, briefs | Groq `openai/gpt-oss-120b` | streaming + tool calling; one provider layer (`lib/metra/llm.ts`) |

Embeddings and re-ranking run on the server's CPU: no note text leaves the server to be indexed. Only the chunks
used to answer a question are sent to the LLM (the owner confirmed this is acceptable).

## 6. Sources and their access labels (from the code, 12 Nov)

| Source | Indexed text | Labels |
|---|---|---|
| Lead Dialer lead profile + notes, actions, predictive-dialer call notes | company, contact, status, description; note text | `u:owner`, `dm:owner` |
| Lead Management lead, comments, calls (summary, AI summary, transcript), CMR facts, contacts | text fields | `u:assignee`, `lbm:business`, `sa` |
| Lead tasks | title, note | `u:taskAssignee`, `lbm:business`, `sa` |
| Chat messages (DMs, groups, project channels, meeting chats) | body, file name; one window per conversation-day | `chat:conversation` (Super Admins only where they are members) |
| Meetings | title, agenda | `u:organizer`, `u:attendees`, `sa` |
| Call notes and transcripts | AI notes, transcript lines | `chat:conversation`, `u:joined` |
| Projects: tasks, comments | title, description, comment | `proj:project`, `sa` |
| My To-Do entries, notes, reviews | title, details, note | `u:owner`, `t:owner`, `sa`; private → `u:owner` only |
| Daily logs (ITAD, Lead Gen, E-commerce…) notes | notes | `u:owner`, `t:owner`, `sa` |
| Daily Report answers (text) | text answers | `u:owner`, `rt:owner`, `sa` |
| Custom block records | text fields | `cb:*` per block settings, `u:creator`, `sa` |
| Marketing tasks + comments | title, description, comment | `u:assignee`, `mkt:lead`, `mkt:discipline` |
| Blogs, marketing plan | text | `dk:MARKETING`, `sa` |
| E-commerce tasks, comments, meeting notes | text | `dk:ECOMMERCE`, `sa` |
| Feedback + replies | text | `u:author`, `u:recipient`, `t:recipient`, `sa` |
| QA evaluations | comments, rebuttal | `u:agent`, `u:evaluator`, `t:agent`, `qa`, `sa` |
| Bids (ITAD) | title, company, notes | `u:agent`, `t:agent`, `sa` |
| Inventory items | name, notes | `dept:department`, `sa` |
| Attendance / leave notes | note | `u:owner`, `t:owner`, `sa` |
| Holidays | name | `all` |
| ITAD docs, personal to-dos, support tickets | text | `u:owner` |
| Metriq help (how the app works) | built-in guide | `all` |

**Never indexed:** passwords and hashes, tokens and keys, TOTP secrets, IPs and user agents, raw import rows,
recording files, inbox passwords, salary records (finance), notifications (they repeat other records and would
outlive a lost access).

Where the app's own rules disagree between screens (found in the audit: meeting details, Lead Management call
transcripts, marketing task titles in search, ITAD active bids, dialer leads of people who left ITAD), Metra
follows the **stricter** screen.

## 7. Screens

* **Launcher** on every page, above the chat button: Metra's mark (✦ on an indigo → teal gradient). Opens a side
  panel (desktop) or a bottom sheet (phone). Ctrl+K → "Ask Metra".
* **Full page** `/app/metra`: conversations on the left, the chat, and the sources of the selected answer.
* **Answer**: streamed text, `[n]` chips with a preview (source type, who, when) that open the record,
  action cards (Confirm / Edit / Dismiss), 👍/👎, copy.
* **Suggested questions** per department and role ("Who should I call first today?", "What did the CFO at Acme
  say last time?", "What did my team log yesterday?").
* **Admin → Metra**: index status per source, re-index, usage this month, sources on/off (chat included by default).
* Feature switch `metra` (owner console, per company), off by default until tested.

## 8. Quality and safety

* **Evaluation** (`npm run metra:eval`): a golden question set over seeded data per department and role, scoring
  retrieval hit@5 / MRR, "not found" correctness, and an LLM judge for faithfulness. Run before every change to
  the prompts or the retrieval settings.
* **Access tests** (integration): a member never retrieves another member's notes; a Team Lead sees their own
  department only; a Super Admin never sees DMs they are not in or private to-dos; nothing crosses companies;
  removing someone from a project hides its chunks at once.
* **Prompt injection**: retrieved text is data inside a delimited block; Metra can only *propose* changes.
* Usage per company per month is recorded; a monthly limit can be set per plan.

## 9. Limits to know

* Groq's free tier allows about 8K tokens a minute for this model: roughly two answers a minute for a whole
  company. Production needs a paid Groq key (cheap: well under a cent per answer).
* Embedding and re-ranking need ~250 MB of RAM on the server.
* The first full index of an existing company runs in the background (~10 ms per record).

## 10. Run it locally

1. `server/.env`: add `GROQ_API_KEY=...` (the answers; everything else works without it).
2. `npm run dev:erp` (applies the two new migrations: `20261115100000_itad_notes_round`, `20261115110000_metra`).
3. Owner console → Switches → **Metra (AI assistant)** → on for your company (off by default).
4. Optional demo records and the evaluation (local database only):
   `npm run metra:demo -w server` (add; `-- --remove` to take them out) then `npm run metra:eval -w server`
   (`-- --answers` also asks the model). First run downloads the two local models (~150 MB) into `server/.cache/models`.
5. The first full index runs 45 seconds after the server starts, then every 6 hours; new and changed records are
   indexed within seconds of being saved.

Evaluation on the local copy of 99 Technologies' data with the demo records (12 Nov, real models): retrieval
hit@5 11/11, MRR 1.00; 6/6 must-not-see checks held; the off-topic question returned nothing.

## 11. Going live (checklist)

* Run the migrations (deploy does `prisma migrate deploy`).
* `GROQ_API_KEY` on the server must be a **paid** Groq key (the free tier allows ~8K tokens a minute: about two
  answers a minute for the whole company). Optional: `METRA_MODEL`, `METRA_LLM_BASE_URL` / `METRA_LLM_API_KEY` for
  another provider, `METRA_BRIEF_HOUR` (Pakistan hour of the shift brief, default 18).
* The server needs ~300 MB more RAM for the two models, and internet access to huggingface.co on first start (or
  copy `server/.cache/models` across and set `METRA_OFFLINE=1`).
* Nginx: answers are streamed; the API sends `X-Accel-Buffering: no`, so no Nginx change is needed.
* Switch Metra on for one company first; watch System Health (`metra-index`, `metra-insights`) and Admin → Metra.

## 12. Reliability layer (13 Nov, after the first day live)

The first day live showed what a copy with 4 Lead Dialer leads could not: "you have no Interested leads" (there were
four), "I can't pull the total", and one failed answer. None was a model problem; all came from tools written for a
careful caller being used by a smaller model that fills in options its own way. What was added:

| Problem on live | Cause | What now prevents it |
|---|---|---|
| "No Interested leads" | status filter exact and case-sensitive; the model also added `view: follow_ups`, `list: CRM` | `dialer_leads` matches every filter to the values that exist (any case, misspellings); if nothing matches it takes the model's extra narrowing off one by one before saying "none", and says what it left out |
| "Can't pull the total" | the model sent the person's own name as `rep`; the dialer answers 403 to a name | `loadDialerFor`: your own name or "me" = your leads; a manager's rep is found by name; a non-manager always gets their own, with a note |
| Wrong "none" presented as fact | a tool returned an empty list with no context | every dialer answer starts with the total and the count per status; the Deal Tracker tool the same |
| Options the tool does not have, `""`, `"true"`, wrong enum case | the model | `lib/metra/guard.ts` checks every read tool's arguments against its own schema first and tells the model what it dropped |
| "Tool choice is none, but model called a tool" | the last turn offered tools with `tool_choice: none` | the last turn offers no tools at all: the lookups go in as text |
| Three lookups = three full loads of the lead list | each tool call read `/api/dialer/data` again | reads are remembered for the length of one answer (`withApiCache`), with one retry on a dropped connection |
| Nobody saw the failures until a user pasted a chat | no trace | each lookup is stored with the answer (name, options, ok, time, error); Company settings, Metra, "Problems Metra had" lists the last 14 days |

Metra also knows Metriq itself now: every screen (name, what it is for, who has it, where) is in the index as source
"Metriq screen", and a Metriq address in a question is named for the model.

### The rule before going live

    npm run metra:check -w server -- --erp

It seeds 2,800 Lead Dialer leads and a few bids for the test accounts (local database only), asks the real questions
as an agent, a team lead and a Super Admin, and compares every answer with what the screens show. **Nothing goes
live unless it says "Ready".** When a problem shows up on live ("Problems Metra had", or a person's feedback), the
question that caused it is added to `CASES` in `src/scripts/metraCheck.ts` first, then fixed.

### Privacy of chats

A person's chats are theirs alone: every read is filtered by the signed-in person (tested for members, team leads
and Super Admins), `/api/metra` answers are never cached (`Cache-Control: no-store`), and the browser forgets
everything of Metra when a different person signs in on the same page. An admin never sees an answer, and sees a
question only when the person sent a note with it.

## 13. The catalog (15 Nov): one entry per screen

Until now each screen was taught to Metra by hand in several places, and a screen nobody wrote a line for failed
("open the Stock tracking screen", "couldn't find any meeting notes"). `docs/metra/ROADMAP.md` has the plan; phase 1
is built:

- **`server/src/lib/metra/catalog/`**: one entry per screen or data set (`types.ts`). An entry says what the screen
  is called, how people ask for it (English and Roman Urdu), who may open it, how its data is read, and which
  screens, read routes and tables it stands for.
- **`metriq_data`** (`catalog/index.ts`, `catalog/table.ts`): one reader for every entry with a table. It reads the
  screen's own API as the person, then filters and counts in code: totals of every row first, the count of each
  status and each named condition ("low stock", "not resolved", "overdue"), sums, then the rows. A filter value that
  matches nothing real is left out and said so; dates that leave nothing are dropped with a note; every row has
  every column of its heading.
- **The guide is made per person and per question** (`guideFor`): the hand-written lines of the areas that have
  their own tools (kept word for word in `catalog/core.ts`), the full line of each data set that is the person's own
  team's or fits the question (`pick`), and the rest by name only.
- **Search** gained the free text of these areas (`sources.ts`): e-commerce meeting notes, stock requests, daily
  logs, inventory items and inventory requests. A department's shared screens are labelled with the kind of screen
  AND the department (`dkd:<KIND>:<departmentId>`), so another e-commerce department never reads them.
- **Finished areas:** E-commerce (listings, daily log, task board and a task's comments, stock tracking and its
  history, meeting notes, remote desktops and their history), Inventory (stock list, requests, team, one item's
  history) and the calendar (meetings with the notes written on them, holidays, leave, tasks due, to-dos, meeting
  note deadlines).

### The gate

    npm run metra:coverage -w server -- --erp

fails when a screen, a read route or a table of a finished area belongs to no entry, when free text of a finished
area is not in the search index, when an entry cannot be read by any test account, or when a person who may not
open a screen can read its entry. It also prints what is not in the catalog yet (phase 2). `metra:coverage` and
`metra:check` both run before a deploy.

### Adding a screen

1. Write its entry (copy one from `catalog/inventory.ts`): `key`, `label`, `about`, `says`, `who`, `load`, `table`,
   and the `blocks`, `apis` and `models` it stands for.
2. If people write free text there, add a source in `sources.ts` with the screen's own access rule.
3. Add its area to `DONE` in `scripts/metraCoverage.ts` and at least ten questions to `CASES` in
   `scripts/metraCheck.ts`, with the truth read from the app's API.
4. Run both scripts until they pass twice.

## 14. Conversation, actions, scale (15 Nov; roadmap phases 3 to 5)

### Conversation (`lib/metra/talk.ts`)

- **Follow-ups.** A short question that leans on the one before ("and last month?", "what about Ali?", "aur pichle
  hafte?") is given to the model with a line naming the earlier question, and the data sets of the earlier question
  are picked again. Rule: `isFollowUp`.
- **The screen behind the panel.** The app sends the address of the screen the person is on with each question
  (`page` on `POST /api/metra/chat`; never from Metra's own page). Only an address inside `/app/` with plain
  characters is read. The model is told the screen and the record open on it (a task code, a project board, a
  meeting, a lead, a day), and that screen's data sets are given in full in the guide.
- **Roman Urdu.** `plainWords` adds the English meaning of common Roman Urdu words so the catalog (written in
  English) is matched; the model always reads the original words.
- **Two data sets fit.** When two data sets of different areas fit a question about equally ("any stock requests
  open?" for someone with both E-commerce and Inventory), the guide says so and tells the model to read both.
- **Every number has a source.** After the answer is written, `checkNumbers` looks for each number (10 and above,
  any decimal, any percentage) in what the lookups returned and in the person's own words. Dates, times, codes,
  citations and list markers are not numbers. If one has no source, the answer is written once more with that said;
  the person gets the rewrite. What happened is kept with the answer as a lookup called `answer_check`; a number
  still without a source shows in "Problems Metra had" as "A number had no source".
  Switch off with `METRA_CHECK_NUMBERS=off`.

### Actions (`lib/metra/actions.ts`)

A change is only ever a card. Nothing is written until the person presses Confirm; then the action runs as that
person through the app's own route, so the app's checks are made again.

| Card | Who | What it does |
|---|---|---|
| Ask for stock in or out | Inventory | a request on the Inventory Requests screen (stock changes when the team completes it) |
| Log a stock problem | E-commerce | a line in Stock tracking |
| Save meeting notes | E-commerce | a note on the Meeting notes screen |
| Add a task to the board | E-commerce team lead | a task, optionally given to a person with a due date |
| Ask to work from home | everyone | their own request, for their team lead to answer |
| Enter leave | team leads | a leave, day-off or work-from-home day for a person of their team |
| Ticket: create, comment, move, tick a checklist item | project members | the same as on the project board |

The everyday cards from before (to-do, meeting, lead note and call back) are always on offer. The ones above are
offered only when the message asks for a change (`wantsAction`), so a plain question carries fewer tools.
Not built: drafting a daily log (numbers entered in someone's name are not something to prepare for them).

**"Your day"** (`lib/metra/catalog/brief.ts`): the first time a person opens Metra on a day, a brief is made from
their own data sets with no model: today's meetings, what is due, their to-dos, a holiday, what is overdue, and one
line from each data set of their own team that has something to say. ITAD agents keep their shift brief.

### Scale and cost

- **Memory.** All companies' indexes together hold at most `METRA_MAX_PIECES` pieces (default 600,000); past it the
  company nobody asked for the longest is dropped and loads again on its next question (`overCap` in `store.ts`).
- **Cost and speed.** Company settings > Metra shows, for this month: answers, tokens, the usual and the slow time to
  answer, tokens and lookups per answer, how many answers the number check sent back, and the cost when
  `METRA_PRICE_IN` and `METRA_PRICE_OUT` are set (US dollars per million tokens of the model in use).
- **A second model for rejected answers.** `METRA_STRONG_MODEL` (a model name on the same provider) is used only to
  rewrite an answer the number check rejected. Unset: the usual model rewrites.
- **Real questions as tests.** Company settings > Metra > "Answers people rated" > **Copy as test questions** copies
  the questions people marked not helpful and shared with a note. Saved to a file, they are asked by
  `npm run metra:check -w server -- --erp --extra file.json`.

### Settings added (server `.env`, all optional)

    METRA_CHECK_NUMBERS=off        switch the number check off
    METRA_STRONG_MODEL=<model>     model for rewriting rejected answers
    METRA_PRICE_IN=0.00            dollars per million input tokens (for the cost on the admin page)
    METRA_PRICE_OUT=0.00           dollars per million output tokens
    METRA_MAX_PIECES=600000        pieces all companies' indexes may hold in memory together

## 15. The whole app in the catalog (15 Nov; roadmap section 8)

A full audit by machine (every screen address, every read route, every table) showed the catalog had been checked
only for the areas called finished. What changed:

- **`catalog/more.ts`**: 29 more entries (Lead Management, the Projects dashboard and ticket history, a person's
  profile, the attendance register, the trend screens, one day's own log, the Lead Dialer's imports and history, one
  evaluation and one scorecard in full, one marketing item, the Daily Report forms, notification history, tags).
- **`catalog/load.ts`** gained readers for screens whose shape is not fixed in code: `auto` (the screen's own figures
  first, its list as the rows; a screen of figures only becomes rows of figures; a page of a longer list is said to
  be a page), `figures` (rates kept as shares are said as percentages) and `dayLog` (one day's own entry; a day with
  nothing logged is said in words). The main screens still name their columns themselves.
- **`catalog/screens.ts`**: the 34 screens outside the Department Studio menu. They are in the search index
  (`APP_SCREEN`) and in `screenAt`, so Metra can say where a screen is and knows the page a person asks from.
- **Access**: two more principals in `access.ts`. `leads` is anyone with a place in Lead Management (a rep, a
  manager, a head, the Super Admin); `sub:<slug>` is a person's part of a department (the social numbers are for the
  social team and the leads, as the app has it). A screen that gives everyone "their own" (Lead Management) is read
  as the person, so a rep's answers hold a rep's leads; the gate checks a person with none gets nothing.
- **The gate** (`scripts/metraCoverage.ts`) is for the whole app now. Every read route is in one of four lists:
  read by an entry (the entry's own `apis`), read by a tool of its own (`OWN_TOOL`), not data (`NOT_DATA`, each with
  its reason), or left out on purpose (`LEFT_OUT`). Every table is shown, indexed, never read (`NEVER`) or named with
  a reason (`TABLE_NOTES`). While it reads, `traceCalls` writes down the addresses each entry calls: an entry must
  read every route it lists and none it does not.

**Adding a screen now:** (1) the screen in `lib/blocks.ts` (menu) or `catalog/screens.ts`; (2) an entry in the
catalog that reads its route, or the route in one of the gate's lists with the reason; (3) run the gate. It names
whatever is still unplaced.
