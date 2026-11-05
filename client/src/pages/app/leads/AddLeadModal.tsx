import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { leadsApi, type MetaBusiness } from '../../../lib/leadsApi'
import { Label, Select } from './shared'

/** Add a lead by hand. While typing, the pre-call check runs: the same company already here, or on a list. */
export function AddLeadModal({ business, onClose, onAdded, initial }: { business: MetaBusiness; onClose: () => void; onAdded: (id: string) => void; initial?: { phone?: string } }) {
  const { addToast } = useToast()
  const cmr = business.kind === 'CMR'
  const canManage = business.myRole === 'MANAGER'
  const [f, setF] = useState({ organization: '', name: '', contactRole: '', phone: initial?.phone ?? '', email: '', website: '', industry: '', state: '', message: '', assignTo: canManage ? '' : 'me' })
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<Awaited<ReturnType<typeof leadsApi.check>> | null>(null)
  const timer = useRef<number>()
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!f.organization.trim() && !f.phone.trim() && !f.email.trim() && !f.website.trim()) { setCheck(null); return }
    timer.current = window.setTimeout(() => { leadsApi.check({ business: business.id, organization: f.organization, phone: f.phone, email: f.email, website: f.website }).then(setCheck).catch(() => setCheck(null)) }, 400)
  }, [f.organization, f.phone, f.email, f.website, business.id])

  const go = async (force = false) => {
    setBusy(true)
    try {
      const r = await leadsApi.add({ businessId: business.id, organization: f.organization.trim() || null, name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, website: f.website.trim() || null, industry: f.industry || null, state: f.state || null, message: f.message.trim() || null, ...(cmr ? { contactRole: f.contactRole.trim() || null } : {}), assignTo: f.assignTo === '' ? undefined : f.assignTo === 'none' ? null : f.assignTo, force })
      onAdded(r.lead.id)
    } catch (e) {
      const dupId = (() => { try { return (JSON.parse((e as Error).message) as { duplicateId?: string }).duplicateId ?? null } catch { return null } })()
      if (dupId) { if (window.confirm(`${apiErrorText(e, 'Already here.')}\n\nOpen the existing lead instead?`)) onAdded(dupId); else if (window.confirm('Add it anyway as a second record?')) await go(true) }
      else addToast({ type: 'error', message: apiErrorText(e, 'Could not add') })
    } finally { setBusy(false) }
  }
  const blocked = !!check?.prohibited
  return (
    <Modal open onClose={onClose} title={cmr ? 'New company (first call)' : 'Add a lead'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || blocked || (!f.organization.trim() && !f.name.trim() && !f.phone.trim() && !f.email.trim())} onClick={() => go()}>{cmr ? 'Add and open' : 'Add lead'}</Button></>}>
      <div className="space-y-3">
        {check && (check.hits.length > 0 || check.duplicates.length > 0) && (
          <div className="space-y-1.5">
            {check.hits.map((h, i) => <p key={i} className={`flex items-center gap-2 rounded-btn px-3 py-2 text-body-sm ${h.kind === 'PROHIBITED' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-amber-800'}`}>{h.kind === 'PROHIBITED' ? <Ban size={14} /> : <AlertTriangle size={14} />}{h.kind === 'PROHIBITED' ? 'On the Prohibited Leads list' : 'Already a customer'} ({h.on}: {h.name}){h.kind === 'PROHIBITED' ? ' — do not call.' : ' — mark Existing Customer; Jesse confirms.'}</p>)}
            {check.duplicates.map((d) => <p key={d.id} className="flex flex-wrap items-center gap-2 rounded-btn bg-primary/[0.06] px-3 py-2 text-body-sm text-ink"><AlertTriangle size={14} className="text-primary" />Already here: <strong>{d.organization || d.name}</strong> · {d.statusLabel}{d.assignee ? ` · ${d.assignee.name}` : ''}<button type="button" className="ml-auto font-semibold text-primary hover:underline" onClick={() => onAdded(d.id)}>Open it</button></p>)}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Company" autoFocus value={f.organization} onChange={set('organization')} placeholder="Acme Recycling" />
          <TextField label="Contact name" value={f.name} onChange={set('name')} />
          {cmr && <TextField label="Role" value={f.contactRole} onChange={set('contactRole')} placeholder="Operations manager" />}
          <TextField label="Phone" value={f.phone} onChange={set('phone')} placeholder="602-555-0100" />
          <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
          <TextField label="Website" value={f.website} onChange={set('website')} placeholder="acme.com" />
          <label><Label>{cmr ? 'Segment' : 'Industry'}</Label><Select value={f.industry} onChange={set('industry')} className="w-full"><option value="">—</option>{business.settings.segments.map((s) => <option key={s} value={s}>{s}</option>)}</Select></label>
          <label><Label>State</Label><Select value={f.state} onChange={set('state')} className="w-full"><option value="">—</option>{business.settings.states.map((s) => <option key={s} value={s}>{s}</option>)}</Select></label>
          {canManage && (
            <label className="sm:col-span-2"><Label>Give it to</Label><Select value={f.assignTo} onChange={set('assignTo')} className="w-full"><option value="">Nobody yet (I will assign it)</option><option value="me">Me</option>{business.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></label>
          )}
          <div className="sm:col-span-2"><TextArea label="Notes" rows={2} value={f.message} onChange={set('message')} placeholder={cmr ? 'Anything before the discovery call' : 'What they asked for'} /></div>
        </div>
        {cmr && <p className="text-body-sm text-ink-muted">After adding, log the discovery call on the lead: the five facts, the call summary and the next step.</p>}
      </div>
    </Modal>
  )
}
