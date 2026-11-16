import type { Asker } from '../access'
import type { Entry, Row } from './types'
import { get, idOf, nameOf } from './load'
import { norm } from './table'

/**
 * Inventory: the stock list, stock-in / stock-out requests, the team's numbers and one item's history.
 * Shapes are those of controllers/inventoryController.ts.
 */

const inTeam = (a: Asker) => a.role === 'SUPER_ADMIN' || a.kinds.includes('INVENTORY' as never)
const own = (a: Asker) => a.kinds.includes('INVENTORY' as never)
const leads = (a: Asker) => a.role === 'SUPER_ADMIN' || (a.role === 'TEAM_LEAD' && a.kinds.includes('INVENTORY' as never))

interface ItemT { id: string; name: string; category: string; active: boolean; quantity: number; price: number | null; previousPrice: number | null; lowStockAt: number; sku: string; unit: string; location: string; notes: string; status: 'IN' | 'LOW' | 'OUT'; updatedAt: string }
interface MoveT { item: { name: string; category: string } | null; type: string; quantity: number; status: string; requestedBy: { id: string; name: string } | null; requestedByName: string; note: string; assignee: { id: string; name: string } | null; requestedAt: string; resolvedAt: string | null }

const moveRow = (m: MoveT): Row => ({ item: m.item?.name ?? '', category: m.item?.category ?? '', type: m.type, quantity: m.quantity, status: m.status, requestedBy: nameOf(m.requestedBy) || m.requestedByName, assignee: nameOf(m.assignee), assigneeId: idOf(m.assignee), requestedAt: m.requestedAt, resolvedAt: m.resolvedAt, note: m.note })
const MOVE_WORDS = { status: { REQUESTED: 'Requested (nobody on it yet)', ASSIGNED: 'Assigned', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }, type: { STOCK_IN: 'Stock in', STOCK_OUT: 'Stock out' } }

