import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, ListChecks, ShieldCheck, Tag, UserCheck } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { useAuth } from '../../../lib/auth'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, fmtDate, inZone, leadsApi, leadTitle, YES_NO_LABEL, type LeadDetail } from '../../../lib/leadsApi'
import { Avatar, FactsMeter, StatusPill } from './shared'
import { CommentsCard, FactValue } from './LeadPage'

/**
 * One submission, the way Jesse reads it: the ask, everything about the lead in one card (who,
 * how to reach them, the five facts, other contacts, notes) and the chat. His message in the chat is his
 * answer: the lead leaves "waiting", the SDR gets it as a task and carries the lead on. Jesse
 * never sets statuses here; he sees them.
 */
export default function JesseReview() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [d, setD] = useState<LeadDetail | null>(null)
  const [err, setErr] = useState('')
  const [justReplied, setJustReplied] = useState(false)
  const load = useCallback(() => leadsApi.get(id).then((r) => { setD(r); setErr('') }).catch((e) => setErr(apiErrorText(e, 'Lead not found'))), [id])
  useEffect(() => { void load() }, [load])
  // The SDR may answer in the chat while this is open.
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000); return () => window.clearInterval(t) }, [load])

  if (err) return <div className="mx-auto max-w-xl py-16 text-center"><p className="text-body-md text-ink-muted">{err}</p><Link to="/app/leads/inbox" className="mt-3 inline-block text-primary">Back to the inbox</Link></div>
  if (!d || !user) return <div className="h-64 animate-pulse rounded-card border border-line bg-card" />
  const { lead: l, pipeline } = d
  const title = leadTitle(l)
  const from = l.assignee?.name ?? 'the team'
  const waiting = !!l.jesseInputNeeded
  const openTasks = l.tasks?.filter((t) => !t.doneAt) ?? []

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-4">
      <Link to="/app/leads/inbox" className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} />Inbox</Link>

      <div className={cn('rounded-card border bg-card p-4 shadow-xs sm:p-5', waiting ? 'border-orange-200 dark:border-orange-500/30' : 'border-line')}>
        <div className="flex flex-wrap items-start gap-3">
          <Avatar name={title} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-headline-lg text-ink">{title}</h1>
              <StatusPill status={l.status} pipeline={pipeline} label={l.statusLabel} />
              {waiting ? <Badge tone="warning" dot>Waiting for you{l.waitingDays != null ? ` · ${l.waitingDays} business day${l.waitingDays === 1 ? '' : 's'}` : ''}</Badge> : l.jesseDecidedAt ? <Badge tone="success">You answered {ago(l.jesseDecidedAt)}</Badge> : null}
              {l.belowMin && <Badge tone="accent">Below minimum</Badge>}
            </div>
            <p className="mt-1 text-body-sm text-ink-muted">Submitted by <b className="text-ink">{from}</b>{l.flaggedAt ? ` ${ago(l.flaggedAt)}` : ''}</p>
          </div>
        </div>
        {l.jesseAsk && (
          <div className="mt-3 rounded-card border border-orange-200 bg-orange-50/60 px-3.5 py-2.5 dark:border-orange-500/30 dark:bg-orange-500/10">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">What {from} needs from you</p>
            <p className="mt-0.5 text-body-md text-ink">{l.jesseAsk}</p>
          </div>
        )}
        {l.meetingSlots?.length ? <p className="mt-2 text-body-sm text-ink-muted"><Clock size={12} className="mr-1 inline" />Slots the prospect offered (Phoenix): {l.meetingSlots.map((s) => inZone(s, 'America/Phoenix')).join(' · ')}</p> : null}
        {justReplied && <p className="mt-3 inline-flex items-center gap-1.5 rounded-btn bg-success/10 px-3 py-1.5 text-body-sm font-medium text-success"><CheckCircle2 size={14} /> Sent to {from}. It is their task now; this lead moved to “Answered”.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* The chat first: that is Jesse's one job here. */}
        <div className="space-y-4 lg:order-2 lg:col-span-2">
          <div className="rounded-card border border-primary/30 bg-primary/[0.04] px-3.5 py-2.5 text-body-sm text-ink">
            {waiting
              ? <>Write your answer below — a go-ahead, a price, freight, a meeting time, or a no. <b>{from}</b> gets it as a task and handles the rest; you don’t need to set anything else.</>
              : <>Anything more for <b>{from}</b> goes here too. Statuses and follow-ups stay with them; you see the progress below.</>}
          </div>
          <CommentsCard d={d} meId={user.id} onPosted={() => { if (waiting) setJustReplied(true); void load() }} />
          <div className="rounded-card border border-line bg-card p-4 shadow-xs">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><ListChecks size={15} className="text-ink-faint" />Where {from} has it</h3>
            <dl className="mt-2 space-y-1.5 text-body-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Status</dt><dd><StatusPill status={l.status} pipeline={pipeline} label={l.statusLabel} size="sm" /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Next step</dt><dd className="text-right text-ink">{l.nextStep ?? '—'}{l.nextStepDate ? <span className={cn('ml-1', l.overdue ? 'font-semibold text-danger' : 'text-ink-muted')}>· {fmtDate(l.nextStepDate)}</span> : null}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Open tasks</dt><dd className="text-ink">{openTasks.length ? openTasks.map((t) => t.title).join(' · ') : 'none'}</dd></div>
              {l.meetingAt && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Meeting</dt><dd className="text-right text-ink">{inZone(l.meetingAt, 'America/Phoenix')} (Phoenix){l.inviteSentAt ? ' · invite sent' : ''}</dd></div>}
              {l.meetingOutcome && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Outcome</dt><dd className="text-right text-ink">{l.meetingOutcome}</dd></div>}
              {!l.open && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Closed</dt><dd className="text-right text-ink">{l.statusLabel}{l.lostReason ? ` · ${l.lostReason.toLowerCase().replace(/_/g, ' ')}` : ''}{l.lostNote ? ` · ${l.lostNote}` : ''}</dd></div>}
            </dl>
          </div>
        </div>
        {/* Everything about the lead, in one place. */}
        <div className="lg:order-1 lg:col-span-3">
          <LeadDetailsAll d={d} />
        </div>
      </div>
    </div>
  )
}

