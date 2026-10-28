import { api } from './api'

/**
 * On/off switches set by the owner (Phase 1, step 1). Read once and refreshed now and then;
 * if they cannot be read, every part keeps working as normal (switches default to on).
 */
let flags: Record<string, boolean> = {}
let loadedAt = 0

export async function refreshFlags(): Promise<Record<string, boolean>> {
  if (Date.now() - loadedAt < 60_000) return flags
  loadedAt = Date.now()
  try { flags = (await api.get<{ flags: Record<string, boolean> }>('/flags')).flags } catch { /* keep the last known */ }
  return flags
}

/** On unless the owner switched it off. */
export const flagOn = (key: string): boolean => flags[key] !== false
