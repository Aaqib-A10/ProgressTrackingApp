import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { listBrands, createBrand, updateBrand, type Brand } from '../../../lib/marketingApi'

export default function MarketingBrands() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)

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
    </div>
  )
}
