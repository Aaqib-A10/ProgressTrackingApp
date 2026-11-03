import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Ban, Check, Copy, Flag, Globe, Inbox, ListOrdered, Mail, Plus, RefreshCw, Send, Settings2, Trash2, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Modal } from '../../../components/ui/Modal'
import { Toggle } from '../../../components/ui/Toggle'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField, TextArea } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { ago, leadsApi, type BusinessKind, type BusinessRow, type CmrSettings, type InboxInput, type Person, type PipelineStatus } from '../../../lib/leadsApi'
import { Label, Select } from './shared'
import { readFile } from '../itad/dialer/ImportModal'

/**
 * Lead Settings (Super Admin): the businesses that receive leads, who works them (managers assign,
 * reps follow up), the website form for each business, its email inbox and its time limits.
 */

const COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']
const SLA_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240, 480, 1440]
const slaText = (m: number) => (m === 0 ? 'Never' : m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m < 1440 ? `${m / 60} hours` : '1 day')

export default function LeadSettings() {
  const { addToast } = useToast()
  const [list, setList] = useState<BusinessRow[] | null>(null)
  const [people, setPeople] = useState<(Person & { department: string | null })[]>([])
  const [cmrOn, setCmrOn] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const load = () => leadsApi.businesses().then((r) => { setList(r.businesses); setPeople(r.people); setCmrOn(r.cmrOn); setSel((s) => s ?? r.businesses[0]?.id ?? null) }).catch((e) => setErr(apiErrorText(e, 'Could not load')))
  useEffect(() => { void load() }, [])
  const put = (b: BusinessRow) => setList((l) => (l ?? []).map((x) => (x.id === b.id ? { ...x, ...b } : x)))
  const biz = list?.find((b) => b.id === sel) ?? null

  if (err) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Inbox />} title="Lead Settings are not available" hint={err} /></div>

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/app/leads" className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} />Leads</Link>
          <h1 className="mt-1 text-headline-lg text-ink">Lead Settings</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Each business gets its own pipeline, people, website form and inbox. A CMR business adds Jesse, the five facts and the flow.</p>
        </div>
        <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>Add business</Button>
      </div>

      {list && !list.length ? (
        <div className="rounded-card border border-line bg-card p-8">
          <EmptyState icon={<Globe />} title="No businesses yet" hint="Add each brand or company that receives leads, for example RTI or Minnesota Computers." action={<Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setCreating(true)}>Add business</Button>} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <nav className="space-y-1.5">
            {(list ?? []).map((b) => (
              <button key={b.id} type="button" onClick={() => setSel(b.id)} className={cn('flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left transition-colors', sel === b.id ? 'border-primary bg-primary/[0.04]' : 'border-line bg-card hover:border-line-strong')}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: b.color }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-body-md font-semibold text-ink">{b.name}</span><span className="block text-body-sm text-ink-muted">{b.members.length} people · {b.openLeads} open</span></span>
                {b.kind === 'CMR' && <Badge tone="accent">CMR</Badge>}{!b.isActive && <Badge>Off</Badge>}
              </button>
            ))}
          </nav>
          {biz && <BusinessEditor key={biz.id} biz={biz} people={people} cmrOn={cmrOn} onSaved={put} onDeleted={() => { setSel(null); void load() }} toast={addToast} />}
        </div>
      )}

      {creating && <CreateModal cmrOn={cmrOn} onClose={() => setCreating(false)} onCreated={(b) => { setCreating(false); setList((l) => [...(l ?? []), { ...b, openLeads: 0 }].sort((x, y) => x.name.localeCompare(y.name))); setSel(b.id) }} />}
    </div>
  )
}

type Toast = ReturnType<typeof useToast>['addToast']

