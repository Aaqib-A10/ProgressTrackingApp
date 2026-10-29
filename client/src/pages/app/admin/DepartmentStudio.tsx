import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, closestCenter,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, GripVertical, Lock, Plus, RotateCcw, Search, ShieldCheck, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { BLOCKS, BLOCK_GROUPS, blockByKey, blockRefusal, type Block, type BlockGroup } from '../../../lib/blocks'
import { companyApi, type CompanyDepartment, type DepartmentLayout } from '../../../lib/companyApi'
import { navGroupOf, navItemOfBlock, templateBlocks } from '../../../components/layout/navConfig'
import { startPreview } from '../../../lib/preview'
import { apiErrorText } from '../../../lib/api'

/**
 * Department Studio (Phase 2, part A): the Super Admin shapes a department's menu for its members
 * and for its team leads. Drag blocks from the library into the menu, drag them to reorder, take
 * them out; preview it in the app as that member or team lead. Rules: lib/blocks.ts.
 */

type Menu = 'member' | 'lead'
const MENU_LABEL: Record<Menu, string> = { member: 'Member', lead: 'Team Lead' }

export default function DepartmentStudio() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const [dept, setDept] = useState<CompanyDepartment | null>(null)
  const [layout, setLayout] = useState<DepartmentLayout | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [menu, setMenu] = useState<Menu>('member')
  const [picked, setPicked] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  function take(d: CompanyDepartment) {
    const l = d.layout ?? { member: templateBlocks(d.type, 'MEMBER'), lead: templateBlocks(d.type, 'TEAM_LEAD') }
    setDept(d); setLayout(l); setSaved(JSON.stringify(l))
  }
  useEffect(() => {
    companyApi.departments().then((r) => {
      const d = r.departments.find((x) => x.id === id)
      if (!d) { addToast({ type: 'error', message: 'Department not found.' }); navigate('/app/admin/company'); return }
      take(d)
    }).catch(() => addToast({ type: 'error', message: 'Could not load the department.' }))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => layout?.[menu] ?? [], [layout, menu])
  const dirty = !!layout && JSON.stringify(layout) !== saved
  // Leave the page with unsaved changes: ask first.
  useEffect(() => {
    if (!dirty) return
    const on = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [dirty])

  const setList = (fn: (l: string[]) => string[]) => setLayout((cur) => (cur ? { ...cur, [menu]: fn(cur[menu]) } : cur))
  const refusal = (b: Block, m: Menu = menu) => (dept ? blockRefusal(b, dept.type, m) : null)

  /** Add a block: at the end of its group, or as a new group at the end. */
  function add(key: string, m: Menu = menu) {
    const b = blockByKey(key)
    if (!b || !layout) return
    const why = refusal(b, m)
    if (why) { addToast({ type: 'info', message: why }); return }
    setLayout((cur) => {
      if (!cur || cur[m].includes(key)) return cur
      const l = [...cur[m]]
      let at = -1
      l.forEach((k, i) => { if (blockByKey(k)?.group === b.group) at = i })
      if (at < 0) l.push(key); else l.splice(at + 1, 0, key)
      return { ...cur, [m]: l }
    })
  }
  function remove(key: string, m: Menu = menu) {
    if (blockByKey(key)?.fixed) return
    setLayout((cur) => (cur ? { ...cur, [m]: cur[m].filter((k) => k !== key) } : cur))
  }

  // The menu as groups, in the order they first appear.
  const groups = useMemo(() => {
    const out: { group: BlockGroup; keys: string[] }[] = []
    for (const k of list) {
      const b = blockByKey(k)
      if (!b) continue
      let g = out.find((x) => x.group === b.group)
      if (!g) { g = { group: b.group, keys: [] }; out.push(g) }
      g.keys.push(k)
    }
    return out
  }, [list])
  /** Rebuild the flat list from groups (group order, then item order). */
  const fromGroups = (gs: { group: BlockGroup; keys: string[] }[]) => gs.flatMap((g) => g.keys)
  function moveGroup(i: number, by: number) {
    const j = i + by
    if (j < 0 || j >= groups.length) return
    setList(() => fromGroups(arrayMove(groups, i, j)))
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function onStart(e: DragStartEvent) { setDragging(String(e.active.id)) }
  function onEnd(e: DragEndEvent) {
    setDragging(null)
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    if (a.startsWith('lib:')) { if (over === 'menu' || over.startsWith('item:')) add(a.slice(4)); return }
    if (a.startsWith('item:') && over.startsWith('item:') && a !== over) {
      const ka = a.slice(5), ko = over.slice(5)
      const g = groups.find((x) => x.keys.includes(ka))
      // Items move within their own heading; headings move with the arrows.
      if (!g || !g.keys.includes(ko)) return
      const keys = arrayMove(g.keys, g.keys.indexOf(ka), g.keys.indexOf(ko))
      setList(() => fromGroups(groups.map((x) => (x === g ? { ...x, keys } : x))))
    }
  }

  async function save() {
    if (!layout || !dept) return
    setBusy(true)
    try {
      const r = await companyApi.setLayout(dept.id, layout)
      const d = r.departments.find((x) => x.id === dept.id)
      if (d) take(d)
      addToast({ type: 'success', message: `Saved. ${dept.name} gets these menus the next time their page loads.` })
      void refresh?.()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  async function reset() {
    if (!dept || !window.confirm(`Go back to the menus that come with a ${dept.kind} department? Your changes here are dropped.`)) return
    setBusy(true)
    try {
      const r = await companyApi.setLayout(dept.id, { reset: true })
      const d = r.departments.find((x) => x.id === dept.id)
      if (d) take(d)
      addToast({ type: 'success', message: 'Back to the menus of its kind.' })
      void refresh?.()
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not reset.') }) } finally { setBusy(false) }
  }
  function preview() {
    if (!dept || !layout) return
    startPreview({ departmentId: dept.id, departmentName: dept.name, kind: dept.type, role: menu === 'lead' ? 'TEAM_LEAD' : 'MEMBER', blocks: layout[menu] })
    navigate('/app/dashboard')
  }

  if (!dept || !layout) return <div className="mx-auto w-full max-w-[1800px] py-16 text-center text-body-md text-ink-muted">Loading…</div>

  const ql = q.trim().toLowerCase()
  const libGroups = BLOCK_GROUPS.map((g) => ({ ...g, blocks: BLOCKS.filter((b) => b.group === g.key && (!ql || `${b.label} ${b.description}`.toLowerCase().includes(ql))) })).filter((g) => g.blocks.length)
  const pickedBlock = picked ? blockByKey(picked) : null

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/admin/company" className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={15} /> Departments</Link>
        <div className="min-w-0">
          <h1 className="text-headline-md text-ink">{dept.name} <span className="ml-1 align-middle text-body-sm font-semibold text-ink-muted">· Studio</span></h1>
          <p className="text-body-sm text-ink-muted">{dept.kind} · {dept.people === 1 ? '1 person' : `${dept.people} people`} · {dept.layout ? 'own menus' : `the menus of a ${dept.kind} department`}{dirty ? ' · unsaved changes' : ''}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-btn border border-line bg-card p-0.5" role="tablist" aria-label="View as">
            {(['member', 'lead'] as Menu[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={menu === m} onClick={() => setMenu(m)} className={cn('h-8 rounded-md px-3 text-body-sm font-semibold', menu === m ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>
                View as {MENU_LABEL[m]}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" leadingIcon={<Eye size={15} />} onClick={preview}>Preview in the app</Button>
          {dept.layout && <Button variant="ghost" size="sm" leadingIcon={<RotateCcw size={15} />} disabled={busy} onClick={reset}>Reset</Button>}
          <Button size="sm" disabled={busy || !dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px_300px]">
          {/* Library */}
          <section className="min-w-0 rounded-card border border-line bg-card shadow-sm" aria-label="Blocks">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 className="text-body-lg font-semibold text-ink">Blocks</h2>
                <p className="text-body-sm text-ink-muted">Drag one into the {MENU_LABEL[menu]} menu, or press +.</p>
              </div>
              <div className="relative ml-auto w-full sm:w-56">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a block" aria-label="Find a block" className="h-8 w-full rounded-btn border border-line bg-card pl-8 pr-2 text-body-sm text-ink focus:border-primary focus:outline-none" />
              </div>
            </div>
            <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto p-4">
              {libGroups.map((g) => (
                <div key={g.key}>
                  <p className="mb-1.5 text-label-md uppercase text-ink-muted">{g.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.blocks.map((b) => <LibraryCard key={b.key} b={b} inMenu={list.includes(b.key)} why={refusal(b)} picked={picked === b.key} onPick={() => setPicked(b.key)} onAdd={() => add(b.key)} />)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* The menu */}
          <MenuPreview menu={menu} groups={groups} picked={picked} onPick={setPicked} onRemove={(k) => remove(k)} onMoveGroup={moveGroup} dragging={dragging} />

          {/* Details */}
          <aside className="space-y-4">
            <div className="rounded-card border border-line bg-card p-4 shadow-sm">
              {pickedBlock ? (
                <BlockDetails b={pickedBlock} layout={layout} why={(m) => refusal(pickedBlock, m)} onToggle={(m, on) => (on ? add(pickedBlock.key, m) : remove(pickedBlock.key, m))} />
              ) : (
                <div className="text-body-sm text-ink-muted">
                  <p className="text-body-md font-semibold text-ink">How it works</p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-4">
                    <li>Members and team leads have a menu each: switch with <b>View as</b>.</li>
                    <li>Drag blocks in, drag them up and down, press × to take one out. Headings move with their arrows.</li>
                    <li>Taking a block out hides it and stops new entries in it. Nothing is deleted: put it back and everything is there.</li>
                    <li><b>Preview in the app</b> walks you through Metriq with this menu.</li>
                    <li>Admin and Quality Assurance screens follow each person's role, as before.</li>
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
        <DragOverlay>{dragging ? <DragChip k={dragging.replace(/^(lib|item):/, '')} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function DragChip({ k }: { k: string }) {
  const item = navItemOfBlock(k)
  const b = blockByKey(k)
  const Icon = item?.icon
  return <div className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-card px-3 py-2 text-body-sm font-medium text-ink shadow-lg">{Icon && <Icon size={15} />}{b?.label}</div>
}

function LibraryCard({ b, inMenu, why, picked, onPick, onAdd }: { b: Block; inMenu: boolean; why: string | null; picked: boolean; onPick: () => void; onAdd: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `lib:${b.key}`, disabled: !!why || inMenu })
  const Icon = navItemOfBlock(b.key)?.icon
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onPick} data-block={b.key}
      className={cn('group flex items-start gap-2.5 rounded-btn border p-2.5 text-left transition-colors', why ? 'cursor-default border-dashed border-line bg-slate-50/60 opacity-70' : inMenu ? 'border-success/40 bg-success/5' : 'cursor-grab border-line bg-card hover:border-primary/40', picked && 'ring-2 ring-primary/30', isDragging && 'opacity-40')}>
      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', why ? 'bg-slate-100 text-ink-faint' : 'bg-primary/10 text-primary')}>{Icon && <Icon size={15} />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-semibold text-ink">{b.label}</span>
        <span className="block text-[12px] leading-snug text-ink-muted">{why ?? b.description}</span>
      </span>
      {inMenu ? <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 text-[11px] font-semibold text-success"><Check size={11} />In</span>
        : why ? <Lock size={13} className="mt-1 shrink-0 text-ink-faint" />
          : <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onAdd() }} className="rounded-md p-1 text-primary hover:bg-primary/10" aria-label={`Add ${b.label}`}><Plus size={15} /></button>}
    </div>
  )
}

function MenuPreview({ menu, groups, picked, onPick, onRemove, onMoveGroup, dragging }: {
  menu: Menu; groups: { group: BlockGroup; keys: string[] }[]; picked: string | null; onPick: (k: string) => void; onRemove: (k: string) => void; onMoveGroup: (i: number, by: number) => void; dragging: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'menu' })
  const adding = !!dragging?.startsWith('lib:')
  return (
    <section ref={setNodeRef} aria-label={`${MENU_LABEL[menu]} menu`} className={cn('order-first rounded-card border lg:order-none bg-slate-50/80 shadow-sm transition-colors dark:bg-slate-900/40', adding ? (isOver ? 'border-primary bg-primary/5' : 'border-dashed border-primary/50') : 'border-line')}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-body-lg font-semibold text-ink">{MENU_LABEL[menu]} menu</h2>
        <p className="text-body-sm text-ink-muted">What a {menu === 'lead' ? 'team lead' : 'member'} sees on the left.</p>
      </div>
      <div className="max-h-[calc(100vh-260px)] space-y-3 overflow-y-auto p-3">
        {groups.map((g, gi) => {
          const meta = navGroupOf(g.group)
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
                <ul className="space-y-0.5">
                  {g.keys.map((k) => <MenuItem key={k} k={k} picked={picked === k} onPick={() => onPick(k)} onRemove={() => onRemove(k)} />)}
                </ul>
              </SortableContext>
            </div>
          )
        })}
        {adding && <p className="rounded-btn border border-dashed border-primary/50 px-3 py-3 text-center text-body-sm font-semibold text-primary">Drop here to add it</p>}
        <div className="border-t border-line pt-2">
          <p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-muted"><ShieldCheck size={13} /> Admin and Quality Assurance screens follow each person's role.</p>
        </div>
      </div>
    </section>
  )
}

function MenuItem({ k, picked, onPick, onRemove }: { k: string; picked: boolean; onPick: () => void; onRemove: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `item:${k}` })
  const item = navItemOfBlock(k)
  const b = blockByKey(k)
  if (!item || !b) return null
  const Icon = item.icon
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-menu-item={k}
      className={cn('group flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1.5 shadow-xs ring-1 ring-line', picked && 'ring-2 ring-primary/50', isDragging && 'z-10 opacity-60')}>
      <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-0.5 text-ink-faint hover:text-ink active:cursor-grabbing" aria-label={`Move ${item.label}`}><GripVertical size={14} /></button>
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <Icon size={15} className="shrink-0 text-ink-muted" />
        <span className="truncate text-[13px] font-medium text-ink">{item.label}</span>
      </button>
      {b.fixed ? <Lock size={12} className="mr-1 text-ink-faint" aria-label="Always there" /> : (
        <button type="button" onClick={onRemove} className="rounded p-0.5 text-ink-faint opacity-60 hover:bg-danger/10 hover:text-danger group-hover:opacity-100" aria-label={`Take ${item.label} out`}><X size={14} /></button>
      )}
    </li>
  )
}

function BlockDetails({ b, layout, why, onToggle }: { b: Block; layout: DepartmentLayout; why: (m: Menu) => string | null; onToggle: (m: Menu, on: boolean) => void }) {
  const item = navItemOfBlock(b.key)
  const Icon = item?.icon
  return (
    <div>
      <div className="flex items-center gap-2">
        {Icon && <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon size={16} /></span>}
        <div className="min-w-0">
          <p className="text-body-md font-semibold text-ink">{b.label}</p>
          {item && item.label !== b.label && <p className="text-[12px] text-ink-muted">Shows in the menu as “{item.label}”</p>}
        </div>
      </div>
      <p className="mt-2 text-body-sm text-ink-muted">{b.description}</p>
      <p className="mt-3 text-label-md uppercase text-ink-muted">In the menu of</p>
      <div className="mt-1.5 space-y-1.5">
        {(['member', 'lead'] as Menu[]).map((m) => {
          const no = why(m)
          const on = layout[m].includes(b.key)
          return (
            <label key={m} className={cn('flex items-center gap-2 rounded-btn border border-line px-2.5 py-2 text-body-sm', no ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50')} title={no ?? undefined}>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} disabled={!!no || (b.fixed && on)} onChange={(e) => onToggle(m, e.target.checked)} />
              <span className="font-semibold text-ink">{MENU_LABEL[m]}s</span>
              {no && <span className="ml-auto text-[11px] text-ink-muted">{no}</span>}
              {b.fixed && <span className="ml-auto text-[11px] text-ink-muted">Always there</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}
