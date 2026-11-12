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

let reading: Promise<Record<string, boolean>> | null = null

/**
 * Read the switches (at most once a minute). Everyone who asks while a read is on its way waits for that same read:
 * before, a second caller got the empty "not read yet" switches at once, so a page behind an off-until-on switch
 * (Metra) sent the person to the dashboard when they reloaded it or opened it from a notification.
 */
export function refreshFlags(): Promise<Record<string, boolean>> {
  if (reading) return reading
  if (loaded && Date.now() - loadedAt < 60_000) return Promise.resolve(flags)
  reading = (async () => {
    try { flags = (await api.get<{ flags: Record<string, boolean> }>('/flags')).flags } catch { /* keep the last known */ }
    loadedAt = Date.now()
    loaded = true
    listeners.forEach((f) => f())
    return flags
  })().finally(() => { reading = null })
  return reading
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

/** Switches that stay off until the server says they are on (new parts still being tested, like Metra). */
const OFF_UNTIL_ON = new Set(['metra'])

/** On unless the owner switched it off (the ones above: off unless switched on). */
export const flagOn = (key: string): boolean => (OFF_UNTIL_ON.has(key) ? flags[key] === true : flags[key] !== false)

/** Tests only: set the switches as the server would send them. */
export function setFlagsForTest(f: Record<string, boolean>): void { flags = f; loadedAt = Date.now(); loaded = true }
