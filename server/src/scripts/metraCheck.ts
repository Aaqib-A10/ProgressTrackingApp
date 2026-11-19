import { clearMore, seedMore, MORE_FLAGS, MORE_TRUTH as M } from './metraSeedMore'
import 'dotenv/config'
import type { AddressInfo } from 'node:net'

/**
 * Metra's check before going live (docs/metra/DESIGN.md §8): real questions, asked as real kinds of people, on a
 * database with as much data as the live one, and every answer compared with what the screen shows.
 *
 * Why: Metra passed every test on a copy with 4 Lead Dialer leads, then on live (thousands of leads, a smaller model
 * filling in tool options its own way) it told an agent "you have no Interested leads" and "I can't read the total".
 * Nothing goes live unless this passes.
 *
 *   npm run metra:check -w server -- --erp            seed (once), ask everything, print pass / fail
 *   npm run metra:check -w server -- --erp --only 3,7 only those questions
 *   npm run metra:check -w server -- --erp --unseed   take the test rows out again
 *   npm run metra:check -w server -- --erp --extra questions.json   also ask the questions people marked not helpful
 *   npm run metra:check -w server -- --erp --truth    print what the screens hold (the right answers), asking nothing
 *
 * --erp uses the local erp database (pulsetrack_erp, the one `npm run dev:erp` runs on). It only ever touches a
 * database on this computer, and only rows it made itself (Lead Dialer list "METRA-CHECK", bids and marketing cards
 * titled "METRA-CHECK", the project MCHK "METRA-CHECK Website").
 * It needs the test accounts (npx tsx prisma/test-users.ts) and the model key in server/.env.
 */

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) { console.error('metra:check only runs on a database on this computer. Stopping.'); process.exit(1) }
if (flag('--erp')) process.env.DATABASE_URL = url.replace(/\/[^/?]+(\?|$)/, '/pulsetrack_erp$1')

const MARK = 'METRA-CHECK'
const INTERESTED = ['Zephyr Dental Group', 'Halcyon Freight Lines', 'Orchid Research Labs', 'Marlow County Schools']
const PIPELINE = ['Kestrel Community Bank', 'Juniper Family Clinic', 'Tamarind Foods Inc']
const BULK: [string, number][] = [['Assigned', 1200], ['Contact Attempted', 600], ['Voicemail Sent', 400], ['Not Interested', 200], ['Connected', 93]]
const WON = [{ company: 'Quartz Valley Hospital', awarded: 5400 }, { company: 'Ridgeway Technical College', awarded: 12250 }]
// "My Tasks": two project tasks given to the marketing lead and one marketing card of their own (My Tasks shows all
// three), and a card on the marketing team's board that is someone else's.
const MY_TASKS = ['Rewrite the pricing page copy', 'Fix broken links on the blog']
const NOT_MINE = 'Saffron launch carousel'
const MINE_ON_BOARD = 'December newsletter draft'

type U = { id: string; role: import('@prisma/client').Role; name: string }
/** E-commerce, Inventory and calendar truth (ROADMAP phase 1), read from the app's API: n = numbers, s = names. */
type Areas = { n: Record<string, number>; s: Record<string, string[]> }
interface Truth { total: number; byStatus: Record<string, number>; interested: string[]; teamTotal: number; leadTotal: number; won: { company: string; awarded: number }[]; deals: { active: number; submitted: number; won: number; lost: number }; notSubmitted: number; myDials: number; myLeadsGenerated: number; myTasks: string[]; myOpenTasks: number; x: Areas }
/** A seeded name as it must appear in an answer: without the METRA-CHECK mark in front. */
const bare = (s: string) => s.replace(/^METRA-CHECK\s+/, '')
interface Case { as: 'member' | 'lead' | 'admin' | 'leadgen' | 'marketing' | 'ecom' | 'ecomlead' | 'inv' | 'invlead' | 'qa' | 'csr' | 'leadgenlead'; ask: string; /** The screen the person asks from, as the app would send it. */ page?: string; history?: { role: 'user' | 'assistant'; content: string }[]; numbers?: (t: Truth) => number[]; names?: (t: Truth) => string[]; absent?: string[]; note: string }