function Section({ icon, title, hint, children, action }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-ink-faint">{icon}</span>
          <div><h2 className="text-[15px] font-semibold text-ink">{title}</h2>{hint && <p className="mt-0.5 text-body-sm text-ink-muted">{hint}</p>}</div>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function BusinessEditor({ biz, people, cmrOn, onSaved, onDeleted, toast }: { biz: BusinessRow; people: (Person & { department: string | null })[]; cmrOn: boolean; onSaved: (b: BusinessRow) => void; onDeleted: () => void; toast: Toast }) {
  const [f, setF] = useState({ name: biz.name, website: biz.website ?? '', color: biz.color, slaAssignMins: biz.slaAssignMins, slaContactMins: biz.slaContactMins })
  const [busy, setBusy] = useState(false)
  const dirty = f.name !== biz.name || f.website !== (biz.website ?? '') || f.color !== biz.color || f.slaAssignMins !== biz.slaAssignMins || f.slaContactMins !== biz.slaContactMins
  const run = async (fn: () => Promise<{ business: BusinessRow } | unknown>, ok?: string) => {
    setBusy(true)
    try { const r = await fn() as { business?: BusinessRow }; if (r?.business) onSaved(r.business); if (ok) toast({ type: 'success', message: ok }) } catch (e) { toast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-5">
      <Section icon={<Globe size={17} />} title="Business" action={<div className="flex items-center gap-3"><Toggle checked={biz.isActive} onChange={(v) => run(() => leadsApi.updateBusiness(biz.id, { isActive: v }), v ? 'Switched on' : 'Switched off: its form and inbox stop')} label={biz.isActive ? 'On' : 'Off'} /></div>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Website" placeholder="https://example.com" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
          <label><span className="mb-1.5 block text-body-sm font-medium text-ink">Alert managers if a lead is not assigned within</span>
            <select value={f.slaAssignMins} onChange={(e) => setF({ ...f, slaAssignMins: Number(e.target.value) })} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">{SLA_CHOICES.map((m) => <option key={m} value={m}>{slaText(m)}</option>)}</select>
          </label>
          <label><span className="mb-1.5 block text-body-sm font-medium text-ink">Alert the rep if nobody gets in touch within</span>
            <select value={f.slaContactMins} onChange={(e) => setF({ ...f, slaContactMins: Number(e.target.value) })} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md">{SLA_CHOICES.map((m) => <option key={m} value={m}>{slaText(m)}</option>)}</select>
          </label>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-body-sm font-medium text-ink">Colour</span>
            <div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white', f.color === c && 'ring-2 ring-offset-2 ring-offset-card')} style={{ background: c, ['--tw-ring-color' as string]: c }}>{f.color === c && <Check size={14} />}</button>)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 text-body-sm text-danger hover:underline" onClick={() => { if (window.confirm(`Delete ${biz.name}? Only a business with no leads can be deleted.`)) void leadsApi.deleteBusiness(biz.id).then(onDeleted).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not delete') })) }}><Trash2 size={14} />Delete business</button>
          <Button size="sm" disabled={!dirty || busy || !f.name.trim()} onClick={() => run(() => leadsApi.updateBusiness(biz.id, { name: f.name.trim(), website: f.website.trim() || null, color: f.color, slaAssignMins: f.slaAssignMins, slaContactMins: f.slaContactMins }), 'Saved')}>Save changes</Button>
        </div>
      </Section>

      <KindSection biz={biz} people={people} cmrOn={cmrOn} onSaved={onSaved} toast={toast} />
      <PeopleSection biz={biz} people={people} onSaved={onSaved} toast={toast} />
      <PipelineSection biz={biz} onSaved={onSaved} toast={toast} />
      {biz.kind === 'CMR' && <CmrSection biz={biz} onSaved={onSaved} toast={toast} />}
      <ListsSection biz={biz} toast={toast} />
      <FormSection biz={biz} onSaved={onSaved} toast={toast} />
      <InboxSection biz={biz} onSaved={onSaved} toast={toast} />
    </div>
  )
}

