import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { TextField } from '../../../components/ui/Input'
import { PillFilter } from '../../../components/ui/PillFilter'
import { Modal } from '../../../components/ui/Modal'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber, formatMoney } from '../../../lib/format'
import {
  listBrands,
  listAds,
  getAdsSummary,
  createAd,
  updateAd,
  deleteAd,
  AD_PLATFORMS,
  AD_CAMPAIGN_TYPES,
  AD_STATUSES,
  type Brand,
  type AdCampaign,
  type AdsSummary,
  type AdPlatform,
  type AdCampaignType,
  type AdCampaignStatus,
} from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const statusTone = (s: AdCampaignStatus) => AD_STATUSES.find((x) => x.key === s)?.tone ?? 'neutral'
const typeLabel = (t: AdCampaignType) => AD_CAMPAIGN_TYPES.find((x) => x.key === t)?.label ?? t

type Draft = {
  title: string
  date: string
  campaignType: AdCampaignType
  status: AdCampaignStatus
  leads: string
  businessLeads: string
  spend: string
}
const emptyDraft = (): Draft => ({ title: '', date: today(), campaignType: 'SEARCH', status: 'ACTIVE', leads: '', businessLeads: '', spend: '' })
const numOf = (s: string) => (s ? Number(s) : 0)
/** Keep digits + a single decimal point (for money inputs like Spend). */
const sanitizeMoney = (s: string) => {
  const cleaned = s.replace(/[^\d.]/g, '')
  const i = cleaned.indexOf('.')
  return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '')
}