const CASES: Case[] = [
  { as: 'member', ask: 'how many leads do i hv in total ?', numbers: (t) => [t.total], note: 'total leads' },
  { as: 'member', ask: 'can you let me know of my interested and won clients leads', names: (t) => [...t.interested, ...t.won.map((w) => w.company)], note: 'Interested leads and won deals' },
  { as: 'member', ask: 'can you not see interested clients in lead dialer', names: (t) => t.interested, note: 'Interested leads, by name',
    history: [{ role: 'user', content: 'my interested leads?' }, { role: 'assistant', content: 'No "Interested" leads are currently assigned to you in the Lead Dialer.' }] },
  { as: 'member', ask: 'show my intrested leads', names: (t) => t.interested, note: 'a misspelt status' },
  { as: 'member', ask: 'how many leads do I have in each status?', numbers: (t) => [t.byStatus.Interested, t.byStatus.Pipeline, t.byStatus.Assigned, t.byStatus['Voicemail Sent']], note: 'counts per status' },
  { as: 'member', ask: 'https://pulsetrack.online/app/itad/dialer this the url where all of my leads are. how many are there', numbers: (t) => [t.total], note: 'a Metriq address in the question' },
  { as: 'member', ask: 'which of my leads are in pipeline', names: () => PIPELINE, note: 'Pipeline leads, by name' },
  { as: 'member', ask: 'mere kitne deals won hain aur total kitna hai', numbers: (t) => [t.won.length, t.won.reduce((s, w) => s + w.awarded, 0)], note: 'won deals and their total (Roman Urdu)' },
  { as: 'lead', ask: 'how many leads does the whole ITAD team have in the lead dialer?', numbers: (t) => [t.teamTotal], note: 'team total (manager)' },
  { as: 'lead', ask: 'how many interested leads does Test ITAD Member have, and who are they', numbers: (t) => [t.interested.length], names: (t) => t.interested, note: 'one rep, named by a manager' },
  { as: 'lead', ask: 'how many leads do I have myself?', numbers: (t) => [t.leadTotal], note: "the manager's own leads" },
  { as: 'admin', ask: 'Give me a summary of the Deal Tracker: how many Active, Submitted, Won and Lost bids', numbers: (t) => [t.deals.active, t.deals.submitted, t.deals.won, t.deals.lost], note: 'Deal Tracker cards' },
  { as: 'admin', ask: "How many people haven't submitted their daily report today?", numbers: (t) => [t.notSubmitted], note: 'missing reports' },
  { as: 'member', ask: 'where in metriq do I add a new bid?', names: () => ['Deal Tracker'], note: 'knows its own screens' },
  // From "Problems Metra had" on live, 13 Nov: members were sent to team-lead pages and got Forbidden;
  // a company that exists only as a bid was searched for in leads only and "not found".
  { as: 'member', ask: 'how many dials did I make this month?', numbers: (t) => [t.myDials], note: 'own numbers of a member (not the team page)' },
  { as: 'member', ask: 'how many calls did I make this year so far', numbers: () => [], note: 'a range the app does not have (year)' },
  { as: 'member', ask: 'tell me about Quartz Valley Hospital', names: () => ['Quartz Valley Hospital'], note: 'a company that is only in the Deal Tracker' },
  { as: 'leadgen', ask: 'how many leads did I generate this month?', numbers: (t) => [t.myLeadsGenerated], note: 'own numbers of a Lead Gen member' },
  // Live, 14 Nov: "my task" was answered from the marketing team's board (other people's cards) instead of My Tasks.
  { as: 'marketing', ask: 'what are my task', names: (t) => t.myTasks, absent: [NOT_MINE], note: 'My Tasks, not the marketing board' },
  { as: 'marketing', ask: 'how many tasks are assigned to me right now?', numbers: (t) => [t.myOpenTasks], absent: [NOT_MINE], note: 'the count on My Tasks' },
  { as: 'marketing', ask: 'mere tasks dikhao', names: (t) => t.myTasks, absent: [NOT_MINE], note: 'My Tasks (Roman Urdu)' },

  // ---- E-commerce (ROADMAP phase 1). Before the catalog, 15 Nov: "open the Stock tracking screen", "couldn't find any
  // meeting notes", "no total of listings available".
  { as: 'ecom', ask: 'which products have stock issues right now?', numbers: (t) => [t.x.n.stockOpen], names: (t) => t.x.s.stockOpen, absent: ['Lenovo ThinkCentre M720q'], note: 'e-commerce: open stock requests, by name' },
  { as: 'ecom', ask: 'how many stock requests are still not resolved?', numbers: (t) => [t.x.n.stockOpen], note: 'e-commerce: count of open stock requests' },
  { as: 'ecom', ask: 'stock ka koi masla pending hai?', numbers: (t) => [t.x.n.stockOpen], note: 'e-commerce: open stock requests (Roman Urdu)' },
  { as: 'ecom', ask: 'what was written in our last meeting notes?', names: () => ['Weekly sync on Amazon returns', 'repricer'], note: 'e-commerce: the latest meeting note and what it says' },
  { as: 'ecom', ask: 'what did we decide about the Black Friday bundles?', numbers: () => [15, 200], names: () => ['Optiplex bundles'], note: 'e-commerce: an older meeting note, by topic' },
  { as: 'ecom', ask: 'which meeting note deadlines are still ahead?', names: () => ['Weekly sync on Amazon returns'], note: 'e-commerce: meeting note deadlines' },
  { as: 'ecom', ask: 'how many listings did I add this month?', numbers: (t) => [t.x.n.myListings], note: "e-commerce: a member's own listings for the month" },
  { as: 'ecom', ask: 'what did I write in my daily log yesterday?', names: () => ['Optiplex bundles'], note: 'e-commerce: the notes of one day' },
  { as: 'ecom', ask: 'which tasks on the ecommerce board are overdue?', names: () => ['Fix Amazon suppressed listings'], absent: ['Refresh eBay store banners'], note: 'e-commerce: overdue board tasks' },
  { as: 'ecom', ask: 'which ecommerce board tasks are assigned to me?', names: () => ['Fix Amazon suppressed listings', 'Upload Walmart bulk file'], absent: ['Refresh eBay store banners'], note: 'e-commerce: my tasks on the team board' },
  { as: 'ecom', ask: 'what did people comment on the Amazon suppressed listings task?', names: () => ['brand approval letter'], note: 'e-commerce: the comments of one task' },
  { as: 'ecomlead', ask: 'how many people on my team have not logged any listings this month?', numbers: (t) => [t.x.n.notLogged], note: 'e-commerce lead: who logged nothing' },
  { as: 'ecomlead', ask: 'how many remote desktops are free right now?', numbers: (t) => [t.x.n.rdpFree], note: 'e-commerce lead: remote desktops' },
  { as: 'admin', ask: 'show me the unresolved e-commerce stock requests', numbers: (t) => [t.x.n.stockOpenAdmin], names: (t) => t.x.s.stockOpen, note: 'a Super Admin asks about e-commerce (not their own team)' },

  // ---- Inventory
  { as: 'inv', ask: 'how many items are low in stock?', numbers: (t) => [t.x.n.invLow], note: 'inventory: low stock, the count' },
  { as: 'inv', ask: 'which items are low in stock?', names: (t) => t.x.s.invLow, absent: ['Dell OptiPlex 7060 SFF', 'HP 65W charger'], note: 'inventory: low stock, by name' },
  { as: 'inv', ask: 'which items are out of stock?', names: (t) => t.x.s.invOut, absent: ['Dell OptiPlex 7060 SFF'], note: 'inventory: out of stock' },
  { as: 'inv', ask: 'kitne items ka stock khatam hai?', numbers: (t) => [t.x.n.invOut], note: 'inventory: out of stock (Roman Urdu)' },
  { as: 'inv', ask: 'how many Dell OptiPlex 7060 SFF do we have and where are they kept?', numbers: () => [14], names: () => ['Rack A3'], note: 'inventory: one item, quantity and place' },
  { as: 'inv', ask: 'how many items are in the stock list in total?', numbers: (t) => [t.x.n.invItems], note: 'inventory: total items' },
  { as: 'inv', ask: 'which items need restocking?', names: (t) => [...t.x.s.invLow, ...t.x.s.invOut], note: 'inventory: low or out' },
  { as: 'inv', ask: 'what is the note on the Samsung 256GB SSD?', names: () => ['Supplier delayed'], note: 'inventory: the note on an item' },
  { as: 'inv', ask: 'are there any pending stock requests?', numbers: (t) => [t.x.n.invOpen], note: 'inventory: open requests' },
  { as: 'inv', ask: 'who asked for the OptiPlex stock out and why?', names: () => ['Sales desk', 'Karachi order'], note: 'inventory: who requested, with the note' },
  { as: 'invlead', ask: 'how many open requests does the inventory team have, and how many items are out of stock?', numbers: (t) => [t.x.n.invOpen, t.x.n.invOut], note: 'inventory lead: team totals' },
  { as: 'admin', ask: 'which inventory items are low in stock?', names: (t) => t.x.s.invLowAdmin, note: 'a Super Admin asks about inventory (not their own team)' },

  // ---- Calendar: meetings with the notes written on them, holidays, due dates, to-dos
  { as: 'ecom', ask: 'what is on my calendar for the next 7 days?', names: () => ['Supplier call with Zenith', 'Founders Day'], note: 'calendar: the coming week' },
  { as: 'ecom', ask: 'do I have any meetings tomorrow?', names: () => ['Supplier call with Zenith'], note: 'calendar: tomorrow' },
  { as: 'ecom', ask: 'what notes did I add on my calendar for tomorrow?', names: () => ['warranty'], note: 'calendar: the notes written on an event' },
  { as: 'ecom', ask: 'kal meri koi meeting hai?', names: () => ['Supplier call'], note: 'calendar: tomorrow (Roman Urdu)' },
  { as: 'ecom', ask: 'what do I have to do today?', names: () => ['Count the returns shelf'], note: 'calendar: today\'s to-do' },
  { as: 'ecom', ask: 'what is in my notes?', names: () => ['DHL about the Monday pickup'], note: 'Notes: my own sticky note' },
  { as: 'ecomlead', ask: 'which notes have been shared with me?', names: () => ['DHL about the Monday pickup'], note: 'Notes: a note shared with me' },
  { as: 'ecom', ask: 'are there any holidays in the next 7 days?', names: () => ['Founders Day'], note: 'calendar: holidays' },
  { as: 'ecom', ask: 'what is due in the next 7 days on my calendar?', names: () => ['Upload Walmart bulk file'], note: 'calendar: tasks due' },
  { as: 'ecom', ask: 'am I free tomorrow afternoon?', names: () => ['Supplier call'], note: 'calendar: free or busy' },
  { as: 'inv', ask: 'what is on my schedule for the next 7 days?', names: () => ['Founders Day'], absent: ['Supplier call'], note: "calendar: another person's (not the e-commerce member's meeting)" },
  { as: 'ecom', ask: 'what was the agenda of my supplier call?', names: () => ['pallet price'], note: 'calendar: a meeting by name' },

  // ---- Phase 2 (ROADMAP): attendance, leave, people, targets, team numbers, marketing, QA. The truth is what the
  // screens hold on the test copy; nothing is seeded for these.
  { as: 'lead', ask: 'how many people are on my team attendance list and how many are not in yet?', numbers: (t) => [t.x.n.attMembers, t.x.n.attNotIn], note: 'attendance now: counts' },
  { as: 'lead', ask: 'who is late today?', numbers: (t) => (t.x.n.attLate ? [t.x.n.attLate] : []), names: (t) => t.x.s.attLate, note: 'attendance now: late people (or none)' },
  { as: 'lead', ask: 'how many leave days are recorded for my team, and how many of them are work from home?', numbers: (t) => [t.x.n.leaveDays, t.x.n.leaveWfh], note: 'leave: counts by kind' },
  { as: 'lead', ask: 'what is the daily dial target for my team?', numbers: (t) => [t.x.n.dialTarget], note: 'targets' },
  { as: 'lead', ask: 'how many dials did my team make last month according to the monthly report?', numbers: (t) => [t.x.n.dialsLastMonth], note: 'monthly report (ITAD lead)' },
  { as: 'lead', ask: "who has not submitted today's report on my team?", numbers: (t) => [t.x.n.notSubmittedTeam], note: 'missing reports, counted' },
  { as: 'leadgenlead', ask: 'how many leads did the lead gen team generate last month?', numbers: (t) => [t.x.n.lgLeadsLastMonth], note: 'monthly report (Lead Gen lead)' },
  { as: 'member', ask: 'was I late any day this month?', numbers: (t) => (t.x.n.myLateDays ? [t.x.n.myLateDays] : []), note: "a member's own attendance" },
  { as: 'admin', ask: 'how many people are in the company and how many departments are there?', numbers: (t) => [t.x.n.people, t.x.n.departments], note: 'people and teams (Super Admin)' },
  { as: 'member', ask: 'what is the email address of Test ITAD Lead?', names: () => ['itad.lead@test.local'], note: 'people directory (a member)' },
  { as: 'marketing', ask: 'how many ad campaigns are active and what is our total ad spend?', numbers: (t) => [t.x.n.adsActive, t.x.n.adsSpend], note: 'marketing: ads totals' },
  { as: 'marketing', ask: 'which ad campaign got the most leads?', names: (t) => t.x.s.adsBest, note: 'marketing: best campaign' },
  { as: 'marketing', ask: 'how many brands do we market and how many social profiles do they have in all?', numbers: (t) => [t.x.n.brands, t.x.n.profiles], note: 'marketing: brands and profiles' },
  { as: 'marketing', ask: 'how many marketing items are still in the backlog?', numbers: (t) => [t.x.n.mktBacklog], note: 'marketing: work by status' },
  { as: 'marketing', ask: 'who wrote our blog posts?', names: (t) => t.x.s.blogAuthors, note: 'marketing: blogs' },
  { as: 'qa', ask: 'how many QA scorecards are there and what is the pass mark of the Call Quality Monitoring Form?', numbers: (t) => [t.x.n.scorecards, t.x.n.callFormPass], note: 'QA: scorecards' },
  { as: 'csr', ask: 'what was my last QA score?', numbers: (t) => [t.x.n.myQaScore], note: "QA: an agent's own scores" },

  // ---- Phase 3 (ROADMAP): follow-ups, the screen the person is on, Roman Urdu in the newer areas
  { as: 'inv', ask: 'and which are out?', names: (t) => t.x.s.invOut, absent: ['Dell OptiPlex 7060 SFF'], note: 'a follow-up: another condition of the same data',
    history: [{ role: 'user', content: 'which items are low in stock?' }, { role: 'assistant', content: 'Three items are low in stock: Crucial 8GB DDR4, WD 1TB HDD and Test SSD 512GB.' }] },
  { as: 'ecom', ask: 'and on how many days did I log?', numbers: (t) => [t.x.n.myDaysLogged], note: 'a follow-up: another number of the same data',
    history: [{ role: 'user', content: 'how many listings did I add this month?' }, { role: 'assistant', content: 'You added 25 listings this month.' }] },
  { as: 'marketing', ask: 'what about the paused ones?', numbers: (t) => [t.x.n.adsPaused], note: 'a follow-up: another status',
    history: [{ role: 'user', content: 'how many ad campaigns are active?' }, { role: 'assistant', content: '12 ad campaigns are active.' }] },
  { as: 'inv', ask: 'how many of these are low?', page: '/app/inventory', numbers: (t) => [t.x.n.invLow], note: 'asked from the Stock list screen: "these" is that screen' },
  { as: 'ecom', ask: 'anything here still not resolved?', page: '/app/ecommerce/stock', numbers: (t) => [t.x.n.stockOpen], names: (t) => t.x.s.stockOpen, note: 'asked from the Stock tracking screen' },
  { as: 'lead', ask: 'meri team mein kitne log chutti par rahe aur kitne din?', numbers: (t) => [t.x.n.leaveDays], note: 'leave (Roman Urdu)' },
  { as: 'marketing', ask: 'kitne ad campaigns active hain aur total kharcha kitna hai?', numbers: (t) => [t.x.n.adsActive, t.x.n.adsSpend], note: 'marketing ads (Roman Urdu)' },
  { as: 'admin', ask: 'company mein kitne log hain?', numbers: (t) => [t.x.n.people], note: 'people (Roman Urdu)' },

  // The rest of the app (the full audit of 15 Nov): Lead Management, the Daily Report, the Lead Dialer's imports, one
  // evaluation in full, a custom block, and the screens outside the menu. Rows from scripts/metraSeedMore.ts.
  { as: 'leadgenlead', ask: 'how many leads do we have in Lead Management in all, and how many open ones are not assigned to anyone?', numbers: () => [M.leads.length + M.review.length, M.leads.filter((l) => !l.mine).length], note: 'Lead Dashboard: all leads of both businesses and the unassigned ones' },
  { as: 'leadgenlead', ask: 'which leads are waiting for the head to decide, and what was asked?', names: () => [M.review[0].name, 'published rate'], absent: [M.review[1].name], note: 'the review queue, with the question put to the head' },
  { as: 'leadgen', ask: 'how many dials and connected calls are in my lead daily report today?', numbers: () => [M.leadReport.dials, M.leadReport.connected], names: () => ['one connect'], note: 'the lead daily report of a rep' },
  { as: 'leadgen', ask: 'which follow up tasks on my leads are overdue?', names: () => ['Send the rate sheet'], absent: ['Confirm the first order'], note: 'Agent Tasks: only the overdue ones' },
  { as: 'leadgenlead', ask: 'what is on the deal board of our freight business and what are the open deals worth?', names: () => ['Lucia Ferrand', 'Omar Siddiqui'], numbers: () => [M.leads.filter((l) => l.status !== 'CLOSED_WON').reduce((s, l) => s + (l.value ?? 0), 0)], note: 'Deal Board: the deals and what the open ones add up to' },
  { as: 'leadgen', ask: 'which calls did I log on my leads?', names: () => ['Dana Whitfield', 'Omar Siddiqui'], absent: ['Lucia Ferrand'], note: 'lead calls: a rep sees only their own' },
  { as: 'leadgenlead', ask: 'what did Test LeadGen Member put in the daily report today?', numbers: () => [M.reports[0].calls, M.reports[0].quotes], names: () => ['price list'], note: "Daily Report: one person's answers, under the form's own field names" },
  { as: 'leadgen', ask: 'did I send my daily report yesterday, and what did I put in it?', numbers: () => [M.reports[1].calls, M.reports[1].quotes], note: 'Daily Report: my own, on another day' },
  { as: 'leadgenlead', ask: 'how many calls did the team report in the daily report over the last 30 days?', numbers: () => [M.reports.reduce((s, r) => s + r.calls, 0)], note: 'Daily Report: the last 30 days added up' },
  { as: 'member', ask: 'when was my lead list last imported and how many rows did it have?', numbers: () => [40], names: () => ['leads.csv'], note: 'Lead Dialer imports' },
  { as: 'csr', ask: 'what was the score of my last QA evaluation, did I pass, and did QA leave a comment?', numbers: () => [88], names: () => ['Good'], note: 'one evaluation in full' },
  { as: 'admin', ask: 'list the records of the Vendors block and the total amount', names: () => M.vendors.map((v) => v.vendor), numbers: () => [M.vendors.reduce((s, v) => s + v.amount, 0)], note: 'a custom block, with the total of its number field' },
  { as: 'leadgenlead', page: '/app/leads/board', ask: 'what is this page for?', names: () => ['Deal Board'], note: 'a screen outside the menu, known from the page the person is on' },
  { as: 'admin', ask: 'where do I add a new user and set their role?', names: () => ['Users'], note: 'where a screen is: the admin screens are in the list of screens' },
  { as: 'marketing', ask: 'what are the comments on the Saffron launch carousel?', names: () => ['Saffron launch carousel'], note: 'one marketing item in full (it has no comments: that must be said, not made up)' },
]