function PeopleSection({ biz, people, onSaved, toast }: { biz: BusinessRow; people: (Person & { department: string | null })[]; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const [pick, setPick] = useState('')
  const [role, setRole] = useState<'MANAGER' | 'REP'>('REP')
  const others = useMemo(() => people.filter((p) => !biz.members.some((m) => m.id === p.id)), [people, biz.members])
  const act = (fn: () => Promise<{ business: BusinessRow; returned?: number }>, ok: (r: { returned?: number }) => string) => fn().then((r) => { onSaved(r.business); toast({ type: 'success', message: ok(r) }) }).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not save') }))
  return (
    <Section icon={<Users size={17} />} title="People" hint="Managers see every lead of this business and give them out. Reps see the leads given to them.">
      {biz.members.length ? (
        <ul className="divide-y divide-line rounded-card border border-line">
          {biz.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="min-w-0 flex-1"><span className="block truncate text-body-md font-medium text-ink">{m.name}{!m.isActive && <span className="ml-1.5 text-ink-faint">(inactive)</span>}</span><span className="block truncate text-body-sm text-ink-muted">{m.email}</span></span>
              <select value={m.role} onChange={(e) => act(() => leadsApi.setMember(biz.id, m.id, e.target.value as 'MANAGER' | 'REP'), () => 'Saved')} className="h-8 rounded-btn border border-line bg-card px-2 text-body-sm">
                <option value="MANAGER">Manager</option><option value="REP">Rep</option>
              </select>
              <button type="button" className="rounded-btn p-1.5 text-ink-faint hover:bg-slate-100 hover:text-danger" aria-label={`Remove ${m.name}`} onClick={() => act(() => leadsApi.removeMember(biz.id, m.id), (r) => r.returned ? `Removed. ${r.returned} open lead${r.returned === 1 ? '' : 's'} went back to the managers.` : 'Removed')}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-body-md text-ink-muted">Nobody yet. Until a manager is added, new leads alert the Super Admins.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 min-w-[240px] flex-1 rounded-btn border border-line bg-card px-2.5 text-body-md">
          <option value="">Add a person…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as 'MANAGER' | 'REP')} className="h-9 rounded-btn border border-line bg-card px-2.5 text-body-md"><option value="REP">as Rep</option><option value="MANAGER">as Manager</option></select>
        <Button size="sm" disabled={!pick} onClick={() => act(() => leadsApi.setMember(biz.id, pick, role), () => 'Added').then(() => setPick(''))}>Add</Button>
      </div>
    </Section>
  )
}

function CopyBox({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="relative">
      {label && <p className="mb-1 text-body-sm font-medium text-ink">{label}</p>}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-btn border border-line bg-slate-50 p-3 pr-20 font-mono text-[12px] leading-5 text-ink dark:bg-white/[0.03]">{text}</pre>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }} className={cn('absolute right-2 inline-flex items-center gap-1 rounded-btn border border-line bg-card px-2 py-1 text-body-sm font-medium', label ? 'top-7' : 'top-2')}>{done ? <Check size={13} /> : <Copy size={13} />}{done ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

function FormSection({ biz, onSaved, toast }: { biz: BusinessRow; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const [tab, setTab] = useState<'html' | 'js' | 'wp'>('html')
  const site = biz.website ? biz.website.replace(/\/+$/, '') : 'https://your-site.com'
  const html = `<form action="${biz.formUrl}" method="POST">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Email">
  <input name="phone" placeholder="Phone">
  <input name="company" placeholder="Company">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <!-- Keep these two: the page people see after sending, and a trap for bots (leave it empty and hidden) -->
  <input type="hidden" name="_redirect" value="${site}/thank-you">
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
</form>`
  const js = `// Send any form on the page to Metriq. Field names can be anything (name, email, phone, message...).
// UTM tags and gclid from the page address are added by themselves.
document.querySelector('form#contact').addEventListener('submit', async (e) => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(e.target))
  const url = new URL(location.href)
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid']) if (url.searchParams.get(k)) data[k] = url.searchParams.get(k)
  data.page = location.href
  const r = await fetch('${biz.formUrl}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  if (r.ok) location.href = '${site}/thank-you'
})`
  const wp = `Contact Form 7, WPForms, Gravity Forms, Elementor and others can send each entry to a web address
("webhook"). Use this address, method POST, format JSON or form:

${biz.formUrl}

Or, with no plugin: in the form's email settings, also send the notification email to this business's
lead inbox (below). Emails that list fields as "Name: ...", "Phone: ..." become leads with those fields.`
  return (
    <Section icon={<Globe size={17} />} title="Website form" hint="Every website form that posts here becomes a lead of this business. Any field names work."
      action={<div className="flex gap-2">
        <Button size="sm" variant="secondary" leadingIcon={<Send size={14} />} onClick={() => leadsApi.testLead(biz.id).then(() => toast({ type: 'success', message: 'Test lead sent. Find it under Leads, then mark it Spam.' })).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not send') }))}>Send a test lead</Button>
        <Button size="sm" variant="ghost" leadingIcon={<RefreshCw size={14} />} onClick={() => { if (window.confirm('Make a new form address? The old one stops working, so every form on the site must be updated.')) void leadsApi.newFormKey(biz.id).then((r) => { onSaved(r.business); toast({ type: 'success', message: 'New address made' }) }) }}>New address</Button>
      </div>}>
      <CopyBox label="Form address" text={biz.formUrl} />
      <div className="mt-4 flex gap-1">
        {([['html', 'HTML form'], ['js', 'Your own form (JavaScript)'], ['wp', 'WordPress and form plugins']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('h-8 rounded-full px-3 text-body-sm font-medium', tab === k ? 'bg-ink text-card' : 'text-ink-muted hover:bg-slate-100')}>{l}</button>
        ))}
      </div>
      <div className="mt-3"><CopyBox text={tab === 'html' ? html : tab === 'js' ? js : wp} /></div>
      <p className="mt-3 text-body-sm text-ink-muted">The same person sending again while their lead is open is added to that lead (not a new one). Bots that fill the hidden <code>_hp</code> field are ignored.</p>
    </Section>
  )
}

const PRESETS: { label: string; host: string; port: number; hint: string }[] = [
  { label: 'Google Workspace / Gmail', host: 'imap.gmail.com', port: 993, hint: 'Use an app password (Google account, Security, 2-Step Verification, App passwords).' },
  { label: 'Microsoft 365 / Outlook', host: 'outlook.office365.com', port: 993, hint: 'Your Microsoft 365 admin may need to allow IMAP for this mailbox.' },
  { label: 'cPanel / other', host: '', port: 993, hint: 'Your host gives the IMAP server name (often mail.your-domain.com).' },
]

function InboxSection({ biz, onSaved, toast }: { biz: BusinessRow; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const [f, setF] = useState<InboxInput>({ inboxOn: biz.inboxOn, inboxHost: biz.inboxHost, inboxPort: biz.inboxPort, inboxSecure: biz.inboxSecure, inboxUser: biz.inboxUser, inboxFolder: biz.inboxFolder, password: '' })
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const preset = PRESETS.find((p) => p.host && p.host === f.inboxHost) ?? (f.inboxHost ? PRESETS[2] : null)
  const save = async (on = f.inboxOn) => {
    setBusy(true)
    try { const r = await leadsApi.saveInbox(biz.id, { ...f, inboxOn: on, password: f.password || undefined }); onSaved(r.business); setF({ ...f, inboxOn: on, password: '' }); toast({ type: 'success', message: on ? 'Inbox on: new emails become leads within 2 minutes' : 'Saved' }) } catch (e) { toast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) }
  }
  const tryIt = async () => {
    setBusy(true); setTest(null)
    try { const r = await leadsApi.testInbox(biz.id, { ...f, password: f.password || undefined }); setTest(r.ok ? { ok: true, text: `Connected. ${r.messages ?? 0} emails in ${f.inboxFolder}.` } : { ok: false, text: r.error ?? 'Could not connect' }) } catch (e) { setTest({ ok: false, text: apiErrorText(e, 'Could not connect') }) } finally { setBusy(false) }
  }
  return (
    <Section icon={<Mail size={17} />} title="Email inbox" hint="New emails to this mailbox become leads (checked every 2 minutes). Only emails that arrive after it is switched on; nothing in the mailbox is changed."
      action={<Toggle checked={biz.inboxOn} onChange={(v) => void save(v)} label={biz.inboxOn ? 'On' : 'Off'} />}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => setF({ ...f, inboxHost: p.host || f.inboxHost, inboxPort: p.port, inboxSecure: true })} className={cn('h-8 rounded-full border px-3 text-body-sm', preset?.label === p.label ? 'border-primary bg-primary/[0.06] text-primary' : 'border-line text-ink-muted hover:text-ink')}>{p.label}</button>)}
      </div>
      {preset && <p className="mb-3 text-body-sm text-ink-muted">{preset.hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Mail server (IMAP)" placeholder="imap.gmail.com" value={f.inboxHost ?? ''} onChange={(e) => setF({ ...f, inboxHost: e.target.value })} />
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <TextField label="Port" inputMode="numeric" value={String(f.inboxPort)} onChange={(e) => setF({ ...f, inboxPort: Number(e.target.value.replace(/\D/g, '')) || 993 })} />
          <label className="flex h-9 items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={f.inboxSecure} onChange={(e) => setF({ ...f, inboxSecure: e.target.checked })} />SSL</label>
        </div>
        <TextField label="Email / user name" placeholder="sales@your-domain.com" value={f.inboxUser ?? ''} onChange={(e) => setF({ ...f, inboxUser: e.target.value })} />
        <TextField label={biz.inboxHasPassword ? 'Password (saved; type to change)' : 'Password'} type="password" autoComplete="new-password" placeholder={biz.inboxHasPassword ? '••••••••' : ''} value={f.password ?? ''} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <TextField label="Folder" value={f.inboxFolder} onChange={(e) => setF({ ...f, inboxFolder: e.target.value })} />
      </div>
      {test && <p className={cn('mt-3 rounded-btn px-3 py-2 text-body-sm', test.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>{test.text}</p>}
      {biz.inboxOn && (biz.inboxError ? <p className="mt-3 rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">Last check failed: {biz.inboxError}</p> : biz.inboxCheckedAt ? <p className="mt-3 text-body-sm text-ink-muted">Last checked {ago(biz.inboxCheckedAt)}.</p> : <p className="mt-3 text-body-sm text-ink-muted">First check within 2 minutes.</p>)}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !f.inboxHost || !f.inboxUser} onClick={tryIt}>Test connection</Button>
        <Button size="sm" disabled={busy} onClick={() => save()}>Save inbox</Button>
      </div>
    </Section>
  )
}

function CreateModal({ cmrOn, onClose, onCreated }: { cmrOn: boolean; onClose: () => void; onCreated: (b: BusinessRow) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [kind, setKind] = useState<BusinessKind>('GENERAL')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { const r = await leadsApi.createBusiness({ name: name.trim(), website: website.trim() || null, color: kind === 'CMR' ? '#059669' : COLORS[Math.floor(Math.random() * COLORS.length)], kind }); onCreated(r.business) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not add') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add a business" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={go}>Add</Button></>}>
      <div className="space-y-3">
        <TextField label="Name" autoFocus placeholder="Recycle Technologies" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Website (optional)" placeholder="https://example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        <div><Label>Kind</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['GENERAL', 'Usual pipeline', 'New → Contacted → Qualified → Won / Lost'], ['CMR', 'CMR flow', 'Five facts, Jesse’s queue and decisions, meetings, daily report']] as const).map(([k, t, h]) => (
              <button key={k} type="button" disabled={k === 'CMR' && !cmrOn} onClick={() => setKind(k)} className={cn('rounded-card border p-3 text-left disabled:opacity-50', kind === k ? 'border-primary bg-primary/[0.06]' : 'border-line')}><span className="block text-body-sm font-semibold text-ink">{t}</span><span className="block text-[11.5px] text-ink-muted">{h}{k === 'CMR' && !cmrOn ? ' · switched off for your company' : ''}</span></button>
            ))}
          </div>
        </div>
        <p className="text-body-sm text-ink-muted">Next: add its managers and reps{kind === 'CMR' ? ', set Jesse as the head' : ''}, then put its form address on the website.</p>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ kind, head, pipeline, CMR settings, lists

function KindSection({ biz, people, cmrOn, onSaved, toast }: { biz: BusinessRow; people: (Person & { department: string | null })[]; cmrOn: boolean; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const save = (b: Parameters<typeof leadsApi.updateBusiness>[1], ok: string) => leadsApi.updateBusiness(biz.id, b).then((r) => { onSaved(r.business); toast({ type: 'success', message: ok }) }).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not save') }))
  return (
    <Section icon={<Flag size={17} />} title="Kind and head" hint="The kind decides the pipeline and the flow. The head (CMR: Jesse) sees every lead, decides on flagged ones and hears every call.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><Label>Kind</Label><Select value={biz.kind} onChange={(e) => { if (window.confirm(`Change ${biz.name} to the ${e.target.value === 'CMR' ? 'CMR flow' : 'usual pipeline'}? Existing leads keep their status.`)) void save({ kind: e.target.value as BusinessKind }, 'Kind changed') }} className="w-full"><option value="GENERAL">Usual pipeline</option><option value="CMR" disabled={!cmrOn}>CMR flow{cmrOn ? '' : ' (switched off for your company)'}</option></Select></label>
        <label><Label>Head{biz.kind === 'CMR' ? ' (Jesse)' : ''}</Label><Select value={biz.headId ?? ''} onChange={(e) => void save({ headId: e.target.value || null }, e.target.value ? 'Head set' : 'Head removed')} className="w-full"><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}</Select></label>
      </div>
      {biz.kind === 'CMR' && !biz.headId && <p className="mt-3 rounded-btn bg-warning/10 px-3 py-2 text-body-sm text-amber-800">Set Jesse as the head so flagged leads reach him. If he is not in Metriq yet, invite him under Admin → Users first.</p>}
    </Section>
  )
}

const PIPE_COLORS = ['#4F46E5', '#0EA5E9', '#F59E0B', '#22C55E', '#059669', '#8B5CF6', '#EF4444', '#DC2626', '#64748B', '#14B8A6']
function PipelineSection({ biz, onSaved, toast }: { biz: BusinessRow; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const [rows, setRows] = useState<PipelineStatus[]>(biz.pipeline)
  const [edit, setEdit] = useState(false)
  useEffect(() => setRows(biz.pipeline), [biz.pipeline])
  const save = (p: PipelineStatus[] | null) => leadsApi.updateBusiness(biz.id, { pipeline: p }).then((r) => { onSaved(r.business); setEdit(false); toast({ type: 'success', message: p ? 'Pipeline saved' : 'Back to the standard pipeline' }) }).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not save') }))
  const keyOf = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'STATUS'
  return (
    <Section icon={<ListOrdered size={17} />} title="Pipeline" hint="The statuses leads move through, in order. Open statuses count as active; the rest close a lead." action={<div className="flex gap-2">{biz.ownPipeline && <Button size="sm" variant="ghost" onClick={() => save(null)}>Use the standard one</Button>}{edit ? <><Button size="sm" variant="ghost" onClick={() => { setRows(biz.pipeline); setEdit(false) }}>Cancel</Button><Button size="sm" onClick={() => save(rows)}>Save</Button></> : <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Edit</Button>}</div>}>
      {!edit ? (
        <div className="flex flex-wrap gap-2">{biz.pipeline.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-body-sm font-semibold" style={{ background: `${s.color}1a`, color: s.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}{!s.open && <span className="font-normal opacity-70">· closes</span>}</span>)}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto_auto_auto] items-center gap-2">
              <TextField value={s.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key === 'NEW' ? 'NEW' : keyOf(e.target.value) } : x)))} aria-label="Status name" />
              <Select value={s.color} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} style={{ color: s.color }}>{PIPE_COLORS.map((c) => <option key={c} value={c} style={{ color: c }}>●  {c}</option>)}</Select>
              <label className="flex items-center gap-1.5 text-body-sm text-ink"><input type="checkbox" checked={s.open} disabled={s.key === 'NEW'} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)))} />Open</label>
              <span className="flex gap-0.5"><button type="button" disabled={i === 0} className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30" onClick={() => { const r = [...rows]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; setRows(r) }} aria-label="Up">↑</button><button type="button" disabled={i === rows.length - 1} className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30" onClick={() => { const r = [...rows]; [r[i + 1], r[i]] = [r[i], r[i + 1]]; setRows(r) }} aria-label="Down">↓</button></span>
              <button type="button" disabled={s.key === 'NEW' || rows.length <= 2} className="rounded p-1 text-ink-faint hover:text-danger disabled:opacity-30" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" leadingIcon={<Plus size={14} />} onClick={() => setRows([...rows, { key: `STATUS_${rows.length + 1}`, label: '', color: PIPE_COLORS[rows.length % PIPE_COLORS.length], open: true }])}>Add status</Button>
          <p className="text-[11.5px] text-ink-muted">NEW stays first (leads start there). Renaming a status keeps the leads in it.</p>
        </div>
      )}
    </Section>
  )
}

