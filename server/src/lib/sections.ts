import type { DepartmentType } from '@prisma/client'

/**
 * Department sections (Phase 2): the screens a kind of department comes with, which the company's
 * Super Admin turns on or off for that department in Company Settings.
 *
 * Rules (the same in the app and on the server):
 * - A department has one kind, chosen when it is made (General, Sales calling, Lead Generation,
 *   Marketing, E-commerce, Inventory, Customer service). The kind does not change later: a team
 *   that works differently gets a new department, and its people move over.
 * - General departments can be as many as needed; each other kind once per company (its screens
 *   are shared by that one team).
 * - Every section of the kind starts on. Turning one off hides its screens and stops new entries
 *   in it; nothing is deleted, and turning it back on brings everything back as it was.
 * - Team views and analytics are always there (they only read).
 * - A department is removed only when nobody is in it and it holds no records.
 * - Only people with the "Company settings" power (the Super Admin) change any of this.
 *
 * The app has a copy of the app paths (client/src/lib/sections.ts); a test checks they match.
 */

export interface Section {
  key: string
  kind: DepartmentType
  label: string
  description: string
  /** Screens (longest prefix wins). */
  app: string[]
  /** API addresses that save to this section: refused (writes only) while the section is off. */
  api: string[]
}

export const SECTIONS: Section[] = [
  // Sales calling (ITAD)
  { key: 'itad-log', kind: 'ITAD', label: 'Daily calls log', description: 'Each rep logs dials, connects, voicemails and deals every day.', app: ['/app/itad/log'], api: ['/api/itad/entries'] },
  { key: 'itad-dialer', kind: 'ITAD', label: 'Lead Dialer', description: 'Who to call now by US time zone, follow-ups and the funnel, from your CRM export.', app: ['/app/itad/dialer'], api: ['/api/dialer'] },
  { key: 'itad-bids', kind: 'ITAD', label: 'Deal tracker', description: 'Bids and deals with their value and stage.', app: ['/app/itad/bids'], api: ['/api/itad/bids'] },
  { key: 'itad-docs', kind: 'ITAD', label: 'Docs & links', description: 'Price lists, scripts and documents the team shares.', app: ['/app/itad/docs'], api: ['/api/docs'] },
  // Lead Generation
  { key: 'leadgen-log', kind: 'LEAD_GEN', label: 'Daily leads log', description: 'Leads found each day by industry, MQL and SQL.', app: ['/app/leadgen/log'], api: ['/api/leadgen/entries', '/api/leadgen/verticals'] },
  { key: 'leadgen-breakdown', kind: 'LEAD_GEN', label: 'Monthly breakdown', description: 'Leads per category for each month.', app: ['/app/leadgen/breakdown'], api: ['/api/leadgen/breakdown'] },
  // Marketing
  { key: 'mkt-social', kind: 'MARKETING', label: 'Social media', description: 'Planner, monthly social reports and social analytics.', app: ['/app/marketing/planner', '/app/marketing/social'], api: ['/api/marketing/social'] },
  { key: 'mkt-content', kind: 'MARKETING', label: 'Content', description: 'Master plan, content daily log, blogs and the content board.', app: ['/app/marketing/plan', '/app/marketing/content', '/app/marketing/blogs'], api: ['/api/marketing/plan', '/api/marketing/content', '/api/marketing/blogs'] },
  { key: 'mkt-seo', kind: 'MARKETING', label: 'SEO', description: 'SEO daily log and search terms.', app: ['/app/marketing/seo'], api: ['/api/marketing/seo', '/api/marketing/search-terms'] },
  { key: 'mkt-ads', kind: 'MARKETING', label: 'Ads campaigns', description: 'Paid campaigns, spend and results.', app: ['/app/marketing/ads'], api: ['/api/marketing/ads'] },
  { key: 'mkt-email', kind: 'MARKETING', label: 'Email marketing', description: 'Email campaigns and their numbers.', app: ['/app/marketing/email'], api: ['/api/marketing/email'] },
  { key: 'mkt-brands', kind: 'MARKETING', label: 'Brands & profiles', description: 'Your brands, their social profiles and business suites.', app: ['/app/marketing/brands', '/app/marketing/profiles'], api: ['/api/marketing/brands', '/api/marketing/profiles', '/api/marketing/business-suites'] },
  // E-commerce
  { key: 'ecom-log', kind: 'ECOMMERCE', label: 'Daily log', description: 'Listings and orders each person handled today.', app: ['/app/ecommerce/log'], api: ['/api/ecommerce/entries'] },
  { key: 'ecom-board', kind: 'ECOMMERCE', label: 'Task board', description: 'Listing and store tasks on a board.', app: ['/app/ecommerce/board'], api: ['/api/ecommerce/tasks', '/api/ecommerce/board'] },
  { key: 'ecom-stock', kind: 'ECOMMERCE', label: 'Stock tracking', description: 'Stock problems to fix, with who has them.', app: ['/app/ecommerce/stock'], api: ['/api/ecommerce/stock'] },
  { key: 'ecom-notes', kind: 'ECOMMERCE', label: 'Meeting notes', description: 'Notes and decisions from team meetings.', app: ['/app/ecommerce/notes'], api: ['/api/ecommerce/meeting-notes'] },
  { key: 'ecom-rdp', kind: 'ECOMMERCE', label: 'Remote desktops', description: 'Which remote desktop each person uses.', app: ['/app/ecommerce/rdp'], api: ['/api/rdp'] },
  // Inventory
  { key: 'inv-items', kind: 'INVENTORY', label: 'Stock list', description: 'Every item, where it is and how many.', app: ['/app/inventory$'], api: ['/api/inventory/items'] },
  { key: 'inv-requests', kind: 'INVENTORY', label: 'Requests', description: 'People ask for items; the team hands them out.', app: ['/app/inventory/requests'], api: ['/api/inventory/movements', '/api/inventory/requests'] },
]
export const SECTION_KEYS = SECTIONS.map((s) => s.key)

