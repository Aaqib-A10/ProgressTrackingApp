import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { cn } from '../../../lib/cn'
import { apiErrorText } from '../../../lib/api'
import { BLOCK_COLORS, BLOCK_ICON, FIELD_TYPE_LABEL, customApi, iconOf, type CustomBlockInput, type CustomField, type FieldType } from '../../../lib/customApi'
import { FieldInput, fieldCls } from '../custom/fields'

/**
 * Department Studio, part C: make a block of your own. Name it, pick an icon, list its fields
 * (text, number, date, a choice, a person, a tick box, a link), and say who sees what. It then
 * shows in the Studio's library, to put in any department's menu and dashboard.
 */

type DField = CustomField & { _id: string }
type Draft = Omit<CustomBlockInput, 'fields'> & { fields: DField[] }
let seq = 0
const uid = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

const STARTERS: { label: string; draft: () => Partial<Draft> }[] = [
  { label: 'Empty', draft: () => ({ fields: [{ _id: uid(), key: '', label: 'Title', type: 'text', required: true }] }) },
  { label: 'Requests', draft: () => ({ name: 'Requests', icon: 'ClipboardList', fields: [{ _id: uid(), key: 'title', label: 'What is needed', type: 'text', required: true }, { _id: uid(), key: 'details', label: 'Details', type: 'longtext' }, { _id: uid(), key: 'status', label: 'Status', type: 'select', options: ['New', 'In progress', 'Done'] }, { _id: uid(), key: 'owner', label: 'Who handles it', type: 'person' }, { _id: uid(), key: 'due', label: 'Needed by', type: 'date' }], settings: { membersSee: 'all', membersAdd: true, boardField: 'status', dateField: 'due' } }) },
  { label: 'Expenses', draft: () => ({ name: 'Expenses', icon: 'Receipt', fields: [{ _id: uid(), key: 'item', label: 'Item', type: 'text', required: true }, { _id: uid(), key: 'amount', label: 'Amount', type: 'number', required: true }, { _id: uid(), key: 'date', label: 'Date', type: 'date' }, { _id: uid(), key: 'approved', label: 'Approval', type: 'select', options: ['Waiting', 'Approved', 'Refused'] }, { _id: uid(), key: 'receipt', label: 'Receipt link', type: 'url' }], settings: { membersSee: 'own', membersAdd: true, boardField: 'approved', dateField: 'date' } }) },
  { label: 'Pickups', draft: () => ({ name: 'Pickups', icon: 'Truck', fields: [{ _id: uid(), key: 'client', label: 'Client', type: 'text', required: true }, { _id: uid(), key: 'address', label: 'Address', type: 'longtext' }, { _id: uid(), key: 'day', label: 'Pickup day', type: 'date' }, { _id: uid(), key: 'status', label: 'Status', type: 'select', options: ['Booked', 'On the way', 'Collected'] }, { _id: uid(), key: 'units', label: 'Units', type: 'number' }], settings: { membersSee: 'all', membersAdd: true, boardField: 'status', dateField: 'day' } }) },
]

const empty = (): Draft => ({ name: '', description: null, icon: 'LayoutGrid', color: BLOCK_COLORS[0], fields: [], settings: { membersSee: 'all', membersAdd: true, boardField: null, dateField: null } })

