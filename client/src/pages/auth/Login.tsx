import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { ApiError } from '../../lib/api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { login } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/app/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(undefined)
    if (!EMAIL_RE.test(email)) {
      setEmailError('Please enter a valid work email')
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
        quote: 'PulseTrack has completely eliminated our manual reporting friction.',
        name: 'Head of Lead Gen',
        role: 'Verlex Inc.',
      }}
    >
      <h1 className="text-headline-lg text-ink">Welcome back</h1>
      <p className="mt-1 text-body-md text-ink-muted">
        Log in to your account to continue tracking progress.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <TextField
          label="Work email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          autoComplete="email"
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

      <div className="my-5 flex items-center gap-3 text-body-sm text-ink-muted">
        <span className="h-px flex-1 bg-line" /> OR LOG IN WITH <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => addToast({ type: 'info', message: 'Google SSO is coming in a later phase.' })}
      >
        Log in with Google
      </Button>

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="font-semibold text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  )
}
