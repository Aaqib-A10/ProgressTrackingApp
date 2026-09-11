import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Plus, Trash2, Pencil, ExternalLink, GripVertical } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { StatCard } from '../../../components/StatCard'
import { TextField } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { PillFilter } from '../../../components/ui/PillFilter'
import { DataTable, type Column } from '../../../components/DataTable'
import { useToast } from '../../../components/ui/Toast'
import { formatNumber } from '../../../lib/format'
import {
  getBoard,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  listSearchTerms,
  createSearchTerm,
  updateSearchTerm,
  deleteSearchTerm,
  listBusinessSuites,
  createBusinessSuite,
  updateBusinessSuite,
  deleteBusinessSuite,
  META_PLATFORMS,
  SERVICE_TIERS,
  CRM_PROVIDERS,
  CRM_STATUSES,
  PROFILE_PLATFORMS,
  PROFILE_STATUSES,
  MANAGED_VIA,
  SEARCH_TERM_STATUSES,
  type Brand,
  type BrandProfile,
  type SearchTermPage,
  type BusinessSuite,
  type ServiceTier,
  type CrmProvider,
  type CrmStatus,
  type ProfilePlatform,
  type ProfileStatus,
  type ManagedVia,
  type SearchTermStatus,
} from '../../../lib/marketingApi'

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

type Member = { id: string; name: string }

// Channels shown as columns in the coverage matrix (§2.1 of the plan + Website).
const MATRIX_COLS: { platform: ProfilePlatform; label: string }[] = [
  { platform: 'LINKEDIN', label: 'LinkedIn' },
  { platform: 'FACEBOOK', label: 'Facebook' },
  { platform: 'INSTAGRAM', label: 'Instagram' },
  { platform: 'YOUTUBE', label: 'YouTube' },
  { platform: 'X', label: 'X' },
  { platform: 'REDDIT', label: 'Reddit' },
  { platform: 'WEBSITE', label: 'Website' },
]
// Tier display order for the grouped matrix.
const TIER_ORDER: ServiceTier[] = ['TIER_1', 'TIER_2', 'MAINTENANCE']

// ---- badge/label helpers driven by the option arrays ----
const tierTone = (t: ServiceTier) => (SERVICE_TIERS.find((x) => x.key === t)?.tone ?? 'neutral') as BadgeTone
const tierLabel = (t: ServiceTier) => SERVICE_TIERS.find((x) => x.key === t)?.label ?? t
const crmTone = (s: CrmStatus) => (CRM_STATUSES.find((x) => x.key === s)?.tone ?? 'neutral') as BadgeTone
const crmLabel = (s: CrmStatus) => CRM_STATUSES.find((x) => x.key === s)?.label ?? s
const crmProviderLabel = (p: CrmProvider | null) => (p ? CRM_PROVIDERS.find((x) => x.key === p)?.label ?? p : null)
const statusTone = (s: ProfileStatus) => (PROFILE_STATUSES.find((x) => x.key === s)?.tone ?? 'neutral') as BadgeTone
const statusLabel = (s: ProfileStatus) => PROFILE_STATUSES.find((x) => x.key === s)?.label ?? s
const platformLabel = (p: ProfilePlatform) => PROFILE_PLATFORMS.find((x) => x.key === p)?.label ?? p
const managedTone = (m: ManagedVia) => (MANAGED_VIA.find((x) => x.key === m)?.tone ?? 'neutral') as BadgeTone
const managedLabel = (m: ManagedVia) => MANAGED_VIA.find((x) => x.key === m)?.label ?? m

// ---- drafts ----
type BrandDraft = {
  name: string
  website: string
  tier: ServiceTier
  ownerId: string
  crmProvider: '' | CrmProvider
  crmStatus: CrmStatus
  crmAccount: string
  crmNote: string
  searchTermTarget: string
}
const emptyBrandDraft = (): BrandDraft => ({
  name: '', website: '', tier: 'TIER_1', ownerId: '', crmProvider: '', crmStatus: 'NONE', crmAccount: '', crmNote: '', searchTermTarget: '',
})

type StDraft = { term: string; url: string; status: SearchTermStatus; note: string }
const emptyStDraft = (): StDraft => ({ term: '', url: '', status: 'PLANNED', note: '' })

type ProfileDraft = { platform: ProfilePlatform; handle: string; url: string; status: ProfileStatus; managedVia: ManagedVia; businessSuiteId: string; ownerId: string; note: string }
const emptyProfileDraft = (): ProfileDraft => ({ platform: 'FACEBOOK', handle: '', url: '', status: 'ACTIVE', managedVia: 'MANUAL', businessSuiteId: '', ownerId: '', note: '' })
const isMeta = (p: ProfilePlatform) => META_PLATFORMS.includes(p)

type SuiteDraft = { name: string; businessManagerId: string; url: string }
const emptySuiteDraft = (): SuiteDraft => ({ name: '', businessManagerId: '', url: '' })

