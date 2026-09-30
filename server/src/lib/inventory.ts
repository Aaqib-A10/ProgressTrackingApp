/** Fixed inventory categories — shared by the item form select, the filter pills,
 * and server-side validation. "All Items" is a UI-only "no filter" pill, not a value. */
export const INVENTORY_CATEGORIES = [
  'Desktop Models',
  'Memory',
  'Drives',
  'Monitors',
  'GPU',
  'Accessories',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

/** Derived stock status from live quantity vs the low-stock threshold. */
export function stockStatus(quantity: number, lowStockAt: number): 'OUT' | 'LOW' | 'IN' {
  if (quantity <= 0) return 'OUT'
  if (lowStockAt > 0 && quantity <= lowStockAt) return 'LOW'
  return 'IN'
}
