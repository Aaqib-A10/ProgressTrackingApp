import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CheckCircle2, Circle, Crown, Eye, Flag, Globe, Headset, ShieldCheck, ToggleRight, Upload, UserCog, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'
import { apiErrorText } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { leadsApi, type BusinessKind, type BusinessRow, type Person } from '../../../lib/leadsApi'
import { Label } from './shared'

/**
 * The guided setup for Lead Management: what to do, in order, and who sees what afterwards.
 * Shown as the first screen of Lead Settings while there is no business, and as a checklist
 * on each business until its people are in and its leads are imported.
 */

export type SetupPerson = Person & { role: string; department: string | null; departmentType?: string | null }

const WHO_SEES: { icon: React.ReactNode; who: string; what: string }[] = [
  { icon: <ShieldCheck size={15} />, who: 'Super Admin', what: 'Every business, every lead, every screen: Lead Dashboard, Leads, Agent Tasks, Calls, Jesse Queue, Daily Report, Jesse Summary and these settings.' },
  { icon: <UserCog size={15} />, who: 'Team lead (Manager)', what: 'Every lead of their business. Imports the sheet, gives leads to the SDRs, reads the Daily Report and Jesse Summary.' },
  { icon: <Crown size={15} />, who: 'Head (Jesse)', what: 'Sees every lead of the business, gets the flagged ones in Jesse Queue, decides (meeting, direction, close) and can listen to calls.' },
  { icon: <Headset size={15} />, who: 'SDR (Rep)', what: 'Only the leads given to them: logs calls, sends the info email, qualifies, offers slots, writes the Daily Report.' },
]

export function WhoSeesWhat({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
      {WHO_SEES.map((r) => (
        <div key={r.who} className="rounded-card border border-line bg-card p-3.5">
          <span className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-ink"><span className="text-primary">{r.icon}</span>{r.who}</span>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">{r.what}</p>
        </div>
      ))}
    </div>
  )
}

function Step({ n, done, title, children, action }: { n: number; done: boolean; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className={cn('flex gap-4 rounded-card border p-4', done ? 'border-success/30 bg-success/[0.04]' : 'border-line bg-card')}>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-sm font-bold', done ? 'bg-success text-white' : 'bg-primary/10 text-primary')}>{done ? <Check size={16} /> : n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <div className="mt-1 text-body-sm leading-6 text-ink-muted">{children}</div>
        {action && !done && <div className="mt-2.5">{action}</div>}
      </div>
    </li>
  )
}