export default function MarketingProfiles() {
  const { addToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [allProfiles, setAllProfiles] = useState<BrandProfile[]>([])
  const [businessSuites, setBusinessSuites] = useState<BusinessSuite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'matrix' | 'board'>('matrix')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Brand modal (create or edit)
  const [brandModal, setBrandModal] = useState<{ mode: 'create' | 'edit'; brand?: Brand } | null>(null)
  const [brandDraft, setBrandDraft] = useState<BrandDraft>(emptyBrandDraft)

  // Profile modal (create with preset, or edit)
  const [profileModal, setProfileModal] = useState<{ mode: 'create'; brandId: string } | { mode: 'edit'; profile: BrandProfile } | null>(null)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft)

  // Search-term pages (for the open brand popup)
  const [searchTerms, setSearchTerms] = useState<SearchTermPage[]>([])
  const [stModal, setStModal] = useState<{ mode: 'create'; brandId: string } | { mode: 'edit'; page: SearchTermPage } | null>(null)
  const [stDraft, setStDraft] = useState<StDraft>(emptyStDraft)

  // Business Suites manager
  const [suiteManagerOpen, setSuiteManagerOpen] = useState(false)
  const [suiteDraft, setSuiteDraft] = useState<SuiteDraft>(emptySuiteDraft)
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const [b, p, s] = await Promise.all([listBrands(), listProfiles(), listBusinessSuites()])
    setBrands(b.brands)
    setAllProfiles(p.profiles)
    setBusinessSuites(s.suites)
    return b.brands
  }, [])

  useEffect(() => {
    Promise.all([loadAll(), getBoard().then((r) => r.members).catch(() => [] as Member[])])
      .then(([, m]) => setMembers(m))
      .catch(() => addToast({ type: 'error', message: 'Could not load Marketing data.' }))
      .finally(() => setLoading(false))
  }, [loadAll, addToast])

  // Load the open brand's search-term pages.
  useEffect(() => {
    if (!selectedBrandId) {
      setSearchTerms([])
      return
    }
    let active = true
    listSearchTerms(selectedBrandId).then((r) => active && setSearchTerms(r.pages)).catch(() => undefined)
    return () => { active = false }
  }, [selectedBrandId])

  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? '—' : '—')
  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? null

  // brandId → platform → profile (first match wins; used by the matrix cells)
  const matrix = useMemo(() => {
    const m = new Map<string, Map<ProfilePlatform, BrandProfile>>()
    for (const p of allProfiles) {
      let byPlat = m.get(p.brandId)
      if (!byPlat) {
        byPlat = new Map()
        m.set(p.brandId, byPlat)
      }
      // Prefer an ACTIVE profile if a brand has more than one on a platform.
      const prev = byPlat.get(p.platform)
      if (!prev || (prev.status !== 'ACTIVE' && p.status === 'ACTIVE')) byPlat.set(p.platform, p)
    }
    return m
  }, [allProfiles])

  const profileAt = (brandId: string, platform: ProfilePlatform) => matrix.get(brandId)?.get(platform)
  const brandProfiles = (brandId: string) => allProfiles.filter((p) => p.brandId === brandId)

  const brandsByTier = useMemo(
    () => [...brands].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name)),
    [brands],
  )

  function selectBrand(id: string) {
    // Open the brand detail popup.
    setSelectedBrandId(id)
  }

  // ---------- brand modal ----------
  function openBrandCreate() {
    setBrandDraft(emptyBrandDraft())
    setBrandModal({ mode: 'create' })
  }
  function openBrandEdit(b: Brand) {
    setBrandDraft({
      name: b.name, website: b.website ?? '', tier: b.tier, ownerId: b.ownerId ?? '',
      crmProvider: b.crmProvider ?? '', crmStatus: b.crmStatus, crmAccount: b.crmAccount ?? '', crmNote: b.crmNote ?? '',
      searchTermTarget: b.searchTermTarget != null ? String(b.searchTermTarget) : '',
    })
    setBrandModal({ mode: 'edit', brand: b })
  }
  const brandPayload = (d: BrandDraft) => ({
    website: d.website.trim() || null,
    tier: d.tier,
    ownerId: d.ownerId || null,
    crmProvider: d.crmProvider || null,
    crmStatus: d.crmStatus,
    crmAccount: d.crmAccount.trim() || null,
    crmNote: d.crmNote.trim() || null,
    searchTermTarget: d.searchTermTarget.trim() === '' ? null : Number(d.searchTermTarget),
  })
  async function saveBrand() {
    if (!brandModal) return
    if (!brandDraft.name.trim()) return
    setSaving(true)
    try {
      if (brandModal.mode === 'create') {
        const { brand } = await createBrand({ name: brandDraft.name.trim(), ...brandPayload(brandDraft) })
        await loadAll()
        selectBrand(brand.id)
      } else {
        await updateBrand(brandModal.brand!.id, { name: brandDraft.name.trim(), ...brandPayload(brandDraft) })
        await loadAll()
      }
      setBrandModal(null)
      addToast({ type: 'success', message: 'Brand suite saved.' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save brand.' })
    } finally {
      setSaving(false)
    }
  }
  async function removeBrand(b: Brand) {
    if (!window.confirm(`Archive "${b.name}"? Its profiles stay on record but the suite is hidden.`)) return
    try {
      await deleteBrand(b.id)
      if (selectedBrandId === b.id) setSelectedBrandId('')
      await loadAll()
    } catch {
      addToast({ type: 'error', message: 'Could not archive brand.' })
    }
  }

  // ---------- profile modal ----------
  function openProfileCreate(brandId: string, platform?: ProfilePlatform) {
    setProfileDraft({ ...emptyProfileDraft(), platform: platform ?? 'FACEBOOK' })
    setProfileModal({ mode: 'create', brandId })
  }
  function openProfileEdit(p: BrandProfile) {
    setProfileDraft({ platform: p.platform, handle: p.handle ?? '', url: p.url ?? '', status: p.status, managedVia: p.managedVia, businessSuiteId: p.businessSuiteId ?? '', ownerId: p.ownerId ?? '', note: p.note ?? '' })
    setProfileModal({ mode: 'edit', profile: p })
  }
  const profilePayload = (d: ProfileDraft) => ({
    platform: d.platform,
    handle: d.handle.trim() || null,
    url: d.url.trim() || null,
    status: d.status,
    managedVia: d.managedVia,
    // Business Suite only applies to Meta channels (FB/IG); cleared otherwise.
    businessSuiteId: isMeta(d.platform) ? (d.businessSuiteId || null) : null,
    ownerId: d.ownerId || null,
    note: d.note.trim() || null,
  })
  async function saveProfile() {
    if (!profileModal) return
    setSaving(true)
    try {
      if (profileModal.mode === 'create') {
        await createProfile({ brandId: profileModal.brandId, ...profilePayload(profileDraft) })
      } else {
        await updateProfile(profileModal.profile.id, profilePayload(profileDraft))
      }
      setProfileModal(null)
      addToast({ type: 'success', message: 'Profile saved.' })
      await loadAll()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save profile.' })
    } finally {
      setSaving(false)
    }
  }
  async function removeProfile(p: BrandProfile) {
    const prev = allProfiles
    setAllProfiles((ps) => ps.filter((x) => x.id !== p.id))
    try {
      await deleteProfile(p.id)
      await loadAll()
    } catch {
      setAllProfiles(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  // ---------- search-term pages ----------
  function openStCreate(brandId: string) {
    setStDraft(emptyStDraft())
    setStModal({ mode: 'create', brandId })
  }
  function openStEdit(p: SearchTermPage) {
    setStDraft({ term: p.term, url: p.url ?? '', status: p.status, note: p.note ?? '' })
    setStModal({ mode: 'edit', page: p })
  }
  const stPayload = (d: StDraft) => ({ term: d.term.trim(), url: d.url.trim() || null, status: d.status, note: d.note.trim() || null })
  async function saveSt() {
    if (!stModal) return
    if (!stDraft.term.trim()) return
    setSaving(true)
    try {
      if (stModal.mode === 'create') {
        const { page } = await createSearchTerm({ brandId: stModal.brandId, ...stPayload(stDraft) })
        setSearchTerms((ts) => [...ts, page])
      } else {
        const { page } = await updateSearchTerm(stModal.page.id, stPayload(stDraft))
        setSearchTerms((ts) => ts.map((t) => (t.id === page.id ? page : t)))
      }
      setStModal(null)
      loadAll() // refresh brand live/target counts
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save term.' })
    } finally {
      setSaving(false)
    }
  }
  async function setStStatus(p: SearchTermPage, status: SearchTermStatus) {
    const prev = searchTerms
    setSearchTerms((ts) => ts.map((t) => (t.id === p.id ? { ...t, status } : t))) // optimistic
    try {
      await updateSearchTerm(p.id, { status })
      loadAll()
    } catch {
      setSearchTerms(prev)
      addToast({ type: 'error', message: 'Could not update.' })
    }
  }
  async function removeSt(p: SearchTermPage) {
    const prev = searchTerms
    setSearchTerms((ts) => ts.filter((t) => t.id !== p.id))
    try {
      await deleteSearchTerm(p.id)
      loadAll()
    } catch {
      setSearchTerms(prev)
      addToast({ type: 'error', message: 'Could not delete.' })
    }
  }

  // ---------- Business Suites ----------
  function editSuite(s: BusinessSuite) {
    setEditingSuiteId(s.id)
    setSuiteDraft({ name: s.name, businessManagerId: s.businessManagerId ?? '', url: s.url ?? '' })
  }
  function cancelSuiteEdit() {
    setEditingSuiteId(null)
    setSuiteDraft(emptySuiteDraft())
  }
  async function saveSuite() {
    if (!suiteDraft.name.trim()) return
    setSaving(true)
    const payload = { businessManagerId: suiteDraft.businessManagerId.trim() || null, url: suiteDraft.url.trim() || null }
    try {
      if (editingSuiteId) await updateBusinessSuite(editingSuiteId, { name: suiteDraft.name.trim(), ...payload })
      else await createBusinessSuite({ name: suiteDraft.name.trim(), ...payload })
      cancelSuiteEdit()
      await loadAll()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save Business Suite.' })
    } finally {
      setSaving(false)
    }
  }
  async function removeSuite(s: BusinessSuite) {
    if (!window.confirm(`Delete "${s.name}"? ${s.profileCount} profile(s) will be unlinked from it.`)) return
    try {
      await deleteBusinessSuite(s.id)
      await loadAll()
    } catch {
      addToast({ type: 'error', message: 'Could not delete Business Suite.' })
    }
  }

  // ---------- tier board: drag a brand into another tier ----------
  async function moveBrandTier(brandId: string, tier: ServiceTier) {
    const b = brands.find((x) => x.id === brandId)
    if (!b || b.tier === tier) return
    const prev = brands
    setBrands((bs) => bs.map((x) => (x.id === brandId ? { ...x, tier } : x))) // optimistic
    try {
      const { brand } = await updateBrand(brandId, { tier })
      setBrands((bs) => bs.map((x) => (x.id === brandId ? brand : x)))
      addToast({ type: 'success', message: `${b.name} → ${tierLabel(tier)}` })
    } catch {
      setBrands(prev)
      addToast({ type: 'error', message: 'Could not move brand.' })
    }
  }
  function onTierDragEnd(e: DragEndEvent) {
    const tier = e.over?.id as ServiceTier | undefined
    if (tier) moveBrandTier(String(e.active.id), tier)
  }

  // ---------- summary ----------
  const tierCount = (t: ServiceTier) => brands.filter((b) => b.tier === t).length
  const activeProfileCount = allProfiles.filter((p) => p.status === 'ACTIVE').length
  const crmConnected = brands.filter((b) => b.crmConnected).length

  // ---------- shared field renderers ----------
  const ownerSelect = (value: string, onChange: (v: string) => void) => (
    <select className={`${sel} w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  )

  const brandFields = (d: BrandDraft, set: (d: BrandDraft) => void) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Brand suite name" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} placeholder="e.g. Green Loop" />
      <TextField label="Website" value={d.website} onChange={(e) => set({ ...d, website: e.target.value })} placeholder="https://…" />
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Service tier</label>
        <select className={`${sel} w-full`} value={d.tier} onChange={(e) => set({ ...d, tier: e.target.value as ServiceTier })}>
          {SERVICE_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Owner</label>
        {ownerSelect(d.ownerId, (v) => set({ ...d, ownerId: v }))}
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">CRM</label>
        <select className={`${sel} w-full`} value={d.crmProvider} onChange={(e) => set({ ...d, crmProvider: e.target.value as '' | CrmProvider })}>
          <option value="">None</option>
          {CRM_PROVIDERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">CRM status</label>
        <select className={`${sel} w-full`} value={d.crmStatus} onChange={(e) => set({ ...d, crmStatus: e.target.value as CrmStatus })}>
          {CRM_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <TextField label="CRM account" value={d.crmAccount} onChange={(e) => set({ ...d, crmAccount: e.target.value })} placeholder="workspace / account / URL" />
      <TextField label="CRM note" value={d.crmNote} onChange={(e) => set({ ...d, crmNote: e.target.value })} placeholder="optional" />
      <TextField
        label="Search-term page target"
        value={d.searchTermTarget}
        onChange={(e) => set({ ...d, searchTermTarget: e.target.value.replace(/\D/g, '') })}
        placeholder="e.g. 80"
        inputMode="numeric"
      />
    </div>
  )

  const profileFields = (d: ProfileDraft, set: (d: ProfileDraft) => void) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Platform</label>
        <select className={`${sel} w-full`} value={d.platform} onChange={(e) => set({ ...d, platform: e.target.value as ProfilePlatform })}>
          {PROFILE_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
        <select className={`${sel} w-full`} value={d.status} onChange={(e) => set({ ...d, status: e.target.value as ProfileStatus })}>
          {PROFILE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Managed via</label>
        <select className={`${sel} w-full`} value={d.managedVia} onChange={(e) => set({ ...d, managedVia: e.target.value as ManagedVia })}>
          {MANAGED_VIA.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      <TextField label="Handle / page name" value={d.handle} onChange={(e) => set({ ...d, handle: e.target.value })} placeholder="@greenloop" />
      <TextField label="Profile URL" value={d.url} onChange={(e) => set({ ...d, url: e.target.value })} placeholder="https://…" />
      {isMeta(d.platform) && (
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Business Suite</label>
          <select className={`${sel} w-full`} value={d.businessSuiteId} onChange={(e) => set({ ...d, businessSuiteId: e.target.value })}>
            <option value="">— none —</option>
            {businessSuites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" onClick={() => setSuiteManagerOpen(true)} className="mt-1 text-body-sm text-primary hover:underline">Manage Business Suites</button>
        </div>
      )}
      <div>
        <label className="mb-1 block text-body-sm font-semibold text-ink">Owner</label>
        {ownerSelect(d.ownerId, (v) => set({ ...d, ownerId: v }))}
      </div>
      <TextField label="Note" value={d.note} onChange={(e) => set({ ...d, note: e.target.value })} placeholder="optional" />
    </div>
  )

  // ---------- matrix cell ----------
  const matrixCell = (brand: Brand, platform: ProfilePlatform, label: string) => {
    const p = profileAt(brand.id, platform)
    if (!p) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); openProfileCreate(brand.id, platform) }}
          className="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-ink-muted/40 transition-colors hover:bg-primary/10 hover:text-primary"
          title={`Add ${label} for ${brand.name}`}
        >
          <Plus size={13} />
        </button>
      )
    }
    const dot = p.status === 'ACTIVE' ? 'bg-success' : p.status === 'PAUSED' ? 'bg-warning' : 'bg-slate-300'
    // Mixpost-managed channels get a teal ring around the status dot.
    const ring = p.managedVia === 'MIXPOST' ? 'ring-2 ring-accent ring-offset-1' : ''
    return (
      <button
        onClick={(e) => { e.stopPropagation(); openProfileEdit(p) }}
        className="mx-auto flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
        title={`${label}: ${statusLabel(p.status)} · ${managedLabel(p.managedVia)}${p.handle ? ` (${p.handle})` : ''} — click to edit`}
      >
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot} ${ring}`} />
      </button>
    )
  }

  const matrixColumns: Column<Brand>[] = [
    {
      key: 'brand',
      header: 'Brand',
      render: (b) => (
        <div>
          <button onClick={() => selectBrand(b.id)} className="flex items-center gap-2 text-left font-medium text-ink hover:text-primary">
            <span>{b.name}</span>
            {b.crmConnected && <Badge tone="success" className="px-1.5 py-0 text-[10px]">CRM</Badge>}
          </button>
          {b.searchTermTarget != null && b.searchTermTarget > 0 && (
            <div className="mt-0.5 text-[11px] text-ink-muted">SEO pages {b.searchTermsLive}/{b.searchTermTarget}</div>
          )}
        </div>
      ),
    },
    ...MATRIX_COLS.map(
      (c): Column<Brand> => ({
        key: c.platform,
        header: c.label,
        align: 'center',
        render: (b) => matrixCell(b, c.platform, c.label),
      }),
    ),
    { key: 'count', header: 'Active', align: 'right', render: (b) => `${b.activeProfiles}/${b.profileCount}` },
  ]

  // ---------- detail table ----------
  const detailColumns: Column<BrandProfile>[] = [
    { key: 'platform', header: 'Platform', render: (p) => <span className="font-medium text-ink">{platformLabel(p.platform)}</span> },
    { key: 'handle', header: 'Handle', render: (p) => p.handle ?? '—' },
    {
      key: 'url',
      header: 'URL',
      render: (p) =>
        p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Link <ExternalLink size={13} />
          </a>
        ) : '—',
    },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge> },
    { key: 'managed', header: 'Managed', render: (p) => <Badge tone={managedTone(p.managedVia)}>{managedLabel(p.managedVia)}</Badge> },
    {
      key: 'suite',
      header: 'Business Suite',
      render: (p) =>
        isMeta(p.platform)
          ? (p.businessSuiteName ?? <span className="text-ink-muted/60">— none —</span>)
          : <span className="text-ink-muted/40">n/a</span>,
    },
    { key: 'owner', header: 'Owner', render: (p) => p.ownerName ?? memberName(p.ownerId) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => openProfileEdit(p)} className="text-ink-muted hover:text-primary" title="Edit"><Pencil size={16} /></button>
          <button onClick={() => removeProfile(p)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ]

  const stColumns: Column<SearchTermPage>[] = [
    { key: 'term', header: 'Search term', render: (t) => <span className="font-medium text-ink">{t.term}</span> },
    {
      key: 'url',
      header: 'URL',
      render: (t) =>
        t.url ? (
          <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Link <ExternalLink size={13} /></a>
        ) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <select
          value={t.status}
          onChange={(e) => setStStatus(t, e.target.value as SearchTermStatus)}
          className="rounded-btn border border-line bg-card px-2 py-1 text-body-sm text-ink focus:border-primary focus:outline-none"
        >
          {SEARCH_TERM_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => openStEdit(t)} className="text-ink-muted hover:text-primary" title="Edit"><Pencil size={16} /></button>
          <button onClick={() => removeSt(t)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ]

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Profiles &amp; Platforms</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">
            Every brand suite, the channels we run for each, service tier, and CRM status. Click a dot to edit, a
            <span className="mx-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 align-middle text-primary"><Plus size={11} /></span>
            to add a channel, or a brand name to open its full list.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PillFilter
            options={[{ value: 'matrix', label: 'Matrix' }, { value: 'board', label: 'Tier board' }] as never}
            value={view}
            onChange={setView}
            size="sm"
          />
          <Button variant="secondary" onClick={() => setSuiteManagerOpen(true)}>Business Suites</Button>
          <Button onClick={openBrandCreate} leadingIcon={<Plus size={16} />}>New brand suite</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Brand Suites" value={formatNumber(brands.length)} valueClassName="text-headline-lg" />
        <StatCard label="Tier 1" value={formatNumber(tierCount('TIER_1'))} valueClassName="text-headline-lg" />
        <StatCard label="Tier 2" value={formatNumber(tierCount('TIER_2'))} valueClassName="text-headline-lg" />
        <StatCard label="Maintenance" value={formatNumber(tierCount('MAINTENANCE'))} valueClassName="text-headline-lg" />
        <StatCard label="Active Profiles" value={formatNumber(activeProfileCount)} valueClassName="text-headline-lg" />
        <StatCard label="CRM Connected" value={formatNumber(crmConnected)} valueClassName="text-headline-lg" caption={`of ${brands.length} suites`} />
      </div>

      {view === 'matrix' && (
        <>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-body-sm text-ink-muted">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-success" /> Active</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" /> Paused / needed</span>
            <span className="flex items-center gap-1.5"><Plus size={12} className="text-ink-muted/50" /> Not present (add)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-success ring-2 ring-accent ring-offset-1" /> Mixpost-managed</span>
          </div>

          <Card title="Coverage matrix" subtitle="Brands by tier × channel" flush>
            <DataTable
              columns={matrixColumns}
              rows={brandsByTier}
              getRowId={(b) => b.id}
              groupBy={(b) => b.tier}
              renderGroupHeader={(key, rows) => (
                <span className="flex items-center gap-2 text-label-md uppercase text-ink-muted">
                  <Badge tone={tierTone(key as ServiceTier)}>{tierLabel(key as ServiceTier)}</Badge>
                  <span>{rows.length} brands</span>
                </span>
              )}
              onRowClick={(b) => selectBrand(b.id)}
              emptyMessage="No brand suites yet — add one with “New brand suite”."
            />
          </Card>
        </>
      )}

      {view === 'board' && (
        <div>
          <p className="mb-3 text-body-sm text-ink-muted">Grab a card by its handle and drop it into another tier to re-prioritise a brand.</p>
          <DndContext sensors={sensors} onDragEnd={onTierDragEnd}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {TIER_ORDER.map((tier) => {
                const bs = brands.filter((b) => b.tier === tier).sort((a, b) => a.name.localeCompare(b.name))
                return (
                  <TierColumn key={tier} tier={tier} count={bs.length}>
                    {bs.map((b) => <BrandCard key={b.id} brand={b} profiles={brandProfiles(b.id)} onOpen={selectBrand} />)}
                  </TierColumn>
                )
              })}
            </div>
          </DndContext>
        </div>
      )}

      {/* Per-brand detail — centered popup */}
      <Modal
        open={selectedBrand != null}
        onClose={() => setSelectedBrandId('')}
        size="xl"
        title={
          selectedBrand ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{selectedBrand.name}</span>
              <Badge tone={tierTone(selectedBrand.tier)}>{tierLabel(selectedBrand.tier)}</Badge>
            </span>
          ) : ''
        }
        footer={
          selectedBrand ? (
            <>
              <button onClick={() => removeBrand(selectedBrand)} className="mr-auto rounded-btn px-2.5 py-2 text-body-sm font-medium text-ink-muted hover:bg-danger/10 hover:text-danger" title="Archive suite">
                <span className="inline-flex items-center gap-1.5"><Trash2 size={15} /> Archive</span>
              </button>
              <Button variant="secondary" leadingIcon={<Pencil size={14} />} onClick={() => openBrandEdit(selectedBrand)}>Edit suite</Button>
              <Button leadingIcon={<Plus size={14} />} onClick={() => openProfileCreate(selectedBrand.id)}>Add profile</Button>
            </>
          ) : null
        }
      >
        {selectedBrand && (
          <div className="space-y-4">
            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-2 text-body-sm">
              <span className="text-ink-muted">CRM:</span>
              <Badge tone={crmTone(selectedBrand.crmStatus)}>{crmLabel(selectedBrand.crmStatus)}</Badge>
              {crmProviderLabel(selectedBrand.crmProvider) && <span className="text-ink-muted">· {crmProviderLabel(selectedBrand.crmProvider)}</span>}
              {selectedBrand.crmAccount && <span className="text-ink-muted">· {selectedBrand.crmAccount}</span>}
              <span className="text-ink-muted">· Owner: {selectedBrand.ownerName ?? '—'}</span>
              <span className="text-ink-muted">· {selectedBrand.activeProfiles}/{selectedBrand.profileCount} active profiles</span>
              {selectedBrand.website && (
                <a href={selectedBrand.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Website <ExternalLink size={12} />
                </a>
              )}
            </div>
            {selectedBrand.crmNote && (
              <p className="rounded-btn bg-bg px-3 py-2 text-body-sm text-ink-muted">CRM note: {selectedBrand.crmNote}</p>
            )}
            <div className="overflow-hidden rounded-card border border-line">
              <DataTable
                columns={detailColumns}
                rows={brandProfiles(selectedBrand.id)}
                getRowId={(p) => p.id}
                emptyMessage="No profiles for this brand yet — use “Add profile”."
              />
            </div>

            {/* Search-term landing pages */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-body-md font-semibold text-ink">Search Term Pages</h3>
                <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => openStCreate(selectedBrand.id)}>Add term</Button>
              </div>
              {(() => {
                const live = searchTerms.filter((t) => t.status === 'LIVE').length
                const target = selectedBrand.searchTermTarget ?? 0
                const pct = target > 0 ? Math.min(100, Math.round((live / target) * 100)) : 0
                return (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-body-sm text-ink-muted">
                      <span>
                        <span className="font-semibold tabular-nums text-ink">{live}</span> live / target{' '}
                        <span className="font-semibold tabular-nums text-ink">{target || '—'}</span>
                        {target > 0 && <span className="ml-1">({pct}%)</span>}
                      </span>
                      <span>{searchTerms.length} terms tracked</span>
                    </div>
                    {target > 0 ? (
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    ) : (
                      <p className="text-body-sm text-ink-muted/70">No target set — use “Edit suite” to set a search-term page target.</p>
                    )}
                  </div>
                )
              })()}
              {searchTerms.length > 0 ? (
                <div className="overflow-hidden rounded-card border border-line">
                  <DataTable columns={stColumns} rows={searchTerms} getRowId={(t) => t.id} />
                </div>
              ) : (
                <p className="text-body-sm text-ink-muted">No search-term pages yet — add one with “Add term”.</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Search-term modal */}
      <Modal
        open={stModal != null}
        onClose={() => setStModal(null)}
        title={stModal?.mode === 'edit' ? 'Edit search-term page' : 'Add search-term page'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStModal(null)}>Cancel</Button>
            <Button onClick={saveSt} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveSt() }}>
          <div className="grid grid-cols-1 gap-4">
            <TextField label="Search term / keyword" value={stDraft.term} onChange={(e) => setStDraft({ ...stDraft, term: e.target.value })} placeholder="e.g. electronics recycling minneapolis" />
            <TextField label="Page URL" value={stDraft.url} onChange={(e) => setStDraft({ ...stDraft, url: e.target.value })} placeholder="https://recycletechnologies.com/…" />
            <div>
              <label className="mb-1 block text-body-sm font-semibold text-ink">Status</label>
              <select className={`${sel} w-full`} value={stDraft.status} onChange={(e) => setStDraft({ ...stDraft, status: e.target.value as SearchTermStatus })}>
                {SEARCH_TERM_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <TextField label="Note" value={stDraft.note} onChange={(e) => setStDraft({ ...stDraft, note: e.target.value })} placeholder="optional" />
          </div>
        </form>
      </Modal>

      {/* Business Suites manager */}
      <Modal
        open={suiteManagerOpen}
        onClose={() => { setSuiteManagerOpen(false); cancelSuiteEdit() }}
        size="lg"
        title="Meta Business Suites"
        footer={<Button variant="secondary" onClick={() => { setSuiteManagerOpen(false); cancelSuiteEdit() }}>Done</Button>}
      >
        <div className="space-y-4">
          <p className="text-body-sm text-ink-muted">
            Business Managers that hold your Facebook &amp; Instagram pages. Shared across brands — a profile connects to one via its Business Suite field.
          </p>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveSuite() }} className="rounded-card border border-line p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField label="Name" value={suiteDraft.name} onChange={(e) => setSuiteDraft({ ...suiteDraft, name: e.target.value })} placeholder="e.g. 99 Technologies" />
              <TextField label="Business Manager ID" value={suiteDraft.businessManagerId} onChange={(e) => setSuiteDraft({ ...suiteDraft, businessManagerId: e.target.value })} placeholder="optional" />
              <TextField label="URL" value={suiteDraft.url} onChange={(e) => setSuiteDraft({ ...suiteDraft, url: e.target.value })} placeholder="business.facebook.com/…" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button type="submit" disabled={saving || !suiteDraft.name.trim()} leadingIcon={editingSuiteId ? undefined : <Plus size={16} />}>
                {editingSuiteId ? 'Save changes' : 'Add suite'}
              </Button>
              {editingSuiteId && <Button type="button" variant="ghost" onClick={cancelSuiteEdit}>Cancel edit</Button>}
            </div>
          </form>
          {businessSuites.length > 0 ? (
            <div className="overflow-hidden rounded-card border border-line">
              <DataTable
                columns={[
                  { key: 'name', header: 'Suite', render: (s: BusinessSuite) => <span className="font-medium text-ink">{s.name}</span> },
                  { key: 'bm', header: 'BM ID', render: (s: BusinessSuite) => s.businessManagerId ?? '—' },
                  { key: 'url', header: 'URL', render: (s: BusinessSuite) => s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Link <ExternalLink size={13} /></a> : '—' },
                  { key: 'count', header: 'Profiles', align: 'right', render: (s: BusinessSuite) => formatNumber(s.profileCount) },
                  {
                    key: 'actions', header: '', align: 'right',
                    render: (s: BusinessSuite) => (
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => editSuite(s)} className="text-ink-muted hover:text-primary" title="Edit"><Pencil size={16} /></button>
                        <button onClick={() => removeSuite(s)} className="text-ink-muted hover:text-danger" title="Delete"><Trash2 size={16} /></button>
                      </div>
                    ),
                  },
                ]}
                rows={businessSuites}
                getRowId={(s) => s.id}
              />
            </div>
          ) : (
            <p className="text-body-sm text-ink-muted">No Business Suites yet — add one above.</p>
          )}
        </div>
      </Modal>

      {/* Brand modal */}
      <Modal
        open={brandModal != null}
        onClose={() => setBrandModal(null)}
        title={brandModal?.mode === 'edit' ? 'Edit brand suite' : 'New brand suite'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBrandModal(null)}>Cancel</Button>
            <Button onClick={saveBrand} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveBrand() }}>{brandFields(brandDraft, setBrandDraft)}</form>
      </Modal>

      {/* Profile modal */}
      <Modal
        open={profileModal != null}
        onClose={() => setProfileModal(null)}
        title={profileModal?.mode === 'edit' ? 'Edit profile' : 'Add profile'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setProfileModal(null)}>Cancel</Button>
            <Button onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveProfile() }}>{profileFields(profileDraft, setProfileDraft)}</form>
      </Modal>
    </div>
  )
}

