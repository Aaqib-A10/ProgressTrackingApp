import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Users, User, Check } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { api, ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'

/**
 * Start a free trial (Phase 1, step 7): for a team (a company with its own address) or just
 * for yourself (a personal workspace). 14 days, no card.
 */

function errText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  try { return (JSON.parse(e.message) as { error?: string }).error ?? e.message } catch { return e.message }
}

export default function Start() {
  const [mode, setMode] = useState<'team' | 'solo'>('team')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<boolean | null>(null)
  // Free while Metriq launches: until online payment opens there is no trial to count down.
  const [free, setFree] = useState(true)
  // An invite link (/start?invite=<code>) opens sign-up for that person while it is closed to everyone else.
  const [params] = useSearchParams()
  const invite = params.get('invite')?.trim() || undefined
  const [invited, setInvited] = useState(false)
  useEffect(() => { api.get<{ newCompanies: boolean; invited?: boolean; paymentsOpen?: boolean }>(`/auth/open${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`).then((r) => { setOpen(r.newCompanies); setInvited(!!r.invited); setFree(!r.paymentsOpen) }).catch(() => setOpen(false)) }, [invite])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setBusy(true)
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const r = await api.post<{ next: string }>('/auth/start', { mode, name, email, password, companyName: mode === 'team' ? companyName : undefined, timeZone, invite })
      // A full load, so the app starts with the new session.
      window.location.assign(r.next)
    } catch (err) { setError(errText(err)); setBusy(false) }
  }

  if (open === false) {
    return (
      <AuthLayout headline="Daily reports, attendance and projects for your whole team, in one place.">
        <h1 className="text-headline-lg text-ink">Not open yet</h1>
        <p className="mt-1 text-body-md text-ink-muted">{invite ? 'This invite link has been used or is no longer valid. Ask the person who sent it for a new one.' : 'Metriq is not open for new companies yet.'} Already have an account?</p>
        <Link to="/login" className="mt-5 inline-block font-semibold text-primary-ink hover:underline">Sign in</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout headline="Daily reports, attendance and projects for your whole team, in one place.">
      <h1 className="text-headline-lg text-ink">{free ? 'Start Metriq free' : 'Start your free trial'}</h1>
      <p className="mt-1 text-body-md text-ink-muted">{free ? 'Free while we launch, everything included. No card needed.' : '14 days, everything included. No card needed.'}</p>
      {invited && <p className="mt-3 rounded-btn border border-primary/20 bg-primary/5 px-3 py-2 text-body-sm text-ink">You were invited to start Metriq early. This link is yours: set up your company below.</p>}

      <div role="radiogroup" aria-label="Who is it for" className="mt-5 grid grid-cols-2 gap-2">
        {([['team', 'For my team', 'A company, with people and departments', Users], ['solo', 'Just me', 'Plan and track your own work', User]] as const).map(([v, l, d, Icon]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
            className={cn('relative rounded-card border p-3 text-left transition-colors', mode === v ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-line hover:border-primary/40')}>
            {mode === v && <Check size={14} className="absolute right-2.5 top-2.5 text-primary-ink" />}
            <Icon size={18} className={mode === v ? 'text-primary-ink' : 'text-ink-muted'} />
            <span className="mt-1.5 block text-body-md font-semibold text-ink">{l}</span>
            <span className="block text-body-sm text-ink-muted">{d}</span>
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        {mode === 'team' && <TextField label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />}
        <TextField label={mode === 'team' ? 'Work email' : 'Email'} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="8 or more, letters and numbers" />
        {error && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Setting it up…' : free ? 'Start free' : 'Start free trial'}</Button>
        <p className="text-center text-body-sm text-ink-muted">By starting, you agree to the <Link to="/terms" className="font-medium text-ink underline-offset-2 hover:underline">Terms of Service</Link> and <Link to="/privacy" className="font-medium text-ink underline-offset-2 hover:underline">Privacy Policy</Link>.</p>
      </form>

      <OAuthButtons intent="signup" mode={mode} company={mode === 'team' ? companyName : undefined} label="OR START WITH" invite={invite} />

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        Already on Metriq? <Link to="/login" className="font-semibold text-primary-ink hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
