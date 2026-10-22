import { useEffect, useState } from 'react'

/**
 * Light, dark, or follow the computer. The choice is kept per browser; index.html applies it
 * before the first paint so a dark page never flashes white. Changing it updates every open
 * part of the app at once (charts redraw with the new colours).
 */
export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'pt-theme'
const EVENT = 'pt:theme'
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

export function resolveTheme(choice: ThemeChoice = getThemeChoice()): Theme {
  if (choice === 'system') return media()?.matches ? 'dark' : 'light'
  return choice
}

function apply(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0E0F11' : '#FAFAFB')
}

export function setThemeChoice(choice: ThemeChoice): void {
  try { localStorage.setItem(KEY, choice) } catch { /* private window: still switch for this visit */ }
  apply(resolveTheme(choice))
  window.dispatchEvent(new Event(EVENT))
}

/** Call once at start: applies the saved choice and follows the computer when set to system. */
export function initTheme(): void {
  apply(resolveTheme())
  media()?.addEventListener?.('change', () => {
    if (getThemeChoice() === 'system') { apply(resolveTheme('system')); window.dispatchEvent(new Event(EVENT)) }
  })
}

/** The current choice and the theme actually showing; re-renders when either changes. */
export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (c: ThemeChoice) => void } {
  const [state, setState] = useState(() => ({ choice: getThemeChoice(), theme: resolveTheme() }))
  useEffect(() => {
    const on = () => setState({ choice: getThemeChoice(), theme: resolveTheme() })
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return { ...state, setChoice: setThemeChoice }
}

/** A theme colour as an rgb() string, for places that need a real colour (SVG charts, canvas). */
export function themeColor(name: string, alpha = 1): string {
  if (typeof document === 'undefined') return 'rgb(0 0 0)'
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return v ? `rgb(${v} / ${alpha})` : 'rgb(0 0 0)'
}
