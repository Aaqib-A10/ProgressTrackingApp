import { useEffect, useMemo, useState, type FormEvent } from 'react'
import qrcode from 'qrcode-generator'
import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { api, apiErrorText } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

/**
 * Two-step sign-in (Settings → Security): after the password, a 6-digit code from an authenticator app.
 *  - TwoStepSetup: scan the code, enter a first 6 digits, save the recovery codes. Also the whole screen a person
 *    sees when their company requires two-step sign-in and they have none yet (routes/guards).
 *  - TwoStepCard: the Settings card (turn on, new recovery codes, turn off).
 */

interface Status { on: boolean; since: string | null; recoveryLeft: number; required: boolean }
const codeBox = 'h-11 w-44 rounded-btn border border-line bg-card px-3 text-center font-mono text-[18px] tracking-[0.3em] text-ink placeholder:tracking-normal placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

/** The QR picture of a link, as an image address. Always black on white, whatever the theme: phones need the contrast. */
function qrImage(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createDataURL(5, 10)
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { addToast } = useToast()
  const text = codes.join('\n')
  const copy = async () => { try { await navigator.clipboard.writeText(text); addToast({ type: 'success', message: 'Recovery codes copied.' }) } catch { addToast({ type: 'error', message: 'Could not copy. Select the codes and copy them.' }) } }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`Metriq recovery codes\nEach code signs you in once when you do not have your phone.\n\n${text}\n`], { type: 'text/plain' }))
    a.download = 'metriq-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div>
      <p className="flex items-center gap-2 text-body-md font-semibold text-ink"><KeyRound size={17} className="text-primary-ink" /> Save your recovery codes</p>
      <p className="mt-1 text-body-sm text-ink-muted">Each code signs you in once if you do not have your phone. They are shown only now: copy them somewhere safe, away from this computer.</p>
      <ul className="mt-3 grid max-w-sm grid-cols-2 gap-x-6 gap-y-1.5 rounded-btn border border-line bg-bg p-3 font-mono text-body-md text-ink">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" leadingIcon={<Copy size={14} />} onClick={copy}>Copy</Button>
        <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={download}>Download</Button>
        <Button size="sm" leadingIcon={<Check size={14} />} onClick={onDone}>I saved them</Button>
      </div>
    </div>
  )
}

/** Turn two-step sign-in on: scan, enter a code, keep the recovery codes. `onDone` once the person has saved them. */
export function TwoStepSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null)
  const [error, setError] = useState<string>()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  useEffect(() => {
    api.post<{ secret: string; url: string }>('/auth/me/two-step/start').then(setSetup).catch((e) => setError(apiErrorText(e, 'Could not start the setup. Try again.')))
  }, [])
  const qr = useMemo(() => (setup ? qrImage(setup.url) : null), [setup])

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/me/two-step/confirm', { code })
      setCodes(r.recoveryCodes)
    } catch (err) {
      setError(apiErrorText(err, 'That code is not right.'))
    } finally {
      setBusy(false)
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />
  if (!setup) return <p className="text-body-sm text-ink-muted">{error ?? 'Getting your setup code…'}</p>
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-body-sm text-ink">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy, 1Password).</li>
        <li>Scan this picture with it. Or type the key in by hand.</li>
        <li>Enter the 6 digits the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-5">
        {qr && <img src={qr} alt="Picture to scan with your authenticator app" width={180} height={180} className="rounded-btn border border-line bg-white p-1" />}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-ink-muted">Key, to type by hand</p>
          <p className="mt-1 break-all font-mono text-body-md text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
        </div>
      </div>
      <form onSubmit={confirm} className="flex flex-wrap items-center gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" aria-label="6-digit code from your app" className={codeBox} autoFocus />
        <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </form>
      {error && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{error}</p>}
    </div>
  )
}

/** A small window that asks for a code before something sensitive (turn off, new recovery codes). */
function CodePrompt({ title, hint, action, onClose, onSubmit }: { title: string; hint: string; action: string; onClose: () => void; onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const go = async () => {
    setBusy(true)
    setError(undefined)
    try { await onSubmit(code.trim()) } catch (e) { setError(apiErrorText(e, 'That code is not right.')) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={busy || code.trim().length < 6}>{action}</Button></>}>
      <p className="mb-3 text-body-sm text-ink-muted">{hint}</p>
      <input value={code} onChange={(e) => setCode(e.target.value.slice(0, 20))} autoComplete="one-time-code" placeholder="Code" aria-label="Code" autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6) void go() }}
        className="h-11 w-full rounded-btn border border-line bg-card px-3 font-mono text-[16px] text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
      {error && <p className="mt-2 rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{error}</p>}
    </Modal>
  )
}

/** Settings → Security: this person's two-step sign-in. */
export function TwoStepCard() {
  const { refresh } = useAuth()
  const { addToast } = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [asking, setAsking] = useState<'off' | 'recovery' | null>(null)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const load = () => api.get<Status>('/auth/me/two-step').then(setStatus).catch(() => setStatus(null))
  useEffect(() => { void load() }, [])

  return (
    <Card title="Two-step sign-in" subtitle="After your password, a 6-digit code from an app on your phone. It keeps your account safe even if someone learns your password.">
      {!status ? <p className="text-body-sm text-ink-muted">Loading…</p> : newCodes ? (
        <RecoveryCodes codes={newCodes} onDone={() => { setNewCodes(null); void load() }} />
      ) : settingUp ? (
        <TwoStepSetup onCancel={() => setSettingUp(false)} onDone={() => { setSettingUp(false); void load(); void refresh(); addToast({ type: 'success', message: 'Two-step sign-in is on.' }) }} />
      ) : status.on ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-body-md text-ink"><ShieldCheck size={18} className="text-success-ink" /> <b>On</b>{status.since && <span className="text-ink-muted">since {new Date(status.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
          <p className="text-body-sm text-ink-muted">{status.recoveryLeft} of 8 recovery codes left.{status.recoveryLeft <= 2 ? ' Get new ones before they run out.' : ''}{status.required ? ' Your company requires two-step sign-in.' : ''}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leadingIcon={<KeyRound size={14} />} onClick={() => setAsking('recovery')}>New recovery codes</Button>
            <Button variant="secondary" size="sm" leadingIcon={<ShieldOff size={14} />} onClick={() => setAsking('off')}>Turn off</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-body-md text-ink"><ShieldOff size={18} className="text-ink-muted" /> <b>Off</b></p>
          <Button leadingIcon={<ShieldCheck size={16} />} onClick={() => setSettingUp(true)}>Turn on two-step sign-in</Button>
        </div>
      )}
      {asking === 'off' && (
        <CodePrompt title="Turn off two-step sign-in" action="Turn off" onClose={() => setAsking(null)}
          hint={`Enter a code from your app, or a recovery code.${status?.required ? ' Your company requires two-step sign-in, so you will be asked to set it up again straight away (for example on a new phone).' : ''}`}
          onSubmit={async (code) => { await api.post('/auth/me/two-step/off', { code }); setAsking(null); await load(); await refresh(); addToast({ type: 'success', message: 'Two-step sign-in is off.' }) }} />
      )}
      {asking === 'recovery' && (
        <CodePrompt title="New recovery codes" action="Make new codes" onClose={() => setAsking(null)} hint="Enter the 6-digit code from your app. Your old recovery codes stop working."
          onSubmit={async (code) => { const r = await api.post<{ recoveryCodes: string[] }>('/auth/me/two-step/recovery', { code }); setAsking(null); setNewCodes(r.recoveryCodes) }} />
      )}
    </Card>
  )
}
