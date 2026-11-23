import { useState, type FormEvent } from 'react'
import { t } from '../../lib/i18n'
import { Building2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'

/**
 * "Sign in with your company" on the sign-in page: a person whose company uses single sign-on (SAML) types their
 * work email, and is sent to their company's own sign-in (Okta, Microsoft, Google...). Nothing is shown about
 * whether the email has an account here.
 */
export function SsoSignIn({ next }: { next?: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  async function go(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setBusy(true)
    try {
      const r = await api.post<{ url: string }>('/auth/sso/find', { email: email.trim() })
      window.location.assign(`${r.url}${next ? `?next=${encodeURIComponent(next)}` : ''}`)
    } catch (err) {
      const m = (err as { message?: string })?.message ?? ''
      let text = 'No company signs in with single sign-on for that email. Use your password.'
      try { text = (JSON.parse(m) as { error?: string }).error || text } catch { if (m && !m.startsWith('{')) text = m }
      setError(text)
      setBusy(false)
    }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-btn border border-line bg-card px-3 py-2 text-body-md font-medium text-ink hover:border-line-strong">
        <Building2 size={16} />{t('Sign in with your company (SSO)')}
      </button>
    )
  }
  return (
    <form onSubmit={go} className="mt-3 space-y-2 rounded-btn border border-line p-3" noValidate>
      <label htmlFor="sso-email" className="block text-body-sm font-medium text-ink">{t('Your work email')}</label>
      <input id="sso-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
        className="h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
      {error && <p className="text-body-sm text-danger-ink" role="alert">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !email.trim()}>{busy ? 'Opening your company’s sign-in…' : t('Continue')}</Button>
    </form>
  )
}