/** Words that mean Metra gave up; never right when the data is there. */
const GAVE_UP = /couldn['’]?t (find|pull|get|read)|could not (find|read|pull)|unable to|not able to|try again|isn['’]?t returning|not returning|no data (is )?available|don['’]?t have (any )?(data|access|information)/i

async function main() {
  // Loaded only now: the database address above must be set first.
  const { prisma } = await import('../lib/prisma')
  const { runAsCompany } = await import('../lib/tenancy')
  const { HOME_COMPANY_ID } = await import('../lib/company')
  const { createApp } = await import('../app')
  const { setAuditBaseUrl } = await import('../lib/health/audit')
  const { apiAs } = await import('../lib/mcp/api')
  const { askerOf } = await import('../lib/metra/access')
  const { answer } = await import('../lib/metra/agent')
  const { llmReady, llmModel, llmBase } = await import('../lib/metra/llm')
  const { setCompanyFlag } = await import('../lib/flags')
  const { DEFAULT_STAGE_MAP } = await import('../lib/dialer/rules')

  const find = async (email: string): Promise<U> => {
    const u = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true, role: true, name: true } })
    if (!u) { console.error(`The test account ${email} is missing. Run: npx tsx prisma/test-users.ts`); process.exit(1) }
    return u
  }
  const people = { member: await find('itad.member@test.local'), lead: await find('itad.lead@test.local'), admin: await find('admin@test.local'), leadgen: await find('leadgen.member@test.local'), marketing: await find('marketing.lead@test.local'), ecom: await find('ecommerce.member@test.local'), ecomlead: await find('ecommerce.lead@test.local'), qa: await find('qa@test.local'), csr: await find('csr.member@test.local'), leadgenlead: await find('leadgen.lead@test.local'), inv: await find('inventory.member@test.local'), invlead: await find('inventory.lead@test.local') }

  /** Takes out the e-commerce, inventory and calendar rows this script made (each carries the mark in a name it wrote). */
  const clearAreas = async (): Promise<number> => {
    let n = 0
    n += (await prisma.inventoryMovement.deleteMany({ where: { item: { sku: { startsWith: 'MCHK-' } } } })).count
    n += (await prisma.inventoryItem.deleteMany({ where: { sku: { startsWith: 'MCHK-' } } })).count
    n += (await prisma.stockRequest.deleteMany({ where: { itemName: { startsWith: MARK } } })).count
    n += (await prisma.meetingNote.deleteMany({ where: { title: { startsWith: MARK } } })).count
    n += (await prisma.ecomTaskComment.deleteMany({ where: { task: { title: { startsWith: MARK } } } })).count
    n += (await prisma.ecommerceTask.deleteMany({ where: { title: { startsWith: MARK } } })).count
    n += (await prisma.ecommerceDailyEntry.deleteMany({ where: { notes: { startsWith: MARK } } })).count
    n += (await prisma.holiday.deleteMany({ where: { name: { startsWith: MARK } } })).count
    n += (await prisma.workLogEntry.deleteMany({ where: { title: { startsWith: MARK } } })).count
    n += (await prisma.note.deleteMany({ where: { title: { startsWith: MARK } } })).count
    // A meeting made through the app got a chat of its own: both go.
    const ms = await prisma.meeting.findMany({ where: { title: { startsWith: MARK } }, select: { id: true, conversationId: true } })
    for (const m of ms) if (!(await prisma.meeting.count({ where: { conversationId: m.conversationId, NOT: { title: { startsWith: MARK } } } }))) await prisma.chatConversation.deleteMany({ where: { id: m.conversationId } })
    await prisma.meeting.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } })
    // Lead Management, the Daily Report form, the Lead Dialer import and the custom block (scripts/metraSeedMore.ts).
    n += await clearMore(prisma as never)
    return n + ms.length
  }

  const unseed = () => runAsCompany(HOME_COMPANY_ID, async () => {
    const a = await prisma.dialerLead.deleteMany({ where: { listName: MARK } })
    const b = await prisma.bid.deleteMany({ where: { title: { startsWith: MARK } } })
    const c = await prisma.pmTask.deleteMany({ where: { project: { key: 'MCHK', name: { startsWith: MARK } } } })
    await prisma.pmProject.deleteMany({ where: { key: 'MCHK', name: { startsWith: MARK } } })
    const d = await prisma.marketingTask.deleteMany({ where: { title: { startsWith: MARK } } })
    return a.count + b.count + c.count + d.count + (await clearAreas())
  })
  if (flag('--unseed')) { console.log(`Took out ${await unseed()} test rows.`); await prisma.$disconnect(); return }

  await runAsCompany(HOME_COMPANY_ID, async () => {
    const have = await prisma.dialerLead.count({ where: { listName: MARK, ownerId: people.member.id } })
    const want = INTERESTED.length + PIPELINE.length + BULK.reduce((s, [, n]) => s + n, 0)
    if (have === want && !flag('--reseed')) return
    await prisma.dialerLead.deleteMany({ where: { listName: MARK } })
    await prisma.bid.deleteMany({ where: { title: { startsWith: MARK } } })
    const states = ['Texas', 'Ohio', 'Florida', 'Georgia', 'Nevada', 'Oregon']
    const row = (ownerId: string, i: number, company: string, status: string) => ({ ownerId, matchKey: `check:${i}`, company, status, stage: DEFAULT_STAGE_MAP[status] ?? 1, maxStage: DEFAULT_STAGE_MAP[status] ?? 1, listName: MARK, contactName: `Contact ${i}`, phone: `555${String(1000000 + i)}`, state: states[i % states.length], industry: i % 3 ? 'Education' : 'Health Care' })
    let i = 0
    const rows = [
      ...INTERESTED.map((c) => row(people.member.id, i++, c, 'Interested')),
      ...PIPELINE.map((c) => row(people.member.id, i++, c, 'Pipeline')),
      ...BULK.flatMap(([status, n]) => Array.from({ length: n }, () => { i++; return row(people.member.id, i, `Check Company ${i}`, status) })),
      ...Array.from({ length: 300 }, () => { i++; return row(people.lead.id, i, `Lead Own Company ${i}`, i % 2 ? 'Assigned' : 'Connected') }),
    ]
    for (let k = 0; k < rows.length; k += 500) await prisma.dialerLead.createMany({ data: rows.slice(k, k + 500) })
    const itad = await prisma.department.findFirst({ where: { type: 'ITAD' }, select: { id: true } })
    const soon = new Date(Date.now() + 5 * 86400000), past = new Date(Date.now() - 20 * 86400000)
    const bid = (title: string, company: string, status: 'ACTIVE' | 'WON' | 'LOST', awarded: number | null) => ({ title: `${MARK} ${title}`, company, type: 'PO' as const, agentId: people.member.id, departmentId: itad?.id ?? null, status, dueDate: status === 'ACTIVE' ? soon : past, priceQuoted: 3000, awardedPrice: awarded, closedDate: status === 'ACTIVE' ? null : past })
    await prisma.bid.createMany({ data: [...WON.map((w, k) => bid(`buyback ${k + 1}`, w.company, 'WON', w.awarded)), bid('lost one', 'Sable Logistics', 'LOST', 0), bid('open one', 'Tindall Motors', 'ACTIVE', null)] })
    console.log(`Seeded ${rows.length.toLocaleString('en-US')} Lead Dialer leads and 4 bids (list / title "${MARK}").`)
  })
  // My Tasks: a project with two tasks for the marketing lead, and one marketing card that belongs to a colleague.
  await runAsCompany(HOME_COMPANY_ID, async () => {
    const own = { key: 'MCHK', name: { startsWith: MARK } }
    if ((await prisma.pmTask.count({ where: { project: own } })) === MY_TASKS.length && (await prisma.marketingTask.count({ where: { title: { startsWith: MARK } } })) === 2 && !flag('--reseed')) return
    await prisma.pmTask.deleteMany({ where: { project: own } })
    await prisma.pmProject.deleteMany({ where: own })
    await prisma.marketingTask.deleteMany({ where: { title: { startsWith: MARK } } })
    const p = await prisma.pmProject.create({ data: { name: `${MARK} Website`, key: 'MCHK', ownerId: people.admin.id, taskCounter: MY_TASKS.length } })
    await prisma.pmProjectMember.create({ data: { projectId: p.id, userId: people.marketing.id } })
    const todo = await prisma.pmColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0, isDefault: true } })
    await prisma.pmColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } })
    for (const [k, title] of MY_TASKS.entries()) {
      const t = await prisma.pmTask.create({ data: { projectId: p.id, code: `MCHK-${k + 1}`, title, columnId: todo.id, createdById: people.admin.id, position: k } })
      await prisma.pmTaskAssignee.create({ data: { taskId: t.id, userId: people.marketing.id, assignedById: people.admin.id } })
    }
    const colleague = await find('marketing.social@test.local')
    await prisma.marketingTask.create({ data: { title: `${MARK} ${NOT_MINE}`, discipline: 'SOCIAL', status: 'IN_PROGRESS', assigneeId: colleague.id } })
    await prisma.marketingTask.create({ data: { title: `${MARK} ${MINE_ON_BOARD}`, discipline: 'CONTENT', status: 'IN_REVIEW', assigneeId: people.marketing.id } })
    console.log(`Seeded project MCHK with ${MY_TASKS.length} tasks for ${people.marketing.name} and one marketing card for ${colleague.name}.`)
  })
  await setCompanyFlag('metra', HOME_COMPANY_ID, true, 'metra:check')
  // What Metra knows about Metriq's own screens is part of its index: make sure it is there.
  const { indexNow } = await import('../lib/metra/indexer')
  await runAsCompany(HOME_COMPANY_ID, () => indexNow(HOME_COMPANY_ID, ['APP_SCREEN']))
  const indexAreas = () => runAsCompany(HOME_COMPANY_ID, () => indexNow(HOME_COMPANY_ID, ['ECOM_NOTE', 'STOCK_REQUEST', 'ECOM_ENTRY', 'ECOM_TASK', 'INV_ITEM', 'INV_MOVE', 'MEETING']))
  if (!llmReady()) { console.error('No model key in server/.env (GROQ_API_KEY or METRA_LLM_API_KEY). Stopping.'); process.exit(1) }

  // The app itself, on a free port: tools read through its real API, with every permission check.
  const server = createApp().listen(0)
  setAuditBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

  // E-commerce, Inventory and the calendar (ROADMAP phase 1). Made again on every run: their dates are relative to today.
  const flagsBefore = await prisma.featureFlagCompany.findMany({ where: { companyId: HOME_COMPANY_ID, key: { in: [...MORE_FLAGS] } } })
  for (const k of MORE_FLAGS) await setCompanyFlag(k, HOME_COMPANY_ID, true, 'metra:check')
  const flagsBack = async () => { for (const k of MORE_FLAGS) { const b = flagsBefore.find((x) => x.key === k); await setCompanyFlag(k, HOME_COMPANY_ID, b ? b.enabled : null, 'metra:check') } }
  await runAsCompany(HOME_COMPANY_ID, async () => {
    await clearAreas()
    const { DateTime } = await import('luxon')
    const { companyToday, companyTz, dbDateFromString } = await import('../lib/time')
    const today = DateTime.fromISO(companyToday(), { zone: companyTz() })
    await seedMore(prisma as never, { admin: people.admin, manager: people.leadgenlead, rep: people.leadgen, dialer: people.member }, companyTz())
    const d = (plus: number) => dbDateFromString(today.plus({ days: plus }).toISODate()!)
    const at = (plus: number, hour: number) => today.plus({ days: plus }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate()
    const deptOf = async (u: U) => (await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { departmentId: true } })).departmentId
    const [ec, inv] = [await deptOf(people.ecom), await deptOf(people.inv)]
    if (!ec || !inv) { console.error('The e-commerce or inventory test account has no department. Run: npx tsx prisma/test-users.ts'); process.exit(1) }

    await prisma.meetingNote.createMany({ data: [
      { authorId: people.ecomlead.id, departmentId: ec, title: `${MARK} Weekly sync on Amazon returns`, meetingDate: d(-2), deadline: d(3), body: 'Decided to pause the Walmart repricer until Friday. Hamza will audit 40 suppressed Amazon listings. Returns older than 30 days go to the liquidation pallet.' },
      { authorId: people.ecomlead.id, departmentId: ec, title: `${MARK} Q4 holiday listing plan`, meetingDate: d(-9), deadline: null, body: 'Black Friday bundles: three Dell Optiplex bundles at 15 percent off. The eBay promoted listings budget is set to 200 dollars.' },
      { authorId: people.ecom.id, departmentId: ec, title: `${MARK} Shipping delays review`, meetingDate: d(-20), deadline: d(-5), body: 'FedEx pickup moves to 3 PM. Zainab owns the delayed orders sheet.' },
    ] })
    await prisma.stockRequest.createMany({ data: [
      { departmentId: ec, itemName: `${MARK} HP EliteDesk 800 G4`, quantity: 6, requestedByName: 'Nathan', action: 'STOCK_OUT', status: 'REQUESTED', note: 'Out of stock in the warehouse: pull it from Amazon and Walmart.', createdById: people.ecomlead.id, requestedAt: at(-1, 10) },
      { departmentId: ec, itemName: `${MARK} Dell Latitude 5490`, quantity: 3, requestedByName: 'Nathan', action: 'STOCK_OUT', status: 'ASSIGNED', assignedToId: people.ecom.id, assignedAt: at(-1, 12), note: 'Only the i5 model.', createdById: people.ecomlead.id, requestedAt: at(-1, 11) },
      { departmentId: ec, itemName: `${MARK} Dell P2419H monitor`, quantity: null, requestedByName: 'Warehouse', action: 'STOCK_OUT', status: 'REQUESTED', note: 'Only 2 left, pull the eBay listing.', createdById: people.ecom.id, requestedAt: at(0, 9) },
      { departmentId: ec, itemName: `${MARK} Lenovo ThinkCentre M720q`, quantity: 12, requestedByName: 'Warehouse', action: 'STOCK_IN', status: 'RESOLVED', assignedToId: people.ecom.id, resolvedAt: at(-3, 15), note: 'Back in stock, relist everywhere.', createdById: people.ecomlead.id, requestedAt: at(-4, 10) },
    ] })
    const task = (title: string, status: 'TODO' | 'IN_PROGRESS' | 'DONE', assignedToId: string | null, due: number | null, order: number) => prisma.ecommerceTask.create({ data: { title: `${MARK} ${title}`, description: 'Seeded by metra:check.', source: 'Team meeting', status, order, assignedToId, createdById: people.ecomlead.id, dueDate: due == null ? null : d(due), completedAt: status === 'DONE' ? at(-1, 16) : null } })
    const late = await task('Fix Amazon suppressed listings', 'IN_PROGRESS', people.ecom.id, -2, 9001)
    await task('Upload Walmart bulk file', 'TODO', people.ecom.id, 2, 9002)
    await task('Refresh eBay store banners', 'TODO', null, null, 9003)
    await task('Audit pricing sheet', 'DONE', people.ecomlead.id, -6, 9004)
    await prisma.ecomTaskComment.create({ data: { taskId: late.id, authorId: people.ecomlead.id, body: 'Amazon needs the brand approval letter first; I asked Nathan for it.' } })

    // The member's own daily log: yesterday and the day before, in listings per marketplace.
    const tags = await prisma.tag.findMany({ where: { departmentId: ec, isActive: true, type: { in: ['TASK_TYPE', 'MARKETPLACE'] } }, orderBy: { createdAt: 'asc' } })
    const kind = tags.find((t) => t.type === 'TASK_TYPE' && (t.group ?? '').toLowerCase() !== 'pricing')
    const markets = tags.filter((t) => t.type === 'MARKETPLACE')
    if (kind && markets.length >= 2) {
      const log = async (plus: number, notes: string, pricingNotes: string | null, counts: number[]) => {
        if (await prisma.ecommerceDailyEntry.findUnique({ where: { userId_date: { userId: people.ecom.id, date: d(plus) } }, select: { id: true } })) return
        const e = await prisma.ecommerceDailyEntry.create({ data: { userId: people.ecom.id, date: d(plus), status: 'SUBMITTED', notes: `${MARK} ${notes}`, pricingNotes } })
        await prisma.ecommerceListingLine.createMany({ data: counts.map((listings, k) => ({ entryId: e.id, taskTypeId: kind.id, marketplaceId: markets[k].id, listings })) })
      }
      await log(-1, 'Relisted the Optiplex bundles after the photo fix.', 'Dropped the 7050 SFF by 10 dollars on eBay.', [12, 5])
      await log(-2, 'Cleaned up duplicate SKUs.', null, [8, 0])
    } else console.log('No e-commerce marketplaces or work types on this database: the daily log was not seeded.')

    const item = (n: number, name: string, category: string, quantity: number, lowStockAt: number, price: number, extra: { location?: string; notes?: string; active?: boolean } = {}) => prisma.inventoryItem.create({ data: { departmentId: inv, name: `${MARK} ${name}`, category, quantity, lowStockAt, price, sku: `MCHK-${n}`, createdById: people.invlead.id, ...extra } })
    const optiplex = await item(1, 'Dell OptiPlex 7060 SFF', 'Desktop Models', 14, 5, 185, { location: 'Rack A3' })
    const crucial = await item(2, 'Crucial 8GB DDR4', 'Memory', 3, 10, 18)
    const samsung = await item(3, 'Samsung 256GB SSD', 'Drives', 0, 5, 22, { notes: 'Supplier delayed until next week.' })
    await item(4, 'HP 65W charger', 'Accessories', 40, 0, 9, { location: 'Bin 12' })
    const wd = await item(5, 'WD 1TB HDD', 'Drives', 2, 4, 30)
    await item(6, 'Kingston 16GB DDR4', 'Memory', 25, 8, 35, { active: false })
    await prisma.inventoryMovement.createMany({ data: [
      { itemId: optiplex.id, type: 'STOCK_OUT', quantity: 2, status: 'REQUESTED', requestedByName: 'Sales desk', note: 'For the Karachi order.', requestedAt: at(0, 9) },
      { itemId: crucial.id, type: 'STOCK_IN', quantity: 20, status: 'ASSIGNED', requestedByName: 'Purchasing', assignedToId: people.inv.id, assignedAt: at(-1, 13), requestedAt: at(-1, 12) },
      { itemId: wd.id, type: 'STOCK_OUT', quantity: 1, status: 'COMPLETED', requestedByName: 'Repairs', assignedToId: people.inv.id, resolvedAt: at(-2, 15), requestedAt: at(-2, 11) },
      { itemId: samsung.id, type: 'STOCK_IN', quantity: 5, status: 'CANCELLED', requestedByName: 'Purchasing', note: 'Supplier cancelled.', requestedAt: at(-5, 10) },
    ] })
    await prisma.holiday.create({ data: { date: d(4), name: `${MARK} Founders Day` } })

    // A to-do for today (through the app, as the person), and a meeting tomorrow with notes written on it. The meeting
    // is made as the app makes it (its own chat, then the meeting) but without the chat message announcing it.
    const todo = await apiAs(people.ecom, 'POST', '/api/worklog', { body: { title: `${MARK} Count the returns shelf`, date: today.toISODate(), period: 'DAY' } })
    if (todo.status >= 400) { console.error(`Could not seed the to-do (${todo.status}): ${JSON.stringify(todo.body).slice(0, 200)}`); process.exit(1) }
    // A sticky note (Notes), shared with the team lead to read.
    const note = await apiAs(people.ecom, 'POST', '/api/notes', { body: { title: `${MARK} Call DHL about the Monday pickup`, body: 'Ask for the 3 PM slot and the pallet rate.', tags: ['shipping'], shares: [{ userId: people.ecomlead.id, canEdit: false }] } })
    if (note.status >= 400) { console.error(`Could not seed the note (${note.status}): ${JSON.stringify(note.body).slice(0, 200)}`); process.exit(1) }
    const title = `${MARK} Supplier call with Zenith`
    const conv = await prisma.chatConversation.create({ data: { type: 'GROUP', name: title, createdById: people.ecom.id, members: { create: [{ userId: people.ecom.id, isAdmin: true }] } } })
    await prisma.meeting.create({ data: { title, agenda: 'Ask about the 90-day warranty and the pallet price for 7060 towers.', startsAt: at(1, 15), endsAt: at(1, 16), organizerId: people.ecom.id, conversationId: conv.id } })
  })
  await indexAreas()

  // What the screens show (read through the same API the pages use), to compare the answers with.
  type Lead = { company: string; status: string; duplicate: boolean }
  const leadsOf = async (u: U, rep: string) => ((await apiAs(u, 'GET', '/api/dialer/data', { query: { rep } })).body as { leads: Lead[] }).leads.filter((l) => !l.duplicate)
  const truth: Truth = await runAsCompany(HOME_COMPANY_ID, async () => {
    const mine = await leadsOf(people.member, 'me')
    const byStatus: Record<string, number> = {}
    for (const l of mine) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1
    const deals = (await apiAs(people.admin, 'GET', '/api/itad/bids')).body as { summary: Truth['deals'] }
    const myDeals = (await apiAs(people.member, 'GET', '/api/itad/bids')).body as { bids: { company: string; status: string; awardedPrice: number | null }[] }
    const missing = (await apiAs(people.admin, 'GET', '/api/notifications/not-submitted')).body as { total: number }
    // A member's own daily numbers this month, as My Reports shows them.
    const own = async (u: U, key: string) => { const b = (await apiAs(u, 'GET', '/api/reports/me', { query: { range: 'month' } })).body as { totals?: Record<string, unknown> }; return Number(b.totals?.[key] ?? 0) }
    const tasks = (await apiAs(people.marketing, 'GET', '/api/tasks/mine')).body as { pending: { title: string }[]; stats: { openCount: number } }
    // E-commerce and Inventory, exactly as their screens give them.
    type Stock = { itemName: string; status: string }
    const stockOf = async (u: U) => ((await apiAs(u, 'GET', '/api/ecommerce/stock')).body as { requests: Stock[] }).requests.filter((s) => s.status !== 'RESOLVED')
    const stock = await stockOf(people.ecom)
    const team = (await apiAs(people.ecomlead, 'GET', '/api/ecommerce/team', { query: { range: 'month' } })).body as { agents: { id: string; status: string; totalListings: number; daysLogged: number }[] }
    const rdps = (await apiAs(people.ecomlead, 'GET', '/api/rdp')).body as { rdps: { active: boolean; currentAgents: string[] }[] }
    type Item = { name: string; status: 'IN' | 'LOW' | 'OUT' }
    const itemsOf = async (u: U) => ((await apiAs(u, 'GET', '/api/inventory/items')).body as { items: Item[] }).items
    const items = await itemsOf(people.inv)
    const moves = (await apiAs(people.inv, 'GET', '/api/inventory/requests')).body as { requests: { status: string }[] }
    // Phase 2: what the attendance, leave, people, marketing and QA screens hold right now.
    const read = async <T>(u: U, path: string, query: Record<string, string> = {}) => (await apiAs(u, 'GET', path, { query })).body as T
    const att = await read<{ rows: { name: string; lateDays: number }[]; summary: { members: number; notInNow: number } }>(people.lead, '/api/attendance/team', { range: 'today' })
    const leave = await read<{ leave: { type: string }[] }>(people.lead, '/api/admin/leave')
    const targets = await read<{ targets: { metricKey: string; period: string; value: number }[] }>(people.lead, '/api/admin/targets')
    const monthly = async (u: U, department: string) => (await read<{ report?: { team?: Record<string, number> } }>(u, '/api/reports/monthly', { department })).report?.team ?? {}
    const missingTeam = await read<{ total: number }>(people.lead, '/api/notifications/not-submitted')
    const myAtt = await read<{ summary: { lateDays: number } }>(people.member, '/api/attendance/history', { range: 'month' })
    const users = await read<{ users: unknown[] }>(people.admin, '/api/admin/users')
    const depts = await read<{ departments: unknown[] }>(people.admin, '/api/company/departments')
    const ads = await read<{ activeCampaigns: number; totalCampaigns: number; totalSpend: number; bestPerforming: { title: string } | null }>(people.marketing, '/api/marketing/ads/summary')
    const brands = await read<{ brands: { profileCount: number }[] }>(people.marketing, '/api/marketing/brands')
    const board = await read<{ columns: { status: string; tasks: unknown[] }[] }>(people.marketing, '/api/marketing/board')
    const blogs = await read<{ blogs: { author: { name: string } | null }[] }>(people.marketing, '/api/marketing/blogs')
    const cards = await read<{ scorecards: { name: string; passThreshold: number }[] }>(people.qa, '/api/qa/scorecards')
    const myQa = await read<{ evaluations: { totalScore: number }[] }>(people.csr, '/api/qa/my-evaluations')
    const x: Areas = {
      n: {
        stockOpen: stock.length, stockOpenAdmin: (await stockOf(people.admin)).length,
        myListings: team.agents.find((a) => a.id === people.ecom.id)?.totalListings ?? 0, myDaysLogged: team.agents.find((a) => a.id === people.ecom.id)?.daysLogged ?? 0, notLogged: team.agents.filter((a) => a.status === 'PENDING').length,
        rdpFree: rdps.rdps.filter((r) => r.active && !r.currentAgents.length).length,
        attMembers: att.summary.members, attNotIn: att.summary.notInNow, attLate: att.rows.filter((r) => r.lateDays > 0).length,
        leaveDays: leave.leave.length, leaveWfh: leave.leave.filter((l) => l.type === 'WFH').length,
        dialTarget: targets.targets.find((x) => x.metricKey === 'callsDialed')?.value ?? 0,
        dialsLastMonth: (await monthly(people.lead, 'ITAD')).callsDialed ?? 0, lgLeadsLastMonth: (await monthly(people.leadgenlead, 'LEAD_GEN')).leads ?? 0,
        notSubmittedTeam: missingTeam.total, myLateDays: myAtt.summary.lateDays, people: users.users.length, departments: depts.departments.length,
        adsActive: ads.activeCampaigns, adsPaused: ads.totalCampaigns - ads.activeCampaigns, adsSpend: ads.totalSpend, brands: brands.brands.length, profiles: brands.brands.reduce((s, b) => s + b.profileCount, 0),
        mktBacklog: board.columns.find((c) => c.status === 'BACKLOG')?.tasks.length ?? 0,
        scorecards: cards.scorecards.length, callFormPass: cards.scorecards.find((c) => c.name === 'Call Quality Monitoring Form')?.passThreshold ?? 0, myQaScore: myQa.evaluations[0]?.totalScore ?? 0,
        invItems: items.length, invLow: items.filter((i) => i.status === 'LOW').length, invOut: items.filter((i) => i.status === 'OUT').length,
        invOpen: moves.requests.filter((m) => m.status === 'REQUESTED' || m.status === 'ASSIGNED').length,
      },
      s: {
        stockOpen: stock.map((s) => bare(s.itemName)),
        invLow: items.filter((i) => i.status === 'LOW').map((i) => bare(i.name)), invOut: items.filter((i) => i.status === 'OUT').map((i) => bare(i.name)),
        invLowAdmin: (await itemsOf(people.admin)).filter((i) => i.status === 'LOW').map((i) => bare(i.name)),
        attLate: att.rows.filter((r) => r.lateDays > 0).map((r) => r.name.trim()), adsBest: ads.bestPerforming ? [ads.bestPerforming.title] : [],
        blogAuthors: [...new Set(blogs.blogs.map((b) => b.author?.name.trim()).filter((n): n is string => !!n))],
      },
    }
    return {
      x,
      myTasks: tasks.pending.map((t) => t.title).slice(0, 12), myOpenTasks: tasks.stats.openCount,
      total: mine.length, byStatus, interested: mine.filter((l) => l.status === 'Interested').map((l) => l.company),
      teamTotal: (await leadsOf(people.lead, 'all')).length, leadTotal: (await leadsOf(people.lead, 'me')).length,
      won: myDeals.bids.filter((b) => b.status === 'WON').map((b) => ({ company: b.company, awarded: b.awardedPrice ?? 0 })),
      deals: deals.summary, notSubmitted: missing.total, myDials: await own(people.member, 'callsDialed'), myLeadsGenerated: await own(people.leadgen, 'leadsGenerated'),
    }
  })
  if (flag('--truth')) { console.log(JSON.stringify(truth.x, null, 1)); await flagsBack(); server.close(); await prisma.$disconnect(); process.exit(0) }
  console.log(`Model: ${llmModel()} at ${llmBase().replace(/^https?:\/\//, '')}. The agent has ${truth.total.toLocaleString('en-US')} leads; the team ${truth.teamTotal.toLocaleString('en-US')}.\n`)

  const only = opt('--only')?.split(',').map(Number)
  const digits = (s: string) => s.replace(/(\d)[,   ](?=\d{3}\b)/g, '$1')
  const hasNumber = (text: string, n: number) => new RegExp(`(^|[^\\d.])${n}(\\.0+)?(?![\\d])`).test(digits(text))
  // The model writes special spaces and hyphens ("Quartz Valley Hospital" with narrow spaces): compare plain text.
  const plain = (t: string) => Array.from(t).map((ch) => ('    '.includes(ch) ? ' ' : '‐‑‒–—'.includes(ch) ? '-' : ch)).join('')
  // A true zero is often said in words ("you haven't generated any leads yet").
  const NONE = /\b(no|none|zero|any|nothing)\b|haven|n['’]t/i
  let failed = 0, asked = 0
  const unasked: number[] = []
  // Questions real people asked and marked not helpful (Company settings > Metra > "Copy as test questions", saved to a
  // file): asked as someone of that team. There is no known right answer for them, so they pass when Metra reads
  // without a failed lookup, does not give up, and every number it says has a source.
  const extra: Case[] = []
  if (opt('--extra')) {
    const fs = await import('node:fs')
    const rows = JSON.parse(fs.readFileSync(opt('--extra')!, 'utf8')) as { ask?: string; team?: string | null; as?: string }[]
    const role = (t: string): Case['as'] => (/commerce/i.test(t) ? 'ecom' : /inventory/i.test(t) ? 'inv' : /marketing/i.test(t) ? 'marketing' : /lead\s*gen/i.test(t) ? 'leadgen' : /qa|quality/i.test(t) ? 'qa' : /admin/i.test(t) ? 'admin' : 'member')
    for (const r of rows) if (r.ask?.trim()) extra.push({ as: (r.as as Case['as']) && r.as! in people ? (r.as as Case['as']) : role(r.team ?? ''), ask: r.ask.trim(), note: `from the problem log${r.team ? ` (${r.team})` : ''}` })
    console.log(`${extra.length} questions from ${opt('--extra')} are asked after the built-in ones.
`)
  }
  for (const [i, c] of [...CASES, ...extra].entries()) {
    if (only && !only.includes(i + 1)) continue
    asked++
    const who = people[c.as]
    const t0 = Date.now()
    let text = '', problems: string[] = [], tools = '', tokens = 0, calls = 0
    // A test key allows few tokens a minute: when the model is busy the question waits for the next minute and is
    // asked again (up to five times), so a rate limit is never counted as a wrong answer.
    for (let attempt = 0; attempt < 5; attempt++) {
    problems = []
    try {
      const r = await runAsCompany(HOME_COMPANY_ID, async () => answer(await askerOf(who.id), c.history ?? [], c.ask, () => undefined, undefined, { memories: [], summary: null, page: c.page ?? null }))
      text = plain(r.content)
      tokens = r.tokensIn + r.tokensOut
      calls = r.tools.length
      tools = r.tools.map((x) => `${x.name}${x.ok ? '' : ' (FAILED: ' + (x.error ?? '').slice(0, 80) + ')'} ${JSON.stringify(x.args)}`).join(' ; ')
      for (const n of c.numbers?.(truth) ?? []) if (!hasNumber(text, n) && !(n === 0 && NONE.test(text))) problems.push(`the number ${n.toLocaleString('en-US')} is missing`)
      for (const n of c.names?.(truth) ?? []) if (!text.toLowerCase().includes(n.toLowerCase())) problems.push(`"${n}" is missing`)
      for (const n of c.absent ?? []) if (text.toLowerCase().includes(n.toLowerCase())) problems.push(`"${n}" is in the answer and must not be`)
      if (GAVE_UP.test(text)) problems.push('it says it could not find or read something')
      if (r.tools.some((x) => !x.ok)) problems.push('a lookup failed')
      if (!text.trim()) problems.push('empty answer')
    } catch (e) { problems = [`error: ${(e as Error).message.slice(0, 200)}`] }
    if (!problems.some((p) => /rate limit|model is busy/i.test(p))) break
    if (attempt < 4) await new Promise((r) => setTimeout(r, 62_000))
    }
    const ok = problems.length === 0
    // Still busy after five tries: the question was never answered. That is not a wrong answer, and not a pass either.
    const busy = !ok && problems.every((p) => /rate limit|model is busy/i.test(p))
    if (busy) unasked.push(i + 1); else if (!ok) failed++
    console.log(`${ok ? 'PASS' : busy ? 'BUSY' : 'FAIL'}  ${String(i + 1).padStart(2)}. [${c.as}] ${c.ask}   (${c.note}; ${((Date.now() - t0) / 1000).toFixed(1)} s${tokens ? `, ${calls} lookup${calls === 1 ? '' : 's'}, ${tokens.toLocaleString('en-US')} tokens` : ''})`)
    if (!ok || flag('--show')) console.log(`      ${problems.join('; ') || 'ok'}\n      lookups: ${tools || 'none'}\n      answer: ${text.replace(/\s+/g, ' ').slice(0, 600)}\n`)
  }
  const passed = asked - failed - unasked.length
  console.log(`\n${passed} of ${asked} passed${failed ? `, ${failed} failed` : ''}${unasked.length ? `, ${unasked.length} could not be asked because the model was busy (ask them again: --only ${unasked.join(',')})` : ''}.${failed || unasked.length ? ' NOT ready to go live.' : ' Ready.'}`)
  await flagsBack()
  server.close()
  await prisma.$disconnect()
  process.exit(failed || unasked.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
