import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { HelpCircle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { TextField } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { ApiError } from '../../lib/api'
import { getSupportStatus, sendSupport } from '../../lib/supportApi'

const iconCls = 'hidden rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink sm:inline-flex'

/**
 * The Help icon in the top bar. When the owner has switched Help on for this company it opens a
 * short form that reaches Metriq support (with the page and browser attached). When Help is off it
 * stays the plain icon it has always been, so nothing changes for that company.
 */
export function HelpButton() {
  const { addToast } = useToast()
  const { pathname, search } = useLocation()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getSupportStatus().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)) }, [])

  if (!enabled) return <button className={iconCls} aria-label="Help"><HelpCircle size={18} /></button>

  async function send() {
    if (subject.trim().length < 3 || body.trim().length < 5) { addToast({ type: 'error', message: 'Add a short title and tell us what happened.' }); return }
    setBusy(true)
    try {
      const r = await sendSupport({ subject: subject.trim(), body: body.trim(), pageUrl: pathname + search, userAgent: navigator.userAgent })
      addToast({ type: 'success', message: `Sent (#${r.ticket.number}). You will get the answer in your bell.` })
      setSubject(''); setBody(''); setOpen(false)
    } catch (e) {
      let msg = 'Could not send. Try again.'
      if (e instanceof ApiError) { try { msg = (JSON.parse(e.message) as { error?: string }).error ?? msg } catch { /* plain text */ } }
      addToast({ type: 'error', message: msg })
    } finally { setBusy(false) }
  }

  return (
    <>
      <button className={iconCls} aria-label="Help" onClick={() => setOpen(true)}><HelpCircle size={18} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title="Help: tell Metriq support"
        footer={<><Link to="/app/help" onClick={() => setOpen(false)} className="mr-auto text-body-sm font-semibold text-primary">My requests</Link>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button></>}>
        <div className="space-y-4">
          <TextField label="What is it about?" placeholder="e.g. The daily log will not save" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink" htmlFor="help-body">What happened?</label>
            <textarea id="help-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What you did, what you expected, what you saw instead."
              className="w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
          </div>
          <p className="text-body-sm text-ink-muted">The page you are on and your browser are sent with it, so support can see what you saw.</p>
        </div>
      </Modal>
    </>
  )
}
