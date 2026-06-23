import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { PasswordField, PasswordStrength } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { api, ApiError } from '../../lib/api'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      navigate('/reset-success', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout headline="Choose a strong new password.">
      <h1 className="text-headline-lg text-ink">Set a new password</h1>
      <p className="mt-1 text-body-md text-ink-muted">Enter and confirm your new password below.</p>

      {!token ? (
        <p className="mt-6 rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">
          Missing reset token. Please use the link from your email.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <PasswordField label="New password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <PasswordStrength value={password} />
          </div>
          <PasswordField label="Confirm password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          {error && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Saving…' : 'Reset password'}
          </Button>
        </form>
      )}

      <Link to="/login" className="mt-6 block text-center text-body-sm font-semibold text-primary hover:underline">
        Back to log in
      </Link>
    </AuthLayout>
  )
}
