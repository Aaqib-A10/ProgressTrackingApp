import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, FileUp, PhoneCall, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerData, type DialerLead } from '../../../../lib/dialerApi'
import { NO_FILTERS, PKT, REGIONS, applyFilters, clock, followUps, leadState, nextUsClockChange, usDaylight, type Filters } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { DashboardView } from './DashboardView'
import { FollowUpsView } from './FollowUpsView'
import { FunnelView, IndustriesView } from './FunnelViews'
import { FixDataView } from './FixDataView'
import { DuplicatesView, HistoryView, SettingsView } from './AdminViews'
import { ImportModal } from './ImportModal'
import { LeadDetailModal, LeadsListModal, errMsg } from './ui'

/**
 * Lead Dialer (ITAD). Reps dial US leads from Pakistan at night; this page does the checking
 * for them: which US region is open now, where leads are stuck, which follow-ups went quiet,
 * and the funnel. Data comes from each rep's own CRM export (export, then import).
 * Plan: "Lead Dialer Dashboard, Final Plan" and the "Dialer Command Center" demo.
 */

type View = 'dashboard' | 'followups' | 'funnel' | 'industries' | 'fix' | 'history' | 'duplicates' | 'settings'

export default function LeadDialer() {
  const { addToast } = useToast()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'dashboard'
  const rep = params.get('rep') || 'me'
  const [data, setData] = useState<DialerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [importing, setImporting] = useState(false)
  const [listModal, setListModal] = useState<{ title: string; leads: DialerLead[] } | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [dupCount, setDupCount] = useState(0)

  const load = useCallback(() => {
    return dialerApi.data(rep)
      .then((d) => {
        setData(d)
        if (d.me.isManager) dialerApi.duplicates().then((r) => setDupCount(r.duplicates.length)).catch(() => {})
      })
      .catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not load the Lead Dialer') }))
      .finally(() => setLoading(false))
  }, [rep, addToast])
  useEffect(() => { setLoading(true); load() }, [load])
  // Live clocks and countdowns.
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(t) }, [])

  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }) }
  const go = (v: string) => setParam('view', v === 'dashboard' ? null : v)

  const leads = data?.leads ?? []
  const filtered = useMemo(() => applyFilters(leads, filters, now), [leads, filters, now])
  const isManager = !!data?.me.isManager
  const showOwner = rep !== 'me' && isManager
  const fuCount = useMemo(() => (data ? followUps(leads, data.settings, now).length : 0), [data, leads, now])
  const noStateCount = leads.filter((l) => !leadState(l) && !l.duplicate && !l.sentToLeadGen).length
  const unknownStatuses = useMemo(() => [...new Set(leads.map((l) => l.status))].filter((s) => data && data.settings.stageMap[s] == null), [leads, data])

  const opts = (fn: (l: DialerLead) => string | null, empty: string) => [...new Set(leads.map((l) => fn(l) ?? empty))].sort((a, b) => a.localeCompare(b))
  const filtersOn = Object.values(filters).some(Boolean)
  const dst = usDaylight(now)
  const change = nextUsClockChange(now)
  const lastAt = data?.lastImport ? new Date(data.lastImport.at) : null
  const stale = lastAt ? now.getTime() - lastAt.getTime() > 18 * 3600000 : false

  const tabs: { key: View; label: string; count?: number; manager?: boolean }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'followups', label: 'Follow-ups', count: fuCount },
    { key: 'funnel', label: 'Funnel' },
    { key: 'industries', label: 'Industries' },
    { key: 'fix', label: 'Fix data', count: noStateCount },
    { key: 'history', label: 'History' },
    { key: 'duplicates', label: 'Duplicates', count: dupCount, manager: true },
    { key: 'settings', label: 'Settings' },
  ]
  const sel = (active: boolean) => cn('h-8 rounded-full border px-3 text-body-sm focus:border-primary focus:outline-none', active ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-line bg-card text-ink')

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-headline-lg text-ink"><PhoneCall size={22} className="text-[#0F766E]" />Lead Dialer</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Who to call next, and when. {showOwner ? 'Team view' : 'Your own leads only'}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-line bg-card px-3 py-1 text-body-sm text-ink">Now <b>{clock(PKT, now)} PKT</b></span>
          <span className="rounded-full border border-line bg-card px-3 py-1 text-body-sm text-ink" title="The US changes its clocks; Pakistan does not.">Clock <b>US {dst ? 'daylight' : 'standard'} time</b> (until {change.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })})</span>
          {data && <span className="rounded-full border border-line bg-card px-3 py-1 text-body-sm text-ink">Windows <b>{data.settings.clockMode === 'FIXED_PKT' ? 'Fixed PKT slots' : 'Fixed local hours'}</b></span>}
          {isManager && data && (
            <select value={rep} onChange={(e) => setParam('rep', e.target.value === 'me' ? null : e.target.value)} className="h-9 rounded-btn border border-line bg-card px-2 text-body-sm font-semibold text-ink" aria-label="Whose leads">
              <option value="me">My leads</option>
              <option value="all">All reps (team)</option>
              {data.reps.filter((r) => r.id !== data.me.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <Button leadingIcon={<FileUp size={15} />} onClick={() => setImporting(true)}>Import my leads</Button>
        </div>
      </div>

      {data?.lastImport ? (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-btn border px-3 py-2 text-body-sm', stale ? 'border-warning/40 bg-warning/5' : 'border-line bg-card')}>
          {stale && <AlertTriangle size={15} className="text-warning" />}
          <span className="text-ink">Last import <b>{lastAt!.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>{showOwner ? ` by ${data.lastImport.by}` : ''} · {data.lastImport.fileName}</span>
          <span className="text-ink-muted">{stale ? 'Numbers are as fresh as the last import. Export and import at the start of the shift.' : 'Numbers are as fresh as this import.'}</span>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.filter((t) => !t.manager || isManager).map((t) => (
          <button key={t.key} type="button" onClick={() => go(t.key)} className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-body-md font-medium', view === t.key ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
            {t.label}
            {!!t.count && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', t.key === 'duplicates' ? 'bg-danger/10 text-danger' : 'bg-warning/15 text-warning')}>{t.count}</span>}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-card bg-slate-100" />)}</div>
      ) : !data ? null : leads.length === 0 && view !== 'settings' && view !== 'history' && view !== 'duplicates' ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-card px-6 py-16 text-center">
          <FileUp size={32} className="text-primary" />
          <p className="text-body-lg font-semibold text-ink">{rep === 'me' ? 'Import your leads to start' : 'No leads imported yet for this view'}</p>
          <p className="max-w-lg text-body-md text-ink-muted">Export your own leads from the CRM (CSV or Excel) and import the file. The dashboard then shows which US regions are open, where leads are stuck, follow-ups that went quiet, and your funnel.</p>
          {rep === 'me' && <Button leadingIcon={<FileUp size={15} />} onClick={() => setImporting(true)}>Import my leads</Button>}
        </div>
      ) : (
        <>
          {(view === 'dashboard' || view === 'funnel' || view === 'industries') && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm text-ink-muted">Filters</span>
              <select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className={sel(!!filters.state)} aria-label="State"><option value="">State: All</option>{opts((l) => leadState(l), '(no state)').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} className={sel(!!filters.region)} aria-label="Region"><option value="">Region: All</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
              <select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })} className={sel(!!filters.industry)} aria-label="Industry"><option value="">Industry: All</option>{opts((l) => l.industry, '(no industry)').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={sel(!!filters.status)} aria-label="Status"><option value="">Status: Any</option>{opts((l) => l.status, 'Unknown').map((v) => <option key={v}>{v}</option>)}</select>
              {showOwner && <select value={filters.rep} onChange={(e) => setFilters({ ...filters, rep: e.target.value })} className={sel(!!filters.rep)} aria-label="Rep"><option value="">Rep: All</option>{[...new Map(leads.map((l) => [l.ownerId, l.ownerName])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
              <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className={sel(!!filters.source)} aria-label="Source"><option value="">Source: All</option>{opts((l) => l.source, '(no source)').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className={sel(!!filters.date)} aria-label="Lead date"><option value="">Date: All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
              {filtersOn && <button type="button" onClick={() => setFilters(NO_FILTERS)} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>}
              <span className="ml-auto text-body-sm text-ink-muted">{filtered.length.toLocaleString()} of {leads.length.toLocaleString()} leads</span>
            </div>
          )}

          {view === 'dashboard' && <DashboardView leads={filtered} allLeads={leads} settings={data.settings} now={now} filters={filters} setFilter={(k, v) => setFilters((f) => ({ ...f, [k]: v }))} onOpenLeads={(title, ls) => setListModal({ title, leads: ls })} onOpenLead={setLeadId} go={go} duplicates={isManager ? dupCount : 0} />}
          {view === 'followups' && <FollowUpsView leads={leads} settings={data.settings} now={now} onOpenLead={setLeadId} onChanged={load} showOwner={showOwner} />}
          {view === 'funnel' && <FunnelView leads={filtered} settings={data.settings} now={now} showReps={showOwner} onPick={(by, key) => { if (by === 'state' || by === 'industry' || by === 'source' || by === 'status') { setFilters((f) => ({ ...f, [by]: key })); go('dashboard') } }} />}
          {view === 'industries' && <IndustriesView leads={filtered} settings={data.settings} now={now} showReps={showOwner} picked={filters.industry} onPickIndustry={(k) => setFilters((f) => ({ ...f, industry: f.industry === k ? '' : k }))} />}
          {view === 'fix' && <FixDataView leads={leads} onOpenLead={setLeadId} onChanged={load} showOwner={showOwner} />}
          {view === 'history' && <HistoryView rep={rep} refreshKey={data.lastImport?.id ?? ''} />}
          {view === 'duplicates' && isManager && <DuplicatesView onChanged={load} />}
          {view === 'settings' && <SettingsView canEdit={isManager} onSaved={load} extraStatuses={unknownStatuses} />}
        </>
      )}

      {importing && data && <ImportModal saved={data.myMapping} onClose={() => setImporting(false)} onImported={() => { if (rep !== 'me') setParam('rep', null); load() }} />}
      {listModal && <LeadsListModal title={listModal.title} leads={listModal.leads} now={now} showOwner={showOwner} onClose={() => setListModal(null)} onOpen={(id) => setLeadId(id)} />}
      {leadId && <LeadDetailModal id={leadId} now={now} onClose={() => setLeadId(null)} onChanged={load} />}
    </div>
  )
}