function CmrSection({ biz, onSaved, toast }: { biz: BusinessRow; onSaved: (b: BusinessRow) => void; toast: Toast }) {
  const [f, setF] = useState<CmrSettings>(biz.settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setF(biz.settings), [biz.settings])
  const list = (v: string[]) => v.join(', ')
  const parse = (s: string) => s.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean)
  const save = async () => { setBusy(true); try { const r = await leadsApi.updateBusiness(biz.id, { settings: f }); onSaved(r.business); toast({ type: 'success', message: 'CMR settings saved' }) } catch (e) { toast({ type: 'error', message: apiErrorText(e, 'Could not save') }) } finally { setBusy(false) } }
  return (
    <Section icon={<Settings2 size={17} />} title="CMR flow settings" hint="The words the SDRs pick from, the meeting copy address, consent states and the Send-info email." action={<Button size="sm" disabled={busy} onClick={save}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Copy every meeting invite to (email)" type="email" value={f.copyEmail} onChange={(e) => setF({ ...f, copyEmail: e.target.value })} placeholder="aaqib@…" />
        <TextField label="Their name" value={f.copyName} onChange={(e) => setF({ ...f, copyName: e.target.value })} />
        <TextField label="Two-party consent states" value={list(f.consentStates)} onChange={(e) => setF({ ...f, consentStates: parse(e.target.value) })} placeholder="CA, WA" />
        <div className="grid grid-cols-3 gap-2">
          <TextField label="Published rate ($/lb)" inputMode="decimal" value={String(f.publishedRate)} onChange={(e) => setF({ ...f, publishedRate: Number(e.target.value) || 0 })} />
          <TextField label="Min load (lb)" inputMode="numeric" value={String(f.minLoadLbs)} onChange={(e) => setF({ ...f, minLoadLbs: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          <TextField label="Connected ≥ (s)" inputMode="numeric" value={String(f.connectedSecs)} onChange={(e) => setF({ ...f, connectedSecs: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </div>
        <TextArea label="Segments (one per line or comma separated)" rows={3} value={list(f.segments)} onChange={(e) => setF({ ...f, segments: parse(e.target.value) })} />
        <TextArea label="States" rows={3} value={list(f.states)} onChange={(e) => setF({ ...f, states: parse(e.target.value) })} />
        <div className="sm:col-span-2"><TextField label="Send-info email subject" value={f.infoSubject} onChange={(e) => setF({ ...f, infoSubject: e.target.value })} /></div>
        <div className="sm:col-span-2"><TextArea label="Send-info email text" rows={10} value={f.infoBody} onChange={(e) => setF({ ...f, infoBody: e.target.value })} /><p className="mt-1 text-[11.5px] text-ink-muted">Placeholders: {'{{company}} {{contact}} {{sdr}} {{rate}} {{note}}'}. No price beyond the published rate, no freight or pickup promise: Metriq refuses those.</p></div>
      </div>
    </Section>
  )
}

function ListsSection({ biz, toast }: { biz: BusinessRow; toast: Toast }) {
  const [kind, setKind] = useState<'PROHIBITED' | 'CUSTOMER'>('PROHIBITED')
  const [rows, setRows] = useState<{ id: string; name: string; phone: string | null; email: string | null; website: string | null; note: string | null }[] | null>(null)
  const [text, setText] = useState('')
  const load = () => leadsApi.listEntries(biz.id, kind).then((r) => setRows(r.entries)).catch(() => setRows([]))
  useEffect(() => { void load() }, [biz.id, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (entries: { name: string; phone?: string | null; email?: string | null; website?: string | null; note?: string | null }[]) => leadsApi.addEntries(biz.id, kind, entries).then((r) => { toast({ type: 'success', message: `${r.added} added${r.already ? `, ${r.already} already there` : ''}${r.flagged ? ` · ${r.flagged} lead${r.flagged === 1 ? '' : 's'} re-flagged` : ''}` }); setText(''); void load() }).catch((e) => toast({ type: 'error', message: apiErrorText(e, 'Could not add') }))
  const fromFile = async (file: File) => {
    try {
      const r = await readFile(file)
      const low = r.headers.map((h) => h.toLowerCase())
      const col = (names: string[]) => low.findIndex((h) => names.some((n) => h.includes(n)))
      const iName = col(['company', 'name', 'account']), iPhone = col(['phone']), iEmail = col(['email']), iSite = col(['website', 'url', 'domain']), iNote = col(['note', 'reason'])
      const cell = (row: (string | number | null)[], i: number) => (i < 0 ? null : String(row[i] ?? '').trim() || null)
      const entries = r.rows.map((row) => ({ name: cell(row, iName) ?? '', phone: cell(row, iPhone), email: cell(row, iEmail), website: cell(row, iSite), note: cell(row, iNote) })).filter((e) => e.name)
      if (!entries.length) { toast({ type: 'error', message: 'No company names found (the first row must be the column names).' }); return }
      await add(entries)
    } catch (e) { toast({ type: 'error', message: apiErrorText(e, 'Could not read the file') }) }
  }
  return (
    <Section icon={<Ban size={17} />} title="Prohibited leads and existing customers" hint="The pre-call check: a company on either list is flagged the moment it is added, and the Prohibited list blocks calls. Match by company name, phone, email or website.">
      <div className="mb-3 inline-flex rounded-btn border border-line bg-card p-0.5">{(['PROHIBITED', 'CUSTOMER'] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', kind === k ? 'bg-ink text-card' : 'text-ink-muted')}>{k === 'PROHIBITED' ? 'Prohibited Leads' : 'Existing customers'}{rows && kind === k ? ` (${rows.length})` : ''}</button>)}</div>
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="max-h-72 overflow-auto rounded-card border border-line">
          {rows?.length ? <ul className="divide-y divide-line">{rows.map((r) => <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-body-sm"><span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{r.name}</span><span className="block truncate text-[11.5px] text-ink-muted">{[r.phone, r.email, r.website, r.note].filter(Boolean).join(' · ')}</span></span><button type="button" className="text-ink-faint hover:text-danger" aria-label={`Remove ${r.name}`} onClick={() => leadsApi.removeEntry(biz.id, r.id).then(() => load())}><Trash2 size={14} /></button></li>)}</ul> : <p className="p-4 text-body-sm text-ink-muted">{rows ? 'Empty. Add names on the right, or upload the list.' : 'Loading…'}</p>}
        </div>
        <div className="space-y-2">
          <TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'One per line, e.g.\nKBI\nLRI, 602-555-0100\nS&P Global, , , spglobal.com'} />
          <div className="flex items-center justify-between gap-2">
            <label className="cursor-pointer text-body-sm text-primary hover:underline">Upload CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = '' }} /></label>
            <Button size="sm" disabled={!text.trim()} onClick={() => add(text.split('\n').map((line) => { const [name, phone, email, website, note] = line.split(',').map((x) => x.trim()); return { name: name ?? '', phone: phone || null, email: email || null, website: website || null, note: note || null } }).filter((e) => e.name))}>Add</Button>
          </div>
          <p className="text-[11.5px] text-ink-muted">Columns in a file: Company, Phone, Email, Website, Note (any order; the first row names them).</p>
        </div>
      </div>
    </Section>
  )
}
