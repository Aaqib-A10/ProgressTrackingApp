/** Fixed inventory categories — shared by the filter pills and the item form select.
 * Must match server/src/lib/inventory.ts. "All Items" is a UI-only "no filter" pill. */
export const INVENTORY_CATEGORIES = [
  'Desktop Models',
  'Memory',
  'Drives',
  'Monitors',
  'GPU',
  'Accessories',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]
