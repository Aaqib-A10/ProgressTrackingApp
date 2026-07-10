import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { StatCard } from '../../../components/StatCard'
import { TextField } from '../../../components/ui/Input'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import {
  listBrands,
  listBlogs,
  createBlog,
  deleteBlog,
  getBlogCounts,
  type Brand,
  type BlogPost,
  type BlogCounts,
} from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function MarketingBlogs() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [month, setMonth] = useState(thisMonth())
  const [counts, setCounts] = useState<BlogCounts | null>(null)
  const [blogs, setBlogs] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  const [brandId, setBrandId] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [words, setWords] = useState('')
  const [publishedAt, setPublishedAt] = useState(today())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listBrands()
      .then((r) => {
        setBrands(r.brands)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load brands.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  const refresh = useCallback(() => {
    getBlogCounts(month).then(setCounts).catch(() => undefined)
    listBlogs({ month }).then((r) => setBlogs(r.blogs)).catch(() => undefined)
  }, [month])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!brandId || !title.trim()) return
    setSaving(true)
    try {
      await createBlog({
        brandId,
        title: title.trim(),
        url: url.trim() || undefined,
        wordCount: words ? Number(words) : undefined,
        publishedAt: publishedAt || undefined,
      })
      setTitle('')
      setUrl('')
      setWords('')
      addToast({ type: 'success', message: 'Blog logged.' })
      refresh()
    } catch {
      addToast({ type: 'error', message: 'Could not log blog.' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(b: BlogPost) {
    const prev = blogs
    setBlogs((bs) => bs.filter((x) => x.id !== b.id))
    try {
      await deleteBlog(b.id)
      refresh()
    } catch {
      setBlogs(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  const columns: Column<BlogPost>[] = [
    { key: 'title', header: 'Title', render: (b) => (b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{b.title}</a> : <span className="font-medium text-ink">{b.title}</span>) },
    { key: 'brand', header: 'Brand', render: (b) => b.brand.name },
    { key: 'author', header: 'Author', render: (b) => b.author?.name ?? '—' },
    { key: 'words', header: 'Words', align: 'right', render: (b) => (b.wordCount != null ? formatNumber(b.wordCount) : '—') },
    { key: 'published', header: 'Published', render: (b) => b.publishedAt ?? '—' },
    { key: 'actions', header: '', align: 'right', render: (b) => <button onClick={() => remove(b)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button> },
  ]

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Blogs</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Log blogs per brand; counts roll up at month end.</p>
        </div>
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Month</label>
          <input type="month" className={sel} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      {counts && counts.counts.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="All brands" value={formatNumber(counts.total)} caption={`blogs in ${counts.month}`} />
          {counts.counts.filter((c) => c.count > 0).map((c) => (
            <StatCard key={c.brandId} label={c.name} value={formatNumber(c.count)} delta={c.count ? c.delta : undefined} caption="vs last month" />
          ))}
        </div>
      )}

      {brands.length > 0 && (
        <Card title="Log a blog">
          <form onSubmit={add} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-1">
              <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
              <select className={`${sel} w-full`} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Blog title" />
            </div>
            <TextField label="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Published</label>
              <input type="date" className={`${sel} w-full`} value={publishedAt} max={today()} onChange={(e) => setPublishedAt(e.target.value)} />
            </div>
            <div className="flex items-end gap-3">
              <TextField label="Words" value={words} onChange={(e) => setWords(e.target.value.replace(/\D/g, ''))} placeholder="0" />
              <Button type="submit" disabled={saving} leadingIcon={<Plus size={16} />}>
                Log
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Blogs — ${month}`} flush>
        <DataTable columns={columns} rows={blogs} getRowId={(b) => b.id} emptyMessage="No blogs logged for this month yet." />
      </Card>
    </div>
  )
}
