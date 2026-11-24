import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Search, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { areaCls, dayLabel, errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * People: the directory, and each person's record (job, dates, manager, contacts, emergency contact) with their
 * leave for the year. Everyone sees names, jobs and teams; the private parts are for the person, their team lead
 * and admins.
 */

interface Private { employeeCode: string | null; employmentType: string | null; joinedOn: string; joinedOnSet: boolean; leftOn: string | null; birthday: string | null; address: string | null; emergencyName: string | null; emergencyPhone: string | null; notes?: string | null }
interface Person { id: string; name: string; email: string; role: string; active: boolean; department: string | null; jobTitle: string | null; phone: string | null; manager: { id: string; name: string } | null; private: Private | null; canEdit: boolean; canManage: boolean }
interface Balance { allowed: number | null; used: number; waiting: number; left: number | null }
interface Leave { year: number; balance: Record<'ANNUAL' | 'SICK' | 'CASUAL', Balance> & { UNPAID: { used: number; waiting: number } }; own: { kind: string; days: number }[] }

const ROLE: Record<string, string> = { SUPER_ADMIN: 'Admin', TEAM_LEAD: 'Team lead', SUB_DEPT_LEAD: 'Lead', MEMBER: 'Member', QA: 'QA', QA_LEAD: 'QA lead' }
const EMPLOYMENT = [['FULL_TIME', 'Full time'], ['PART_TIME', 'Part time'], ['CONTRACT', 'Contract'], ['INTERN', 'Intern']] as const
const LEAVE = [['ANNUAL', 'Annual'], ['SICK', 'Sick'], ['CASUAL', 'Casual']] as const

export default function People() {
  const { user } = useAuth()
  const admin = user?.role === 'SUPER_ADMIN'
  const [people, setPeople] = useState<Person[] | null>(null)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const load = useCallback(() => { api.get<{ people: Person[] }>('/people').then((r) => setPeople(r.people)).catch(() => setPeople([])) }, [])
  useEffect(load, [load])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (people ?? []).filter((p) => !t || [p.name, p.email, p.jobTitle, p.department, p.manager?.name].some((x) => x?.toLowerCase().includes(t)))
  }, [people, q])

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">People</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Everyone in the company, their job and who they report to. Open your own name to keep your contacts up to date.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className={`${inputCls} h-9 pl-9`} />
          </div>
          {admin && <Button variant="secondary" onClick={() => setLeaveOpen(true)}>Leave days</Button>}
        </div>
      </div>

      <Card flush>
        {people === null ? <p className="p-5 text-body-md text-ink-muted">Loading...</p> : shown.length === 0 ? <EmptyState icon={<Users size={22} />} title="Nobody matches" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-body-md">
              <thead className="border-b border-line text-body-sm text-ink-muted">
                <tr><th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Job</th><th className="px-4 py-2.5 font-medium">Team</th><th className="px-4 py-2.5 font-medium">Reports to</th><th className="px-4 py-2.5 font-medium">Phone</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => (
                  <tr key={p.id} onClick={() => setOpenId(p.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5"><button type="button" className="text-left font-medium text-ink hover:text-primary-ink">{p.name}</button><p className="text-body-sm text-ink-muted">{p.email}</p></td>
                    <td className="px-4 py-2.5 text-ink">{p.jobTitle ?? <span className="text-ink-faint">{ROLE[p.role] ?? p.role}</span>}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{p.department ?? ''}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{p.manager?.name ?? ''}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-muted">{p.phone ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId && <PersonModal id={openId} people={people ?? []} admin={admin} onClose={() => setOpenId(null)} onSaved={load} />}
      {leaveOpen && <LeaveDefaults onClose={() => setLeaveOpen(false)} />}
    </div>
  )
}

function PersonModal({ id, people, admin, onClose, onSaved }: { id: string; people: Person[]; admin: boolean; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [p, setP] = useState<Person | null>(null)
  const [leave, setLeave] = useState<Leave | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [own, setOwn] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get<{ person: Person; leave: Leave | null }>(`/people/${id}`).then((r) => {
      setP(r.person)
      setLeave(r.leave)
      const v = r.person.private
      setF({ phone: r.person.phone ?? '', jobTitle: r.person.jobTitle ?? '', managerId: r.person.manager?.id ?? '', employeeCode: v?.employeeCode ?? '', employmentType: v?.employmentType ?? '', joinedOn: v?.joinedOnSet ? v.joinedOn : '', leftOn: v?.leftOn ?? '', birthday: v?.birthday ?? '', address: v?.address ?? '', emergencyName: v?.emergencyName ?? '', emergencyPhone: v?.emergencyPhone ?? '', notes: v?.notes ?? '' })
      setOwn(Object.fromEntries((r.leave?.own ?? []).map((a) => [a.kind, String(a.days)])))
    }).catch(() => { addToast({ type: 'error', message: 'Could not open this person.' }); onClose() })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const field = (k: string, label: string, type = 'text') => (<div><label className={labelCls} htmlFor={`pr-${k}`}>{label}</label><input id={`pr-${k}`} type={type} value={f[k] ?? ''} onChange={set(k)} className={inputCls} /></div>)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const mine = ['phone', 'address', 'emergencyName', 'emergencyPhone', 'birthday']
      const all = [...mine, 'jobTitle', 'managerId', 'employeeCode', 'employmentType', 'joinedOn', 'leftOn', 'notes']
      const body = Object.fromEntries((p!.canManage ? all : mine).map((k) => [k, f[k]?.trim() ? f[k].trim() : null]))
      setP((await api.put<{ person: Person }>(`/people/${p!.id}`, body)).person)
      if (admin && leave) {
        const days = Object.fromEntries(LEAVE.map(([k]) => [k, own[k]?.trim() ? Number(own[k]) : null]))
        const r = await api.put<{ balance: Leave['balance'] }>(`/people/${p!.id}/leave`, { year: leave.year, days })
        setLeave({ ...leave, balance: r.balance })
      }
      addToast({ type: 'success', message: 'Saved.' })
      onSaved()
    } catch (err) { addToast({ type: 'error', message: errMsg(err, 'Could not save.') }) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={p.name} size="lg" footer={p.canEdit ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button type="submit" form="person-form" disabled={busy}>Save</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
          <Badge tone="primary">{ROLE[p.role] ?? p.role}</Badge>
          {p.department && <span>{p.department}</span>}
          <span>{p.email}</span>
        </div>
        {!p.canEdit ? (
          <dl className="grid grid-cols-2 gap-3 text-body-md">
            <div><dt className="text-body-sm text-ink-muted">Job</dt><dd className="text-ink">{p.jobTitle ?? 'Not set'}</dd></div>
            <div><dt className="text-body-sm text-ink-muted">Reports to</dt><dd className="text-ink">{p.manager?.name ?? 'Not set'}</dd></div>
            <div><dt className="text-body-sm text-ink-muted">Phone</dt><dd className="text-ink">{p.phone ?? 'Not set'}</dd></div>
          </dl>
        ) : (
          <form id="person-form" onSubmit={save} className="space-y-4">
            {p.canManage && (
              <div className="grid gap-3 sm:grid-cols-2">
                {field('jobTitle', 'Job title')}
                <div><label className={labelCls} htmlFor="pr-manager">Reports to</label><select id="pr-manager" value={f.managerId ?? ''} onChange={set('managerId')} className={inputCls}><option value="">Nobody</option>{people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
                <div><label className={labelCls} htmlFor="pr-emp">Employment</label><select id="pr-emp" value={f.employmentType ?? ''} onChange={set('employmentType')} className={inputCls}><option value="">Not set</option>{EMPLOYMENT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                {field('employeeCode', 'Employee number')}
                {field('joinedOn', 'Joined on', 'date')}
                {field('leftOn', 'Left on', 'date')}
              </div>
            )}
            {!p.canManage && <p className="text-body-sm text-ink-muted">Job: {p.jobTitle ?? 'not set'}. Reports to: {p.manager?.name ?? 'not set'}. Joined: {dayLabel(p.private?.joinedOn)}. Your team lead or an admin changes these.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {field('phone', 'Phone')}
              {field('birthday', 'Birthday', 'date')}
              <div className="sm:col-span-2">{field('address', 'Address')}</div>
              {field('emergencyName', 'Emergency contact')}
              {field('emergencyPhone', 'Emergency phone')}
            </div>
            {p.canManage && <div><label className={labelCls} htmlFor="pr-notes">Notes (team lead and admins only)</label><textarea id="pr-notes" rows={2} value={f.notes ?? ''} onChange={set('notes')} className={areaCls} maxLength={2000} /></div>}
            {leave && (
              <div>
                <p className="mb-1.5 text-body-sm font-semibold text-ink">Leave in {leave.year}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {LEAVE.map(([k, l]) => {
                    const b = leave.balance[k]
                    return (
                      <div key={k} className="rounded-btn border border-line p-3">
                        <p className="text-body-sm text-ink-muted">{l}</p>
                        <p className="text-title-md tabular-nums text-ink">{b.allowed === null ? `${b.used} used` : `${b.left} left`}</p>
                        <p className="text-body-sm text-ink-muted">{b.allowed === null ? 'No yearly number set' : `${b.used} of ${b.allowed} used`}{b.waiting ? `, ${b.waiting} waiting` : ''}</p>
                        {admin && <input type="number" min="0" max="366" step="0.5" value={own[k] ?? ''} onChange={(e) => setOwn((x) => ({ ...x, [k]: e.target.value }))} placeholder="Company number" aria-label={`${l} days for ${p.name}`} className={`${inputCls} mt-2 h-9`} />}
                      </div>
                    )
                  })}
                </div>
                {admin && <p className="mt-1 text-body-sm text-ink-muted">Type a number to give this person their own days for the year. Empty uses the company's number.</p>}
                {leave.balance.UNPAID.used > 0 && <p className="mt-1 text-body-sm text-ink-muted">Unpaid leave: {leave.balance.UNPAID.used} day{leave.balance.UNPAID.used === 1 ? '' : 's'}.</p>}
              </div>
            )}
          </form>
        )}
      </div>
    </Modal>
  )
}

/** Admins: the days of leave everyone gets in a year (a person can have their own number on their record). */
function LeaveDefaults({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast()
  const [days, setDays] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<{ days: Record<string, number | null> }>('/people/leave-defaults').then((r) => setDays(Object.fromEntries(Object.entries(r.days).map(([k, v]) => [k, v === null ? '' : String(v)])))).catch(() => setDays({})) }, [])
  async function save() {
    setBusy(true)
    try {
      await api.put('/people/leave-defaults', { days: Object.fromEntries(LEAVE.map(([k]) => [k, days?.[k]?.trim() ? Number(days[k]) : null])) })
      addToast({ type: 'success', message: 'Saved.' })
      onClose()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Leave days in a year" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !days} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">How many days everyone gets. Leave a kind empty to keep it without a limit. People ask for leave in Requests; approved days come off these numbers.</p>
        {LEAVE.map(([k, l]) => (
          <div key={k}><label className={labelCls} htmlFor={`ld-${k}`}>{l} leave</label><input id={`ld-${k}`} type="number" min="0" max="366" step="0.5" value={days?.[k] ?? ''} onChange={(e) => setDays((d) => ({ ...(d ?? {}), [k]: e.target.value }))} className={inputCls} placeholder="No limit" /></div>
        ))}
      </div>
    </Modal>
  )
}
