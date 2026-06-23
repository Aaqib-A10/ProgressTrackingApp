import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Heart, CheckCircle2, Target, TrendingUp, Users, MessageSquare, ChevronRight } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/StatCard'
import { Button } from '../../components/ui/Button'
import { TextField, TextArea } from '../../components/ui/Input'
import { Badge, SubmissionBadge, PerfFlagBadge, FeedbackSentimentBadge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/DataTable'
import { useRange } from '../../components/layout/AppShell'
import { useToast } from '../../components/ui/Toast'
import { ROLE_LABEL } from '../../lib/types'
import { formatNumber, formatPercent } from '../../lib/format'
import { fromNow } from '../../lib/datetime'
import { ITAD_METRICS } from '../../lib/itadApi'
import { LEADGEN_METRICS } from '../../lib/leadgenApi'
import { getMemberProfile, type MemberProfileResponse, type MemberEntryRow } from '../../lib/membersApi'
import { listMemberFeedback, createFeedback, type FeedbackThread, type Sentiment } from '../../lib/feedbackApi'

const DEPT_LABEL: Record<string, string> = { ITAD: 'ITAD', LEAD_GEN: 'Lead Generation', MARKETING: 'Marketing' }
const RANGE_LABEL: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', rolling3m: 'Last 3 Months', custom: 'Custom Range' }

export default function MemberProfile() {
  const { id = '' } = useParams()
  const { range, custom } = useRange()
  const { addToast } = useToast()
  const [data, setData] = useState<MemberProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getMemberProfile(id, range, custom)
      .then((res) => active && setData(res))
      .catch((e) => {
        if (!active) return
        if (e?.status === 403 || e?.status === 404) setDenied(true)
        else addToast({ type: 'error', message: 'Could not load member.' })
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id, range, custom, addToast])

  if (denied) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card>
          <p className="py-10 text-center text-body-md text-ink-muted">You don’t have access to this member’s profile.</p>
        </Card>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <BackLink />
        <div className="text-body-md text-ink-muted">Loading…</div>
      </div>
    )
  }

  const { user, summary } = data

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackLink />

      {/* Profile header */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-headline-md font-semibold text-primary">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-headline-lg text-ink">{user.name}</h1>
              <SubmissionBadge status={data.today.status} />
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-body-md text-ink-muted">
              <Mail size={14} /> {user.email}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
              {user.department && <Badge tone="accent">{DEPT_LABEL[user.department] ?? user.department}</Badge>}
              {user.subDepartment && <Badge tone="neutral">{user.subDepartment}</Badge>}
              {summary && <PerfFlagBadge flag={summary.flag} />}
            </div>
          </div>
          <div className="text-right">
            <p className="text-label-md uppercase text-ink-muted">Period</p>
            <p className="text-body-md font-medium text-ink">{RANGE_LABEL[range] ?? 'This Month'}</p>
            {summary && <p className="text-body-sm text-ink-muted">{summary.workingDays} working day{summary.workingDays === 1 ? '' : 's'}</p>}
          </div>
        </div>
      </Card>

      {data.kind === 'NONE' || !summary ? (
        <Card>
          <p className="py-10 text-center text-body-md text-ink-muted">
            This member’s department doesn’t use the daily progress form, so there’s no performance data to show.
          </p>
        </Card>
      ) : data.kind === 'ITAD' ? (
        <ItadView data={data} summary={summary} />
      ) : (
        <LeadGenView data={data} summary={summary} />
      )}

      {/* Feedback & reviews — this route is lead/admin-only */}
      <MemberFeedback memberId={user.id} memberName={user.name} />
    </div>
  )
}

