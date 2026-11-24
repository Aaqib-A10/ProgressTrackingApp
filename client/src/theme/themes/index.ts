import type { ThemeDef } from '../roles'
import { metriq } from './metriq'

/**
 * The app's one look, in light and dark (the mode is picked in Settings). Six more colour themes were offered until
 * 24 Nov 2026 and were taken out: one look, done well, everywhere.
 */
export const THEMES: ThemeDef[] = [metriq]
export const DEFAULT_THEME = metriq.id
/** Themes that have no light version: picking one shows dark mode whatever the light/dark setting says. */
export const DARK_ONLY = new Set(THEMES.filter((t) => t.darkOnly).map((t) => t.id))
export const themeById = (id: string | null | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0]
