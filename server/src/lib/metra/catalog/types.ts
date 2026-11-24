import type { Role } from '@prisma/client'
import type { Asker } from '../access'
import type { AskedPeriod } from './period'

/**
 * The Metriq catalog (docs/metra/ROADMAP.md §2): one entry per screen or data set. Everything Metra knows about a
 * screen is in its entry: what people call it, who may open it, how its data is read and counted, and which of the
 * app's screens, API paths and tables it stands for. The guide the model reads, the `metriq_data` reader, the
 * coverage check (npm run metra:coverage) and the go-live questions are all made from these entries, so a screen
 * cannot be half-known.
 */

/** One row of a data set, already flat: every value is plain text, a number, yes/no, or nothing. */
export type Row = Record<string, string | number | boolean | null | undefined>

export interface Column {
  key: string
  /** The word shown to the model and the person ("low stock at", not "lowStockAt"). */
  label: string
  /** date: YYYY-MM-DD or an ISO time, shown as a day; time: an ISO time, shown with the hour; long: free text, cut longer. */
  kind?: 'text' | 'number' | 'money' | 'date' | 'time' | 'long'
  /** Not printed in the rows (used for filters and flags only). */
  hidden?: boolean
}

/** A named condition people ask for ("low stock", "overdue", "open"). Counted for every read. */
export interface Flag {
  label: string
  /** Other words for it, English and Roman Urdu. */
  says: string[]
  test: (r: Row, ctx: Ctx) => boolean
}

export interface Table {
  /** What one row is, singular and plural ("item", "items"). */
  unit: [string, string]
  columns: Column[]
  /** Columns holding a person's name ("me" and names are matched against these). */
  people?: string[]
  /** Column holding the owner's user id: with it, "me" is matched exactly, not by name. */
  mine?: string
  /** The status column: counted per value on every read. */
  status?: string
  /** More columns counted per value on every read (category, type, marketplace...). */
  groups?: string[]
  /** The column the from/to dates work on. */
  date?: string
  /** Number columns that are added up. */
  sums?: string[]
  flags?: Record<string, Flag>
  /** Stored value -> the word the screen shows, per column ({ status: { OUT: 'Out of stock' } }). */
  words?: Record<string, Record<string, string>>
}

export interface Ctx {
  me: { id: string; name: string; role: Role }
  asker: Asker
  /** Today on the company's clock, YYYY-MM-DD. */
  today: string
  zone: string
  now: Date
  /**
   * The person's own words for this question (Roman Urdu also put in English, a follow-up with the question it
   * continues). Set when the model reads for a question: a condition the model added that is not in these words is
   * not applied (renderTable). Unset (tests, the coverage gate): every condition is applied as given.
   */
  asked?: string
  /** The period the person named in their own words ("last week"), worked out in code (period.ts). It replaces the dates the model sent. */
  period?: AskedPeriod
}

/** What the model may pass to `metriq_data`. Every one is optional and cleaned before use. */
export interface Args {
  person?: string
  status?: string
  only?: string
  search?: string
  from?: string
  to?: string
  range?: string
  date?: string
  item?: string
  group_by?: string
  limit?: number
}

export interface Loaded {
  rows: Row[]
  /** Lines printed first: the screen's own totals and the period that was read. */
  head?: string[]
  /** Something the reader changed or could not do ("no item called X; the items are: ..."). */
  notes?: string[]
  /** The from/to dates were already applied when loading (the screen itself takes a period): do not narrow again. */
  dated?: boolean
  /** The table for this read, when its columns are only known from the data (a form or a block the company built). */
  table?: Table
}

export interface Entry {
  /** What the model passes as `what`: "inventory.items". */
  key: string
  /** The words on the sidebar. */
  label: string
  /** The menu group it is under ("E-commerce"). */
  area: string
  /** Where the person opens it. */
  app?: string
  /** One sentence: what it holds. */
  about: string
  /** How people ask for it, English and Roman Urdu. Used to pick the entries that fit a question. */
  says: string[]
  /** Same rule as the screen itself. The API checks again on every read. */
  who: (a: Asker) => boolean
  /** Always in this person's guide (their own team's screens), not only when the question fits. */
  pin?: (a: Asker) => boolean
  /** A hand-written guide line (areas with their own tools). When absent, the line is made from `table`. */
  guide?: (a: Asker) => string | null
  /** Options the data set takes besides the common filters. */
  takes?: ('range' | 'date' | 'from_to' | 'item')[]
  load?: (ctx: Ctx, args: Args) => Promise<Loaded | { error: string }>
  table?: Table
  /** Advice printed after the data (what the numbers mean, where related data is). */
  tip?: string
  /**
   * The asker's own version of this data set (attendance.team -> attendance.mine). A question about the asker
   * themself ("my attendance") is read from it, even when the model picked the team's (24 Nov 2026: a team lead's
   * "my attendance last week" was answered with the whole team's table).
   */
  personal?: string
  /** A starter question shown under a new chat to the people whose own screen this is. */
  suggest?: string
  /** One line for the person's "Your day" brief from this data set's rows, or null when there is nothing to say. */
  brief?: (rows: Row[], ctx: Ctx) => string | null

  // What this entry stands for, for the coverage check.
  /** Screens (keys in lib/blocks.ts). */
  blocks: string[]
  /** API paths it reads (GET), as in the route files: '/api/inventory/items'. */
  apis: string[]
  /** Tables whose data it shows. */
  models: string[]
}
