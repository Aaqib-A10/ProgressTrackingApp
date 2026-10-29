import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, LayoutDashboard, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { api, apiErrorText } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { cardByKey, type DashCard } from '../../lib/cards'
import type { CurrentUser } from '../../lib/types'
import { DashboardCard, SPAN } from './DashboardCards'

/**
 * A dashboard made of cards (Department Studio, part B): the cards the department gives this
 * person's role, in the order they arranged them, without the ones they hid. "Arrange" lets
 * each person move and hide cards on their own dashboard; "Back to the team's" undoes it.
 */

type Prefs = { order: string[]; hidden: string[] }

/** The department's cards in this person's order, then any new ones in the department's order. */
export function arranged(cards: DashCard[], prefs: Prefs | null | undefined): DashCard[] {
  if (!prefs) return cards
  const byKey = new Map(cards.map((c) => [c.key, c]))
  const first = prefs.order.map((k) => byKey.get(k)).filter((c): c is DashCard => !!c)
  return [...first, ...cards.filter((c) => !prefs.order.includes(c.key))]
}

export function CardDashboard({ user, cards, editable = true }: { user: CurrentUser; cards: DashCard[]; editable?: boolean }) {
  const { addToast } = useToast()
  const { refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const prefs = user.dashboardPrefs ?? null

  const shown = useMemo(() => arranged(cards, prefs).filter((c) => !prefs?.hidden.includes(c.key)), [cards, prefs])
  const byKey = new Map(cards.map((c) => [c.key, c]))

  function start() {
    setOrder(arranged(cards, prefs).map((c) => c.key))
    setHidden(prefs?.hidden ?? [])
    setEditing(true)
  }
  async function save(body: Prefs | { reset: true }, ok: string) {
    setBusy(true)
    try { await api.put('/auth/me/dashboard', body); await refresh?.(); setEditing(false); addToast({ type: 'success', message: ok }) } catch (e) { addToast({ type: 'error', message: apiErrorText(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function onEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    setOrder((o) => arrayMove(o, o.indexOf(String(e.active.id)), o.indexOf(String(e.over!.id))))
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <>
              <span className="mr-auto text-body-sm text-ink-muted">Drag cards to move them; the eye hides one. Only your own dashboard changes.</span>
              {prefs && <Button size="sm" variant="ghost" leadingIcon={<RotateCcw size={14} />} disabled={busy} onClick={() => save({ reset: true }, "Back to your team's dashboard.")}>Back to the team&apos;s</Button>}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" disabled={busy} onClick={() => save({ order, hidden }, 'Your dashboard is saved.')}>Save</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" leadingIcon={<LayoutDashboard size={14} />} onClick={start}>Arrange</Button>
          )}
        </div>
      )}

      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {order.map((k) => byKey.get(k)).filter((c): c is DashCard => !!c).map((c) => (
                <ArrangeCard key={c.key} card={c} user={user} off={hidden.includes(c.key)} onToggle={() => setHidden((h) => (h.includes(c.key) ? h.filter((x) => x !== c.key) : [...h, c.key]))} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-flow-row-dense lg:grid-cols-3">
          {shown.map((c) => <div key={c.key} className={cn('min-w-0 empty:hidden', SPAN[c.size])}><DashboardCard card={c} user={user} /></div>)}
          {shown.length === 0 && <p className="py-16 text-center text-body-md text-ink-muted lg:col-span-3">Every card is hidden. Press Arrange to show some again.</p>}
        </div>
      )}
    </div>
  )
}

function ArrangeCard({ card, user, off, onToggle }: { card: DashCard; user: CurrentUser; off: boolean; onToggle: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.key })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('relative min-w-0 rounded-card border-2 border-dashed border-primary/40', SPAN[card.size], isDragging && 'z-20 opacity-80 shadow-overlay')}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 rounded-t-card bg-primary/90 px-2 py-1 text-body-sm font-semibold text-white">
        <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-0.5 hover:bg-white/20 active:cursor-grabbing" aria-label={`Move ${cardByKey(card.key)?.label ?? 'card'}`}><GripVertical size={15} /></button>
        <span className="min-w-0 flex-1 truncate">{cardByKey(card.key)?.label ?? 'Your block'}</span>
        <button type="button" onClick={onToggle} className="rounded p-0.5 hover:bg-white/20" aria-label={off ? 'Show' : 'Hide'} title={off ? 'Show it' : 'Hide it'}>{off ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </div>
      <div className={cn('pointer-events-none select-none pt-8', off && 'opacity-30 grayscale')} aria-hidden><DashboardCard card={card} user={user} /></div>
    </div>
  )
}
