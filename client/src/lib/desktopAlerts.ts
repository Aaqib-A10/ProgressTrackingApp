// Desktop pop-up alerts (the browser's Notification API) for PulseTrack.
// Settings live on this computer/browser only, so each person chooses per device.
// Pop-ups show while PulseTrack is open in a tab (even in the background or minimised).

export interface DesktopPrefs {
  /** Master switch for pop-ups on this computer. */
  enabled: boolean
  /** Task alerts: assigned, overdue, due soon, mentions, comments, reviews, etc. */
  tasks: boolean
  /** New chat messages (direct, group and project channels that are not muted). */
  chat: boolean
  /** Play a short soft tone with each pop-up. */
  sound: boolean
}

const KEY = 'pt.desktopAlerts.v1'
const DEFAULTS: DesktopPrefs = { enabled: false, tasks: true, chat: true, sound: false }

export function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function permission(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported'
}

export function getPrefs(): DesktopPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DesktopPrefs>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

const listeners = new Set<() => void>()
export function onPrefsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function savePrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  const next = { ...getPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  listeners.forEach((f) => f())
  return next
}

/** Ask the browser for permission (must be called from a click). Turns pop-ups on if granted. */
export async function enable(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported'
  let p = Notification.permission
  if (p === 'default') p = await Notification.requestPermission()
  savePrefs({ enabled: p === 'granted' })
  return p
}

/** True when pop-ups are switched on here and the browser allows them. */
export function active(kind?: 'tasks' | 'chat' | 'calls'): boolean {
  const prefs = getPrefs()
  if (!prefs.enabled || permission() !== 'granted') return false
  // Calls always pop up when alerts are on (they can't wait like a message can).
  return kind && kind !== 'calls' ? prefs[kind] : true
}

/** Only pop up when the person isn't already looking at PulseTrack. */
function userIsAway(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}

let audioCtx: AudioContext | null = null
function tone(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = audioCtx ?? new Ctx()
    const t = audioCtx.currentTime
    // Two soft, low sine notes (a gentle chime, not a click or pop).
    ;[523.25, 659.25].forEach((f, i) => {
      const o = audioCtx!.createOscillator()
      const g = audioCtx!.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.16)
      g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.16 + 0.04)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.45)
      o.connect(g).connect(audioCtx!.destination)
      o.start(t + i * 0.16)
      o.stop(t + i * 0.16 + 0.5)
    })
  } catch { /* audio not available */ }
}

export interface PopupInput {
  kind: 'tasks' | 'chat' | 'calls'
  /** Keep the pop-up on screen until the person clicks it (incoming calls). */
  sticky?: boolean
  title: string
  body: string
  /** In-app route to open when the pop-up is clicked. */
  link?: string
  /** Same tag replaces an earlier pop-up instead of stacking. */
  tag?: string
  /** Show even when the tab is focused (used by "Send a test alert"). */
  force?: boolean
}

export function popup(p: PopupInput): boolean {
  if (!active(p.kind)) return false
  if (!p.force && !userIsAway()) return false
  try {
    const n = new Notification(p.title, { body: p.body, tag: p.tag, icon: '/favicon.svg', badge: '/favicon.svg', requireInteraction: !!p.sticky })
    n.onclick = () => {
      window.focus()
      if (p.link) window.dispatchEvent(new CustomEvent('pt:navigate', { detail: p.link }))
      n.close()
    }
    if (getPrefs().sound && p.kind !== 'calls') tone() // calls have their own ring
    return true
  } catch {
    return false
  }
}
