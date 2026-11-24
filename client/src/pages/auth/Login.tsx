import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { SsoSignIn } from '../../components/auth/SsoSignIn'
import { api, apiErrorText } from '../../lib/api'
import { AuthLayout } from './AuthLayout'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAuth, SESSION_EXPIRED_KEY } from '../../lib/auth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { login, loginTwoStep } = useAuth()
  // Two-step sign-in: the password was right, now the code from their authenticator app.
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const { slug } = useParams()
  const [params] = useSearchParams()
  // A company's own sign-in page (/c/<address>) shows its name (Phase 1, step 7).
  const [companyName, setCompanyName] = useState<string | null>(null)
  useEffect(() => {
    if (!slug) return
    api.get<{ company: { name: string } }>(`/auth/company/${encodeURIComponent(slug)}`).then((r) => setCompanyName(r.company.name)).catch(() => setCompanyName(null))
  }, [slug])
  // "Start a free trial" only once the owner opens sign-ups; until then the old Sign up link.
  const [open, setOpen] = useState(false)
  useEffect(() => { api.get<{ newCompanies: boolean }>('/auth/open').then((r) => setOpen(r.newCompanies)).catch(() => setOpen(false)) }, [])
  const navigate = useNavigate()
  const location = useLocation()
  // Back where the person was, with its ?query (an app's sign-in request lives in it: /app/oauth/authorize?client_id=...).
  const fromLoc = (location.state as { from?: { pathname: string; search?: string } } | null)?.from
  const from = fromLoc?.pathname ? `${fromLoc.pathname}${fromLoc.search ?? ''}` : '/app/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  // Back from a company's single sign-on that did not work: say why.
  useEffect(() => { const m = params.get('sso_error'); if (m) setFormError(m.slice(0, 300)) }, [params])

  // Surface why the user landed here if their session was ended mid-use.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        setSessionEnded(true)
        sessionStorage.removeItem(SESSION_EXPIRED_KEY)
      }
    } catch { /* ignore */ }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(undefined)
    // An email, or a username (short sign in names such as the test accounts).
    if (email.includes('@') ? !EMAIL_RE.test(email) : !/^[a-z0-9._-]{3,}$/i.test(email.trim())) {
      setEmailError('Enter your work email or username')
      return
    }
    setEmailError(undefined)
    setSubmitting(true)
    try {
      const r = await login(email, password)
      if (r.ticket) { setTicket(r.ticket); setCode(''); return }
      navigate(from, { replace: true })
    } catch (err) {
      // The company signs in through its own identity provider: go there.
      const why = (() => { try { return JSON.parse((err as { message?: string }).message ?? '') as { code?: string; ssoUrl?: string } } catch { return null } })()
      if (why?.code === 'SSO_REQUIRED' && why.ssoUrl?.startsWith('/api/auth/sso/')) { window.location.assign(`${why.ssoUrl}?next=${encodeURIComponent(from)}`); return }
      setFormError(apiErrorText(err, 'Something went wrong. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onCode(e: FormEvent) {
    e.preventDefault()
    if (!ticket) return
    setFormError(undefined)
    setSubmitting(true)
    try {
      await loginTwoStep(ticket, code.trim())
      navigate(from, { replace: true })
    } catch (err) {
      const text = apiErrorText(err, 'That code is not right.')
      setFormError(text)
      // The 5 minutes ran out: back to the password.
      if (/sign in again/i.test(text)) { setTicket(null); setPassword('') }
    } finally {
      setSubmitting(false)
    }
  }

  if (ticket) {
    return (
      <AuthLayout headline="The single source of truth for every team.">
        <h1 className="text-headline-lg text-ink">Enter your code</h1>
        <p className="mt-1 text-body-md text-ink-muted">Open your authenticator app and enter the 6 digits it shows for Metriq.</p>
        <form onSubmit={onCode} className="mt-6 space-y-4" noValidate>
          <TextField label="6-digit code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus spellCheck={false} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.slice(0, 20))} />
          {formError && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{formError}</p>}
          <Button type="submit" className="w-full" disabled={submitting || code.trim().length < 6}>{submitting ? 'Checking…' : 'Sign in'}</Button>
        </form>
        <p className="mt-4 text-body-sm text-ink-muted">No phone with you? Enter one of your recovery codes instead. Lost both? Ask your company's admin to turn two-step sign-in off for you.</p>
        <button type="button" onClick={() => { setTicket(null); setFormError(undefined) }} className="mt-4 text-body-sm font-semibold text-primary-ink hover:underline">Back to log in</button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      headline="The single source of truth for every team."
    >
      <h1 className="text-headline-lg text-ink">{companyName ? `Sign in to ${companyName}` : 'Welcome back'}</h1>
      <p className="mt-1 text-body-md text-ink-muted">
        Log in to your account to continue tracking progress.
      </p>

      {params.get('error') && (
        <div className="mt-4 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{params.get('error')}</div>
      )}

      {sessionEnded && (
        <div className="mt-4 rounded-btn border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-warning-ink">
          Your session ended. Please sign in again to continue.
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <TextField
          label="Work email or username"
          type="text"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          autoComplete="username"
        />
        <div>
          <PasswordField
            label="Password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <div className="mt-1.5 flex justify-end">
            <Link to="/forgot-password" className="text-body-sm font-medium text-primary-ink hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>

        {formError && (
          <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger-ink">{formError}</p>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log In'}
        </Button>
      </form>

      <OAuthButtons intent="signin" label="OR LOG IN WITH" />
      <SsoSignIn next={from} />

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        {open ? (
          <>New to Metriq?{' '}<Link to="/start" className="font-semibold text-primary-ink hover:underline">Start free</Link></>
        ) : (
          <>Don&apos;t have an account?{' '}<Link to="/signup" className="font-semibold text-primary-ink hover:underline">Sign up</Link></>
        )}
      </p>
      <p className="mt-3 text-center text-body-sm text-ink-faint">
        <Link to="/terms" className="hover:text-ink">Terms</Link> · <Link to="/privacy" className="hover:text-ink">Privacy</Link> · <Link to="/cookies" className="hover:text-ink">Cookies</Link>
      </p>
    </AuthLayout>
  )
}