export default function AdsCampaigns() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [platform, setPlatform] = useState<AdPlatform>('GOOGLE')
  const [month, setMonth] = useState(thisMonth())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([])
  const [summary, setSummary] = useState<AdsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<AdCampaign | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft)

  useEffect(() => {
    listBrands()
      .then((r) => {
        setBrands(r.brands)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const rangeActive = Boolean(from || to)
  const refresh = useCallback(() => {
    if (!brandId) return
    const params = { brandId, platform, month, from: from || undefined, to: to || undefined }
    listAds(params).then((r) => setCampaigns(r.campaigns)).catch(() => undefined)
    getAdsSummary(params).then(setSummary).catch(() => undefined)
  }, [brandId, platform, month, from, to])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!brandId || !draft.title.trim()) return
    setSaving(true)
    try {
      await createAd({
        brandId,
        platform,
        date: draft.date || today(),
        title: draft.title.trim(),
        campaignType: draft.campaignType,
        status: draft.status,
        leads: numOf(draft.leads),
        businessLeads: numOf(draft.businessLeads),
        spend: numOf(draft.spend),
      })
      setDraft(emptyDraft())
      addToast({ type: 'success', message: 'Campaign added.' })
      refresh()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not add campaign.' })
    } finally {
      setSaving(false)
    }
  }

  function openEdit(c: AdCampaign) {
    setEditing(c)
    setEditDraft({
      title: c.title,
      date: c.date,
      campaignType: c.campaignType,
      status: c.status,
      leads: String(c.leads),
      businessLeads: String(c.businessLeads),
      spend: String(c.spend),
    })
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    try {
      await updateAd(editing.id, {
        title: editDraft.title.trim(),
        date: editDraft.date || undefined,
        campaignType: editDraft.campaignType,
        status: editDraft.status,
        leads: numOf(editDraft.leads),
        businessLeads: numOf(editDraft.businessLeads),
        spend: numOf(editDraft.spend),
      })
      setEditing(null)
      addToast({ type: 'success', message: 'Campaign updated.' })
      refresh()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not update.' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: AdCampaign) {
    const prev = campaigns
    setCampaigns((cs) => cs.filter((x) => x.id !== c.id))
    try {
      await deleteAd(c.id)
      refresh()
    } catch {
      setCampaigns(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  const columns: Column<AdCampaign>[] = [
    { key: 'title', header: 'Campaign', render: (c) => <span className="font-medium text-ink">{c.title}</span> },
    { key: 'date', header: 'Date', render: (c) => c.date },
    { key: 'type', header: 'Type', render: (c) => typeLabel(c.campaignType) },
    { key: 'status', header: 'Status', render: (c) => <Badge tone={statusTone(c.status)}>{AD_STATUSES.find((s) => s.key === c.status)?.label}</Badge> },
    { key: 'leads', header: 'Leads', align: 'right', render: (c) => formatNumber(c.leads) },
    { key: 'businessLeads', header: 'Business Leads', align: 'right', render: (c) => formatNumber(c.businessLeads) },
    { key: 'spend', header: 'Spend', align: 'right', render: (c) => formatMoney(c.spend) },
    { key: 'avgCostPerLead', header: 'Avg. Cost/Lead', align: 'right', render: (c) => (c.avgCostPerLead != null ? formatMoney(c.avgCostPerLead) : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => openEdit(c)} className="text-ink-muted hover:text-primary" title="Edit"><Pencil size={16} /></button>
          <button onClick={() => remove(c)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ]

  const totalRow = summary
    ? {
        cells: {
          title: 'Totals',
          leads: formatNumber(summary.totalLeads),
          businessLeads: formatNumber(summary.totalBusinessLeads),
          spend: formatMoney(summary.totalSpend),
          avgCostPerLead: summary.avgCostPerLead != null ? formatMoney(summary.avgCostPerLead) : '—',
        } as Record<string, React.ReactNode>,
      }
    : undefined

  const draftFields = (d: Draft, set: (d: Draft) => void) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField label="Campaign title" value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} placeholder="e.g. Q3 Brand Search" />
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Date</label>
        <input type="date" className={`${sel} w-full`} value={d.date} max={today()} onChange={(e) => set({ ...d, date: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Type</label>
        <select className={`${sel} w-full`} value={d.campaignType} onChange={(e) => set({ ...d, campaignType: e.target.value as AdCampaignType })}>
          {AD_CAMPAIGN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
        <select className={`${sel} w-full`} value={d.status} onChange={(e) => set({ ...d, status: e.target.value as AdCampaignStatus })}>
          {AD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <TextField label="Leads" value={d.leads} onChange={(e) => set({ ...d, leads: e.target.value.replace(/\D/g, '') })} placeholder="0" />
      <TextField label="Business leads" value={d.businessLeads} onChange={(e) => set({ ...d, businessLeads: e.target.value.replace(/\D/g, '') })} placeholder="0" />
      <TextField label="Spend" value={d.spend} onChange={(e) => set({ ...d, spend: sanitizeMoney(e.target.value) })} placeholder="0.00" inputMode="decimal" />
      <div className="flex items-end pb-1 text-body-sm text-ink-muted">
        Avg. cost/lead: <span className="ml-1 font-semibold text-ink">{numOf(d.leads) > 0 ? formatMoney(numOf(d.spend) / numOf(d.leads)) : '—'}</span>
      </div>
    </div>
  )

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">ADS Campaigns</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Per-brand Google &amp; Meta campaigns; totals roll up automatically.</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {brands.length > 0 && (
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
              <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Month</label>
            <input type="month" className={sel} value={month} max={thisMonth()} disabled={rangeActive} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">From</label>
            <input type="date" className={sel} value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">To</label>
            <input type="date" className={sel} value={to} min={from || undefined} max={today()} onChange={(e) => setTo(e.target.value)} />
          </div>
          {rangeActive && (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear dates</Button>
          )}
        </div>
      </div>

      <PillFilter options={AD_PLATFORMS.map((p) => ({ value: p.key, label: p.label }))} value={platform} onChange={setPlatform} />

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Active" value={formatNumber(summary.activeCampaigns)} valueClassName="text-headline-lg" caption={`of ${summary.totalCampaigns} campaigns`} />
          <StatCard label="Total Leads" value={formatNumber(summary.totalLeads)} valueClassName="text-headline-lg" />
          <StatCard label="Business Leads" value={formatNumber(summary.totalBusinessLeads)} valueClassName="text-headline-lg" />
          <StatCard label="Total Spend" value={formatMoney(summary.totalSpend)} valueClassName="text-headline-lg" />
          <StatCard label="Avg. Cost/Lead" value={summary.avgCostPerLead != null ? formatMoney(summary.avgCostPerLead) : '—'} valueClassName="text-headline-lg" caption="spend ÷ leads" />
          <StatCard
            label="Best Performing"
            valueClassName="text-headline-md"
            value={
              summary.bestPerforming ? (
                <span className="line-clamp-2 leading-snug" title={summary.bestPerforming.title}>
                  {summary.bestPerforming.title}
                </span>
              ) : (
                '—'
              )
            }
            caption={summary.bestPerforming ? `${formatNumber(summary.bestPerforming.leads)} leads` : 'no data'}
          />
        </div>
      )}

      {brands.length > 0 && (
        <Card title={`Add a ${AD_PLATFORMS.find((p) => p.key === platform)?.label} campaign`}>
          <form onSubmit={add} className="space-y-4">
            {draftFields(draft, setDraft)}
            <Button type="submit" disabled={saving} leadingIcon={<Plus size={16} />}>Add campaign</Button>
          </form>
        </Card>
      )}

      <Card title={`Campaigns — ${rangeActive ? `${from || '…'} to ${to || '…'}` : month}`} flush>
        <DataTable columns={columns} rows={campaigns} getRowId={(c) => c.id} totalRow={campaigns.length ? totalRow : undefined} emptyMessage="No campaigns logged for this brand / platform / month yet." />
      </Card>

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title="Edit campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        {draftFields(editDraft, setEditDraft)}
      </Modal>
    </div>
  )
}
