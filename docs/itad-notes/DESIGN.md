# ITAD round 12 Nov: Earth Zone sync, Notes, Claude feed, touches from notes, auto-closing follow-ups, notification tabs

Source: "Metriq Update: Earth Zone Sync, Notes, Claude Review Feed, AI and Notifications" (Danyal Ahmed, ITAD,
12 Nov 2026). Section numbers below (§) are the document's. Section 5 (Metriq AI) is built as **Metra**, see
`docs/metra/DESIGN.md`. This file covers §1 to §4, §6 and the pending items of §9 / §11.

Rules carried over from the document (§10): read the code first and match its patterns, never invent fields that
are not in the data, migrations additive and reversible, tests for the sync rules / note parsing / override
persistence / touch counting, **never call or write to Earth Zone**, no phone numbers, emails or note text in
client analytics, and every open item ships behind a setting with the stated default.

## What already exists (audited 12 Nov, so nothing is built twice)

| Item | State |
|---|---|
| Filters button with pins, chips, Reset, per agent per page (§11) | Done (spec 4 Nov): `client/src/pages/app/itad/dialer/filters.tsx`, prefs `filterPins` |
| Import done screen: clickable cards and rows, Activity block, previous-import compare, Reassigned from Lead Gen apart from Moved back, skipped rows with reasons, changed-fields breakdown (§11) | Done: `importLeads` summary + `importChanges` |
| Column picker on All leads (§11) | Done: `LeadColumns.tsx` (Company locked) |
| Bulk fill of extra contacts with preview, own leads only, no overwrite unless asked | Done: `bulkFill` (reused by the sync below) |
| Notes: author, pin, edit (author only), next-action date | Done: `DialerNote`; **no delete, no source** |
| Touches from imports and manual outcome chips, "tries, same status" | Done: `lib/dialer/touches.ts` |
| Automatic follow-up tasks, reminders, Task history | Done: `lib/dialer/tasks.ts`; tasks are **cancelled**, never auto-done |

Still open from §9/§11 (checked in the code, done in this round): column picker on the **Follow-ups** page,
History view by weeks / months, the off-by-one reconciliation of Added + Changed + Unchanged vs Total.

## §1 One-time Earth Zone sync

Screen: Lead Dialer → **Earth Zone sync** (agent; a manager can run it for a rep). The file is parsed in the browser
(same Excel/CSV reader as imports) and sent as rows, then:

1. **Preview** (`POST /api/dialer/ez-sync {apply:false}`): matched / unmatched / ambiguous counts, the rows behind each,
   and what will be filled per field. Nothing is saved.
2. **Apply** (`apply:true`): only the running agent's own leads.

Matching order (setting `ezMatchOrder`, default as proposed): Earth Zone Lead ID already saved on the lead →
primary email → primary phone (digits) → company + last name. A row matching two leads is **ambiguous** and skipped.
The Earth Zone Lead ID is saved on every matched lead (`DialerLead.ezLeadId`) so later matching is exact.

Fields filled (and nothing else; City, State, Created At, Updated At, Assigned To and every other field untouched):

| File column | Goes to | Rule |
|---|---|---|
| Alternative Numbers (Secondary) | `altPhones[]` (new) | split on `, ; / \| newline`, digits compared, duplicates dropped; each its own copy button |
| Secondary Email | `email2` | filled when empty; a different existing value is a conflict, kept unless "replace" is ticked |
| Hidden Description | `ezLinks` (new, clickable LinkedIn / CFO links) + `description` (new, the remaining text) | |
| Job Title | `jobTitle` | as Secondary Email |
| Logged Interaction Notes Timeline | `DialerNote` rows, source EARTHZONE | see §2 |

A blank cell never overwrites. Re-running the sync adds no duplicate notes or numbers (note key + digit compare).

## §2 Notes

`DialerNote` gains (all additive): `source` (METRIQ default, EARTHZONE, CLAUDE), `authorName` (Earth Zone author as
written, cleaned of doubled spaces), `userId` becomes optional (an Earth Zone author with no Metriq account),
`ezKey` (unique per lead: Earth Zone entry identity), `ezText` (the text as Earth Zone has it), `deletedAt`.

