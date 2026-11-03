import { useEffect, useState } from 'react'
import { api } from './api'

/**
 * On/off switches set by the owner (Phase 1, step 1). Read once and refreshed now and then;
 * if they cannot be read, every part keeps working as normal (switches default to on).
 */
let flags: Record<string, boolean> = {}
let loadedAt = 0
let loaded = false
const listeners = new Set<() => void>()

export async function refreshFlags(): Promise<Record<string, boolean>> {
  if (Date.now() - loadedAt < 60_000) return flags
  loadedAt = Date.now()
  try { flags = (await api.get<{ flags: Record<string, boolean> }>('/flags')).flags } catch { /* keep the last known */ }
  loaded = true
  listeners.forEach((f) => f())
  return flags
}

/** True once the switches have been read (or could not be read). */
export const flagsLoaded = (): boolean => loaded

/**
 * Re-render when the switches arrive. The menu uses it so a part switched off for the company
 * is never shown first and then taken away (it looked like the item "disappeared" on click).
 */
export function useFlags(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const f = () => setN((x) => x + 1)
    listeners.add(f)
    void refreshFlags()
    return () => { listeners.delete(f) }
  }, [])
  return n
}

/** On unless the owner switched it off. */
export const flagOn = (key: string): boolean => flags[key] !== false

/** Tests only: set the switches as the server would send them. */
export function setFlagsForTest(f: Record<string, boolean>): void { flags = f; loadedAt = Date.now(); loaded = true }
