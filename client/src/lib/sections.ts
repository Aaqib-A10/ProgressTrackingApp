import type { Department } from './types'

/**
 * Department sections (Phase 2): the screens a kind of department comes with. The company's
 * Super Admin turns them on or off per department in Company Settings; a section that is off is
 * left out of the menu and its pages, and the server takes no new entries for it (nothing is
 * deleted). The same list as the server's lib/sections.ts (a test checks they match); here only
 * the screens. The longest match wins.
 */

export interface Section { key: string; kind: Department; label: string; description: string; app: string[] }

export const SECTIONS: Section[] = [
  { key: 'itad-log', kind: 'ITAD', label: 'Daily calls log', description: 'Each rep logs dials, connects, voicemails and deals every day.', app: ['/app/itad/log'] },
  { key: 'itad-dialer', kind: 'ITAD', label: 'Lead Dialer', description: 'Who to call now by US time zone, follow-ups and the funnel, from your CRM export.', app: ['/app/itad/dialer'] },
  { key: 'itad-bids', kind: 'ITAD', label: 'Deal tracker', description: 'Bids and deals with their value and stage.', app: ['/app/itad/bids'] },
  { key: 'itad-docs', kind: 'ITAD', label: 'Docs & links', description: 'Price lists, scripts and documents the team shares.', app: ['/app/itad/docs'] },
  { key: 'leadgen-log', kind: 'LEAD_GEN', label: 'Daily leads log', description: 'Leads found each day by industry, MQL and SQL.', app: ['/app/leadgen/log'] },
  { key: 'leadgen-breakdown', kind: 'LEAD_GEN', label: 'Monthly breakdown', description: 'Leads per category for each month.', app: ['/app/leadgen/breakdown'] },
  { key: 'mkt-social', kind: 'MARKETING', label: 'Social media', description: 'Planner, monthly social reports and social analytics.', app: ['/app/marketing/planner', '/app/marketing/social'] },
  { key: 'mkt-content', kind: 'MARKETING', label: 'Content', description: 'Master plan, content daily log, blogs and the content board.', app: ['/app/marketing/plan', '/app/marketing/content', '/app/marketing/blogs'] },
  { key: 'mkt-seo', kind: 'MARKETING', label: 'SEO', description: 'SEO daily log and search terms.', app: ['/app/marketing/seo'] },
  { key: 'mkt-ads', kind: 'MARKETING', label: 'Ads campaigns', description: 'Paid campaigns, spend and results.', app: ['/app/marketing/ads'] },
  { key: 'mkt-email', kind: 'MARKETING', label: 'Email marketing', description: 'Email campaigns and their numbers.', app: ['/app/marketing/email'] },
  { key: 'mkt-brands', kind: 'MARKETING', label: 'Brands & profiles', description: 'Your brands, their social profiles and business suites.', app: ['/app/marketing/brands', '/app/marketing/profiles'] },
  { key: 'ecom-log', kind: 'ECOMMERCE', label: 'Daily log', description: 'Listings and orders each person handled today.', app: ['/app/ecommerce/log'] },
  { key: 'ecom-board', kind: 'ECOMMERCE', label: 'Task board', description: 'Listing and store tasks on a board.', app: ['/app/ecommerce/board'] },
  { key: 'ecom-stock', kind: 'ECOMMERCE', label: 'Stock tracking', description: 'Stock problems to fix, with who has them.', app: ['/app/ecommerce/stock'] },
  { key: 'ecom-notes', kind: 'ECOMMERCE', label: 'Meeting notes', description: 'Notes and decisions from team meetings.', app: ['/app/ecommerce/notes'] },
  { key: 'ecom-rdp', kind: 'ECOMMERCE', label: 'Remote desktops', description: 'Which remote desktop each person uses.', app: ['/app/ecommerce/rdp'] },
  { key: 'inv-items', kind: 'INVENTORY', label: 'Stock list', description: 'Every item, where it is and how many.', app: ['/app/inventory$'] },
  { key: 'inv-requests', kind: 'INVENTORY', label: 'Requests', description: 'People ask for items; the team hands them out.', app: ['/app/inventory/requests'] },
]

export const KIND_INFO: Record<Department, { label: string; description: string }> = {
  GENERAL: { label: 'General', description: 'Shared tools: attendance, projects, chat, to-dos and the daily report you design. Make as many as you need.' },
  ITAD: { label: 'Sales calling', description: 'For teams that call leads: daily calls log, Lead Dialer, deals and documents.' },
  LEAD_GEN: { label: 'Lead Generation', description: 'For teams that find leads: daily leads by industry and the lead funnel.' },
  MARKETING: { label: 'Marketing', description: 'Social media, content, SEO, ads and email, by brand.' },
  ECOMMERCE: { label: 'E-commerce', description: 'Online store teams: daily log, task board, stock and notes.' },
  INVENTORY: { label: 'Inventory', description: 'Stock, requests and who has what.' },
  CSR: { label: 'Customer service', description: 'Support teams, scored by Quality Assurance.' },
  TALKLOOP: { label: 'Talkloop', description: 'Retired.' },
}


export function sectionOfPath(pathname: string): Section | null {
  const p = pathname.split('?')[0].replace(/\/+$/, '')
  let best: { s: Section; len: number } | null = null
  for (const s of SECTIONS) for (const prefix of s.app) {
    // "/app/inventory$" is that one screen only (not the screens under it).
    const exact = prefix.endsWith('$')
    const hit = exact ? p === prefix.slice(0, -1) : p === prefix || p.startsWith(prefix + '/')
    if (hit && (!best || prefix.length > best.len)) best = { s, len: prefix.length }
  }
  return best?.s ?? null
}

/** Is this screen in a section the company turned off? */
export function sectionBlocked(sectionsOff: string[] | undefined, pathname: string): boolean {
  if (!sectionsOff?.length) return false
  const s = sectionOfPath(pathname)
  return !!s && sectionsOff.includes(s.key)
}

/** A good guess at the kind from the name someone typed ("Lead generation" → Lead Generation). */
export function kindFromName(name: string): Department {
  const n = name.toLowerCase()
  if (/lead\s*gen|prospect|research/.test(n)) return 'LEAD_GEN'
  if (/market|seo|social|content|brand/.test(n)) return 'MARKETING'
  if (/e-?commerce|online store|amazon|ebay|shopify|listing/.test(n)) return 'ECOMMERCE'
  if (/inventory|warehouse|stock|store ?room/.test(n)) return 'INVENTORY'
  if (/itad|sales call|outbound|telesales|calling|business development|bdr|sdr/.test(n)) return 'ITAD'
  if (/customer (service|support|care)|support|csr|help ?desk/.test(n)) return 'CSR'
  return 'GENERAL'
}
