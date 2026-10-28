/**
 * Silent updates: after a deploy, an open tab picks up the new version by itself, at a moment
 * nobody notices, instead of showing a "Reload" banner (Oct 2026).
 *
 * Safe moments: the next click to another page, a tab left in the background, or a long idle.
 * Never during a call or meeting, while text is being written, or while something uploads or
 * records (those parts "hold" updates while they run).
 */

const holds = new Set<symbol>()

/** Keep the page from reloading until the returned function is called (uploads, recordings). */
export function holdUpdates(): () => void {
  const key = Symbol('hold')
  holds.add(key)
  return () => { holds.delete(key) }
}

export function updatesHeld(): boolean {
  return holds.size > 0
}

/** Run a task while holding updates. */
export async function whileHeld<T>(task: () => Promise<T>): Promise<T> {
  const release = holdUpdates()
  try { return await task() } finally { release() }
}

type El = { tagName?: string; value?: string; textContent?: string | null; isContentEditable?: boolean; type?: string; readOnly?: boolean; disabled?: boolean }
export interface DocLike {
  activeElement: El | null
  querySelectorAll: (sel: string) => ArrayLike<El>
}

const TEXT_INPUTS = new Set(['', 'text', 'email', 'number', 'tel', 'url', 'password', 'time', 'date', 'datetime-local'])

/**
 * Something typed that a reload would lose: any text box or editor with words in it, or the field
 * the person is in right now. Empty boxes and checkboxes don't count.
 */
export function hasUnsavedText(doc: DocLike): boolean {
  const a = doc.activeElement
  if (a && !a.readOnly && !a.disabled) {
    const tag = (a.tagName ?? '').toLowerCase()
    if (tag === 'textarea' && (a.value ?? '').trim()) return true
    if (tag === 'input' && TEXT_INPUTS.has((a.type ?? '').toLowerCase()) && (a.value ?? '').trim()) return true
    if (a.isContentEditable && (a.textContent ?? '').trim()) return true
  }
  const boxes = doc.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (b.readOnly || b.disabled) continue
    const text = (b.tagName ?? '').toLowerCase() === 'textarea' ? b.value : b.textContent
    if ((text ?? '').trim()) return true
  }
  return false
}

export interface SafeState {
  inCall: boolean
  path: string
  held: boolean
  unsavedText: boolean
}

/** A meeting room page is a call too. */
const isMeetingRoom = (path: string) => /^\/app\/meetings\/[^/]+/.test(path) || /^\/(guest|join)\//.test(path)

export function safeToReload(s: SafeState): boolean {
  return !s.inCall && !s.held && !s.unsavedText && !isMeetingRoom(s.path)
}

export const HIDDEN_MS = 5 * 60_000
export const IDLE_MS = 15 * 60_000
/** After one silent reload, wait before another, so a cached old page can never loop. */
export const RETRY_GAP_MS = 10 * 60_000
export const RELOADED_KEY = 'pt-silent-reload-at'

export type Trigger = 'page-change' | 'hidden' | 'idle'

export interface Decision {
  outdated: boolean
  trigger: Trigger
  now: number
  /** When the tab went into the background (for 'hidden'), or the last mouse/key (for 'idle'). */
  since: number
  lastReloadAt: number | null
  state: SafeState
}

export function shouldReload(d: Decision): boolean {
  if (!d.outdated) return false
  if (d.lastReloadAt != null && d.now - d.lastReloadAt < RETRY_GAP_MS) return false
  if (d.trigger === 'hidden' && d.now - d.since < HIDDEN_MS) return false
  if (d.trigger === 'idle' && d.now - d.since < IDLE_MS) return false
  return safeToReload(d.state)
}
