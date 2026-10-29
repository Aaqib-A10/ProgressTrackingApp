import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

/**
 * Sign in or sign up with Google / Microsoft (Phase 1, step 7). Until the owner turns on "Sign in
 * with Google and Microsoft" (and the keys are on the server), both buttons show "coming soon".
 */
const ALL = [{ key: 'google', label: 'Google' }, { key: 'microsoft', label: 'Microsoft' }]

export function OAuthButtons({ intent, mode, company, label }: { intent: 'signin' | 'signup'; mode?: 'team' | 'solo'; company?: string; label: string }) {
  const [state, setState] = useState<{ open: boolean; providers: { key: string; label: string }[] } | null>(null)
  useEffect(() => { api.get<{ open?: boolean; providers: { key: string; label: string }[] }>('/auth/oauth/providers').then((r) => setState({ open: !!r.open, providers: r.providers })).catch(() => setState({ open: false, providers: [] })) }, [])
  if (!state) return null
  const href = (key: string) => `/api/auth/oauth/${key}/start?${new URLSearchParams({ intent, ...(mode ? { mode } : {}), ...(company ? { company } : {}) })}`
  const live = state.open && state.providers.length > 0
  const list = live ? state.providers : ALL
  return (
    <>
      <div className="my-5 flex items-center gap-3 text-body-sm text-ink-muted">
        <span className="h-px flex-1 bg-line" /> {label} <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {list.map((p) => live ? (
          <a key={p.key} href={href(p.key)} className="inline-flex h-10 items-center justify-center gap-2.5 rounded-btn border border-line bg-card text-body-md font-semibold text-ink transition-colors hover:bg-slate-50">
            {p.key === 'google' ? <GoogleMark /> : <MicrosoftMark />}
            {p.label}
          </a>
        ) : (
          <span key={p.key} aria-disabled="true" title={`${p.label} sign-in is coming soon`} className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-btn border border-dashed border-line bg-card text-body-md font-semibold text-ink-muted">
            <span className="opacity-60">{p.key === 'google' ? <GoogleMark /> : <MicrosoftMark />}</span>
            {p.label}
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Soon</span>
          </span>
        ))}
      </div>
    </>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
function MicrosoftMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}
