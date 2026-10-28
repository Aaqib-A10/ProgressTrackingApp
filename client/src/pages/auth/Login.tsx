import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { api } from '../../lib/api'
import { AuthLayout } from './AuthLayout'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAuth, SESSION_EXPIRED_KEY } from '../../lib/auth'
import { ApiError } from '../../lib/api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { login } = useAuth()
  const { slug } = useParams()
  const [params] = useSearchParams()
  // A company's own sign-in page (/c/<address>) shows its name (Phase 1, step 7).
  const [companyName, setCompanyName] = useState<string | null>(null)
  useEffect(() => {
    if (!slug) return
    api.get<{ company: { name: string } }>(`/auth/company/${encodeURIComponent(slug)}`).then((r) => setCompanyName(r.company.name)).catch(() => setCompanyName(null))
  }, [slug])
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/app/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)

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
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      headline="The single source of truth for every team."
      testimonial={{
        quote: 'Metriq has completely eliminated our manual reporting friction.',
        name: 'Head of Lead Gen',
        role: 'Verlex Inc.',
      }}
    >
      <h1 className="text-headline-lg text-ink">{companyName ? `Sign in to ${companyName}` : 'Welcome back'}</h1>
      <p className="mt-1 text-body-md text-ink-muted">
        Log in to your account to continue tracking progress.
      </p>

      {params.get('error') && (
        <div className="mt-4 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-body-sm text-danger">{params.get('error')}</div>
      )}

      {sessionEnded && (
        <div className="mt-4 rounded-btn border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-warning">
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
            <Link to="/forgot-password" className="text-body-sm font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>

        {formError && (
          <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{formError}</p>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log In'}
        </Button>
      </form>

      <OAuthButtons intent="signin" label="OR LOG IN WITH" />

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        New to Metriq?{' '}
        <Link to="/start" className="font-semibold text-primary hover:underline">
          Start a free trial
        </Link>
      </p>
    </AuthLayout>
  )
}