// ---------- tier board pieces ----------
function TierColumn({ tier, count, children }: { tier: ServiceTier; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: tier })
  return (
    <div ref={setNodeRef} className={'flex flex-col rounded-card border bg-bg/60 p-2 transition-colors ' + (isOver ? 'border-primary/40 bg-primary/5' : 'border-line')}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <Badge tone={tierTone(tier)}>{tierLabel(tier)}</Badge>
        <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{count}</span>
      </div>
      <div className="flex min-h-[140px] flex-col gap-2 p-1">
        {count === 0 ? <div className="px-2 py-6 text-center text-body-sm text-ink-muted/70">Drop a brand here</div> : children}
      </div>
    </div>
  )
}

function BrandCard({ brand, profiles, onOpen }: { brand: Brand; profiles: BrandProfile[]; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: brand.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined
  const byPlat = new Map(profiles.map((p) => [p.platform, p]))
  return (
    <div ref={setNodeRef} style={style} className={'rounded-btn border border-line bg-card p-3 shadow-card ' + (isDragging ? 'opacity-60 shadow-overlay' : '')}>
      <div className="flex items-start gap-2">
        <button {...listeners} {...attributes} className="mt-0.5 cursor-grab touch-none text-ink-muted/50 hover:text-ink-muted active:cursor-grabbing" title="Drag to another tier">
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={() => onOpen(brand.id)} className="block max-w-full truncate text-left font-medium text-ink hover:text-primary">{brand.name}</button>
          <div className="mt-1 flex items-center gap-2 text-body-sm text-ink-muted">
            <span className="tabular-nums">{brand.activeProfiles}/{brand.profileCount} active</span>
            {brand.crmConnected && <Badge tone="success" className="px-1.5 py-0 text-[10px]">CRM</Badge>}
          </div>
          {brand.searchTermTarget != null && brand.searchTermTarget > 0 && (
            <div className="mt-0.5 text-[11px] text-ink-muted">SEO pages {brand.searchTermsLive}/{brand.searchTermTarget}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {MATRIX_COLS.map((c) => {
              const p = byPlat.get(c.platform)
              const cls = !p ? 'bg-slate-200' : p.status === 'ACTIVE' ? 'bg-success' : p.status === 'PAUSED' ? 'bg-warning' : 'bg-slate-300'
              const ring = p?.managedVia === 'MIXPOST' ? 'ring-1 ring-accent ring-offset-1' : ''
              return <span key={c.platform} title={`${c.label}${p ? `: ${statusLabel(p.status)}` : ': none'}`} className={`inline-block h-2 w-2 rounded-full ${cls} ${ring}`} />
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
