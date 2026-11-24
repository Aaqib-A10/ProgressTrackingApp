import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Loader2, Plug, ShieldCheck, Unplug } from 'lucide-react'
import { api, apiErrorText } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from '../../components/ui/Button'

/**
 * The Allow page for apps that sign in to Metriq (Claude, ChatGPT, Cursor...: server/src/lib/mcpAuth.ts). The app sends
 * the person here; they are signed in to Metriq as always first (password, two-step sign-in or single sign-on), see
 * which app asks, as whom, and where they go back to, and press Allow or Cancel. Nothing is shared before Allow.
 */

const KEYS = ['response_type', 'client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource'] as const

interface Check {
  ok: boolean
  error?: string
  redirect?: string
  refused?: string
  app?: { name: string; backTo: string; verified: boolean }
  me?: { name: string; email: string; company: string }
}

export default function OAuthAuthorize() {
  const [params] = useSearchParams()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const ask = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v !== undefined)), [params])
  const [check, setCheck] = useState<Check | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null)

  useEffect(() => {
    let live = true
    api.post<Check>('/oauth/authorize/check', ask)
      .then((r) => {
        if (!live) return
        // A problem the app should hear about (the address is its own): send it back with the error.
        if (!r.ok && r.redirect) { window.location.assign(r.redirect); return }
        setCheck(r)
      })
      .catch((e) => live && setFailed(apiErrorText(e, 'Could not open this sign-in. Start again from the app.')))
    return () => { live = false }
  }, [ask])

  async function decide(allow: boolean) {
    setBusy(allow ? 'allow' : 'cancel')
    try {
      const r = await api.post<{ redirect?: string; error?: string }>('/oauth/authorize', { ...ask, allow })
      if (r.redirect) { window.location.assign(r.redirect); return }
      setFailed(r.error ?? 'Something went wrong. Start again from the app.')
    } catch (e) {
      setFailed(apiErrorText(e, 'Something went wrong. Start again from the app.'))
    }
    setBusy(null)
  }

  async function otherAccount() {
    await logout()
    navigate('/login', { replace: true, state: { from: location } })
  }

  const error = failed ?? (check && !check.ok ? check.error ?? 'This sign-in link is not complete. Start again from the app.' : null)

  return (
    <div className="tone-indigo g-wash flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="g-ring g-bar w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-overlay">
        <div className="px-6 pb-6 pt-7 sm:px-8">
          <div className="flex items-center justify-center gap-3">
            <span className="g-fill g-glow flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-bold">M</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-muted"><Plug size={14} /></span>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-bg text-[20px] font-bold text-ink">{(check?.app?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          </div>

          {error ? (
            <div className="mt-6 text-center">
              <AlertTriangle className="mx-auto text-warning-ink" size={26} />
              <h1 className="mt-3 text-headline-md text-ink">Could not connect</h1>
              <p className="mt-2 text-body-md text-ink-muted">{error}</p>
              <Button className="mt-6 w-full" variant="secondary" onClick={() => navigate('/app/connectors')}>Go to Connectors</Button>
            </div>
          ) : !check ? (
            <div className="mt-10 flex justify-center pb-6 text-ink-muted"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Loading</span></div>
          ) : (
            <>
              <h1 className="mt-5 text-center text-headline-md text-ink">
                Connect <span className="g-text font-bold">{check.app!.name}</span> to Metriq?
              </h1>
              <p className="mt-1.5 text-center text-body-md text-ink-muted">
                It will work in Metriq as <b className="font-semibold text-ink">{check.me!.name}</b>
                <span className="block text-body-sm">{check.me!.email} · {check.me!.company}</span>
              </p>

              <ul className="mt-6 space-y-3 text-body-md text-ink">
                <li className="flex gap-3"><Eye size={18} className="mt-0.5 shrink-0 text-primary-ink" /><span>It sees only what you can see in Metriq, and nothing of other people's private things.</span></li>
                <li className="flex gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary-ink" /><span>It can make the changes you ask it to (comments, tasks, updates), under your name.</span></li>
                <li className="flex gap-3"><Unplug size={18} className="mt-0.5 shrink-0 text-primary-ink" /><span>You can disconnect it at any time in Metriq, under Connectors. Changing your password disconnects it too.</span></li>
              </ul>

              <p className="mt-5 flex items-center justify-center gap-1.5 rounded-btn bg-ink/[0.04] px-3 py-2 text-center text-body-sm text-ink-muted">
                <ShieldCheck size={15} className="shrink-0" />
                After you allow, you go back to <b className="font-semibold text-ink">{check.app!.backTo}</b>
              </p>
              {!check.app!.verified && (
                <p className="mt-2 text-center text-[12px] text-ink-faint">Only allow it if you just started connecting {check.app!.name} yourself.</p>
              )}

              {check.refused ? (
                <p role="alert" className="mt-5 rounded-btn bg-warning/15 px-3 py-2 text-body-sm text-warning-ink">{check.refused}</p>
              ) : null}

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button variant="secondary" disabled={!!busy} onClick={() => void decide(false)}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel'}</Button>
                <Button disabled={!!busy || !!check.refused} onClick={() => void decide(true)}>
                  {busy === 'allow' ? 'Connecting…' : <span className="inline-flex items-center gap-1.5">Allow <ArrowRight size={15} /></span>}
                </Button>
              </div>
              <p className="mt-4 text-center text-body-sm text-ink-muted">
                Not {check.me!.name.split(' ')[0]}? <button type="button" onClick={() => void otherAccount()} className="font-semibold text-primary-ink hover:underline">Use another account</button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
