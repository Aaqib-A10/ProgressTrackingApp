import { useSyncExternalStore } from 'react'

/**
 * The floating buttons in the bottom-right corner (Quick Log, Ask Metra) as one dock that can be put aside: a slim
 * tab on the screen edge brings it back. Kept per browser. On the chat page it starts put aside, so the message box
 * and its send button are never under it (opening it there is remembered separately).
 *
 * Each button says it is there (`useDockButton`), so the page leaves room under it and the tab only shows when there
 * is something to bring back.
 */

type Place = 'chat' | 'page'
const KEY: Record<Place, string> = { page: 'pt-dock-tucked', chat: 'pt-dock-tucked-chat' }
const DEFAULT: Record<Place, boolean> = { page: false, chat: true }

const read = (p: Place): boolean => {
  try { const v = localStorage.getItem(KEY[p]); return v === null ? DEFAULT[p] : v === '1' } catch { return DEFAULT[p] }
}

let state = { tucked: { page: read('page'), chat: read('chat') }, present: new Set<string>() }
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

export const placeOf = (pathname: string): Place => (pathname.startsWith('/app/chat') ? 'chat' : 'page')

export function setDockTucked(place: Place, tucked: boolean): void {
  try { localStorage.setItem(KEY[place], tucked ? '1' : '0') } catch { /* private window: this visit only */ }
  state = { ...state, tucked: { ...state.tucked, [place]: tucked } }
  emit()
}

/** Whether the dock is put aside here, and whether any button is in it. */
export function useDock(pathname: string): { tucked: boolean; any: boolean; place: Place } {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  const place = placeOf(pathname)
  return { tucked: s.tucked[place], any: s.present.size > 0, place }
}

/** A button of the dock: registers while `shown`. */
export function registerDockButton(name: string, shown: boolean): () => void {
  const had = state.present.has(name)
  if (shown && !had) { state = { ...state, present: new Set([...state.present, name]) }; emit() }
  if (!shown && had) { const p = new Set(state.present); p.delete(name); state = { ...state, present: p }; emit() }
  return () => {
    if (!state.present.has(name)) return
    const p = new Set(state.present)
    p.delete(name)
    state = { ...state, present: p }
    emit()
  }
}
