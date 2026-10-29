import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, closestCenter,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, GripVertical, LayoutDashboard, Lock, Menu as MenuIcon, Pencil, Plus, RotateCcw, Search, ShieldCheck, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { BLOCKS, BLOCK_GROUPS, CUSTOM_BLOCK, blockByKey, blockRefusal, type Block, type BlockGroup } from '../../../lib/blocks'
import { CARDS, CUSTOM_CARD, cardByKey, cardRefusal, type CardDef, type CardSize, type DashCard } from '../../../lib/cards'
import { companyApi, type CompanyDepartment, type DepartmentDashboard, type DepartmentLayout } from '../../../lib/companyApi'
import { customApi, iconOf, type CustomBlock } from '../../../lib/customApi'
import { CUSTOM_GROUP, navGroupOf, navItemOfBlock, templateBlocks } from '../../../components/layout/navConfig'
import { DashboardCard, SPAN } from '../../../components/dashboard/DashboardCards'
import { startPreview } from '../../../lib/preview'
import { apiErrorText } from '../../../lib/api'
import type { Department } from '../../../lib/types'

/**
 * Department Studio (Phase 2): the Super Admin shapes a department for its members and for its
 * team leads. Menu: drag blocks in, reorder, take out (part A). Dashboard: drag cards in, size
 * and order them (part B). Blocks of the company's own (part C) go in both. Preview it in the
 * app as that member or team lead. Rules: lib/blocks.ts, lib/cards.ts.
 */

type Role = 'member' | 'lead'
const ROLE_LABEL: Record<Role, string> = { member: 'Member', lead: 'Team Lead' }
type Area = 'menu' | 'dashboard'
type Custom = Pick<CustomBlock, 'id' | 'name' | 'icon' | 'color' | 'description'>

const TEAM_KINDS: Department[] = ['ITAD', 'LEAD_GEN', 'MARKETING', 'ECOMMERCE', 'INVENTORY', 'CSR']
/** The dashboard a kind comes with, as cards (what its people see today). */
export function templateCards(kind: Department, role: Role): DashCard[] {
  if (role === 'member') return [{ key: 'greeting', size: 3 }, { key: 'quick-actions', size: 3 }, { key: 'my-tasks', size: 2 }, { key: 'checklist', size: 1 }, { key: 'employee-of-month', size: 3 }, { key: 'feedback', size: 2 }]
  if (TEAM_KINDS.includes(kind)) return [{ key: 'employee-of-month', size: 3 }, { key: 'team-kpis', size: 3 }, { key: 'team-trend', size: 2 }, { key: 'team-breakdown', size: 1 }, { key: 'team-improvement', size: 3 }, { key: 'team-submissions', size: 3 }]
  return [{ key: 'greeting', size: 3 }, { key: 'team-today', size: 2 }, { key: 'todo-today', size: 1 }, { key: 'team-todo', size: 3 }, { key: 'my-tasks', size: 2 }, { key: 'checklist', size: 1 }]
}

const groupOf = (k: string): BlockGroup | 'custom' => (CUSTOM_BLOCK.test(k) ? 'custom' : blockByKey(k)?.group ?? 'main')