export const INVENTORY: Entry[] = [
  {
    key: 'inventory.items', label: 'Stock list', area: 'Inventory', app: '/app/inventory',
    about: 'Every item in stock: how many there are, the level at which it counts as low, whether it is in stock, low or out, its price, SKU, unit, where it is kept and the notes on it.',
    says: ['stock', 'stock list', 'inventory', 'items', 'item', 'low stock', 'low in stock', 'out of stock', 'how many in stock', 'how many do we have', 'quantity', 'price of', 'where is', 'location', 'sku', 'stock value', 'restock', 'kitna stock', 'stock mein', 'kitne hain', 'khatam', 'maal', 'ram', 'ssd', 'drives', 'memory'],
    who: inTeam, pin: own,
    blocks: ['inv-items'], apis: ['/api/inventory/items'], models: ['InventoryItem'],
    async load(ctx) {
      const r = await get<{ items: ItemT[] }>(ctx, '/api/inventory/items')
      if (r.error !== undefined) return { error: r.error }
      const rows: Row[] = r.body.items.map((i) => ({ name: i.name, category: i.category, quantity: i.quantity, lowStockAt: i.lowStockAt || null, status: i.status, price: i.price, value: i.price != null ? Math.round(i.price * i.quantity * 100) / 100 : null, sku: i.sku, unit: i.unit, location: i.location, active: i.active ? 'Active' : 'Not active', notes: i.notes, updatedAt: i.updatedAt }))
      return { rows }
    },
    table: {
      unit: ['item', 'items'],
      columns: [{ key: 'name', label: 'item' }, { key: 'category', label: 'category' }, { key: 'quantity', label: 'quantity', kind: 'number' }, { key: 'lowStockAt', label: 'low at', kind: 'number' }, { key: 'status', label: 'stock status' }, { key: 'price', label: 'price each', kind: 'money' }, { key: 'value', label: 'stock value', kind: 'money' }, { key: 'sku', label: 'SKU' }, { key: 'unit', label: 'unit' }, { key: 'location', label: 'location' }, { key: 'active', label: 'state' }, { key: 'notes', label: 'notes', kind: 'long' }, { key: 'updatedAt', label: 'last changed', kind: 'date' }],
      status: 'status', groups: ['category'], sums: ['quantity', 'value'], date: 'updatedAt',
      words: { status: { IN: 'In stock', LOW: 'Low stock', OUT: 'Out of stock' } },
      flags: {
        low: { label: 'low stock', says: ['low', 'running low', 'low in stock', 'kam'], test: (r) => r.status === 'LOW' },
        out: { label: 'out of stock', says: ['out', 'finished', 'none left', 'zero', 'khatam'], test: (r) => r.status === 'OUT' },
        restock: { label: 'needs restocking (low or out)', says: ['restock', 'reorder', 'needs stock', 'attention', 'issues'], test: (r) => r.status !== 'IN' },
        inactive: { label: 'not active', says: ['inactive', 'retired', 'disabled'], test: (r) => r.active !== 'Active' },
      },
    },
    suggest: 'Which items are low or out of stock?',
    brief: (rows) => { const out = rows.filter((r) => r.status === 'OUT').length, low = rows.filter((r) => r.status === 'LOW').length; return out || low ? `Stock list: ${out} out of stock, ${low} low.` : null },
    tip: 'An item is "low" when its quantity is at or under its "low at" level, and "out" at zero. To find one item pass search with its name. Who took stock in or out is in what="inventory.requests".',
  },
  {
    key: 'inventory.requests', label: 'Stock requests', area: 'Inventory', app: '/app/inventory/requests',
    about: 'Requests to put stock in or take stock out: the item, how many, who asked, who on the inventory team has it, and whether it is requested, assigned, completed or cancelled.',
    says: ['stock request', 'stock requests', 'requests', 'pending requests', 'open requests', 'stock in', 'stock out', 'who took', 'who requested', 'handed out', 'issued', 'movements', 'request pending', 'kis ne liya', 'kis ne manga', 'request'],
    who: inTeam, pin: own,
    blocks: ['inv-requests'], apis: ['/api/inventory/requests'], models: ['InventoryMovement'],
    async load(ctx) {
      const r = await get<{ requests: MoveT[] }>(ctx, '/api/inventory/requests')
      if (r.error !== undefined) return { error: r.error }
      return { rows: r.body.requests.map(moveRow), notes: r.body.requests.length >= 500 ? ['Only the newest 500 requests are read.'] : [] }
    },
    table: {
      unit: ['request', 'requests'],
      columns: [{ key: 'item', label: 'item' }, { key: 'category', label: 'category' }, { key: 'type', label: 'kind' }, { key: 'quantity', label: 'quantity', kind: 'number' }, { key: 'status', label: 'status' }, { key: 'requestedBy', label: 'requested by' }, { key: 'assignee', label: 'assigned to' }, { key: 'assigneeId', label: 'id', hidden: true }, { key: 'requestedAt', label: 'requested', kind: 'time' }, { key: 'resolvedAt', label: 'finished', kind: 'time' }, { key: 'note', label: 'note', kind: 'long' }],
      people: ['assignee', 'requestedBy'], mine: 'assigneeId', status: 'status', groups: ['type'], sums: ['quantity'], date: 'requestedAt', words: MOVE_WORDS,
      flags: {
        open: { label: 'still open (requested or assigned)', says: ['open', 'pending', 'waiting', 'not done', 'unresolved', 'baqi'], test: (r) => r.status === 'REQUESTED' || r.status === 'ASSIGNED' },
        unassigned: { label: 'nobody on it', says: ['unassigned', 'not assigned'], test: (r) => r.status === 'REQUESTED' },
      },
    },
    suggest: 'Which stock requests are still open?',
    brief: (rows, c) => { const open = rows.filter((r) => r.status === 'REQUESTED' || r.status === 'ASSIGNED'); const mine = open.filter((r) => r.assigneeId === c.me.id).length; const free = open.filter((r) => r.status === 'REQUESTED').length; return open.length ? `Stock requests: ${open.length} open${mine ? `, ${mine} of them yours` : ''}${free ? `, ${free} with nobody on ${free === 1 ? 'it' : 'them'}` : ''}.` : null },
    tip: 'A pending request is one that is "still open". The quantities in stock are in what="inventory.items".',
  },
  {
    key: 'inventory.team', label: 'Inventory team', area: 'Inventory', app: '/app/inventory/team',
    about: 'For the inventory team lead: how many requests each person completed and how many they have open, with the totals of items, items out of stock and open requests.',
    says: ['inventory team', 'who completed', 'who has open requests', 'team performance', 'requests per person', 'workload'],
    who: leads, pin: (a) => own(a) && leads(a),
    blocks: ['inv-team'], apis: ['/api/inventory/team'], models: ['InventoryMovement', 'InventoryItem'],
    async load(ctx) {
      const r = await get<{ agents: { name: string; completed: number; open: number }[]; totals: { itemCount: number; outOfStock: number; openRequests: number } }>(ctx, '/api/inventory/team')
      if (r.error !== undefined) return { error: r.error }
      const t = r.body.totals
      return { rows: r.body.agents.map((x) => ({ name: x.name, completed: x.completed, open: x.open })), head: [`Inventory totals: ${t.itemCount} items, ${t.outOfStock} out of stock, ${t.openRequests} open requests (requested or assigned).`] }
    },
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'name', label: 'person' }, { key: 'completed', label: 'requests completed', kind: 'number' }, { key: 'open', label: 'requests open with them', kind: 'number' }],
      people: ['name'], sums: ['completed', 'open'],
    },
  },
  {
    key: 'inventory.item_history', label: 'History of one item', area: 'Inventory', app: '/app/inventory',
    about: 'Everything that happened to ONE stock item: every stock-in and stock-out with who asked and who handled it, and every change to its quantity, price or details with who made it.',
    says: ['history of', 'what happened to', 'who changed', 'price change', 'price changed', 'activity', 'log of item', 'who took the', 'movements of', 'item history', 'kab aaya', 'kis ne change'],
    who: inTeam, takes: ['item'],
    blocks: ['inv-items'], apis: ['/api/inventory/items', '/api/inventory/items/:id/activity'], models: ['InventoryMovement', 'InventoryItem'],
    async load(ctx, a) {
      const list = await get<{ items: ItemT[] }>(ctx, '/api/inventory/items')
      if (list.error !== undefined) return { error: list.error }
      const want = norm(a.item || a.search)
      const items = list.body.items
      if (!want) return { error: `Say which item (pass item with its name). The items are: ${items.slice(0, 60).map((i) => i.name).join(', ')}.` }
      const exact = items.filter((i) => norm(i.name) === want)
      const hits = exact.length ? exact : items.filter((i) => norm(i.name).includes(want) || want.split(' ').every((w) => norm(`${i.name} ${i.sku} ${i.category}`).includes(w)))
      if (!hits.length) return { error: `No item is called "${a.item || a.search}". The items are: ${items.slice(0, 60).map((i) => i.name).join(', ')}.` }
      if (hits.length > 1) return { error: `"${a.item || a.search}" fits ${hits.length} items: ${hits.slice(0, 20).map((i) => i.name).join('; ')}. Ask the person which one, or call again with the full name.` }
      const it = hits[0]
      const r = await get<{ movements: MoveT[]; audits: { action: string; before: unknown; after: unknown; actor: { name: string } | null; createdAt: string }[] }>(ctx, `/api/inventory/items/${encodeURIComponent(it.id)}/activity`)
      if (r.error !== undefined) return { error: r.error }
      const changed = (b: unknown, x: unknown) => {
        const before = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>, after = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
        return Object.keys(after).filter((k) => !/id$|At$/i.test(k) && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => `${k}: ${before[k] ?? 'nothing'} -> ${after[k] ?? 'nothing'}`).join('; ')
      }
      const rows: Row[] = [
        ...r.body.movements.map((m) => ({ when: m.requestedAt, what: m.type === 'STOCK_IN' ? 'Stock in' : 'Stock out', quantity: m.quantity, status: m.status, by: nameOf(m.requestedBy) || m.requestedByName, handledBy: nameOf(m.assignee), detail: m.note })),
        ...r.body.audits.map((x) => ({ when: x.createdAt, what: 'Edited', quantity: null, status: '', by: x.actor?.name ?? '', handledBy: '', detail: changed(x.before, x.after) || x.action })),
      ].sort((x, y) => String(y.when).localeCompare(String(x.when)))
      return { rows, head: [`Item: ${it.name} (${it.category}). Now: ${it.quantity} in stock, ${{ IN: 'in stock', LOW: 'low stock', OUT: 'out of stock' }[it.status]}${it.price != null ? `, price each ${it.price}${it.previousPrice != null ? ` (before: ${it.previousPrice})` : ''}` : ''}${it.location ? `, kept at ${it.location}` : ''}.`] }
    },
    table: {
      unit: ['event', 'events'],
      columns: [{ key: 'when', label: 'when', kind: 'time' }, { key: 'what', label: 'what' }, { key: 'quantity', label: 'quantity', kind: 'number' }, { key: 'status', label: 'status' }, { key: 'by', label: 'by' }, { key: 'handledBy', label: 'handled by' }, { key: 'detail', label: 'detail', kind: 'long' }],
      people: ['by', 'handledBy'], groups: ['what'], date: 'when', words: { status: MOVE_WORDS.status },
    },
    tip: 'Newest first.',
  },
]