function MemberFeedback({ memberId, memberName }: { memberId: string; memberName: string }) {
  const { addToast } = useToast()
  const [threads, setThreads] = useState<FeedbackThread[] | null>(null)
  const [sentiment, setSentiment] = useState<Sentiment>('NEUTRAL')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    listMemberFeedback(memberId)
      .then((r) => active && setThreads(r.feedback))
      .catch(() => active && setThreads([]))
    return () => {
      active = false
    }
  }, [memberId])

  async function submit() {
    const text = body.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      const { feedback } = await createFeedback({ recipientId: memberId, title: title.trim() || undefined, body: text, sentiment })
      setThreads((t) => [feedback, ...(t ?? [])])
      setTitle('')
      setBody('')
      setSentiment('NEUTRAL')
      addToast({ type: 'success', message: 'Feedback sent.' })
    } catch {
      addToast({ type: 'error', message: 'Could not send feedback.' })
    } finally {
      setSaving(false)
    }
  }

  const SENTIMENTS: Sentiment[] = ['PRAISE', 'NEUTRAL', 'IMPROVEMENT']

  return (
    <Card title="Feedback" subtitle={`Leave a review for ${memberName.split(' ')[0]} — they can see and reply to it.`}>
      {/* Compose */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {SENTIMENTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSentiment(s)}
              className={'rounded-full px-1 transition-opacity ' + (sentiment === s ? 'opacity-100 ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100')}
              aria-pressed={sentiment === s}
            >
              <FeedbackSentimentBadge sentiment={s} />
            </button>
          ))}
        </div>
        <TextField placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <TextArea placeholder={`Write feedback for ${memberName.split(' ')[0]}…`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!body.trim() || saving}>{saving ? 'Sending…' : 'Send feedback'}</Button>
        </div>
      </div>

      {/* Existing threads */}
      {threads && threads.length > 0 && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          {threads.map((t) => (
            <Link key={t.id} to={`/app/feedback/${t.id}`} className="flex items-start gap-3 rounded-btn p-2 transition-colors hover:bg-slate-50">
              <span className="mt-0.5 shrink-0"><FeedbackSentimentBadge sentiment={t.sentiment} /></span>
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-body-md font-medium text-ink">{t.title}</p>}
                <p className="line-clamp-1 text-body-sm text-ink-muted">{t.body}</p>
                <p className="mt-0.5 flex items-center gap-1 text-body-sm text-ink-muted">
                  <MessageSquare size={12} /> {t.replyCount} · {fromNow(t.updatedAt)}
                </p>
              </div>
              <ChevronRight size={16} className="mt-1 shrink-0 text-ink-muted" />
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}

type Summary = NonNullable<MemberProfileResponse['summary']>

function ItadView({ data, summary }: { data: MemberProfileResponse; summary: Summary }) {
  const t = summary.totals
  const k = summary.kpis
  const d = data.deltas
  const columns: Column<MemberEntryRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{r.date}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'} /> },
    ...ITAD_METRICS.map((m): Column<MemberEntryRow> => ({
      key: m.key,
      header: m.label,
      align: 'right',
      render: (r) => formatNumber(Number(r[m.key] ?? 0)),
    })),
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Dials" value={formatNumber(t.callsDialed)} delta={d.callsDialed} caption="vs prev period" icon={<Phone size={16} />} />
        <StatCard label="Connect Rate" value={formatPercent(k.connectRate)} delta={d.connectRate} caption={summary.target?.dailyDials ? `Target ${summary.target.dailyDials}/day` : 'vs prev period'} icon={<TrendingUp size={16} />} />
        <StatCard label="Interested" value={formatNumber(t.interested)} delta={d.interested} caption="vs prev period" icon={<Heart size={16} />} />
        <StatCard label="Closed Deals" value={formatNumber(t.closed)} delta={d.closed} caption="vs prev period" icon={<CheckCircle2 size={16} />} />
      </div>
      <Card title="Daily Entries" subtitle="Each submitted day in this period" flush>
        <DataTable columns={columns} rows={data.entries} getRowId={(r) => r.date} emptyMessage="No entries logged in this period." />
      </Card>
    </>
  )
}

function LeadGenView({ data, summary }: { data: MemberProfileResponse; summary: Summary }) {
  const t = summary.totals
  const k = summary.kpis
  const d = data.deltas
  const columns: Column<MemberEntryRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-medium text-ink">{r.date}</span> },
    { key: 'status', header: 'Status', render: (r) => <SubmissionBadge status={r.status === 'SUBMITTED' ? 'SUBMITTED' : 'ON_LEAVE'} /> },
    ...LEADGEN_METRICS.map((m): Column<MemberEntryRow> => ({
      key: m.key,
      header: m.label,
      align: 'right',
      render: (r) => formatNumber(Number(r[m.key] ?? 0)),
    })),
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leads Generated" value={formatNumber(t.leadsGenerated)} delta={d.leadsGenerated} caption="vs prev period" icon={<Target size={16} />} />
        <StatCard label="Qualified (MQL)" value={formatNumber(t.qualifiedMql)} delta={d.qualifiedMql} caption="vs prev period" icon={<Users size={16} />} />
        <StatCard label="MQL → SQL" value={formatPercent(k.mqlToSql)} delta={d.mqlToSql} caption="vs prev period" icon={<TrendingUp size={16} />} />
        <StatCard label="Contacts Found" value={formatNumber(t.contactsFound)} delta={d.contactsFound} caption="vs prev period" icon={<CheckCircle2 size={16} />} />
      </div>
      <Card title="Daily Entries" subtitle="Each submitted day in this period" flush>
        <DataTable columns={columns} rows={data.entries} getRowId={(r) => r.date} emptyMessage="No entries logged in this period." />
      </Card>
    </>
  )
}

function BackLink() {
  return (
    <Link to="/app/team/not-submitted" className="inline-flex items-center gap-1.5 text-body-md font-medium text-ink-muted hover:text-ink">
      <ArrowLeft size={16} /> Back
    </Link>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
