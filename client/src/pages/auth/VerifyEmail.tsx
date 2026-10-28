import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailCheck, MailX } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { api, ApiError } from '../../lib/api'

/** The link in the "confirm your email" message (Phase 1, step 7). */
export default function VerifyEmail() {
  const [params] = useSearchParams()
  const [state, setState] = useState<'checking' | 'ok' | 'bad'>('checking')
  const [error, setError] = useState('')
  useEffect(() => {
    api.post('/auth/verify-email', { token: params.get('token') ?? '' })
      .then(() => setState('ok'))
      .catch((e) => { setState('bad'); try { setError((JSON.parse((e as ApiError).message) as { error?: string }).error ?? '') } catch { setError('') } })
  }, [params])
  return (
    <AuthLayout headline="Daily reports, attendance and projects for your whole team, in one place.">
      {state === 'checking' && <p className="text-body-md text-ink-muted">Checking the link…</p>}
      {state === 'ok' && (
        <div className="text-center">
          <MailCheck size={32} className="mx-auto text-success" />
          <h1 className="mt-3 text-headline-lg text-ink">Email confirmed</h1>
          <p className="mt-1 text-body-md text-ink-muted">You can invite your people now.</p>
          <Link to="/app/setup" className="mt-5 inline-block font-semibold text-primary hover:underline">Back to Metriq</Link>
        </div>
      )}
      {state === 'bad' && (
        <div className="text-center">
          <MailX size={32} className="mx-auto text-danger" />
          <h1 className="mt-3 text-headline-lg text-ink">That link does not work</h1>
          <p className="mt-1 text-body-md text-ink-muted">{error || 'It may be old. Sign in and send a new one from the banner at the top.'}</p>
          <Link to="/login" className="mt-5 inline-block font-semibold text-primary hover:underline">Sign in</Link>
        </div>
      )}
    </AuthLayout>
  )
}
