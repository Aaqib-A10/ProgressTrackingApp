import type { ThemeDef } from '../roles'
import { fromAstryx } from '../palettes/fromAstryx'
import { metriq } from './metriq'

/**
 * Every theme the app offers. The first is the default (no attribute on the page needed). The others are Meta's
 * Astryx themes (MIT), turned into Metriq themes by palettes/fromAstryx.ts. Astryx's y2k theme is left out: too
 * playful for a work tool.
 */
export const THEMES: ThemeDef[] = [
  metriq,
  fromAstryx('neutral', 'Neutral', 'Black and white, nothing else. Quiet and sharp.'),
  fromAstryx('stone', 'Stone', 'Cool greys with a hint of blue. Calm and serious.'),
  fromAstryx('matcha', 'Matcha', 'Soft olive greens, like matcha tea. Earthy and easy on the eyes.'),
  fromAstryx('chocolate', 'Chocolate', 'Warm browns and cream. Cosy, like paper.'),
  fromAstryx('butter', 'Butter', 'Creamy yellow with a bright blue. Friendly and light.'),
  fromAstryx('gothic', 'Gothic', 'Deep blue-black, dark only. For late shifts.'),
]
export const DEFAULT_THEME = metriq.id
/** Themes that have no light version: picking one shows dark mode whatever the light/dark setting says. */
export const DARK_ONLY = new Set(THEMES.filter((t) => t.darkOnly).map((t) => t.id))
export const themeById = (id: string | null | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0]
