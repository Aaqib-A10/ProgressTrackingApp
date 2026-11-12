import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, ThumbsUp, Wrench } from 'lucide-react'
import { Button } from '../ui/Button'
import { apiErrorText } from '../../lib/api'
import { metraApi, type MetraRating } from '../../lib/metraApi'
import { cn } from '../../lib/cn'

const CHOICES: { key: MetraRating; label: string; hint: string; icon: typeof ThumbsUp }[] = [
  { key: 'HELPS', label: 'It helps', hint: 'Metra saves me time', icon: ThumbsUp },
  { key: 'NEEDS_CHANGES', label: 'Needs changes', hint: 'Something is wrong or missing', icon: Wrench },
]

/**
 * Feedback about Metra as a whole: does it help, or what should change. (One wrong answer is the thumbs under that
 * answer.) Sent to the company's Super Admins, who read it under Company settings, Metra.
 */
export function MetraFeedbackForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [rating, setRating] = useState<MetraRating | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (rating) box.current?.focus() }, [rating])

  const needsText = rating === 'NEEDS_CHANGES'
  const ready = !!rating && (!needsText || text.trim().length >= 3)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!rating || !ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await metraApi.sendFeedback(rating, text)
      setSent(true)
    } catch (err) {
      setError(apiErrorText(err, 'Could not send your feedback. Try again.'))
    } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center px-2 py-8 text-center" role="status">
        <CheckCircle2 size={34} className="text-success" />
        <p className="mt-3 text-body-lg font-semibold text-ink">Thank you</p>
        <p className="mt-1 max-w-[30ch] text-body-md text-ink-muted">Your feedback was sent. It is read and used to make Metra better.</p>
        <Button className="mt-5" variant="secondary" onClick={onDone}>Back to the chat</Button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <fieldset>
        <legend className="text-body-md font-semibold text-ink">Is Metra helping you?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Is Metra helping you?">
          {CHOICES.map((c) => {
            const on = rating === c.key
            const Icon = c.icon
            return (
              <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => { setRating(c.key); setError(null) }}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-card border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  on ? (c.key === 'HELPS' ? 'border-primary bg-primary/5' : 'border-warning bg-warning/5') : 'border-line bg-card hover:bg-slate-50',
                )}>
                <span className={cn('inline-flex items-center gap-1.5 text-body-md font-semibold', on && c.key === 'HELPS' ? 'text-primary' : 'text-ink')}>
                  <Icon size={15} className={on && c.key === 'NEEDS_CHANGES' ? 'text-warning' : undefined} />{c.label}
                </span>
                <span className="text-[12.5px] leading-snug text-ink-muted">{c.hint}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {rating && (
        <div>
          <label htmlFor="metra-feedback-text" className="text-body-md font-semibold text-ink">
            {needsText ? 'What should change?' : 'What do you use it for most?'}
            {!needsText && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
          </label>
          <textarea
            id="metra-feedback-text" ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000}
            placeholder={needsText ? 'For example: it gave a wrong number for my deals, or I want it to draft my daily report.' : 'For example: finding follow-ups, checking my to-dos.'}
            className="mt-1.5 w-full resize-y rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {needsText && <p className="mt-1 text-[12.5px] text-ink-muted">Say what you asked and what you expected, if it was a wrong answer.</p>}
        </div>
      )}

      {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-muted">Your admin reads this with your name.</p>
        <div className="flex shrink-0 gap-2">
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" disabled={!ready || busy} leadingIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>Send feedback</Button>
        </div>
      </div>
    </form>
  )
}
