import type { DialerLead, NoteExportRow } from '../../../../lib/dialerApi'
import { REGION_META, lastActivity, leadRegion, leadState } from '../../../../lib/dialer'
import { downloadXlsx } from '../../../../lib/xlsx'

/** Downloads for the Lead Dialer: Excel (.xlsx) and CSV. */

export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  // The byte-order mark makes Excel read the file as UTF-8 (names with accents, dashes in notes).
  const csv = '﻿' + [head.map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export function downloadNotes(name: string, notes: NoteExportRow[]) {
  downloadCsv(name, ['Written', 'Author', 'Rep (lead owner)', 'Company', 'Contact', 'Phone', 'CRM lead ID', 'Status', 'Note', 'Pinned', 'Edited', 'Next action'],
    notes.map((n) => [when(n.createdAt), n.author, n.rep, n.company, n.contactName, n.phone, n.crmId, n.status, n.text, n.pinned ? 'Yes' : '', n.editedAt ? when(n.editedAt) : '', when(n.nextActionAt)]))
}

/** The phone as plain digits for a dialer upload: "309-662-7723" → "3096627723"; a leading US 1 on 11 digits is dropped. */
export function dialDigits(phone: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

/** One row per lead, phone first, ready to upload to the predictive dialer. */
export function leadSheet(leads: DialerLead[], now: Date, showOwner: boolean): { head: string[]; rows: (string | number | null)[][] } {
  const head = ['Phone (digits)', 'Phone', 'Company', 'Contact', 'Email', 'City', 'State', 'Region', 'Time zone', 'Status', 'Industry', 'List', 'Second phone', 'Second email', 'Decision maker', 'Best time', 'LinkedIn', 'Website', 'Tags', 'CRM lead ID', 'Last activity', ...(showOwner ? ['Rep'] : [])]
  const rows = leads.map((l) => {
    const r = leadRegion(l, now)
    return [dialDigits(l.phone), l.phone, l.company, l.contactName, l.email, l.city, leadState(l), r, r ? REGION_META[r].name : null, l.status, l.industry, l.listName, l.phone2, l.email2, l.decisionMaker, l.bestTime, l.linkedin, l.website, l.tags.join(', '), l.externalId, lastActivity(l).slice(0, 10), ...(showOwner ? [l.ownerName] : [])]
  })
  return { head, rows }
}

/** A file name from the list's title: "Central: leads to dial" → "central-leads-to-dial-2026-10-27". */
export function fileBase(title: string, now = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'leads'
  return `${slug}-${now.toISOString().slice(0, 10)}`
}

export function downloadLeads(title: string, leads: DialerLead[], now: Date, showOwner: boolean, format: 'xlsx' | 'csv'): void {
  const { head, rows } = leadSheet(leads, now, showOwner)
  if (format === 'xlsx') downloadXlsx(`${fileBase(title, now)}.xlsx`, 'Leads', head, rows)
  else downloadCsv(`${fileBase(title, now)}.csv`, head, rows)
}
