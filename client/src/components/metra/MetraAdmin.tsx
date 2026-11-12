import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { apiErrorText } from '../../lib/api'
import { loadMetraStatus, metraApi, type MetraFeedbackList, type MetraStatus } from '../../lib/metraApi'
import { cn } from '../../lib/cn'

function when(iso: string | null): string {
  if (!iso) return 'Not yet'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const num = (n: number | undefined) => (n ?? 0).toLocaleString('en-US')

/** Company settings → Metra (Super Admin): the model, the index per source, use this month, feedback, and Re-index now. */
export function MetraAdmin() {
  const { addToast } = useToast()
  const [s, setS] = useState<MetraStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const load = () => { setLoading(true); loadMetraStatus(true).then(setS).finally(() => setLoading(false)) }
  useEffect(load, [])

  async function reindex() {
    setBusy(true)
    try {
      await metraApi.reindex()
      addToast({ type: 'success', message: 'Re-indexing in the background. Refresh in a few minutes to see the new counts.' })
    } catch (e) {
      addToast({ type: 'error', message: apiErrorText(e, 'Could not start re-indexing.') })
    } finally { setBusy(false) }
  }

  if (loading && !s) return <Card><p className="flex items-center gap-2 text-body-md text-ink-muted"><Loader2 size={15} className="animate-spin" />Loading…</p></Card>
  if (!s || !s.enabled) return <Card title="Metra"><p className="text-body-md text-ink-muted">Metra is off for your company. Metriq turns it on once it is set up for you.</p></Card>
  const a = s.admin
  if (!a) return <Card title="Metra"><p className="text-body-md text-ink-muted">Only a Super Admin sees Metra's index.</p></Card>
  const errors = a.sources.filter((x) => x.lastError).length

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="The model">
          <dl className="space-y-1.5 text-body-sm">
            <Row label="Answers">{s.llm ? <Ok>Connected</Ok> : <Warn>Not connected yet</Warn>}</Row>
            <Row label="Search">{a.embed.mode}</Row>
            <Row label="Embedding model"><span className="break-all">{a.embed.model || '—'}</span></Row>
            <Row label="Re-ranker">{typeof a.embed.reranker === 'boolean' ? (a.embed.reranker ? 'On' : 'Off') : a.embed.reranker || 'Off'}</Row>
            <Row label="Index">{a.index.loaded ? `${num(a.index.chunks)} pieces` : 'Loading'}</Row>
          </dl>
        </Card>
        <Card title="This month">
          <dl className="space-y-1.5 text-body-sm">
            <Row label="Answers"><span className="tabular-nums">{num(a.usage.answers)}</span></Row>
            <Row label="Tokens in"><span className="tabular-nums">{num(a.usage.tokensIn)}</span></Row>
            <Row label="Tokens out"><span className="tabular-nums">{num(a.usage.tokensOut)}</span></Row>
          </dl>
        </Card>
        <Card title="Feedback" subtitle="All time">
          <dl className="space-y-1.5 text-body-sm">
            <Row label="👍 Helpful"><span className="tabular-nums">{num(a.feedback.UP)}</span></Row>
            <Row label="👎 Not helpful"><span className="tabular-nums">{num(a.feedback.DOWN)}</span></Row>
          </dl>
        </Card>
      </div>
      {/* What people said comes before the index: it is what an admin acts on. */}
      <FeedbackCards />
      <Card
        title="What Metra has read"
        subtitle={errors ? `${errors} source${errors === 1 ? '' : 's'} had a problem on the last run.` : 'Each source is read again by itself in the background.'}
        action={<Button size="sm" variant="secondary" disabled={busy} leadingIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} onClick={() => void reindex()}>Re-index now</Button>}
        flush
      >
        {a.sources.length === 0 ? (
          <p className="px-5 pb-5 pt-3 text-body-md text-ink-muted">Nothing indexed yet. The first run starts by itself, or use Re-index now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-body-sm">
              <thead><tr className="border-y border-line bg-slate-50 text-left text-[12px] text-ink-muted">
                <th className="px-5 py-2 font-medium">Source</th><th className="px-3 py-2 text-right font-medium">Pieces</th><th className="px-3 py-2 font-medium">Last run</th><th className="px-5 py-2 font-medium">Problem</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {a.sources.map((x) => (
                  <tr key={x.type}>
                    <td className="px-5 py-2 text-ink">{x.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{num(x.chunks)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{when(x.lastRunAt)}</td>
                    <td className={cn('px-5 py-2', x.lastError ? 'text-danger' : 'text-ink-faint')}>{x.lastError ? <span className="line-clamp-2 break-words" title={x.lastError}>{x.lastError}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end px-5 py-3"><button type="button" onClick={load} className="text-body-sm font-medium text-primary hover:underline">Refresh</button></div>
      </Card>
    </div>
  )
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const person = (x: { name: string; department: string | null }) => [x.name, x.department].filter(Boolean).join(' · ')

/** What people said about Metra (the feedback form) and the answers they rated (the thumbs, with their note). */
function FeedbackCards() {
  const { addToast } = useToast()
  const [data, setData] = useState<MetraFeedbackList | null>(null)
  const [failed, setFailed] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [onlyDown, setOnlyDown] = useState(true)
  const load = () => { setFailed(false); metraApi.adminFeedback().then(setData).catch(() => setFailed(true)) }
  useEffect(load, [])

  async function setHandled(id: string, handled: boolean) {
    setData((d) => d && { ...d, general: d.general.map((g) => (g.id === id ? { ...g, handled } : g)) })
    try { await metraApi.setFeedbackHandled(id, handled) } catch (e) {
      setData((d) => d && { ...d, general: d.general.map((g) => (g.id === id ? { ...g, handled: !handled } : g)) })
      addToast({ type: 'error', message: apiErrorText(e, 'Could not save that.') })
    }
  }

  if (failed) return <Card title="What people say about Metra"><p className="text-body-md text-ink-muted">Could not load the feedback. <button type="button" onClick={load} className="font-medium text-primary hover:underline">Try again</button></p></Card>
  if (!data) return <Card title="What people say about Metra"><p className="flex items-center gap-2 text-body-md text-ink-muted"><Loader2 size={15} className="animate-spin" />Loading…</p></Card>

  const open = data.general.filter((g) => !g.handled).length
  const general = onlyOpen ? data.general.filter((g) => !g.handled) : data.general
  const down = data.answers.filter((a) => a.feedback === 'DOWN').length
  const answers = onlyDown ? data.answers.filter((a) => a.feedback === 'DOWN') : data.answers

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="What people say about Metra" subtitle={`${data.general.length} sent, ${open} not handled yet. From the Feedback button in Metra.`}
        action={<FilterLink on={onlyOpen} onClick={() => setOnlyOpen((v) => !v)} onLabel="Show all" offLabel="Only not handled" />}>
        {general.length === 0 ? (
          <p className="text-body-md text-ink-muted">{data.general.length ? 'Everything is handled.' : 'No feedback yet. People send it with the Feedback button in Metra.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {general.map((g) => (
              <li key={g.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', g.rating === 'HELPS' ? 'bg-success/10 text-success' : 'bg-warning/15 text-ink')}>{g.rating === 'HELPS' ? 'It helps' : 'Needs changes'}</span>
                  <span className="text-body-sm font-medium text-ink">{person(g)}</span>
                  <span className="text-[12px] text-ink-faint">{day(g.createdAt)}</span>
                  <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-body-sm text-ink-muted">
                    <input type="checkbox" checked={g.handled} onChange={(e) => void setHandled(g.id, e.target.checked)} className="h-3.5 w-3.5 accent-primary" />Handled
                  </label>
                </div>
                {g.text ? <p className="mt-1.5 whitespace-pre-wrap break-words text-body-md text-ink">{g.text}</p> : <p className="mt-1.5 text-body-sm text-ink-faint">No comment.</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Answers people rated" subtitle={`${down} not helpful, ${data.answers.length - down} helpful. You see the question and their note, not the answer.`}
        action={<FilterLink on={onlyDown} onClick={() => setOnlyDown((v) => !v)} onLabel="Show all" offLabel="Only not helpful" />}>
        {answers.length === 0 ? (
          <p className="text-body-md text-ink-muted">{data.answers.length ? 'No answers were marked not helpful.' : 'Nobody has rated an answer yet.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {answers.map((a) => (
              <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span aria-hidden>{a.feedback === 'DOWN' ? '👎' : '👍'}</span>
                  <span className="sr-only">{a.feedback === 'DOWN' ? 'Not helpful' : 'Helpful'}</span>
                  <span className="text-body-sm font-medium text-ink">{person(a)}</span>
                  <span className="text-[12px] text-ink-faint">{day(a.createdAt)}</span>
                </div>
                <p className="mt-1.5 break-words text-body-md text-ink"><span className="text-ink-muted">Asked: </span>{a.question || '—'}</p>
                {a.note && <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-ink"><span className="text-ink-muted">Their note: </span>{a.note}</p>}
                {a.tools.length > 0 && <p className="mt-1 text-[12px] text-ink-faint">Metra looked in: {[...new Set(a.tools)].map((t) => t.replace(/_/g, ' ')).join(', ')}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function FilterLink({ on, onClick, onLabel, offLabel }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string }) {
  return <button type="button" onClick={onClick} className="text-body-sm font-medium text-primary hover:underline">{on ? onLabel : offLabel}</button>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="text-right text-ink">{children}</dd></div>
}
const Ok = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={14} />{children}</span>
const Warn = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={14} />{children}</span>