/** The first screen when the company has no business yet. */
export function SetupSteps({ cmrOn, onCreate }: { cmrOn: boolean; onCreate: () => void }) {
  return (
    <div className="space-y-5">
      <section className="rounded-card border border-line bg-gradient-to-br from-primary/[0.06] to-accent/[0.06] p-6">
        <h2 className="text-headline-md text-ink">Set up Lead Management in four steps</h2>
        <p className="mt-1 max-w-3xl text-body-md text-ink-muted">A <strong className="font-semibold text-ink">business</strong> is one brand or team that receives leads (for example "CMR"). Each business has its own pipeline, people and settings. Make the business first, then put its people on it, then bring the leads in.</p>
      </section>
      <ol className="space-y-3">
        <Step n={1} done={cmrOn} title="Switch on the CMR flow for this company" action={<Link to="/owner/switches" className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline">Open Switches <ArrowRight size={14} /></Link>}>
          In the Metriq owner console, Switches → your company → turn on <strong className="font-medium text-ink">CMR flow</strong>. Without it a business can only use the usual pipeline (New → Contacted → Qualified → Won / Lost).{cmrOn && ' Done: the CMR flow is on.'}
        </Step>
        <Step n={2} done={false} title="Add the business and its people" action={<Button size="sm" onClick={onCreate}>Add business</Button>}>
          Name it (e.g. "CMR"), pick the <strong className="font-medium text-ink">CMR flow</strong>, set <strong className="font-medium text-ink">Jesse as head</strong>, your <strong className="font-medium text-ink">team lead as Manager</strong> and <strong className="font-medium text-ink">Matthew and Mark as Reps</strong>. Anyone not in Metriq yet is invited under <Link to="/app/admin/users" className="text-primary hover:underline">Admin → Users</Link> first; their Metriq role (Member, Team Lead) does not matter here, this screen decides what they see in Leads.
        </Step>
        <Step n={3} done={false} title="Import the CMR_Lead_Tracker sheet">
          Download the sheet's <em>Leads</em> tab as CSV (Google Sheets: File → Download → CSV), then on the Leads page press <strong className="font-medium text-ink">Import</strong>. One lead per company, every row becomes a call under it; the SDR column assigns the lead, "Jesse Input Needed = Yes" flags it for Jesse, Next Step + date become an Agent Task.
        </Step>
        <Step n={4} done={false} title="Work from the dashboards">
          <strong className="font-medium text-ink">Lead Dashboard</strong> and <strong className="font-medium text-ink">Leads</strong> show everything (Super Admin and team lead) or your own (SDR). <strong className="font-medium text-ink">Jesse Queue</strong> holds what waits on Jesse, <strong className="font-medium text-ink">Jesse Summary</strong> is the sheet's summary tab, live. Later, switch the website form and inbox on so new leads arrive by themselves.
        </Step>
      </ol>
      <section>
        <h2 className="mb-2 inline-flex items-center gap-2 text-[15px] font-semibold text-ink"><Eye size={16} className="text-ink-faint" />Who sees what</h2>
        <WhoSeesWhat />
      </section>
    </div>
  )
}

/** The checklist on top of one business until it is ready. */
export function SetupChecklist({ biz, cmrOn }: { biz: BusinessRow; cmrOn: boolean }) {
  const cmr = biz.kind === 'CMR'
  const managers = biz.members.filter((m) => m.role === 'MANAGER'), reps = biz.members.filter((m) => m.role === 'REP')
  const items: { key: string; done: boolean; text: string; hint?: string; to?: string; toText?: string }[] = [
    ...(cmr && !cmrOn ? [{ key: 'flag', done: false, text: 'The CMR flow switch is off for this company', hint: 'Owner console → Switches → your company → CMR flow. Until then the CMR screens stay hidden.', to: '/owner/switches', toText: 'Open Switches' }] : []),
    ...(cmr ? [{ key: 'head', done: !!biz.headId, text: biz.head ? `Head: ${biz.head.name}` : 'Set Jesse as the head', hint: 'Below, under "Kind and head". Flagged leads and qualify requests go to him.' }] : []),
    { key: 'manager', done: managers.length > 0, text: managers.length ? `Team lead: ${managers.map((m) => m.name).join(', ')}` : 'Add the team lead as a Manager', hint: 'Under "People". A manager sees every lead of this business and gives them out.' },
    { key: 'reps', done: reps.length > 0, text: reps.length ? `SDRs: ${reps.map((m) => m.name).join(', ')}` : 'Add the SDRs as Reps', hint: 'Under "People". The sheet\'s SDR column must match their first names (Matthew, Mark) for the import to assign leads.' },
    { key: 'leads', done: biz.leadCount > 0, text: biz.leadCount ? `${biz.leadCount} lead${biz.leadCount === 1 ? '' : 's'} in` : 'Import the sheet (or add the first lead)', hint: 'Leads → Import → pick the CSV of the Leads tab.', to: `/app/leads?business=${biz.id}&import=1`, toText: 'Import now' },
  ]
  const left = items.filter((i) => !i.done)
  if (!left.length) return null
  return (
    <section className="rounded-card border border-primary/30 bg-primary/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink"><Flag size={16} className="text-primary" />{biz.name}: {left.length} step{left.length === 1 ? '' : 's'} left before the team can work</h2>
        <span className="text-body-sm text-ink-muted">{items.length - left.length} of {items.length} done</span>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map((i) => (
          <li key={i.key} className={cn('flex items-start gap-2.5 rounded-btn px-3 py-2', i.done ? 'text-ink-muted' : 'bg-card text-ink shadow-xs')}>
            {i.done ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success" /> : <Circle size={17} className="mt-0.5 shrink-0 text-ink-faint" />}
            <span className="min-w-0">
              <span className={cn('block text-body-sm', i.done ? 'line-through' : 'font-semibold')}>{i.text}</span>
              {!i.done && i.hint && <span className="block text-[12px] text-ink-muted">{i.hint}</span>}
              {!i.done && i.to && <Link to={i.to} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">{i.toText} <ArrowRight size={12} /></Link>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

/** Add a business with its head, team lead and reps in one go. */
export function CreateBusinessWizard({ cmrOn, people, onClose, onCreated }: { cmrOn: boolean; people: SetupPerson[]; onClose: () => void; onCreated: (b: BusinessRow, note: string) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [kind, setKind] = useState<BusinessKind>(cmrOn ? 'CMR' : 'GENERAL')
  const [headId, setHeadId] = useState('')
  const [managerIds, setManagerIds] = useState<string[]>([])
  const [repIds, setRepIds] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = useMemo(() => people.filter((p) => !filter || `${p.name} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(filter.toLowerCase())), [people, filter])
  const toggle = (list: string[], set: (v: string[]) => void, other: string[], setOther: (v: string[]) => void, id: string) => {
    if (list.includes(id)) set(list.filter((x) => x !== id))
    else { set([...list, id]); if (other.includes(id)) setOther(other.filter((x) => x !== id)) }
  }
  const go = async () => {
    setBusy(true)
    try {
      const r = await leadsApi.createBusiness({ name: name.trim(), website: website.trim() || null, color: kind === 'CMR' ? '#059669' : COLORS[Math.floor(Math.random() * COLORS.length)], kind, headId: kind === 'CMR' && headId ? headId : null })
      let biz = r.business
      const failed: string[] = []
      for (const id of managerIds) { try { biz = (await leadsApi.setMember(biz.id, id, 'MANAGER')).business } catch { failed.push(people.find((p) => p.id === id)?.name ?? id) } }
      for (const id of repIds) { try { biz = (await leadsApi.setMember(biz.id, id, 'REP')).business } catch { failed.push(people.find((p) => p.id === id)?.name ?? id) } }
      onCreated(biz, failed.length ? `Added, but could not add ${failed.join(', ')}: add them under People.` : `${biz.name} is ready. Next: import the sheet.`)
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not add') }) } finally { setBusy(false) }
  }
  const cmr = kind === 'CMR'
  return (
    <Modal open onClose={onClose} title="Add a business" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={go}>{busy ? 'Adding…' : 'Add business'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" autoFocus placeholder={cmr ? 'CMR' : 'Recycle Technologies'} value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Website (optional)" placeholder="https://example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div><Label>Kind</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['GENERAL', 'Usual pipeline', 'New → Contacted → Qualified → Won / Lost. Website forms, inbox, assignment, tasks.'], ['CMR', 'CMR flow', 'The sheet\'s pipeline, five facts, Jesse\'s queue and decisions, meeting handoff, daily report.']] as const).map(([k, t, h]) => (
              <button key={k} type="button" disabled={k === 'CMR' && !cmrOn} onClick={() => setKind(k)} className={cn('rounded-card border p-3 text-left disabled:opacity-50', kind === k ? 'border-primary bg-primary/[0.06]' : 'border-line')}><span className="block text-body-sm font-semibold text-ink">{t}</span><span className="block text-[11.5px] text-ink-muted">{h}{k === 'CMR' && !cmrOn ? ' Switched off for your company (owner console → Switches).' : ''}</span></button>
            ))}
          </div>
        </div>
        {cmr && (
          <label className="block"><Label hint="Jesse. He gets the flagged leads and decides.">Head</Label>
            <select value={headId} onChange={(e) => setHeadId(e.target.value)} className="h-9 w-full rounded-btn border border-line bg-card px-2.5 text-body-md text-ink">
              <option value="">Choose later</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
            </select>
          </label>
        )}
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Label hint="Tick Manager for the team lead, Rep for each SDR. You can change this any time under People.">People</Label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a person…" className="h-8 w-44 rounded-btn border border-line bg-card px-2.5 text-body-sm" aria-label="Find a person" />
          </div>
          <div className="max-h-60 overflow-auto rounded-card border border-line">
            {shown.length ? (
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-ink-faint dark:bg-white/[0.03]"><tr><th className="px-3 py-1.5 text-left font-semibold">Person</th><th className="w-24 px-2 py-1.5 text-center font-semibold">Manager</th><th className="w-20 px-2 py-1.5 text-center font-semibold">Rep</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((p) => (
                    <tr key={p.id} className={cn((managerIds.includes(p.id) || repIds.includes(p.id)) && 'bg-primary/[0.04]')}>
                      <td className="px-3 py-1.5"><span className="block truncate font-medium text-ink">{p.name}{p.id === headId ? <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent">head</span> : null}</span><span className="block truncate text-[11.5px] text-ink-muted">{[p.department, p.role.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}</span></td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${p.name} as Manager`} checked={managerIds.includes(p.id)} onChange={() => toggle(managerIds, setManagerIds, repIds, setRepIds, p.id)} /></td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${p.name} as Rep`} checked={repIds.includes(p.id)} onChange={() => toggle(repIds, setRepIds, managerIds, setManagerIds, p.id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-4 text-body-sm text-ink-muted">{people.length ? 'Nobody matches.' : 'No other people yet. Invite them under Admin → Users, then add them here under People.'}</p>}
          </div>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted"><Users size={12} />{managerIds.length} manager{managerIds.length === 1 ? '' : 's'}, {repIds.length} rep{repIds.length === 1 ? '' : 's'}{cmr && headId ? `, head ${people.find((p) => p.id === headId)?.name ?? ''}` : ''}</p>
        </div>
        <p className="flex items-start gap-2 rounded-btn bg-slate-50 px-3 py-2 text-body-sm text-ink-muted dark:bg-white/[0.03]"><Upload size={15} className="mt-0.5 shrink-0 text-primary" /><span>Next: on the Leads page press <strong className="font-medium text-ink">Import</strong> and pick the CSV of the sheet. Later, the <Globe size={12} className="inline" /> website form and <ToggleRight size={12} className="inline" /> inbox below bring new leads in by themselves.</span></p>
      </div>
    </Modal>
  )
}