* **Parsing** (`lib/dialer/ezNotes.ts`, pure, tested): one cell holds many entries. An entry starts with a bracketed
  date (year, month, day) and the author, then a colon and the text. Entries are split on the date bracket itself, so
  whatever divider sits between them is dropped. The note's date is the Earth Zone date.
* **Authors** are matched to Metriq people by name (case and spacing ignored). Matched → `userId` set (this is what
  makes a note "the agent's own" for §4); not matched → `authorName` only.
* **Timeline**: newest first, every note editable and deletable by the lead's agent (and the author).
* **Overrides**: an Earth Zone note that is edited keeps `ezText`; a deleted one is soft-deleted (`deletedAt`). The
  sync looks notes up by `ezKey` *including deleted ones*, so a later sync or import never restores or overwrites
  them. A small marker shows when a note differs from Earth Zone (edited or deleted there).
* **New person in a note**: an email, phone or LinkedIn link next to a name is offered as a second contact on the lead
  (`DialerContact`, new) for the agent to accept or ignore. Detection is plain pattern matching (no AI).
* **Source label** on every note: Earth Zone, Metriq or Claude. A note written through the Claude connector (request
  header `X-Metriq-Connector`) is CLAUDE.

## §3 Claude review feed

Lead Dialer → **Claude log**: everything the connector wrote to leads (notes with source CLAUDE, and alternative
numbers / fields it set, recorded as `DialerAction.source = CLAUDE`), with the lead, what was written and when.
Filters: lead, date, source. Each entry is editable and deletable from the page.

## §4 Touch counting with notes, and follow-ups that close themselves

Pure functions in `lib/dialer/noteTouches.ts` (tested against every bullet of §4):

* **Contacts by the agent** = the lead owner's own notes (any source) on distinct days, plus their own manual touches
  (outcome chips / Add touch: setting `manualTouchesCount`, default on, because they are the agent's own logged calls).
  Two on the same day count once. A colleague's note never counts.
* **Last touched** = the latest of those; **Updated At** only for leads with none.
* **Tries, same status** = those days after the status last changed.
* **Auto-close**: an open follow-up whose lead got a contact by the agent after the follow-up was created (or reopened)
  is marked **done, "completed automatically"**, with the contact that closed it (`WorkLogEntry.autoClosedBy`).
  A contact is an own note, a status change (for Pipeline and Interested a status change alone is not enough), or,
  for a lead with no notes, a new Updated At after the assignment day that is not an assignment batch or bulk date
  change (the existing bulk rule). The next follow-up is then scheduled by the stage interval.
* Stage intervals are settings (`followUp`). The document's values (Pipeline 30, Interested 15, Connected 7) become
  the defaults for companies that never saved their own; **a saved company setting is kept** (see open items).
* A manually set call-back date wins. Reminders stop when the follow-up closes. Not Interested, Not Qualified, DNC
  and Working On stay excluded (the existing `closed` list).
* **Reopen** in one tap from Task history (`reopenedAt`; only contacts after it close it again).

## §6 Notifications

The bell and the Notifications page get tabs: **Follow ups and tasks**, **Imports**, **AI insights**, **System**
(collapsed by default). The category comes from the notification type (one map, shared by server and client).
Follow-ups are ordered by lead value (Pipeline, Interested, Connected). **Mark all read** per tab, and **per category
muting** (muted: no pop-up or phone push and not counted in the badge; still listed). Stored on the user
(`User.notifyMuted`).

## Open items, with the default shipped

| Item (§8) | Default until the owner decides |
|---|---|
| Matching order for the sync | as proposed (email, phone, company + last name), setting `ezMatchOrder` |
| Interested interval | 15 days (owner: editable, does not matter) |
| AI provider | Groq `openai/gpt-oss-120b`, behind one service layer (owner: sending notes is acceptable) |
| Reusable to-do fields | Lead Dialer tasks already are My To-Do entries; reused |
| Reminder channels beyond in-app | in-app + phone push (already there); email off |
| Current saved follow-up days differ from the document (saved: Connected 30, Interested 14, Pipeline 7) | kept; the document's values shown as the suggested defaults in Settings |
