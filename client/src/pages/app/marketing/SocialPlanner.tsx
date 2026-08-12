import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { TextField } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { PillFilter } from '../../../components/ui/PillFilter'
import { useToast } from '../../../components/ui/Toast'
import {
  listBrands,
  getSocialPlanner,
  createPlannerPost,
  updatePlannerPost,
  deletePlannerPost,
  SOCIAL_PLATFORMS,
  type Brand,
  type PlannerPost,
  type SocialPlatform,
  type TaskStatus,
} from '../../../lib/marketingApi'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const sel =
  'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

// Distinct hue per platform for the planner chips.
const PLATFORM_COLOR: Record<SocialPlatform, string> = {
  INSTAGRAM: '#E1306C',
  FACEBOOK: '#1877F2',
  LINKEDIN: '#0A66C2',
  X: '#0F172A',
  TIKTOK: '#14B8A6',
  YOUTUBE: '#EF4444',
  GOOGLE_BUSINESS: '#F59E0B',
  OTHER: '#64748B',
}
const platformLabel = (p: SocialPlatform | null) => SOCIAL_PLATFORMS.find((x) => x.key === p)?.label ?? '—'

const STATUS_OPTIONS: { key: TaskStatus; label: string }[] = [
  { key: 'BACKLOG', label: 'Idea' },
  { key: 'IN_PROGRESS', label: 'Drafting' },
  { key: 'IN_REVIEW', label: 'In Review' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'PUBLISHED', label: 'Published' },
]
const statusLabel = (s: TaskStatus) => STATUS_OPTIONS.find((x) => x.key === s)?.label ?? s

function ym(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

type Editor = { post: PlannerPost | null; date: string } | null
type Draft = { title: string; platform: SocialPlatform; status: TaskStatus }

export default function SocialPlanner() {
  const { addToast } = useToast()
  const [month, setMonth] = useState(() => ym(new Date()))
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | 'ALL'>('ALL')
  const [posts, setPosts] = useState<PlannerPost[]>([])
  const [loading, setLoading] = useState(true)

  const [editor, setEditor] = useState<Editor>(null)
  const [draft, setDraft] = useState<Draft>({ title: '', platform: 'INSTAGRAM', status: 'SCHEDULED' })
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
    getSocialPlanner({ month, brandId: brandId || undefined })
      .then((r) => setPosts(r.posts))
      .catch(() => addToast({ type: 'error', message: 'Could not load planner.' }))
  }, [month, brandId, addToast])
  useEffect(() => {
    refresh()
  }, [refresh])

  const visible = useMemo(
    () => (platformFilter === 'ALL' ? posts : posts.filter((p) => p.platform === platformFilter)),
    [posts, platformFilter],
  )
  const byDate = useMemo(() => {
    const map = new Map<string, PlannerPost[]>()
    for (const p of visible) if (p.scheduledDate) map.set(p.scheduledDate, [...(map.get(p.scheduledDate) ?? []), p])
    return map
  }, [visible])

  const [year, mon] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, mon - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const leading = first.getUTCDay()
  const cells: (string | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const shift = (delta: number) => setMonth(ym(new Date(Date.UTC(year, mon - 1 + delta, 1))))

  function openNew(date: string) {
    if (!brandId) {
      addToast({ type: 'error', message: 'Add a brand first (Marketing → Brands).' })
      return
    }
    setDraft({ title: '', platform: platformFilter === 'ALL' ? 'INSTAGRAM' : platformFilter, status: 'SCHEDULED' })
    setEditor({ post: null, date })
  }
  function openEdit(post: PlannerPost) {
    setDraft({ title: post.title, platform: (post.platform ?? 'INSTAGRAM') as SocialPlatform, status: post.status })
    setEditor({ post, date: post.scheduledDate ?? `${month}-01` })
  }

  async function save() {
    if (!editor || !draft.title.trim()) return
    setSaving(true)
    try {
      if (editor.post) {
        await updatePlannerPost(editor.post.id, { title: draft.title.trim(), platform: draft.platform, status: draft.status })
      } else {
        await createPlannerPost({ title: draft.title.trim(), platform: draft.platform, status: draft.status, brandId, scheduledDate: editor.date })
      }
      setEditor(null)
      addToast({ type: 'success', message: editor.post ? 'Post updated.' : 'Post scheduled.' })
      refresh()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editor?.post) return
    setSaving(true)
    try {
      await deletePlannerPost(editor.post.id)
      setEditor(null)
      addToast({ type: 'success', message: 'Post removed.' })
      refresh()
    } catch {
      addToast({ type: 'error', message: 'Could not delete.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-ink">Social Planner</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Plan &amp; schedule social content per brand and platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></Button>
          <span className="min-w-[140px] text-center text-body-md font-semibold text-ink">{monthLabel}</span>
          <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        {brands.length > 0 && (
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Brand</label>
            <select className="h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <PillFilter
          size="sm"
          options={[{ value: 'ALL' as const, label: 'All' }, ...SOCIAL_PLATFORMS.map((p) => ({ value: p.key, label: p.label }))]}
          value={platformFilter}
          onChange={setPlatformFilter}
        />
      </div>

      <Card flush>
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-label-md uppercase text-ink-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => (
            <div key={i} className="group min-h-[104px] border-b border-r border-line/70 p-1.5 last:border-r-0">
              {date && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-body-sm font-medium text-ink-muted">{Number(date.slice(-2))}</span>
                    <button onClick={() => openNew(date)} className="text-ink-muted opacity-0 transition-opacity hover:text-primary group-hover:opacity-100" title="Schedule a post">
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {(byDate.get(date) ?? []).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openEdit(p)}
                        className="flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                        style={{ backgroundColor: `${PLATFORM_COLOR[(p.platform ?? 'OTHER') as SocialPlatform]}1a`, color: PLATFORM_COLOR[(p.platform ?? 'OTHER') as SocialPlatform] }}
                        title={`${p.title} · ${platformLabel(p.platform)} · ${statusLabel(p.status)}`}
                      >
                        <span className="truncate">{p.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-3 text-body-sm text-ink-muted">
        {SOCIAL_PLATFORMS.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLOR[p.key] }} /> {p.label}
          </span>
        ))}
      </div>

      <Modal
        open={editor != null}
        onClose={() => setEditor(null)}
        title={editor?.post ? 'Edit post' : 'Schedule a post'}
        footer={
          <>
            {editor?.post && (
              <Button variant="ghost" onClick={remove} disabled={saving} leadingIcon={<Trash2 size={16} />} className="mr-auto text-danger">Delete</Button>
            )}
            <Button variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {editor && (
            <p className="text-body-sm text-ink-muted">
              {new Date(`${editor.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
              {' · '}
              {brands.find((b) => b.id === brandId)?.name}
            </p>
          )}
          <TextField label="Post title / idea" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Product launch teaser" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Platform</label>
              <select className={sel} value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value as SocialPlatform }))}>
                {SOCIAL_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
              <select className={sel} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as TaskStatus }))}>
                {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          {editor?.post && (
            <div className="flex items-center gap-2">
              <span className="text-body-sm text-ink-muted">Current:</span>
              <Badge tone="primary">{platformLabel(editor.post.platform)}</Badge>
              <Badge tone="neutral">{statusLabel(editor.post.status)}</Badge>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
