import { useRef, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { Button } from './ui/Button'

export type Member = { id: string; name: string }

export const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
export const fmtCommentTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Render a comment body with "@Name" highlighted for mentioned members. */
export function highlightMentions(body: string, mentionIds: string[], members: Member[]): ReactNode {
  const names = mentionIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return body
  const out: ReactNode[] = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { out.push(buf); buf = '' } }
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = names.find((n) => body.startsWith('@' + n, i))
      if (hit) {
        flush()
        out.push(<span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">@{hit}</span>)
        i += hit.length + 1
        continue
      }
    }
    buf += body[i]
    i++
  }
  flush()
  return out
}

/**
 * A comment composer with @mention autocomplete. Calls onSubmit(body, mentionIds, reset);
 * the parent posts and invokes reset() on success. Cmd/Ctrl+Enter submits.
 */
export function MentionBox({ members, onSubmit }: { members: Member[]; onSubmit: (body: string, mentions: string[], reset: () => void) => void | Promise<void> }) {
  const [text, setText] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [suggest, setSuggest] = useState<Member[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  function refreshSuggest(v: string, pos: number) {
    const m = v.slice(0, pos).match(/(?:^|\s)@([\w-]{0,30})$/)
    if (!m) { setSuggest(null); return }
    const token = m[1].toLowerCase()
    setSuggest(members.filter((mm) => mm.name.toLowerCase().includes(token)).slice(0, 6))
  }
  function pick(member: Member) {
    const el = ref.current
    if (!el) return
    const pos = el.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    const m = before.match(/(?:^|\s)@([\w-]{0,30})$/)
    if (!m) return
    const at = before.length - m[1].length - 1
    const nb = before.slice(0, at) + '@' + member.name + ' '
    setText(nb + after)
    setMentionIds((ids) => (ids.includes(member.id) ? ids : [...ids, member.id]))
    setSuggest(null)
    setTimeout(() => { el.focus(); el.setSelectionRange(nb.length, nb.length) }, 0)
  }
  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    // Only send mentions whose "@Name" still appears in the final text.
    const kept = mentionIds.filter((id) => { const mm = members.find((x) => x.id === id); return mm && body.includes('@' + mm.name) })
    setBusy(true)
    await onSubmit(body, kept, () => { setText(''); setMentionIds([]) })
    setBusy(false)
  }
  return (
    <div className="relative mt-3">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => { setText(e.target.value); refreshSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
        rows={2}
        placeholder="Write a comment… use @ to mention"
        className="w-full rounded-btn border border-line bg-bg p-3 text-body-sm text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      {suggest && suggest.length > 0 && (
        <ul className="absolute bottom-full z-10 mb-1 w-56 overflow-hidden rounded-btn border border-line bg-card shadow-overlay">
          {suggest.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => pick(m)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm hover:bg-slate-50">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{initials(m.name)}</span>{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" leadingIcon={<Send size={14} />} onClick={submit} disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Comment'}</Button>
      </div>
    </div>
  )
}
