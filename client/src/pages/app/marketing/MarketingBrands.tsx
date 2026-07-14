import { useEffect, useState, type FormEvent } from 'react'
import { Plus, RefreshCw, Link2, CheckCircle2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { listBrands, createBrand, updateBrand, syncSeo, type Brand } from '../../../lib/marketingApi'

function syncedLabel(iso: string | null): string {
  if (!iso) return 'never synced'
  const d = new Date(iso)
  return 'synced ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function MarketingBrands() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [seoFor, setSeoFor] = useState<Brand | null>(null)

  const upsertLocal = (b: Brand) => setBrands((bs) => bs.map((x) => (x.id === b.id ? b : x)))

  useEffect(() => {
    let active = true
    listBrands(true)
      .then((r) => active && setBrands(r.brands))
      .catch(() => active && addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [addToast])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const { brand } = await createBrand({ name: name.trim(), website: website.trim() || undefined })
      setBrands((bs) => [...bs, brand].sort((a, b) => a.name.localeCompare(b.name)))
      setName('')
      setWebsite('')
      addToast({ type: 'success', message: 'Brand added.' })
    } catch {
      addToast({ type: 'error', message: 'Could not add brand.' })
    } finally {
      setSaving(false)
    }
  }

  function toggle(b: Brand) {
    const prev = brands
    setBrands((bs) => bs.map((x) => (x.id === b.id ? { ...x, isActive: !x.isActive } : x)))
    updateBrand(b.id, { isActive: !b.isActive }).catch(() => {
      setBrands(prev)
      addToast({ type: 'error', message: 'Update failed.' })
    })
  }

  const columns: Column<Brand>[] = [
    { key: 'name', header: 'Brand', render: (b) => <span className="font-medium text-ink">{b.name}</span> },
    {
      key: 'website',
      header: 'Website',
      render: (b) =>
        b.website ? (
          <a href={b.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {b.website.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'seo',
      header: 'SEO (GSC + GA4)',
      render: (b) => (
        <div className="flex items-center gap-2">
          {b.seoConnected ? (
            <span className="inline-flex items-center gap-1 text-body-sm text-success" title={syncedLabel(b.seoSyncedAt)}>
              <CheckCircle2 size={14} /> Connected
            </span>
          ) : (
            <span className="text-body-sm text-ink-muted">Not connected</span>
          )}
          <button onClick={() => setSeoFor(b)} className="rounded-btn border border-line px-2 py-1 text-body-sm text-ink hover:bg-slate-50" title="Configure Search Console + GA4">
            {b.seoConnected ? 'Manage' : 'Connect'}
          </button>
        </div>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      render: (b) => (
        <button onClick={() => toggle(b)} title="Toggle active">
          <Badge tone={b.isActive ? 'success' : 'neutral'} dot>
            {b.isActive ? 'Active' : 'Archived'}
          </Badge>
        </button>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Brands</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Company profiles the Marketing team manages. Add or archive brands anytime.</p>
      </div>
      <Card title="Add Brand">
        <form onSubmit={add} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Minnesota Computers" />
          <TextField label="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
          <Button type="submit" disabled={saving} leadingIcon={<Plus size={16} />}>
            Add
          </Button>
        </form>
      </Card>
      <Card title="All Brands" flush>
        {loading ? (
          <div className="p-5 text-body-md text-ink-muted">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={brands} getRowId={(b) => b.id} emptyMessage="No brands yet — add your first above." />
        )}
      </Card>

      {seoFor && (
        <BrandSeoModal brand={seoFor} onClose={() => setSeoFor(null)} onSaved={(b) => { upsertLocal(b); setSeoFor(b) }} />
      )}
    </div>
  )
}

/** Connect a brand to Google Search Console + GA4, and run an on-demand sync. */
function BrandSeoModal({ brand, onClose, onSaved }: { brand: Brand; onClose: () => void; onSaved: (b: Brand) => void }) {
  const { addToast } = useToast()
  const [gsc, setGsc] = useState(brand.gscSiteUrl ?? '')
  const [ga4, setGa4] = useState(brand.ga4PropertyId ?? '')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const { brand: updated } = await updateBrand(brand.id, { gscSiteUrl: gsc.trim() || null, ga4PropertyId: ga4.trim() || null })
      onSaved(updated)
      addToast({ type: 'success', message: 'SEO connection saved.' })
    } catch {
      addToast({ type: 'error', message: 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  async function runSync() {
    setSyncing(true)
    try {
      const { results } = await syncSeo({ brandId: brand.id, days: 90 })
      const r = results[0]
      if (r?.errors.length) addToast({ type: 'error', message: r.errors.join(' · ') })
      else addToast({ type: 'success', message: `Synced ${r?.days ?? 0} day(s) from ${r?.from} to ${r?.to}.` })
    } catch (e) {
      const m = (e as { message?: string })?.message
      let msg = 'Sync failed.'
      try { msg = m ? (JSON.parse(m) as { error?: string }).error || msg : msg } catch { msg = m || msg }
      addToast({ type: 'error', message: msg })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`SEO connection · ${brand.name}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={saving} leadingIcon={<Link2 size={16} />}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-body-sm text-ink-muted">
          Grant the portal’s Google service account <b>read</b> access to this brand’s Search Console property and GA4 property, then enter their identifiers below.
        </p>
        <TextField
          label="Search Console property"
          value={gsc}
          onChange={(e) => setGsc(e.target.value)}
          placeholder="sc-domain:example.com  or  https://example.com/"
        />
        <TextField
          label="GA4 property ID"
          value={ga4}
          onChange={(e) => setGa4(e.target.value)}
          placeholder="properties/123456789  (or just 123456789)"
        />
        <div className="flex items-center justify-between rounded-btn border border-line bg-bg px-3 py-2">
          <span className="text-body-sm text-ink-muted">{syncedLabel(brand.seoSyncedAt)}</span>
          <Button variant="secondary" onClick={runSync} disabled={syncing || (!brand.gscSiteUrl && !brand.ga4PropertyId)} leadingIcon={<RefreshCw size={15} />}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
        <p className="text-[11px] text-ink-muted">Save first, then Sync. Search Console finalizes data ~2–3 days late, so the most recent day or two may fill in later.</p>
      </div>
    </Modal>
  )
}
