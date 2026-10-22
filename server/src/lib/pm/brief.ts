import { DateTime } from 'luxon'

/**
 * A ticket as plain text, ready for Claude: what to do, where the work lives, the checklist,
 * the files and the whole conversation. Used by "Copy for Claude" on a ticket and by the
 * Metriq connector, so both give Claude exactly the same brief.
 */

export interface BriefTask {
  code: string
  title: string
  status: string
  category: string
  priority: string
  startAt: string | null
  dueAt: string | null
  isOverdue: boolean
  createdBy: { name: string }
  assignees: { name: string }[]
  labels: { name: string }[]
  projectKey: string
  projectName: string
  description: string | null
  checklist: { id: string; text: string; isDone: boolean }[]
  comments: { author: { name: string }; body: string; createdAt: string }[]
  reviews: { verdict: string; rating: number | null; body: string; reviewer: { name: string }; createdAt: string }[]
  attachments: { id: string; originalName: string; mimeType: string; size: number }[]
}

const ZONE = () => process.env.APP_TIMEZONE || 'Asia/Karachi'
export const fmtWhen = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(ZONE()).toFormat("ccc, LLL d, yyyy, h:mm a 'PKT'") : null)
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const VERDICT: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', COMMENT: 'Comment' }

export function ticketBrief(t: BriefTask, opts: { workFolder: string | null; appUrl: string; forConnector?: boolean }): string {
  const out: string[] = []
  out.push(`Metriq ticket ${t.code}: ${t.title}`)
  out.push('')
  out.push(`Project: ${t.projectName} (${t.projectKey})`)
  out.push(`Status: ${t.status}  |  Priority: ${t.priority.charAt(0) + t.priority.slice(1).toLowerCase()}${t.dueAt ? `  |  Due: ${fmtWhen(t.dueAt)}${t.isOverdue ? ' (overdue)' : ''}` : ''}`)
  out.push(`Created by: ${t.createdBy.name}  |  Assigned to: ${t.assignees.map((a) => a.name).join(', ') || 'nobody yet'}`)
  if (t.labels.length) out.push(`Labels: ${t.labels.map((l) => l.name).join(', ')}`)
  out.push(`Where the work lives: ${opts.workFolder?.trim() || 'not set for this project (ask, or set it in Project settings)'}`)
  out.push(`Link: ${opts.appUrl}/app/projects/${encodeURIComponent(t.projectKey)}?task=${encodeURIComponent(t.code)}`)
  out.push('', 'What to do:', t.description?.trim() || '(no description; the title is the brief)')
  if (t.checklist.length) {
    out.push('', `Checklist (${t.checklist.filter((c) => c.isDone).length} of ${t.checklist.length} done):`)
    for (const c of t.checklist) out.push(`[${c.isDone ? 'x' : ' '}] ${c.text}`)
  }
  if (t.attachments.length) {
    out.push('', 'Files on the ticket:')
    for (const a of t.attachments) out.push(`- ${a.originalName} (${a.mimeType}, ${kb(a.size)})${opts.forConnector ? `  attachment_id: ${a.id}` : ''}`)
    if (!opts.forConnector) out.push('(open the ticket link to download them)')
  }
  if (t.reviews.length) {
    out.push('', 'Reviews (newest first):')
    for (const r of t.reviews) out.push(`- ${r.reviewer.name}, ${fmtWhen(r.createdAt)}: ${VERDICT[r.verdict] ?? r.verdict}${r.rating ? `, ${r.rating}/5` : ''}. ${r.body}`)
  }
  if (t.comments.length) {
    out.push('', 'Comments (oldest first):')
    for (const c of t.comments) out.push(`- ${c.author.name}, ${fmtWhen(c.createdAt)}:`, ...c.body.split(/\r?\n/).map((l) => `    ${l}`))
  }
  return out.join('\n')
}
