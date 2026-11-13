import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { apiErrorText } from '../../lib/api'
import { loadMetraStatus, metraApi, type MetraFeedbackList, type MetraProblem, type MetraProblemList, type MetraStatus } from '../../lib/metraApi'
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
            <Row label="Index">{`${num(a.index.chunks)} pieces`}{a.index.loaded ? '' : ' (loads on the first question)'}</Row>
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
      <ProblemsCard />
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
      <Card title="Answers people rated" subtitle={`${down} not helpful, ${data.answers.length - down} helpful. You see their note, and the question only if they sent one with it. Never the answer.`}
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
                <p className="mt-1.5 break-words text-body-md text-ink"><span className="text-ink-muted">Asked: </span>{a.question || <span className="text-ink-faint">not shared (their questions are private unless they send a note)</span>}</p>
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

const PROBLEM: Record<MetraProblem['kind'], { label: string; tone: string }> = {
  ERROR: { label: 'Could not answer', tone: 'bg-danger/10 text-danger' },
  LOOKUP_FAILED: { label: 'A lookup failed', tone: 'bg-danger/10 text-danger' },
  GAVE_UP: { label: 'Said it could not find it', tone: 'bg-warning/15 text-ink' },
  NOT_HELPFUL: { label: 'Marked not helpful', tone: 'bg-slate-100 text-ink' },
}
const shortArgs = (a: Record<string, unknown>) => { const t = JSON.stringify(a); return t === '{}' ? '' : t.length > 140 ? `${t.slice(0, 140)}…` : t }

/**
 * Answers that went wrong in the last 14 days: what Metra looked up and why it failed. So a problem is seen here,
 * and "Copy details" gives the developer everything needed to fix it. The question and the answer are never shown.
 */
function ProblemsCard() {
  const { addToast } = useToast()
  const [data, setData] = useState<MetraProblemList | null>(null)
  const [failed, setFailed] = useState(false)
  const [all, setAll] = useState(false)
  const load = () => { setFailed(false); metraApi.adminProblems().then(setData).catch(() => setFailed(true)) }
  useEffect(load, [])
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); addToast({ type: 'success', message: `${what} copied.` }) } catch { addToast({ type: 'error', message: 'Could not copy.' }) }
  }
  const title = 'Problems Metra had'
  if (failed) return <Card title={title}><p className="text-body-md text-ink-muted">Could not load this. <button type="button" onClick={load} className="font-medium text-primary hover:underline">Try again</button></p></Card>
  if (!data) return <Card title={title}><p className="flex items-center gap-2 text-body-md text-ink-muted"><Loader2 size={15} className="animate-spin" />Loading…</p></Card>
  // Problems from before this version went live are often already fixed: they are hidden until asked for.
  const fresh = data.problems.filter((p) => p.createdAt >= data.since)
  const shown = all ? data.problems : fresh
  const answers = all ? data.answers : data.answersSince
  const count = all ? data.total : fresh.length
  const rate = answers ? Math.round((count / answers) * 100) : 0
  const cause = (p: MetraProblem) => p.kind === 'ERROR' ? (/rate limit|busy/i.test(p.error ?? '') ? 'the AI model was busy' : /tool choice/i.test(p.error ?? '') ? 'the model called a tool on the answer step' : 'the answer failed') : p.kind === 'LOOKUP_FAILED' ? 'a lookup failed' : p.kind === 'GAVE_UP' ? 'said it could not find it' : 'marked not helpful'
  const causes = [...shown.reduce((m, p) => m.set(cause(p), (m.get(cause(p)) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1])
  return (
    <Card title={title}
      subtitle={`${all ? 'Last 14 days' : `Since this version went live (${when(data.since)})`}: ${count} of ${answers} answers had a problem${answers ? ` (${rate}%)` : ''}.${causes.length ? ` ${causes.map(([c, n]) => `${n} × ${c}`).join(', ')}.` : ''} You see what Metra looked up and why it failed, never the question or the answer.`}
      action={<span className="flex items-center gap-3"><button type="button" onClick={() => setAll((v) => !v)} className="text-body-sm font-medium text-primary hover:underline">{all ? 'Only since this version' : `Show the last 14 days (${data.total})`}</button>{shown.length ? <Button size="sm" variant="secondary" onClick={() => void copy(JSON.stringify(shown, null, 1), 'These problems')}>Copy for the developer</Button> : null}</span>}>
      {shown.length === 0 ? (
        <p className="text-body-md text-ink-muted">{all ? 'No problems in the last 14 days.' : 'No problems since this version went live.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p) => (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', PROBLEM[p.kind].tone)}>{PROBLEM[p.kind].label}</span>
                <span className="text-body-sm font-medium text-ink">{person(p)}</span>
                <span className="text-[12px] text-ink-faint">{when(p.createdAt)}{p.latencyMs != null ? ` · ${(p.latencyMs / 1000).toFixed(1)} s` : ''}{p.model ? ` · ${p.model}` : ''}</span>
                <button type="button" onClick={() => void copy(JSON.stringify(p, null, 1), 'Details')} className="ml-auto text-body-sm font-medium text-primary hover:underline">Copy details</button>
              </div>
              {p.error && <p className="mt-1.5 break-words text-body-sm text-danger">{p.error}</p>}
              {p.tools.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {p.tools.map((t, i) => (
                    <li key={i} className="break-words text-[12.5px] text-ink-muted">
                      <span className={cn('font-medium', t.ok ? 'text-ink' : 'text-danger')}>{t.name.replace(/_/g, ' ')}</span>
                      {shortArgs(t.args) && <span className="ml-1 font-mono text-[11.5px]">{shortArgs(t.args)}</span>}
                      {!t.ok && <span className="ml-1 text-danger">failed{t.error ? `: ${t.error}` : ''}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
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
