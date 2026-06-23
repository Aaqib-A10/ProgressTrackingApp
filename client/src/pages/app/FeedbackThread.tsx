import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { TextArea } from '../../components/ui/Input'
import { FeedbackSentimentBadge } from '../../components/ui/Badge'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { getFeedbackThread, replyToFeedback, type FeedbackDetail, type FeedbackReply } from '../../lib/feedbackApi'
import { formatDateTime } from '../../lib/datetime'

export default function FeedbackThread() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { addToast } = useToast()
  const [data, setData] = useState<FeedbackDetail | null>(null)
  const [denied, setDenied] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let active = true
    getFeedbackThread(id)
      .then((r) => active && setData(r))
      .catch((e) => {
        if (!active) return
        if (e?.status === 403 || e?.status === 404) setDenied(true)
        else addToast({ type: 'error', message: 'Could not load this thread.' })
      })
    return () => {
      active = false
    }
  }, [id, addToast])

  async function send() {
    const body = reply.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const { reply: created } = await replyToFeedback(id, body)
      setData((d) => (d ? { ...d, replies: [...d.replies, created] } : d))
      setReply('')
    } catch {
      addToast({ type: 'error', message: 'Could not send your reply.' })
    } finally {
      setSending(false)
    }
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <Card><p className="py-10 text-center text-body-md text-ink-muted">You don’t have access to this feedback.</p></Card>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <div className="text-body-md text-ink-muted">Loading…</div>
      </div>
    )
  }

  const meId = user?.id
  // Author label: the lead who wrote the original feedback.
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink />

      {/* Original feedback */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <FeedbackSentimentBadge sentiment={data.sentiment} />
          <span className="text-body-sm text-ink-muted">
            {data.author.id === meId ? 'You' : data.author.name} → {data.recipient.id === meId ? 'you' : data.recipient.name}
          </span>
          <span className="ml-auto text-body-sm text-ink-muted">{formatDateTime(data.createdAt)}</span>
        </div>
        {data.title && <h1 className="mt-3 text-headline-md text-ink">{data.title}</h1>}
        <p className="mt-2 whitespace-pre-wrap text-body-md text-ink">{data.body}</p>
      </Card>

      {/* Replies */}
      {data.replies.length > 0 && (
        <div className="space-y-3">
          {data.replies.map((r) => (
            <ReplyBubble key={r.id} reply={r} mine={r.author.id === meId} />
          ))}
        </div>
      )}

      {/* Composer */}
      <Card>
        <TextArea
          label="Reply"
          placeholder="Write a reply…"
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
          }}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={send} disabled={!reply.trim() || sending} leadingIcon={<Send size={16} />}>
            {sending ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ReplyBubble({ reply, mine }: { reply: FeedbackReply; mine: boolean }) {
  return (
    <div className={'flex flex-col ' + (mine ? 'items-end' : 'items-start')}>
      <div className={'max-w-[85%] rounded-card border px-4 py-2.5 ' + (mine ? 'border-primary/20 bg-primary/5' : 'border-line bg-card')}>
        <p className="text-body-sm font-semibold text-ink">{mine ? 'You' : reply.author.name}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-body-md text-ink">{reply.body}</p>
      </div>
      <span className="mt-1 px-1 text-[11px] text-ink-muted">{formatDateTime(reply.createdAt)}</span>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/app/feedback" className="inline-flex items-center gap-1.5 text-body-md font-medium text-ink-muted hover:text-ink">
      <ArrowLeft size={16} /> All feedback
    </Link>
  )
}
