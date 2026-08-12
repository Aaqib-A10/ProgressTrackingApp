import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Toggle } from '../../../components/ui/Toggle'
import { useToast } from '../../../components/ui/Toast'
import { getContentEntry, upsertContentEntry } from '../../../lib/marketingApi'

export default function ContentDailyLog() {
  const { addToast } = useToast()
  const [body, setBody] = useState('')
  const [onLeave, setOnLeave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getContentEntry()
      .then((res) => {
        if (res.entry) {
          setOnLeave(res.entry.status !== 'SUBMITTED')
          setBody(res.entry.body || '')
        }
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load entry.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  async function submit() {
    setSubmitting(true)
    try {
      await upsertContentEntry({ status: onLeave ? 'ON_LEAVE' : 'SUBMITTED', body: onLeave ? '' : body })
      addToast({ type: 'success', message: onLeave ? 'Marked as On Leave.' : 'Content log submitted.' })
    } catch {
      addToast({ type: 'error', message: 'Could not submit.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Content Daily Log</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">A short write-up of today's content work — drafts, edits, pages, publishing.</p>
        </div>
        <label className="flex items-center gap-3 rounded-btn border border-line bg-card px-4 py-2">
          <span className="text-body-sm font-medium text-ink-muted">On Leave / Off</span>
          <Toggle checked={onLeave} onChange={setOnLeave} label="On leave today" />
        </label>
      </div>

      <Card title="Today's Content Work">
        <div className={onLeave ? 'pointer-events-none opacity-60' : ''}>
          <label className="mb-1 block text-body-sm font-medium text-ink-muted">Log</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            disabled={onLeave}
            placeholder="What did you work on today? Blog drafts, website pages, social copy, video scripts, editing, publishing…"
            className="w-full rounded-btn border border-line bg-bg p-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
        </div>
        <Button className="mt-5" size="lg" onClick={submit} disabled={submitting} leadingIcon={<UploadCloud size={18} />}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </Card>
    </div>
  )
}