/** The lead in one card for Jesse: who and how to reach them, the five facts, other contacts and notes. */
function LeadDetailsAll({ d }: { d: LeadDetail }) {
  const { lead: l, settings } = d
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (v ? <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-1.5 text-body-sm"><dt className="text-ink-muted">{k}</dt><dd className="min-w-0 break-words text-ink">{v}</dd></div> : null)
  const Head = ({ icon, first, children }: { icon: React.ReactNode; first?: boolean; children: React.ReactNode }) => <h3 className={cn('mb-1 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-muted', !first && 'mt-4 border-t border-line pt-3')}><span className="text-ink-faint">{icon}</span>{children}</h3>
  const site = l.website ? <a href={/^https?:/.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{l.website}</a> : null
  const place = [l.city, l.state].filter(Boolean).join(', ')
  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-xs sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink"><Tag size={15} className="text-ink-faint" />Lead details</h2>
      <Head icon={<UserCheck size={14} />} first>Company and contact</Head>
      <dl>
        <Row k="Company" v={l.organization} />
        <Row k="Contact" v={l.name ? `${l.name}${l.contactRole ? `, ${l.contactRole}` : l.jobTitle ? `, ${l.jobTitle}` : ''}` : null} />
        <Row k="Phone" v={l.phone ? `${l.phone}${l.ext ? ` x${l.ext}` : ''}` : null} />
        <Row k="Mobile" v={l.mobile} />
        <Row k="Email" v={l.email} />
        <Row k="Second email" v={l.secondaryEmail} />
        <Row k="Second contact" v={l.secondaryContact} />
        <Row k="Website" v={site} />
        <Row k={d.can.cmr ? 'Segment' : 'Industry'} v={l.industry} />
        <Row k="Location" v={place || null} />
        <Row k="Employees" v={l.employees} />
        {d.can.cmr && <Row k="Decision maker" v={l.decisionMaker && l.decisionMaker !== 'UNKNOWN' ? YES_NO_LABEL[l.decisionMaker] : null} />}
        <Row k="Tags" v={l.tags.length ? l.tags.join(', ') : null} />
      </dl>
      {d.can.cmr && l.facts.length > 0 && (
        <>
          <Head icon={<ShieldCheck size={14} />}>The five facts <FactsMeter facts={l.facts} size="sm" /></Head>
          <dl>
            {l.facts.map((f) => (
              <div key={f.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-1.5 text-body-sm">
                <dt className="flex items-start gap-1.5 text-ink-muted">{f.done ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line-strong" />}{f.label}</dt>
                <dd className={cn('min-w-0 break-words', f.done ? 'text-ink' : 'text-ink-faint')}><FactValue fact={f} l={l} settings={settings} /></dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {l.contacts.length > 0 && (
        <>
          <Head icon={<UserCheck size={14} />}>Other contacts</Head>
          <ul className="space-y-1.5">
            {l.contacts.map((c) => <li key={c.id} className="text-body-sm text-ink"><b>{c.name}</b>{c.role ? `, ${c.role}` : ''}{c.decisionMaker ? ' · decision maker' : ''}<span className="text-ink-muted">{[c.phone, c.mobile, c.email].filter(Boolean).length ? ` · ${[c.phone, c.mobile, c.email].filter(Boolean).join(' · ')}` : ''}</span>{c.notes ? <span className="block text-ink-muted">{c.notes}</span> : null}</li>)}
          </ul>
        </>
      )}
      {(l.message || l.productInfo) && (
        <>
          <Head icon={<Tag size={14} />}>Notes</Head>
          {l.message && <p className="whitespace-pre-wrap text-body-sm text-ink">{l.message}</p>}
          {l.productInfo && <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{l.productInfo}</p>}
        </>
      )}
    </section>
  )
}
