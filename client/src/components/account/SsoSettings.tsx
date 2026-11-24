import { useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { useToast } from '../ui/Toast'
import { areaCls, errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * Company settings, "Single sign-on (SAML)": the company's people sign in through its own identity provider (Okta,
 * Microsoft Entra ID, Google Workspace...). Step 1 gives the identity provider our details; step 2 takes its details.
 */
interface Sso {
  on: boolean; entryPoint: string; idpIssuer: string; domains: string[]; required: boolean; createPeople: boolean
  cert: { set: boolean; expires: string | null }
  sp: { entityId: string; acsUrl: string; metadataUrl: string; startUrl: string }
  signedInWithSso: boolean
}

export function SsoSettings() {
  const { addToast } = useToast()
  const [s, setS] = useState<Sso | null>(null)
  const [cert, setCert] = useState('')
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<{ sso: Sso }>('/company/sso').then((r) => { setS(r.sso); setDomains(r.sso.domains.join(', ')) }).catch(() => setS(null)) }, [])
  if (!s) return null
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => addToast({ type: 'success', message: 'Copied.' })).catch(() => addToast({ type: 'error', message: 'Could not copy. Select it and copy.' }))
  async function save(next: Partial<Sso> = {}) {
    setBusy(true)
    try {
      const body = { on: s!.on, entryPoint: s!.entryPoint.trim(), idpIssuer: s!.idpIssuer.trim(), cert: cert.trim() || undefined, domains: domains.split(/[\s,;]+/).map((d) => d.trim().replace(/^@/, '')).filter(Boolean), required: s!.required, createPeople: s!.createPeople, ...next }
      const r = await api.put<{ sso: Sso }>('/company/sso', body)
      setS(r.sso); setCert(''); setDomains(r.sso.domains.join(', '))
      addToast({ type: 'success', message: 'Saved.' })
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  const row = (label: string, value: string) => (
    <div className="flex items-center gap-2">
      <span className="w-44 shrink-0 text-body-sm text-ink-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-[12px] text-ink" title={value}>{value}</code>
      <button type="button" onClick={() => void copy(value)} className="rounded p-1 text-ink-faint hover:text-ink" aria-label={`Copy ${label}`}><Copy size={14} /></button>
    </div>
  )
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound size={16} className="text-primary-ink" />Single sign-on (SAML)</span>} subtitle="Your people sign in through your company's own login (Okta, Microsoft Entra ID, Google Workspace and others).">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-body-sm font-semibold text-ink">1. In your identity provider, add Metriq as an app with these details</p>
          {row('Entity ID (audience)', s.sp.entityId)}
          {row('Reply URL (ACS)', s.sp.acsUrl)}
          {row('Metadata URL', s.sp.metadataUrl)}
          <p className="text-body-sm text-ink-muted">Send the person's email address as the NameID. Sign the assertion.</p>
        </div>
        <div className="space-y-3">
          <p className="text-body-sm font-semibold text-ink">2. Paste your identity provider's details here</p>
          <div><label className={labelCls} htmlFor="sso-entry">Sign-in URL (SSO URL)</label><input id="sso-entry" value={s.entryPoint} onChange={(e) => setS({ ...s, entryPoint: e.target.value })} placeholder="https://yourcompany.okta.com/app/.../sso/saml" className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="sso-issuer">Issuer (entity ID of the identity provider, optional)</label><input id="sso-issuer" value={s.idpIssuer} onChange={(e) => setS({ ...s, idpIssuer: e.target.value })} className={inputCls} /></div>
          <div>
            <label className={labelCls} htmlFor="sso-cert">Signing certificate</label>
            <textarea id="sso-cert" rows={4} value={cert} onChange={(e) => setCert(e.target.value)} placeholder={s.cert.set ? 'A certificate is saved. Paste a new one only to replace it.' : '-----BEGIN CERTIFICATE-----'} className={`${areaCls} font-mono text-[12px]`} />
            {s.cert.set && s.cert.expires && <p className="mt-1 text-body-sm text-ink-muted">The saved certificate is valid until {new Date(s.cert.expires).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}.</p>}
          </div>
          <div><label className={labelCls} htmlFor="sso-domains">Email domains that sign in this way</label><input id="sso-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yourcompany.com" className={inputCls} /></div>
          <label className="flex items-center gap-3 text-body-md text-ink"><Toggle checked={s.createPeople} onChange={(v) => setS({ ...s, createPeople: v })} label="Add people on their first sign-in" />Add people who are not in Metriq yet on their first sign-in (as members)</label>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => void save()}>Save</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void save({ on: !s.on })}>{s.on ? 'Turn single sign-on off' : 'Turn single sign-on on'}</Button>
            <span className="text-body-sm text-ink-muted">{s.on ? 'On: people can sign in with their company.' : 'Off.'}</span>
          </div>
        </div>
        {s.on && (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-body-sm font-semibold text-ink">3. Require it (optional)</p>
            <p className="text-body-sm text-ink-muted">Passwords then stop working for everyone except Super Admins, who keep theirs in case your identity provider is down. {s.signedInWithSso ? '' : 'To turn this on, sign out and sign in with single sign-on once: that proves the settings work.'}</p>
            <label className="flex items-center gap-3 text-body-md text-ink"><Toggle checked={s.required} disabled={busy || (!s.required && !s.signedInWithSso)} onChange={(v) => void save({ required: v })} label="Require single sign-on" />Require single sign-on</label>
          </div>
        )}
      </div>
    </Card>
  )
}
