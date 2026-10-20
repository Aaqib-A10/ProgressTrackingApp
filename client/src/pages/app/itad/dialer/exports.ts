import type { NoteExportRow } from '../../../../lib/dialerApi'

/** CSV downloads for the Lead Dialer (they open straight in Excel). */

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