export default function BlockBuilder() {
  const { id = 'new' } = useParams()
  const [params] = useSearchParams()
  const back = params.get('back')
  const backTo = back ? `/app/admin/company/departments/${back}` : '/app/admin/company'
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const isNew = id === 'new'
  const [d, setD] = useState<Draft | null>(isNew ? { ...empty(), ...STARTERS[0].draft() } as Draft : null)
  const [records, setRecords] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isNew) return
    customApi.list().then((r) => {
      const b = r.blocks.find((x) => x.id === id)
      if (!b) { addToast({ type: 'error', message: 'Block not found.' }); navigate(backTo); return }
      setRecords(b.records ?? 0)
      setD({ name: b.name, description: b.description, icon: b.icon, color: b.color, settings: b.settings, fields: b.fields.map((f) => ({ ...f, _id: uid() })) })
    }).catch((e) => addToast({ type: 'error', message: apiErrorText(e, 'Could not load the block.') }))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  if (!d) return <div className="mx-auto w-full max-w-[1800px] py-16 text-center text-body-md text-ink-muted">Loading…</div>

  const set = (p: Partial<Draft>) => setD((cur) => (cur ? { ...cur, ...p } : cur))
  const setField = (fid: string, p: Partial<CustomField>) => set({ fields: d.fields.map((f) => (f._id === fid ? { ...f, ...p } : f)) })
  const addField = (type: FieldType) => set({ fields: [...d.fields, { _id: uid(), key: '', label: '', type, ...(type === 'select' ? { options: ['', ''] } : {}) }] })
  function onEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = d!.fields.findIndex((f) => f._id === e.active.id), to = d!.fields.findIndex((f) => f._id === e.over!.id)
    set({ fields: arrayMove(d!.fields, from, to) })
  }
  const keyOf = (f: DField) => f.key || f._id
  const choiceFields = d.fields.filter((f) => f.type === 'select')
  const dateFields = d.fields.filter((f) => f.type === 'date')

  function body(): CustomBlockInput {
    const fields = d!.fields.map(({ _id, ...f }) => ({ ...f, key: f.key || undefined as unknown as string, options: f.type === 'select' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined }))
    // Fields that are new get their key on the server, so the board and calendar point at them by position.
    const pos = (k: string | null) => (k ? d!.fields.findIndex((f) => keyOf(f) === k) : -1)
    const bi = pos(d!.settings.boardField), di = pos(d!.settings.dateField)
    return { ...d!, fields, settings: { ...d!.settings, boardField: bi >= 0 ? d!.fields[bi].key || `__new${bi}` : null, dateField: di >= 0 ? d!.fields[di].key || `__new${di}` : null } }
  }
  async function save() {
    setBusy(true)
    try {
      let b = body()
      const needsSecond = b.settings.boardField?.startsWith('__new') || b.settings.dateField?.startsWith('__new')
      const pending = { board: b.settings.boardField, date: b.settings.dateField }
      if (needsSecond) b = { ...b, settings: { ...b.settings, boardField: pending.board?.startsWith('__new') ? null : pending.board, dateField: pending.date?.startsWith('__new') ? null : pending.date } }
      let saved = isNew ? (await customApi.create(b)).block : (await customApi.update(id, b)).block
      if (needsSecond) {
        // Point the board and calendar at the new fields now that they have their keys.
        const at = (p: string | null | undefined) => (p?.startsWith('__new') ? saved.fields[Number(p.slice(5))]?.key ?? null : p ?? null)
        saved = (await customApi.update(saved.id, { ...saved, settings: { ...saved.settings, boardField: at(pending.board), dateField: at(pending.date) } })).block
      }
      addToast({ type: 'success', message: `${saved.name} is saved.${isNew ? ' Put it in a menu in the Studio.' : ''}` })
      void refresh?.()
      navigate(backTo)
    } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  async function remove() {
    const withRecords = records > 0
    if (!window.confirm(withRecords ? `Delete ${d!.name} and its ${records} record${records === 1 ? '' : 's'}? This cannot be undone.` : `Delete ${d!.name}?`)) return
    setBusy(true)
    try { await customApi.remove(id, withRecords); addToast({ type: 'success', message: 'Deleted.' }); void refresh?.(); navigate(backTo) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not delete.') }) } finally { setBusy(false) }
  }

  const Icon = iconOf(d.icon)
  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={backTo} className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={15} /> {back ? 'Studio' : 'Company Settings'}</Link>
        <h1 className="text-headline-md text-ink">{isNew ? 'New block' : `Change ${d.name || 'block'}`}</h1>
        <div className="ml-auto flex gap-2">
          {!isNew && <Button variant="ghost" className="text-danger" leadingIcon={<Trash2 size={15} />} disabled={busy} onClick={remove}>Delete</Button>}
          <Button disabled={busy || d.name.trim().length < 2 || d.fields.length === 0} onClick={save}>Save</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {isNew && (
            <Card title="Start from" subtitle="A ready set of fields, or an empty block.">
              <div className="flex flex-wrap gap-2">{STARTERS.map((s) => <button key={s.label} type="button" onClick={() => setD({ ...empty(), ...s.draft() } as Draft)} className="rounded-full border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:border-primary/50 hover:bg-primary/5">{s.label}</button>)}</div>
            </Card>
          )}
          <Card title="The block">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="mb-1 block text-body-sm font-semibold text-ink">Name</span><input className={fieldCls} value={d.name} maxLength={60} placeholder="e.g. Pickups, Expenses, Leave requests" onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-body-sm font-semibold text-ink">What it is for (optional)</span><input className={fieldCls} value={d.description ?? ''} maxLength={300} onChange={(e) => set({ description: e.target.value || null })} /></label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-body-sm font-semibold text-ink">Icon and colour</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(BLOCK_ICON).map(([name, I]) => (
                    <button key={name} type="button" onClick={() => set({ icon: name })} aria-label={name} aria-pressed={d.icon === name} className={cn('flex h-9 w-9 items-center justify-center rounded-btn border', d.icon === name ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-muted hover:text-ink')}><I size={16} /></button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BLOCK_COLORS.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} aria-label={`Colour ${c}`} aria-pressed={d.color === c} className={cn('h-7 w-7 rounded-full border-2', d.color === c ? 'border-ink' : 'border-transparent')} style={{ background: c }} />)}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Fields" subtitle="What people fill in. Drag to reorder.">
            {!isNew && records > 0 && <p className="mb-3 rounded-btn bg-warning/10 px-3 py-2 text-body-sm text-ink">It has {records} record{records === 1 ? '' : 's'}. Renaming a field keeps their values; removing a field hides its values; changing a field's type can leave old values that no longer fit.</p>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
              <SortableContext items={d.fields.map((f) => f._id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">{d.fields.map((f) => <FieldRow key={f._id} f={f} onChange={(p) => setField(f._id, p)} onRemove={() => set({ fields: d.fields.filter((x) => x._id !== f._id) })} />)}</ul>
              </SortableContext>
            </DndContext>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-body-sm text-ink-muted"><Plus size={13} className="inline" /> Add</span>
              {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <button key={t} type="button" onClick={() => addField(t)} className="rounded-full border border-line px-2.5 py-1 text-body-sm font-medium text-ink hover:border-primary/50 hover:bg-primary/5">{FIELD_TYPE_LABEL[t]}</button>)}
            </div>
          </Card>

          <Card title="Who sees what">
            <div className="space-y-3 text-body-md">
              <fieldset>
                <legend className="mb-1 text-body-sm font-semibold text-ink">Members see</legend>
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={d.settings.membersSee === 'all'} onChange={() => set({ settings: { ...d.settings, membersSee: 'all' } })} /> Everything their department added</label>
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={d.settings.membersSee === 'own'} onChange={() => set({ settings: { ...d.settings, membersSee: 'own' } })} /> Only what they added themselves (a form)</label>
              </fieldset>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={d.settings.membersAdd} onChange={(e) => set({ settings: { ...d.settings, membersAdd: e.target.checked } })} /> Members can add (off: only team leads add)</label>
              <p className="text-body-sm text-ink-muted">Team leads see and change everything their department added; the Super Admin sees every department's. Each department that uses the block has its own records.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Board by</span>
                  <select className={fieldCls} value={d.settings.boardField ?? ''} onChange={(e) => set({ settings: { ...d.settings, boardField: e.target.value || null } })}><option value="">No board</option>{choiceFields.map((f) => <option key={f._id} value={keyOf(f)}>{f.label || 'Untitled choice'}</option>)}</select>
                </label>
                <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Calendar by</span>
                  <select className={fieldCls} value={d.settings.dateField ?? ''} onChange={(e) => set({ settings: { ...d.settings, dateField: e.target.value || null } })}><option value="">No calendar</option>{dateFields.map((f) => <option key={f._id} value={keyOf(f)}>{f.label || 'Untitled date'}</option>)}</select>
                </label>
              </div>
            </div>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card title={<span className="inline-flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: `${d.color}1f`, color: d.color }}><Icon size={15} /></span>{d.name || 'Your block'}</span>} subtitle="What people see when they press Add">
            <div className="grid gap-3">
              {d.fields.length === 0 ? <p className="text-body-sm text-ink-muted">Add a field to see it here.</p> : d.fields.map((f) => <FieldInput key={f._id} f={{ ...f, label: f.label || 'Untitled', options: (f.options ?? []).filter(Boolean) }} value={null} onChange={() => undefined} people={[]} disabled />)}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function FieldRow({ f, onChange, onRemove }: { f: DField; onChange: (p: Partial<CustomField>) => void; onRemove: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: f._id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('rounded-btn border border-line bg-card p-2.5', isDragging && 'z-10 shadow-lg')} data-field={f.label}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-1 text-ink-faint hover:text-ink" aria-label="Move field"><GripVertical size={15} /></button>
        <input value={f.label} maxLength={60} placeholder="Field name" aria-label="Field name" onChange={(e) => onChange({ label: e.target.value })} className={cn(fieldCls, '!h-9 min-w-[160px] flex-1')} />
        <select value={f.type} aria-label="Type" onChange={(e) => onChange({ type: e.target.value as FieldType, ...(e.target.value === 'select' && !f.options?.length ? { options: ['', ''] } : {}) })} className={cn(fieldCls, '!h-9 !w-36')}>
          {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-body-sm text-ink-muted"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.required} onChange={(e) => onChange({ required: e.target.checked })} /> Needed</label>
        <button type="button" onClick={onRemove} className="rounded p-1 text-ink-faint hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${f.label || 'field'}`}><Trash2 size={15} /></button>
      </div>
      {f.type === 'select' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
          {(f.options ?? []).map((o, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line bg-slate-50 pl-2 pr-1 dark:bg-slate-800/50">
              <input value={o} maxLength={40} placeholder={`Choice ${i + 1}`} aria-label={`Choice ${i + 1}`} onChange={(e) => onChange({ options: (f.options ?? []).map((x, j) => (j === i ? e.target.value : x)) })} className="h-7 w-28 bg-transparent text-body-sm text-ink focus:outline-none" />
              <button type="button" onClick={() => onChange({ options: (f.options ?? []).filter((_, j) => j !== i) })} className="rounded-full p-0.5 text-ink-faint hover:text-danger" aria-label="Remove choice"><X size={12} /></button>
            </span>
          ))}
          <button type="button" onClick={() => onChange({ options: [...(f.options ?? []), ''] })} className="rounded-full px-2 py-1 text-body-sm font-semibold text-primary hover:bg-primary/5">+ Choice</button>
        </div>
      )}
    </li>
  )
}
