import { useEffect, useState } from 'react'
import { brandCss } from '../theme/brand'
import { DARK_ONLY, DEFAULT_THEME, THEMES, themeById } from '../theme/themes'

/**
 * How the app looks: the MODE (light, dark, or follow the computer; kept per browser) and the colour THEME
 * (src/theme/themes: the person's own pick, else their company's, else Metriq's own; kept on the account), plus the
 * company's brand colour in place of the theme's accent. index.html applies what was kept on this device before the
 * first paint, so a page never flashes in the wrong colours. Changing any of it updates every open part of the app
 * at once (charts redraw with the new colours).
 *
 * The public website (/, /pricing, /product...) always shows Metriq's own colours: the theme is the app's.
 */
export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'pt-theme' // the mode
const ID_KEY = 'pt-theme-id' // the colour theme showing
const DARK_KEY = 'pt-theme-dark-only' // '1' when that theme is dark only (read by index.html before the page loads)
const BRAND_KEY = 'pt-brand-css' // the brand colour, as CSS for that theme
const EVENT = 'pt:theme'
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* private window: still applied for this visit */ } }
const isTheme = (id: unknown): id is string => typeof id === 'string' && THEMES.some((t) => t.id === id)

/** Pages of the public website (main.tsx marks the rest as the app). Keep in step with index.html. */
export const WEBSITE = /^\/(?:$|pricing|security|product|solutions|terms|privacy|cookies|dpa)(?:\/|$)/
let onWebsite = typeof window !== 'undefined' && WEBSITE.test(window.location.pathname)

export function getThemeChoice(): ThemeChoice {
  const v = read(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
}

/** The colour theme showing in the app. */
export function getThemeId(): string {
  const v = read(ID_KEY)
  return isTheme(v) ? v : DEFAULT_THEME
}

/** Light or dark, as it shows: a dark-only theme is always dark (on the website, the mode alone decides). */
export function resolveTheme(choice: ThemeChoice = getThemeChoice()): Theme {
  if (!onWebsite && DARK_ONLY.has(getThemeId())) return 'dark'
  if (choice === 'system') return media()?.matches ? 'dark' : 'light'
  return choice
}

function apply(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  // The colour theme and brand colour, in the app only.
  root.setAttribute('data-theme', onWebsite ? DEFAULT_THEME : getThemeId())
  const css = onWebsite ? '' : read(BRAND_KEY) ?? ''
  let tag = document.getElementById('pt-brand') as HTMLStyleElement | null
  if (css) {
    if (!tag) { tag = document.createElement('style'); tag.id = 'pt-brand'; document.head.appendChild(tag) }
    if (tag.textContent !== css) tag.textContent = css
    root.setAttribute('data-brand', '')
  } else {
    tag?.remove()
    root.removeAttribute('data-brand')
  }
  // The phone's address bar takes the page colour.
  const meta = document.querySelector('meta[name="theme-color"]')
  const body = getComputedStyle(root).getPropertyValue('--color-background-body').trim()
  if (meta) meta.setAttribute('content', body || (theme === 'dark' ? '#0E0F11' : '#FAFAFB'))
}

const changed = () => { apply(resolveTheme()); window.dispatchEvent(new Event(EVENT)) }

export function setThemeChoice(choice: ThemeChoice): void {
  write(KEY, choice)
  changed()
}

/**
 * The colour theme and brand colour that apply to this person: their own pick, else the company's, else Metriq's.
 * Called whenever the signed-in person loads or changes (lib/auth), and right away when they pick (Settings).
 */
export function applyAppearance(a: { own?: string | null; company?: string | null; brand?: string | null }): void {
  const id = isTheme(a.own) ? a.own : isTheme(a.company) ? a.company : DEFAULT_THEME
  write(ID_KEY, id)
  write(DARK_KEY, DARK_ONLY.has(id) ? '1' : null)
  const css = brandCss(a.brand, themeById(id))
  write(BRAND_KEY, css || null)
  changed()
}

/** The website and the app look different (main.tsx calls this on every page change). */
export function setOnWebsite(website: boolean): void {
  if (website === onWebsite) return
  onWebsite = website
  changed()
}

/** Call once at start: applies what is kept on this device and follows the computer when set to system. */
export function initTheme(): void {
  apply(resolveTheme())
  media()?.addEventListener?.('change', () => {
    if (getThemeChoice() === 'system') changed()
  })
}

/** The current mode choice, what shows, and the colour theme; re-renders when any of them changes. */
export function useTheme(): { choice: ThemeChoice; theme: Theme; themeId: string; setChoice: (c: ThemeChoice) => void } {
  const now = () => ({ choice: getThemeChoice(), theme: resolveTheme(), themeId: getThemeId() })
  const [state, setState] = useState(now)
  useEffect(() => {
    const on = () => setState(now())
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