export default function DepartmentStudio() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { user, refresh } = useAuth()
  const [dept, setDept] = useState<CompanyDepartment | null>(null)
  const [layout, setLayout] = useState<DepartmentLayout | null>(null)
  const [dash, setDash] = useState<DepartmentDashboard | null>(null)
  const [saved, setSaved] = useState('')
  const [custom, setCustom] = useState<Custom[]>([])
  const [role, setRole] = useState<Role>('member')
  const [area, setArea] = useState<Area>(() => (new URLSearchParams(window.location.search).get('area') === 'dashboard' ? 'dashboard' : 'menu'))
  const [picked, setPicked] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const snapshot = (l: DepartmentLayout | null, d: DepartmentDashboard | null) => JSON.stringify({ l, d })
  function take(d: CompanyDepartment) {
    const l = d.layout ?? { member: templateBlocks(d.type, 'MEMBER'), lead: templateBlocks(d.type, 'TEAM_LEAD') }
    const db = d.dashboard ?? { member: templateCards(d.type, 'member'), lead: templateCards(d.type, 'lead') }
    setDept(d); setLayout(l); setDash(db); setSaved(snapshot(l, db))
  }
  useEffect(() => {
    companyApi.departments().then((r) => {
      const d = r.departments.find((x) => x.id === id)
      if (!d) { addToast({ type: 'error', message: 'Department not found.' }); navigate('/app/admin/company'); return }
      take(d)
    }).catch(() => addToast({ type: 'error', message: 'Could not load the department.' }))
    customApi.list().then((r) => setCustom(r.blocks)).catch(() => setCustom([]))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!layout && snapshot(layout, dash) !== saved
  useEffect(() => {
    if (!dirty) return
    const on = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [dirty])

  // ---------------------------------------------------------------- menu
  const list = useMemo(() => layout?.[role] ?? [], [layout, role])
  const blockRef = (b: Block, r: Role = role) => (dept ? blockRefusal(b, dept.type, r) : null)
  function addBlock(key: string, r: Role = role) {
    if (!layout) return
    if (!CUSTOM_BLOCK.test(key)) {
      const b = blockByKey(key)
      if (!b) return
      const why = blockRef(b, r)
      if (why) { addToast({ type: 'info', message: why }); return }
    }
    setLayout((cur) => {
      if (!cur || cur[r].includes(key)) return cur
      const l = [...cur[r]]
      let at = -1
      l.forEach((k, i) => { if (groupOf(k) === groupOf(key)) at = i })
      if (at < 0) l.push(key); else l.splice(at + 1, 0, key)
      return { ...cur, [r]: l }
    })
  }
  function removeBlock(key: string, r: Role = role) {
    if (blockByKey(key)?.fixed) return
    setLayout((cur) => (cur ? { ...cur, [r]: cur[r].filter((k) => k !== key) } : cur))
  }
  const groups = useMemo(() => {
    const out: { group: BlockGroup | 'custom'; keys: string[] }[] = []
    for (const k of list) {
      if (!CUSTOM_BLOCK.test(k) && !blockByKey(k)) continue
      if (CUSTOM_BLOCK.test(k) && !custom.some((c) => c.id === k.slice(7))) continue
      const g0 = groupOf(k)
      let g = out.find((x) => x.group === g0)
      if (!g) { g = { group: g0, keys: [] }; out.push(g) }
      g.keys.push(k)
    }
    return out
  }, [list, custom])
  const setList = (keys: string[]) => setLayout((cur) => (cur ? { ...cur, [role]: keys } : cur))
  function moveGroup(i: number, by: number) {
    const j = i + by
    if (j < 0 || j >= groups.length) return
    setList(arrayMove(groups, i, j).flatMap((g) => g.keys))
  }

  // ---------------------------------------------------------------- dashboard
  const cards = useMemo(() => dash?.[role] ?? [], [dash, role])
  const cardRef = (c: CardDef, r: Role = role) => (dept ? cardRefusal(c, dept.type, r) : null)
  function addCard(key: string, r: Role = role) {
    if (!dash) return
    let size: CardSize = 2
    if (!CUSTOM_CARD.test(key)) {
      const c = cardByKey(key)
      if (!c) return
      const why = cardRef(c, r)
      if (why) { addToast({ type: 'info', message: why }); return }
      size = c.size
    }
    setDash((cur) => (!cur || cur[r].some((x) => x.key === key) ? cur : { ...cur, [r]: [...cur[r], { key, size }] }))
  }
  const removeCard = (key: string) => setDash((cur) => (cur ? { ...cur, [role]: cur[role].filter((c) => c.key !== key) } : cur))
  const sizeCard = (key: string, size: CardSize) => setDash((cur) => (cur ? { ...cur, [role]: cur[role].map((c) => (c.key === key ? { ...c, size } : c)) } : cur))

  // ---------------------------------------------------------------- drag and drop
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function onStart(e: DragStartEvent) { setDragging(String(e.active.id)) }
  function onEnd(e: DragEndEvent) {
    setDragging(null)
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    if (a.startsWith('lib:')) { if (over === 'menu' || over.startsWith('item:')) addBlock(a.slice(4)); return }
    if (a.startsWith('libcard:')) { if (over === 'canvas' || over.startsWith('card:')) addCard(a.slice(8)); return }
    if (a.startsWith('item:') && over.startsWith('item:') && a !== over) {
      const ka = a.slice(5), ko = over.slice(5)
      const g = groups.find((x) => x.keys.includes(ka))
      if (!g || !g.keys.includes(ko)) return
      const keys = arrayMove(g.keys, g.keys.indexOf(ka), g.keys.indexOf(ko))
      setList(groups.map((x) => (x === g ? { ...x, keys } : x)).flatMap((x) => x.keys))
    }
    if (a.startsWith('card:') && over.startsWith('card:') && a !== over) {
      const ka = a.slice(5), ko = over.slice(5)
      setDash((cur) => {
        if (!cur) return cur
        const l = cur[role]
        return { ...cur, [role]: arrayMove(l, l.findIndex((c) => c.key === ka), l.findIndex((c) => c.key === ko)) }
      })
    }
  }

  // ---------------------------------------------------------------- save, reset, preview
  async function save() {
    if (!layout || !dash || !dept) return
    setBusy(true)
    try {
      await companyApi.setLayout(dept.id, layout)
      const r = await companyApi.setDashboard(dept.id, dash)
      const d = r.departments.find((x) => x.id === dept.id)
      if (d) take(d)
      addToast({ type: 'success', message: `Saved. ${dept.name} gets this the next time their page loads.` })
      void refresh?.()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  async function reset() {
    if (!dept || !window.confirm(`Go back to the menus and dashboards that come with a ${dept.kind} department? Your changes here are dropped.`)) return
    setBusy(true)
    try {
      await companyApi.setLayout(dept.id, { reset: true })
      const r = await companyApi.setDashboard(dept.id, { reset: true })
      const d = r.departments.find((x) => x.id === dept.id)
      if (d) take(d)
      addToast({ type: 'success', message: 'Back to what its kind comes with.' })
      void refresh?.()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not reset.') }) } finally { setBusy(false) }
  }
  function preview() {
    if (!dept || !layout || !dash) return
    startPreview({ departmentId: dept.id, departmentName: dept.name, kind: dept.type, role: role === 'lead' ? 'TEAM_LEAD' : 'MEMBER', blocks: layout[role], dashboard: dash[role] })
    navigate('/app/dashboard')
  }

  if (!dept || !layout || !dash) return <div className="mx-auto w-full max-w-[1800px] py-16 text-center text-body-md text-ink-muted">Loading…</div>

  const ql = q.trim().toLowerCase()
  const match = (s: string) => !ql || s.toLowerCase().includes(ql)
  const own = !!(dept.layout || dept.dashboard)

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/admin/company" className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={15} /> Departments</Link>
        <div className="min-w-0">
          <h1 className="text-headline-md text-ink">{dept.name} <span className="ml-1 align-middle text-body-sm font-semibold text-ink-muted">· Studio</span></h1>
          <p className="text-body-sm text-ink-muted">{dept.kind} · {dept.people === 1 ? '1 person' : `${dept.people} people`} · {own ? 'its own menus and dashboards' : `what a ${dept.kind} department comes with`}{dirty ? ' · unsaved changes' : ''}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist" aria-label="View as">
            {(['member', 'lead'] as Role[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={role === m} onClick={() => setRole(m)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', role === m ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>View as {ROLE_LABEL[m]}</button>
            ))}
          </div>
          <Button variant="secondary" size="sm" leadingIcon={<Eye size={15} />} onClick={preview}>Preview in the app</Button>
          {own && <Button variant="ghost" size="sm" leadingIcon={<RotateCcw size={15} />} disabled={busy} onClick={reset}>Reset</Button>}
          <Button size="sm" disabled={busy || !dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line" role="tablist" aria-label="What to shape">
        {([['menu', 'Menu', MenuIcon], ['dashboard', 'Dashboard', LayoutDashboard]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={area === k} onClick={() => setArea(k)} className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-body-md font-semibold', area === k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>
            <Icon size={16} /> {label}
          </button>
        ))}
        <span className="ml-auto pb-1 text-body-sm text-ink-muted">Editing the {ROLE_LABEL[role]} {area}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
        {area === 'menu' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px_300px]">
            <Library title="Blocks" hint={`Drag one into the ${ROLE_LABEL[role]} menu, or press +.`} q={q} setQ={setQ}>
              {BLOCK_GROUPS.map((g) => ({ ...g, blocks: BLOCKS.filter((b) => b.group === g.key && match(`${b.label} ${b.description}`)) })).filter((g) => g.blocks.length).map((g) => (
                <LibGroup key={g.key} label={g.label}>
                  {g.blocks.map((b) => {
                    const Icon = navItemOfBlock(b.key)?.icon
                    return <LibItem key={b.key} id={`lib:${b.key}`} icon={Icon ? <Icon size={15} /> : null} label={b.label} text={blockRef(b) ?? b.description} locked={!!blockRef(b)} inside={list.includes(b.key)} picked={picked === b.key} onPick={() => setPicked(b.key)} onAdd={() => addBlock(b.key)} />
                  })}
                </LibGroup>
              ))}
              <CustomGroup custom={custom.filter((c) => match(c.name))} inside={(k) => list.includes(k)} onAdd={addBlock} deptId={dept.id} />
            </Library>
            <MenuPreview role={role} groups={groups} custom={custom} picked={picked} onPick={setPicked} onRemove={(k) => removeBlock(k)} onMoveGroup={moveGroup} dragging={dragging} />
            <aside className="space-y-4">
              <div className="rounded-card border border-line bg-card p-4 shadow-sm">
                {picked && blockByKey(picked) ? (
                  <BlockDetails b={blockByKey(picked)!} layout={layout} why={(r) => blockRef(blockByKey(picked)!, r)} onToggle={(r, on) => (on ? addBlock(picked, r) : removeBlock(picked, r))} />
                ) : <HowItWorks area="menu" />}
              </div>
            </aside>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Library title="Cards" hint={`Drag one onto the ${ROLE_LABEL[role]} dashboard, or press +.`} q={q} setQ={setQ}>
              {CARDS.some((c) => !c.leadOnly && match(`${c.label} ${c.description}`)) && <LibGroup label="For everyone" one>
                {CARDS.filter((c) => !c.leadOnly && match(`${c.label} ${c.description}`)).map((c) => <LibItem key={c.key} id={`libcard:${c.key}`} label={c.label} text={cardRef(c) ?? c.description} locked={!!cardRef(c)} inside={cards.some((x) => x.key === c.key)} onAdd={() => addCard(c.key)} one />)}
              </LibGroup>}
              {CARDS.some((c) => c.leadOnly && match(`${c.label} ${c.description}`)) && <LibGroup label="For team leads" one>
                {CARDS.filter((c) => c.leadOnly && match(`${c.label} ${c.description}`)).map((c) => <LibItem key={c.key} id={`libcard:${c.key}`} label={c.label} text={cardRef(c) ?? c.description} locked={!!cardRef(c)} inside={cards.some((x) => x.key === c.key)} onAdd={() => addCard(c.key)} one />)}
              </LibGroup>}
              {custom.some((c) => match(c.name)) && (
                <LibGroup label="Your own blocks" one>
                  {custom.filter((c) => match(c.name)).map((c) => {
                    const Icon = iconOf(c.icon)
                    return <LibItem key={c.id} id={`libcard:custom:${c.id}`} icon={<Icon size={15} />} label={c.name} text="How many, by status, and the latest added." inside={cards.some((x) => x.key === `custom:${c.id}`)} onAdd={() => addCard(`custom:${c.id}`)} one />
                  })}
                </LibGroup>
              )}
            </Library>
            <Canvas role={role} cards={cards} user={user} onRemove={removeCard} onSize={sizeCard} dragging={dragging} />
          </div>
        )}
        <DragOverlay>{dragging ? <DragChip id={dragging} custom={custom} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

// ------------------------------------------------------------------ pieces

function HowItWorks({ area }: { area: Area }) {
  return (
    <div className="text-body-sm text-ink-muted">
      <p className="text-body-md font-semibold text-ink">How it works</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        <li>Members and team leads each have their own {area}: switch with <b>View as</b>.</li>
        {area === 'menu' ? <>
          <li>Drag blocks in, drag them up and down, press × to take one out. Headings move with their arrows.</li>
          <li>Taking a block out hides it and stops new entries in it. Nothing is deleted: put it back and everything is there.</li>
          <li>Make blocks of your own (a form, a table, a board, a calendar) with <b>New block</b>.</li>
        </> : <>
          <li>Drag cards in and around; pick a width for each (a third, two thirds, the whole row).</li>
          <li>Each person can still move or hide cards on their own dashboard.</li>
        </>}
        <li><b>Preview in the app</b> walks you through Metriq as that person.</li>
        <li>Admin and Quality Assurance screens follow each person's role, as before.</li>
      </ul>
    </div>
  )
}

function Library({ title, hint, q, setQ, children }: { title: string; hint: string; q: string; setQ: (v: string) => void; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-card shadow-sm" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div><h2 className="text-body-lg font-semibold text-ink">{title}</h2><p className="text-body-sm text-ink-muted">{hint}</p></div>
        <div className="relative ml-auto w-full sm:w-52">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" aria-label={`Find ${title.toLowerCase()}`} className="h-8 w-full rounded-btn border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div className="max-h-[calc(100vh-300px)] space-y-4 overflow-y-auto p-4">{children}</div>
    </section>
  )
}
function LibGroup({ label, one, children }: { label: string; one?: boolean; children: React.ReactNode }) {
  return <div><p className="mb-1.5 text-label-md uppercase text-ink-muted">{label}</p><div className={cn('grid gap-2', !one && 'sm:grid-cols-2')}>{children}</div></div>
}

function LibItem({ id, icon, label, text, locked, inside, picked, onPick, onAdd }: { id: string; icon?: React.ReactNode; label: string; text: string; locked?: boolean; inside: boolean; picked?: boolean; onPick?: () => void; onAdd: () => void; one?: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, disabled: !!locked || inside })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onPick} data-block={id.replace(/^lib(card)?:/, '')}
      className={cn('group flex items-start gap-2.5 rounded-btn border p-2.5 text-left transition-colors', locked ? 'cursor-default border-dashed border-line bg-slate-50/60 opacity-70' : inside ? 'border-success/40 bg-success/5' : 'cursor-grab border-line bg-card hover:border-primary/40', picked && 'ring-2 ring-primary/30', isDragging && 'opacity-40')}>
      {icon && <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', locked ? 'bg-slate-100 text-ink-faint' : 'bg-primary/10 text-primary')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-semibold text-ink">{label}</span>
        <span className="block text-[12px] leading-snug text-ink-muted">{text}</span>
      </span>
      {inside ? <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 text-[11px] font-semibold text-success"><Check size={11} />In</span>
        : locked ? <Lock size={13} className="mt-1 shrink-0 text-ink-faint" />
          : <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onAdd() }} className="rounded-md p-1 text-primary hover:bg-primary/10" aria-label={`Add ${label}`}><Plus size={15} /></button>}
    </div>
  )
}

function CustomGroup({ custom, inside, onAdd, deptId }: { custom: Custom[]; inside: (k: string) => boolean; onAdd: (k: string) => void; deptId: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-label-md uppercase text-ink-muted">Your own blocks</p>
        <Link to={`/app/admin/company/blocks/new?back=${deptId}`} className="inline-flex items-center gap-1 rounded-btn bg-primary px-2.5 py-1 text-body-sm font-semibold text-white hover:bg-primary-700"><Plus size={14} /> New block</Link>
      </div>
      {custom.length === 0 ? (
        <p className="rounded-btn border border-dashed border-line px-3 py-4 text-center text-body-sm text-ink-muted">Make a screen of your own: a form, a table, a board or a calendar with the fields you choose.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {custom.map((c) => {
            const Icon = iconOf(c.icon)
            const k = `custom:${c.id}`
            return (
              <div key={c.id} className="relative">
                <LibItem id={`lib:${k}`} icon={<Icon size={15} />} label={c.name} text={c.description || 'A block of your own.'} inside={inside(k)} onAdd={() => onAdd(k)} />
                <Link to={`/app/admin/company/blocks/${c.id}?back=${deptId}`} className="absolute bottom-1.5 right-1.5 rounded p-1 text-ink-faint hover:bg-slate-100 hover:text-ink" aria-label={`Change ${c.name}`} title="Change its fields"><Pencil size={13} /></Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DragChip({ id, custom }: { id: string; custom: Custom[] }) {
  const key = id.replace(/^(libcard|lib|item|card):/, '')
  const c = CUSTOM_BLOCK.test(key) ? custom.find((x) => x.id === key.slice(7)) : null
  const label = c?.name ?? blockByKey(key)?.label ?? cardByKey(key)?.label ?? 'Block'
  return <div className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-card px-3 py-2 text-body-sm font-medium text-ink shadow-lg"><GripVertical size={14} className="text-ink-faint" />{label}</div>
}

function MenuPreview({ role, groups, custom, picked, onPick, onRemove, onMoveGroup, dragging }: {
  role: Role; groups: { group: BlockGroup | 'custom'; keys: string[] }[]; custom: Custom[]; picked: string | null; onPick: (k: string) => void; onRemove: (k: string) => void; onMoveGroup: (i: number, by: number) => void; dragging: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'menu' })
  const adding = !!dragging?.startsWith('lib:')
  return (
    <section ref={setNodeRef} aria-label={`${ROLE_LABEL[role]} menu`} className={cn('order-first rounded-card border bg-slate-50/80 shadow-sm transition-colors dark:bg-slate-900/40 lg:order-none', adding ? (isOver ? 'border-primary bg-primary/5' : 'border-dashed border-primary/50') : 'border-line')}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-body-lg font-semibold text-ink">{ROLE_LABEL[role]} menu</h2>
        <p className="text-body-sm text-ink-muted">What a {role === 'lead' ? 'team lead' : 'member'} sees on the left.</p>
      </div>
      <div className="max-h-[calc(100vh-300px)] space-y-3 overflow-y-auto p-3">
        {groups.map((g, gi) => {
          const meta = g.group === 'custom' ? CUSTOM_GROUP : navGroupOf(g.group)
          const GIcon = meta.icon
          return (
            <div key={g.group}>
              {meta.title && (
                <div className="group/h mb-1 flex items-center gap-2 px-1">
                  {GIcon && <span className="flex h-5 w-5 items-center justify-center rounded" style={{ background: `${meta.color}1f`, color: meta.color }}><GIcon size={12} /></span>}
                  <span className="text-[12.5px] font-semibold text-ink">{meta.title}</span>
                  <span className="ml-auto flex opacity-60 group-hover/h:opacity-100">
                    <button type="button" disabled={gi === 0} onClick={() => onMoveGroup(gi, -1)} className="rounded p-0.5 text-ink-muted hover:bg-slate-200 disabled:opacity-30" aria-label={`Move ${meta.title} up`}><ArrowUp size={13} /></button>
                    <button type="button" disabled={gi === groups.length - 1} onClick={() => onMoveGroup(gi, 1)} className="rounded p-0.5 text-ink-muted hover:bg-slate-200 disabled:opacity-30" aria-label={`Move ${meta.title} down`}><ArrowDown size={13} /></button>
                  </span>
                </div>
              )}
              <SortableContext items={g.keys.map((k) => `item:${k}`)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-0.5">{g.keys.map((k) => <MenuItem key={k} k={k} custom={custom} picked={picked === k} onPick={() => onPick(k)} onRemove={() => onRemove(k)} />)}</ul>
              </SortableContext>
            </div>
          )
        })}
        {adding && <p className="rounded-btn border border-dashed border-primary/50 px-3 py-3 text-center text-body-sm font-semibold text-primary">Drop here to add it</p>}
        <div className="border-t border-line pt-2"><p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-muted"><ShieldCheck size={13} /> Admin and Quality Assurance screens follow each person's role.</p></div>
      </div>
    </section>
  )
}

function MenuItem({ k, custom, picked, onPick, onRemove }: { k: string; custom: Custom[]; picked: boolean; onPick: () => void; onRemove: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `item:${k}` })
  const item = navItemOfBlock(k, custom)
  if (!item) return null
  const fixed = !!blockByKey(k)?.fixed
  const Icon = item.icon
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-menu-item={k}
      className={cn('group flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1.5 shadow-xs ring-1 ring-line', picked && 'ring-2 ring-primary/50', isDragging && 'z-10 opacity-60')}>
      <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-0.5 text-ink-faint hover:text-ink active:cursor-grabbing" aria-label={`Move ${item.label}`}><GripVertical size={14} /></button>
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 text-left"><Icon size={15} className="shrink-0 text-ink-muted" /><span className="truncate text-[13px] font-medium text-ink">{item.label}</span></button>
      {fixed ? <Lock size={12} className="mr-1 text-ink-faint" aria-label="Always there" /> : (
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-ink-faint opacity-60 hover:bg-danger/10 hover:text-danger group-hover:opacity-100" aria-label={`Take ${item.label} out`}><X size={14} /></button>
      )}
    </li>
  )
}

function BlockDetails({ b, layout, why, onToggle }: { b: Block; layout: DepartmentLayout; why: (r: Role) => string | null; onToggle: (r: Role, on: boolean) => void }) {
  const item = navItemOfBlock(b.key)
  const Icon = item?.icon
  return (
    <div>
      <div className="flex items-center gap-2">
        {Icon && <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon size={16} /></span>}
        <div className="min-w-0"><p className="text-body-md font-semibold text-ink">{b.label}</p>{item && item.label !== b.label && <p className="text-[12px] text-ink-muted">Shows in the menu as “{item.label}”</p>}</div>
      </div>
      <p className="mt-2 text-body-sm text-ink-muted">{b.description}</p>
      <p className="mt-3 text-label-md uppercase text-ink-muted">In the menu of</p>
      <div className="mt-1.5 space-y-1.5">
        {(['member', 'lead'] as Role[]).map((r) => {
          const no = why(r)
          const on = layout[r].includes(b.key)
          return (
            <label key={r} className={cn('flex items-center gap-2 rounded-btn border border-line px-2.5 py-2 text-body-sm', no ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50')} title={no ?? undefined}>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} disabled={!!no || (b.fixed && on)} onChange={(e) => onToggle(r, e.target.checked)} />
              <span className="font-semibold text-ink">{ROLE_LABEL[r]}s</span>
              {no && <span className="ml-auto text-[11px] text-ink-muted">{no}</span>}
              {b.fixed && <span className="ml-auto text-[11px] text-ink-muted">Always there</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function Canvas({ role, cards, user, onRemove, onSize, dragging }: { role: Role; cards: DashCard[]; user: ReturnType<typeof useAuth>['user']; onRemove: (k: string) => void; onSize: (k: string, s: CardSize) => void; dragging: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' })
  const adding = !!dragging?.startsWith('libcard:')
  if (!user) return null
  return (
    <section ref={setNodeRef} aria-label={`${ROLE_LABEL[role]} dashboard`} className={cn('min-w-0 rounded-card border bg-slate-50/80 p-4 shadow-sm dark:bg-slate-900/40', adding ? (isOver ? 'border-primary bg-primary/5' : 'border-dashed border-primary/50') : 'border-line')}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-lg font-semibold text-ink">{ROLE_LABEL[role]} dashboard</h2>
        <p className="text-body-sm text-ink-muted">Cards show your own data here; each person sees theirs.</p>
      </div>
      <SortableContext items={cards.map((c) => `card:${c.key}`)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {cards.map((c) => <CanvasCard key={c.key} card={c} user={user} onRemove={() => onRemove(c.key)} onSize={(s) => onSize(c.key, s)} />)}
        </div>
      </SortableContext>
      {cards.length === 0 && <p className="py-12 text-center text-body-md text-ink-muted">No cards yet. Drag some in from the left.</p>}
      {adding && <p className="mt-4 rounded-btn border border-dashed border-primary/50 px-3 py-4 text-center text-body-sm font-semibold text-primary">Drop here to add it</p>}
    </section>
  )
}

function CanvasCard({ card, user, onRemove, onSize }: { card: DashCard; user: NonNullable<ReturnType<typeof useAuth>['user']>; onRemove: () => void; onSize: (s: CardSize) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `card:${card.key}` })
  const label = cardByKey(card.key)?.label ?? (user.customBlocks?.find((c) => `custom:${c.id}` === card.key)?.name ?? 'Your block')
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-canvas-card={card.key} className={cn('relative min-w-0 overflow-hidden rounded-card border border-line bg-card', SPAN[card.size], isDragging && 'z-20 opacity-80 shadow-overlay')}>
      <div className="flex items-center gap-1.5 border-b border-line bg-slate-50 px-2 py-1.5 dark:bg-slate-800/50">
        <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-0.5 text-ink-faint hover:text-ink active:cursor-grabbing" aria-label={`Move ${label}`}><GripVertical size={14} /></button>
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">{label}</span>
        <span className="inline-flex rounded border border-line bg-card p-px" role="group" aria-label="Width">
          {([1, 2, 3] as CardSize[]).map((s) => (
            <button key={s} type="button" onClick={() => onSize(s)} className={cn('h-6 rounded-sm px-1.5 text-[11px] font-semibold', card.size === s ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')} aria-pressed={card.size === s} title={s === 1 ? 'A third' : s === 2 ? 'Two thirds' : 'The whole row'}>{s === 1 ? '⅓' : s === 2 ? '⅔' : 'Full'}</button>
          ))}
        </span>
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-ink-faint hover:bg-danger/10 hover:text-danger" aria-label={`Take ${label} off`}><X size={14} /></button>
      </div>
      <div className="pointer-events-none relative max-h-[280px] select-none overflow-hidden p-2" aria-hidden>
        <DashboardCard card={card} user={user} />
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
      </div>
    </div>
  )
}
