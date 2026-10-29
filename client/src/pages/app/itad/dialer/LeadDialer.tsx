import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, FileUp, PhoneCall, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ui/Toast'
import { dialerApi, type DialerData, type DialerLead } from '../../../../lib/dialerApi'
import { NO_FILTERS, PKT, REGIONS, applyFilters, clock, followUpTabs, latestActedToday, leadState, type Filters } from '../../../../lib/dialer'
import { cn } from '../../../../lib/cn'
import { DashboardView } from './DashboardView'
import { FollowUpsView } from './FollowUpsView'
import { FunnelView, IndustriesView } from './FunnelViews'
import { FixDataView } from './FixDataView'
import { DuplicatesView, HistoryView, SettingsView } from './AdminViews'
import { ImportModal } from './ImportModal'
import { LeadsView } from './LeadsView'
import { LeadPanel } from './LeadPanel'
import { DownloadLeads, InfoTip, LeadsListModal, errMsg } from './ui'

/**
 * Lead Dialer (ITAD). Reps dial US leads from Pakistan at night; this page does the checking
 * for them: which US region is open now, who to call next, follow-ups that went quiet, and the
 * funnel. Data comes from each rep's own CRM export (export, then import). The dashboard
 * answers one question; the rest sits behind a click.
 */

type View = 'dashboard' | 'leads' | 'followups' | 'funnel' | 'industries' | 'fix' | 'history' | 'duplicates' | 'settings'

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
  const [panel, setPanel] = useState<{ id: string; ids: string[] } | null>(null)
  const [dupCount, setDupCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

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

  const leads = useMemo(() => data?.leads ?? [], [data])
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads])
  const filtered = useMemo(() => applyFilters(leads, filters, now), [leads, filters, now])
  const isManager = !!data?.me.isManager
  const showOwner = rep !== 'me' && isManager
  const fuDays = data?.followUpByOwner
  const fuCount = useMemo(() => {
    if (!data) return 0
    const t = followUpTabs(leads, data.settings, now, new Date(data.dayStart), latestActedToday(data.actedToday), fuDays)
    return t.overdue.length + t.dueToday.filter((x) => x.callBackDue).length
  }, [data, leads, now, fuDays])
  const noStateCount = leads.filter((l) => !leadState(l) && !l.duplicate && !l.sentToLeadGen).length
  const needsCrm = leads.filter((l) => l.needsCrmUpdate && !l.duplicate).length
  const unknownStatuses = useMemo(() => [...new Set(leads.map((l) => l.status))].filter((s) => data && data.settings.stageMap[s] == null), [leads, data])
  const lists = useMemo(() => [...new Set(leads.map((l) => l.listName))], [leads])

  const opts = (fn: (l: DialerLead) => string | null, empty: string) => [...new Set(leads.map((l) => fn(l) ?? empty))].sort((a, b) => a.localeCompare(b))
  const filtersOn = Object.values(filters).some(Boolean)
  const lastAt = data?.lastImport ? new Date(data.lastImport.at) : null
  const stale = lastAt ? now.getTime() - lastAt.getTime() > 18 * 3600000 : false
  const openLead = (id: string, ids?: string[]) => setPanel({ id, ids: ids ?? [id] })

  const tabs: { key: View; label: string; count?: number; tone?: 'red' | 'amber'; manager?: boolean }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'leads', label: 'Leads', count: needsCrm, tone: 'amber' },
    { key: 'followups', label: 'Follow-ups', count: fuCount, tone: 'red' },
    { key: 'funnel', label: 'Funnel' },
    { key: 'industries', label: 'Industries' },
    { key: 'fix', label: 'Fix data', count: noStateCount, tone: 'amber' },
    { key: 'history', label: 'History' },
    { key: 'duplicates', label: 'Duplicates', count: dupCount, tone: 'red', manager: true },
    { key: 'settings', label: 'Settings' },
  ]
  const sel = (active: boolean) => cn('h-8 rounded-full border px-3 text-body-sm focus:border-primary focus:outline-none', active ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-line bg-card text-ink')

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-headline-lg text-ink"><PhoneCall size={22} className="text-ink-muted" />Lead Dialer</h1>
          <InfoTip side="bottom">Who to call next, and when. {showOwner ? 'Team view.' : 'Your own leads only.'} Numbers are as fresh as the last import: export from Earthzone and import at the start of each shift.</InfoTip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-line bg-card px-3 py-1 text-body-sm text-ink"><b>{clock(PKT, now)}</b> PKT</span>
          {data && <span className="rounded-full border border-line bg-card px-3 py-1 text-body-sm text-ink" title="Duplicates waiting for a manager are not counted"><b className="tabular-nums">{data.counts.counted.toLocaleString()}</b> leads</span>}
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

      {data?.lastImport && (
        <div className={cn('flex items-center gap-2 truncate rounded-btn border px-3 py-1.5 text-body-sm', stale ? 'border-warning/40 bg-warning/5' : 'border-line bg-card')}>
          {stale && <AlertTriangle size={14} className="shrink-0 text-warning" />}
          <span className="truncate text-ink">Last import <b>{lastAt!.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>{showOwner ? ` by ${data.lastImport.by}` : ''}{stale ? ' · import again for fresh numbers' : ''}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.filter((t) => !t.manager || isManager).map((t) => (
          <button key={t.key} type="button" onClick={() => go(t.key)} className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-body-md font-medium', view === t.key ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
            {t.label}
            {!!t.count && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', t.tone === 'red' ? 'bg-danger/10 text-danger' : 'bg-warning/15 text-warning')}>{t.count}</span>}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-card bg-slate-100" />)}</div>
      ) : !data ? null : leads.length === 0 && view !== 'settings' && view !== 'history' && view !== 'duplicates' ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-card px-6 py-16 text-center">
          <FileUp size={32} className="text-primary" />
          <p className="text-body-lg font-semibold text-ink">{rep === 'me' ? 'Import your leads to start' : 'No leads imported yet for this view'}</p>
          <p className="max-w-lg text-body-md text-ink-muted">Export your own leads from Earthzone (CSV or Excel) and import the file.</p>
          {rep === 'me' && <Button leadingIcon={<FileUp size={15} />} onClick={() => setImporting(true)}>Import my leads</Button>}
        </div>
      ) : (
        <>
          {(view === 'dashboard' || view === 'funnel' || view === 'industries') && (
            <div className="flex flex-wrap items-center gap-2">
              <select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className={sel(!!filters.state)} aria-label="State"><option value="">State: All</option>{opts((l) => leadState(l), '(no state)').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} className={sel(!!filters.region)} aria-label="Region"><option value="">Region: All</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
              <select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })} className={sel(!!filters.industry)} aria-label="Industry"><option value="">Industry: All</option>{opts((l) => l.industry, '(no industry)').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={sel(!!filters.status)} aria-label="Status"><option value="">Status: Any</option>{opts((l) => l.status, 'Unknown').map((v) => <option key={v}>{v}</option>)}</select>
              {lists.length > 1 && <select value={filters.list} onChange={(e) => setFilters({ ...filters, list: e.target.value })} className={sel(!!filters.list)} aria-label="List"><option value="">List: All</option>{lists.map((v) => <option key={v} value={v}>{v === 'CRM' ? 'CRM (SMB)' : v}</option>)}</select>}
              {showOwner && <select value={filters.rep} onChange={(e) => setFilters({ ...filters, rep: e.target.value })} className={sel(!!filters.rep)} aria-label="Rep"><option value="">Rep: All</option>{[...new Map(leads.map((l) => [l.ownerId, l.ownerName])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
              <select value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className={sel(!!filters.date)} aria-label="Lead date"><option value="">Date: All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
              {filtersOn && <button type="button" onClick={() => setFilters(NO_FILTERS)} className="inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><X size={14} /> Clear</button>}
              {filtersOn && <span className="ml-auto text-body-sm text-ink-muted">{filtered.filter((l) => !l.duplicate).length.toLocaleString()} of {data.counts.counted.toLocaleString()} leads</span>}
              {filtersOn && <DownloadLeads title={['leads', filters.state, filters.region, filters.industry, filters.status, filters.list, filters.date && `last ${filters.date} days`].filter(Boolean).join(' ')} leads={filtered.filter((l) => !l.duplicate)} now={now} showOwner={showOwner} label="Download filtered" />}
            </div>
          )}

          {view === 'dashboard' && <DashboardView data={data} leads={filtered} settings={data.settings} now={now} filters={filters} setFilter={(k, v) => setFilters((f) => ({ ...f, [k]: v }))} onOpenLeads={(title, ls) => setListModal({ title, leads: ls })} onOpenLead={openLead} go={go} duplicates={isManager ? dupCount : 0} followUpDays={fuDays} />}
          {view === 'leads' && <LeadsView data={data} now={now} showOwner={showOwner} onOpenLead={openLead} onChanged={load} />}
          {view === 'followups' && <FollowUpsView data={data} leads={leads} settings={data.settings} now={now} onOpenLead={openLead} onChanged={load} showOwner={showOwner} followUpDays={fuDays} />}
          {view === 'funnel' && <FunnelView leads={filtered} settings={data.settings} now={now} showReps={showOwner} onPick={(by, key) => { if (by === 'state' || by === 'industry' || by === 'status') { setFilters((f) => ({ ...f, [by]: key })); go('dashboard') } }} />}
          {view === 'industries' && <IndustriesView leads={filtered} settings={data.settings} now={now} showReps={showOwner} picked={filters.industry} onPickIndustry={(k) => setFilters((f) => ({ ...f, industry: f.industry === k ? '' : k }))} />}
          {view === 'fix' && <FixDataView leads={leads} onOpenLead={openLead} onChanged={load} showOwner={showOwner} />}
          {view === 'history' && <HistoryView rep={rep} refreshKey={`${data.lastImport?.id ?? ''}-${refreshKey}`} onOpenLeads={(title, ids, fallback) => {
            const found = ids.map((id) => byId.get(id)).filter((l): l is DialerLead => !!l)
            const gone = fallback.length - found.length
            setListModal({ title: gone ? `${title} (${gone} no longer in your latest import)` : title, leads: found })
          }} />}
          {view === 'duplicates' && isManager && <DuplicatesView onChanged={load} />}
          {view === 'settings' && <SettingsView canEdit={isManager} onSaved={load} extraStatuses={unknownStatuses} />}
        </>
      )}

      {importing && data && (
        <ImportModal saved={data.myMapping} lists={lists} needsCrm={needsCrm} onClose={() => setImporting(false)}
          // Refresh everything at once, so the dashboard and funnel match the "Import done" summary.
          onImported={() => { setFilters(NO_FILTERS); setRefreshKey((k) => k + 1); if (rep !== 'me') setParam('rep', null); load() }} />
      )}
      {listModal && <LeadsListModal title={listModal.title} leads={listModal.leads} now={now} showOwner={showOwner} onClose={() => setListModal(null)} onOpen={(id, ids) => openLead(id, ids)} />}
      {panel && data && <LeadPanel id={panel.id} ids={panel.ids} lookup={(id) => byId.get(id)} now={now} settings={data.settings} meId={data.me.id} onNavigate={(id) => setPanel({ ...panel, id })} onClose={() => setPanel(null)} onChanged={load} />}
    </div>
  )
}
