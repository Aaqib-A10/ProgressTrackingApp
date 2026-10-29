import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Search, Star, Link2, FileText, Pencil, Trash2, Copy, ExternalLink, Download, Upload } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { docsApi, DOC_CATEGORY_LABEL, MAX_DOC_BYTES, type DocCategory, type SavedDoc } from '../../../lib/docsApi'

/**
 * Docs & Links: your own place for important documents and links, with the brand they
 * belong to. Private: nobody else sees what you save here.
 */

const CATEGORIES = Object.keys(DOC_CATEGORY_LABEL) as DocCategory[]
const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message
  if (!m) return fallback
  try { return (JSON.parse(m) as { error?: string }).error || fallback } catch { return m }
}
const sizeLabel = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

export default function DocsLinks() {
  const { addToast } = useToast()
  const [docs, setDocs] = useState<SavedDoc[] | null>(null)
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState<DocCategory | ''>('')
  const [editing, setEditing] = useState<SavedDoc | 'new' | null>(null)

  const load = () => docsApi.list().then((r) => setDocs(r.docs)).catch(() => setDocs([]))
  useEffect(() => { void load() }, [])

  const brands = useMemo(() => [...new Set((docs ?? []).map((d) => d.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [docs])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (docs ?? []).filter((d) =>
      (!brand || d.brand === brand) && (!category || d.category === category) &&
      (!t || [d.title, d.brand, d.notes, d.url ?? '', d.file?.name ?? ''].some((f) => f.toLowerCase().includes(t))))
  }, [docs, q, brand, category])

  async function togglePin(d: SavedDoc) {
    setDocs((all) => all?.map((x) => (x.id === d.id ? { ...x, pinned: !d.pinned } : x)) ?? null)
    await docsApi.update(d.id, { pinned: !d.pinned }).then(load).catch(() => { addToast({ type: 'error', message: 'Could not update.' }); void load() })
  }
  async function remove(d: SavedDoc) {
    if (!confirm(`Delete "${d.title}"?`)) return
    await docsApi.remove(d.id).then(() => { addToast({ type: 'success', message: 'Deleted.' }); void load() }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not delete.') }))
  }
  function copy(url: string) {
    void navigator.clipboard?.writeText(url).then(() => addToast({ type: 'success', message: 'Link copied.' }))
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Docs & Links</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Keep your important documents and links in one place, by brand. Only you can see these.</p>
        </div>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setEditing('new')}>Add document or link</Button>
      </div>

      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, brand, notes or link…" className="h-9 w-full rounded-btn border border-line bg-bg pl-9 pr-3 text-body-sm text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="h-9 rounded-btn border border-line bg-bg px-2 text-body-sm text-ink" aria-label="Brand">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory | '')} className="h-9 rounded-btn border border-line bg-bg px-2 text-body-sm text-ink" aria-label="Type">
            <option value="">All types</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>

        {!docs ? (
          <p className="px-4 py-10 text-center text-body-md text-ink-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-body-md text-ink-muted">{docs.length ? 'Nothing matches that search.' : 'Nothing saved yet. Add a price list, a contract, a portal link…'}</p>
            {!docs.length && <Button className="mt-3" variant="secondary" leadingIcon={<Plus size={16} />} onClick={() => setEditing('new')}>Add your first one</Button>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((d) => (
              <li key={d.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60">
                <button onClick={() => void togglePin(d)} className={cn('mt-0.5 rounded p-1', d.pinned ? 'text-warning' : 'text-ink-muted hover:text-warning')} aria-label={d.pinned ? 'Unpin' : 'Pin to top'} title={d.pinned ? 'Pinned' : 'Pin to top'}>
                  <Star size={16} fill={d.pinned ? 'currentColor' : 'none'} />
                </button>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-primary/10 text-primary">{d.file ? <FileText size={16} /> : <Link2 size={16} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink [overflow-wrap:anywhere]">{d.title}</span>
                    {d.brand && <Badge tone="accent">{d.brand}</Badge>}
                    <Badge tone="neutral">{DOC_CATEGORY_LABEL[d.category]}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm">
                    {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" title={d.url}><ExternalLink size={13} /> {host(d.url)}</a>}
                    {d.file && <a href={d.file.downloadUrl} className="inline-flex items-center gap-1 text-primary hover:underline"><Download size={13} /> {d.file.name} <span className="text-ink-muted">({sizeLabel(d.file.size)})</span></a>}
                  </div>
                  {d.notes && <p className="mt-1 whitespace-pre-line text-body-sm text-ink-muted [overflow-wrap:anywhere]">{d.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {d.url && <button onClick={() => copy(d.url!)} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-primary" aria-label="Copy link" title="Copy link"><Copy size={15} /></button>}
                  <button onClick={() => setEditing(d)} className="rounded p-1.5 text-ink-muted hover:bg-slate-100 hover:text-primary" aria-label="Edit" title="Edit"><Pencil size={15} /></button>
                  <button onClick={() => void remove(d)} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete" title="Delete"><Trash2 size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <DocModal doc={editing === 'new' ? null : editing} brands={brands} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

function DocModal({ doc, brands, onClose, onSaved }: { doc: SavedDoc | null; brands: string[]; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast()
  const [title, setTitle] = useState(doc?.title ?? '')
  const [url, setUrl] = useState(doc?.url ?? '')
  const [brand, setBrand] = useState(doc?.brand ?? '')
  const [category, setCategory] = useState<DocCategory>(doc?.category ?? 'OTHER')
  const [notes, setNotes] = useState(doc?.notes ?? '')
  const [pinned, setPinned] = useState(doc?.pinned ?? false)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const link = url.trim()
    if (!title.trim()) { addToast({ type: 'error', message: 'Give it a name.' }); return }
    if (link && !/^https?:\/\//i.test(link)) { addToast({ type: 'error', message: 'Links must start with http:// or https://' }); return }
    if (!link && !file && !doc?.file) { addToast({ type: 'error', message: 'Add a link or choose a file.' }); return }
    if (file && file.size > MAX_DOC_BYTES) { addToast({ type: 'error', message: 'Files can be up to 25 MB.' }); return }
    setSaving(true)
    try {
      const input = { title: title.trim(), url: link || null, brand: brand.trim() || null, category, notes: notes.trim() || null, pinned }
      const saved = doc ? (await docsApi.update(doc.id, input)).doc : (await docsApi.create(input)).doc
      if (file) await docsApi.upload(saved.id, file)
      addToast({ type: 'success', message: doc ? 'Saved.' : 'Added.' })
      onSaved()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not save.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={doc ? 'Edit' : 'Add document or link'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-body-sm font-semibold text-ink">Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dell 2026 buyback price list" className={cn(inputCls, 'mt-1')} autoFocus />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-body-sm font-semibold text-ink">Brand / company
            <input value={brand} onChange={(e) => setBrand(e.target.value)} list="doc-brands" placeholder="e.g. Minnesota Computers" className={cn(inputCls, 'mt-1')} />
            <datalist id="doc-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label className="block text-body-sm font-semibold text-ink">Type
            <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} className={cn(inputCls, 'mt-1')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-body-sm font-semibold text-ink">Link
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={cn(inputCls, 'mt-1')} inputMode="url" />
        </label>
        <div>
          <p className="text-body-sm font-semibold text-ink">File <span className="font-normal text-ink-muted">(optional, up to 25 MB)</span></p>
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-btn border border-dashed border-line px-3 py-2.5 text-body-sm text-ink-muted hover:border-primary/40">
            <Upload size={16} />
            <span className="truncate">{file ? file.name : doc?.file ? `${doc.file.name} (choose a file to replace it)` : 'Choose a file: PDF, Word, Excel, image…'}</span>
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <label className="block text-body-sm font-semibold text-ink">Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Contact person, expiry date, login hint (never passwords)…" className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-body-md text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10" />
        </label>
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 rounded border-line" /> Pin to the top
        </label>
      </form>
    </Modal>
  )
}
