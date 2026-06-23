import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { TextField } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Dev-only: email delivery is Phase 4, so we surface the reset link here.
  const [devToken, setDevToken] = useState<string>()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await api.post<{ ok: true; devResetToken?: string }>('/auth/forgot-password', { email })
      setDevToken(res.devResetToken)
      setSent(true)
    } catch {
      setSent(true) // never leak whether the email exists
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout headline="Reset your password and get back to tracking.">
      {sent ? (
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <MailCheck size={24} />
          </div>
          <h1 className="text-headline-lg text-ink">Check your email</h1>
          <p className="mt-1 text-body-md text-ink-muted">
            If an account exists for <span className="font-medium text-ink">{email}</span>, we&apos;ve sent a link to reset your password.
          </p>
          {devToken && (
            <div className="mt-4 rounded-btn border border-warning/30 bg-warning/10 p-3 text-body-sm text-ink">
              <p className="font-semibold text-warning">Dev mode (no email configured)</p>
              <Link to={`/reset-password?token=${devToken}`} className="mt-1 block break-all font-medium text-primary hover:underline">
                Open reset link →
              </Link>
            </div>
          )}
          <Link to="/login" className="mt-6 block text-center text-body-sm font-semibold text-primary hover:underline">
            Back to log in
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-headline-lg text-ink">Forgot password?</h1>
          <p className="mt-1 text-body-md text-ink-muted">Enter your work email and we&apos;ll send you a reset link.</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <TextField label="Work email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
          <Link to="/login" className="mt-6 block text-center text-body-sm font-semibold text-primary hover:underline">
            Back to log in
          </Link>
        </>
      )}
    </AuthLayout>
  )
}
