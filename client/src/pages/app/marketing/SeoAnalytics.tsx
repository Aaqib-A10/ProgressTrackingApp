import { useEffect, useRef, useState } from 'react'
import { RefreshCw, UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { listBrands, syncSeo, uploadSeoCsv, type Brand } from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function SeoAnalytics() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listBrands()
      .then((r) => {
        setBrands(r.brands)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const brand = brands.find((b) => b.id === brandId) ?? null

  async function sync() {
    if (!brandId) return
    setSyncing(true)
    try {
      const r = await syncSeo({ brandId })
      const days = r.results.reduce((a, x) => a + x.days, 0)
      const errs = r.results.flatMap((x) => x.errors)
      addToast({ type: errs.length ? 'error' : 'success', message: errs.length ? errs[0] : `Synced ${days} day(s) of data.` })
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Sync failed.' })
    } finally {
      setSyncing(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !brandId) return
    setUploading(true)
    try {
      const r = await uploadSeoCsv(brandId, file)
      addToast({ type: 'success', message: `Imported ${r.rowsImported} day(s) from ${file.name}.` })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed.' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">SEO Analytics</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Pull Search Console + GA4 data automatically, or upload an export.</p>
        </div>
        {brands.length > 0 && (
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
            <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {brands.length === 0 && (
        <Card>
          <p className="py-8 text-center text-body-md text-ink-muted">Add a brand first (Marketing → Brands) to track its SEO analytics.</p>
        </Card>
      )}

      {brand && (
        <>
          <Card title="Automatic sync (Google Search Console + GA4)">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-body-md">
                {brand.seoConnected ? (
                  <Badge tone="success" dot>Connected</Badge>
                ) : (
                  <Badge tone="warning" dot>Not connected</Badge>
                )}
                <span className="text-ink-muted">
                  {brand.seoConnected
                    ? brand.seoSyncedAt
                      ? `Last synced ${new Date(brand.seoSyncedAt).toLocaleDateString()}`
                      : 'Never synced'
                    : 'Configure Search Console / GA4 in Brands to enable auto-sync.'}
                </span>
              </div>
              <Button onClick={sync} disabled={syncing || !brand.seoConnected} leadingIcon={<RefreshCw size={16} />}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
          </Card>

          <Card title="Upload an export (CSV)">
            <p className="mb-4 text-body-md text-ink-muted">
              No Google connection? Upload a Search Console (Date, Clicks, Impressions, CTR, Position) or GA4 (Date, Sessions,
              Users…) CSV export. Rows are matched by date, so re-uploading updates rather than duplicates.
            </p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading} leadingIcon={<UploadCloud size={16} />}>
              {uploading ? 'Uploading…' : 'Choose CSV file'}
            </Button>
            <div className="mt-4 flex items-start gap-2 rounded-btn bg-slate-50 p-3 text-body-sm text-ink-muted">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>Trends and cross-brand comparison surface here once data lands — either sync path feeds the same store.</span>
            </div>
          </Card>
        </>
      )}

      <div className="flex items-center gap-1.5 text-body-sm text-ink-muted">
        <CheckCircle2 size={14} className="text-success" /> Both paths write to the same daily SEO store.
      </div>
    </div>
  )
}
