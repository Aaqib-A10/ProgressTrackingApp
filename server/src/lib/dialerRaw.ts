import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Contact name, website and industry from a CRM export row, whatever the CRM calls the columns.
 *
 * The Lead Dialer import only knew a single "Contact name" column and a few website headers,
 * so an export with "First Name" + "Last Name" (or "Website URL", "Web Address"...) came in
 * with no name and no website, and the downloads for the predictive dialer had them empty.
 * Every lead keeps its whole original row (`raw`), so the missing values can be found there.
 */

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

const FULL = ['contactname', 'fullname', 'name', 'leadname', 'contactperson', 'contact', 'primarycontact', 'contactfullname', 'personname', 'person', 'prospectname', 'prospect', 'customername', 'clientname', 'pointofcontact', 'poc']
const FIRST = ['firstname', 'first', 'fname', 'givenname', 'contactfirstname', 'leadfirstname', 'forename']
const LAST = ['lastname', 'last', 'lname', 'surname', 'familyname', 'contactlastname', 'leadlastname']
const INDUSTRY = ['industry', 'industrytype', 'industryname', 'companyindustry', 'primaryindustry', 'accountindustry', 'leadindustry', 'vertical', 'verticalmarket', 'market', 'sector', 'businesstype', 'typeofbusiness', 'businesscategory', 'category', 'sicdescription', 'sic', 'naicsdescription', 'naics', 'industrydescription', 'subindustry']
const WEB = ['website', 'websiteurl', 'web', 'webaddress', 'websiteaddress', 'webpage', 'webpageurl', 'url', 'companywebsite', 'companywebsiteurl', 'companyurl', 'companysite', 'domain', 'companydomain', 'homepage', 'site', 'accountwebsite', 'businesswebsite']

type Raw = Record<string, unknown>

const text = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/** The first value under any of these header names (in that order of preference). */
function pick(raw: Raw, names: string[], ok: (v: string) => boolean): string | null {
  const byName = new Map<string, unknown>()
  for (const [h, v] of Object.entries(raw)) { const k = norm(h); if (!byName.has(k)) byName.set(k, v) }
  for (const n of names) {
    const v = text(byName.get(n))
    if (v && ok(v)) return v
  }
  return null
}

const looksLikeName = (v: string) => /[a-z]/i.test(v) && !/@/.test(v) && !/^https?:\/\//i.test(v) && v.length <= 120
const looksLikeSite = (v: string) => !/@/.test(v) && !/\s/.test(v) && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v)

/** "First Last" from the row: a full-name column, or first + last name columns. Never the company name. */
export function contactNameFromRaw(raw: Raw | null | undefined, company?: string | null): string | null {
  if (!raw) return null
  const notCompany = (v: string) => looksLikeName(v) && (!company || v.toLowerCase() !== company.toLowerCase())
  const first = pick(raw, FIRST, looksLikeName)
  const last = pick(raw, LAST, looksLikeName)
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return pick(raw, FULL, notCompany)
}

/** ITAD, Oct 2026: "Industry is not showing when we open a lead" — the export called it something else. */
export function industryFromRaw(raw: Raw | null | undefined): string | null {
  if (!raw) return null
  return pick(raw, INDUSTRY, (v) => /[a-z]/i.test(v) && v.length <= 120 && !/@/.test(v) && !/^https?:\/\//i.test(v))
}

export function websiteFromRaw(raw: Raw | null | undefined): string | null {
  if (!raw) return null
  return pick(raw, WEB, looksLikeSite)
}

/**
 * The name to keep: the mapped "Contact name" column, completed with the last name when the
 * mapped column was only the first name; otherwise whatever the row holds.
 */
export function contactNameFor(mapped: string | null, mappedHeader: string | null, raw: Raw, company: string | null): string | null {
  if (mapped) {
    if (mappedHeader && FIRST.includes(norm(mappedHeader))) {
      const last = pick(raw, LAST, looksLikeName)
      return last && !mapped.toLowerCase().endsWith(last.toLowerCase()) ? `${mapped} ${last}` : mapped
    }
    return mapped
  }
  return contactNameFromRaw(raw, company)
}

/**
 * Fill the contact name, website and industry of leads imported before this fix, from the row they came
 * with. Runs once at start; only empty fields are filled, nothing typed by a rep is changed.
 */
export async function fillContactsFromRaw(): Promise<number> {
  let filled = 0
  let cursor: string | undefined
  for (;;) {
    const batch = await prisma.dialerLead.findMany({
      where: { OR: [{ contactName: null }, { website: null }, { industry: null }], raw: { not: Prisma.DbNull } },
      select: { id: true, company: true, contactName: true, website: true, industry: true, raw: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (!batch.length) break
    cursor = batch.at(-1)!.id
    const ups = []
    for (const l of batch) {
      const raw = (l.raw && typeof l.raw === 'object' && !Array.isArray(l.raw) ? l.raw : null) as Raw | null
      const contactName = l.contactName ?? contactNameFromRaw(raw, l.company)
      const website = l.website ?? websiteFromRaw(raw)
      const industry = l.industry ?? industryFromRaw(raw)
      if (contactName !== l.contactName || website !== l.website || industry !== l.industry) {
        ups.push(prisma.dialerLead.update({ where: { id: l.id }, data: { contactName, website, industry } }))
      }
    }
    if (ups.length) { await prisma.$transaction(ups); filled += ups.length }
    if (batch.length < 500) break
  }
  return filled
}

// ITAD spec (30 Oct 2026): the all-leads list can show the contact's title and the CRM's "Assigned To".
const TITLE = ['title', 'jobtitle', 'contacttitle', 'designation', 'position', 'role', 'jobrole', 'leadtitle']
const ASSIGNED = ['assignedto', 'assigned', 'leadowner', 'owner', 'ownername', 'assignee', 'salesrep', 'rep', 'accountowner']

export function titleFromRaw(raw: Raw | null | undefined): string | null {
  if (!raw) return null
  return pick(raw, TITLE, (v) => /[a-z]/i.test(v) && v.length <= 120 && !/@/.test(v))
}

export function assignedToFromRaw(raw: Raw | null | undefined): string | null {
  if (!raw) return null
  return pick(raw, ASSIGNED, (v) => /[a-z]/i.test(v) && v.length <= 120 && !/@/.test(v))
}