/** What each kind of department is for, and its sections. */
export const KIND_INFO: Record<DepartmentType, { label: string; description: string }> = {
  GENERAL: { label: 'General', description: 'Shared tools: attendance, projects, chat, to-dos and the daily report you design. Make as many as you need.' },
  ITAD: { label: 'Sales calling', description: 'For teams that call leads: daily calls log, Lead Dialer, deals and documents.' },
  LEAD_GEN: { label: 'Lead Generation', description: 'For teams that find leads: daily leads by industry and the lead funnel.' },
  MARKETING: { label: 'Marketing', description: 'Social media, content, SEO, ads and email, by brand.' },
  ECOMMERCE: { label: 'E-commerce', description: 'Online store teams: daily log, task board, stock and notes.' },
  INVENTORY: { label: 'Inventory', description: 'Stock, requests and who has what.' },
  CSR: { label: 'Customer service', description: 'Support teams, scored by Quality Assurance.' },
  TALKLOOP: { label: 'Talkloop', description: 'Retired.' },
}

/** The section an address belongs to (the longest match wins), or null. */
export function sectionOf(path: string, where: 'api' | 'app'): Section | null {
  const p = path.split('?')[0].replace(/\/+$/, '')
  let best: { s: Section; len: number } | null = null
  for (const s of SECTIONS) for (const prefix of s[where]) {
    // "/app/inventory$" is that one screen only (not the screens under it).
    const exact = prefix.endsWith('$')
    const hit = exact ? p === prefix.slice(0, -1) : p === prefix || p.startsWith(prefix + '/')
    if (hit && (!best || prefix.length > best.len)) best = { s, len: prefix.length }
  }
  return best?.s ?? null
}

export const sectionsOfKind = (kind: DepartmentType) => SECTIONS.filter((s) => s.kind === kind)

/** A good guess at the kind from the name someone typed ("Lead generation" → Lead Generation). */
export function kindFromName(name: string): DepartmentType {
  const n = name.toLowerCase()
  if (/lead\s*gen|prospect|research/.test(n)) return 'LEAD_GEN'
  if (/market|seo|social|content|brand/.test(n)) return 'MARKETING'
  if (/e-?commerce|online store|amazon|ebay|shopify|listing/.test(n)) return 'ECOMMERCE'
  if (/inventory|warehouse|stock|store ?room/.test(n)) return 'INVENTORY'
  if (/itad|sales call|outbound|telesales|calling|business development|bdr|sdr/.test(n)) return 'ITAD'
  if (/customer (service|support|care)|support|csr|help ?desk/.test(n)) return 'CSR'
  return 'GENERAL'
}
