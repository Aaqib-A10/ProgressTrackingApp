import type { RGB } from './color'

/**
 * The colour roles of Metriq: what a colour is FOR, not what it looks like. Every screen uses roles; a theme gives
 * each role a colour, in light and in dark. The names follow Meta's Astryx design system (MIT), so Astryx components
 * added later read the same theme with no extra work.
 *
 * Each role becomes three CSS variables (src/theme/theme.css, made by `npm run theme:build`):
 *   --c-<role>      "r g b" channels, for Tailwind (bg-success/10 needs channels)
 *   --color-<role>  rgb(...), the Astryx name, for plain CSS and Astryx components
 *   --<old name>    the name the app used before themes (--bg, --ink, --slate-500...), kept so nothing changes
 */

/** Roles a theme sets by hand, light and dark. */
export const BASE_ROLES = {
  'background-body': { old: 'bg', is: 'The app canvas behind everything' },
  'background-card': { old: 'card', is: 'Cards, panels, menus, windows' },
  'background-sidebar': { old: 'sidebar', is: 'The navigation rail' },
  'text-primary': { old: 'ink', is: 'Main text' },
  'text-secondary': { old: 'ink-muted', is: 'Secondary text, labels' },
  'text-faint': { old: 'ink-faint', is: 'Hints, placeholders, icons at rest' },
  border: { old: 'line', is: 'Borders and dividers' },
  'border-emphasized': { old: 'line-strong', is: 'Borders that must stand out (inputs, hover)' },
  accent: { old: 'primary', is: 'Main actions, focus, selection' },
  'accent-strong': { old: 'primary-700', is: 'Main actions when hovered or pressed' },
  'accent-subtle': { old: 'primary-50', is: 'The palest tint of the accent (selected rows)' },
  'accent-muted': { old: 'primary-100', is: 'A pale tint of the accent (chips, active menu item)' },
  // Not "secondary": text-secondary is already the grey secondary text, and the readable text of this colour would
  // have taken the same name.
  highlight: { old: 'accent', is: 'The second brand colour (teal in Metriq)' },
  success: { old: 'success', is: 'Done, on target, healthy' },
  warning: { old: 'warning', is: 'Needs attention soon' },
  error: { old: 'danger', is: 'Failed, overdue, destructive' },
  info: { old: null, is: 'Neutral news, links to more' },
  shadow: { old: 'shadow', is: 'The colour shadows are made of' },
} as const

export type BaseRole = keyof typeof BASE_ROLES

/** The grey scale every theme has (Tailwind's slate-* classes read it). */
export const NEUTRAL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
export type NeutralStep = (typeof NEUTRAL_STEPS)[number]

/** Chart series colours, in order. */
export const CHART_STEPS = [1, 2, 3, 4, 5, 6] as const

/** The status colours: each gets a pale surface (-muted), a colour for text on that surface and on cards (text-), and the text colour on a solid fill (on-). */
export const STATUSES = ['success', 'warning', 'error', 'info', 'highlight'] as const
export type Status = (typeof STATUSES)[number]

/**
 * Named colours for things that are told apart by colour but are not a status: tags, categories, a feature's own
 * colour (the review flow is orange, Claude's notes are purple), note types. Each hue gives six roles:
 *   <hue>-subtle (palest fill)  <hue>-muted (tint)  <hue>-ring (border)  <hue>-vivid (solid, icons, dots)
 *   text-<hue> (text on cards and on the tints)     on-<hue> (text on the solid colour)
 * Astryx has the same idea (--color-blue-subtle, -ring, -vivid).
 */
export const HUES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const
export type Hue = (typeof HUES)[number]
/** A hue as a short ramp, light (50) to dark (700), like Tailwind's. The roles are taken from it per mode. */
export type HueRamp = Record<50 | 100 | 200 | 300 | 400 | 500 | 700, RGB>

/** What a theme writes for one mode. Derived roles (muted surfaces, readable text, text on fills) are worked out from these unless the theme sets them. */
export interface ModeColors {
  base: Record<BaseRole, RGB>
  neutral: Record<NeutralStep, RGB>
  chart: RGB[]
  hues: Record<Hue, HueRamp>
  /** Optional hand-picked values for derived roles, by role name (e.g. 'success-muted'). */
  derived?: Partial<Record<string, RGB>>
}

export interface ThemeDef {
  id: string
  label: string
  /** One line for the picker. */
  description: string
  light: ModeColors
  /** Absent for a theme that has no dark version. */
  dark?: ModeColors
  /** A theme drawn in dark colours only (Gothic): it turns dark mode on whatever the light/dark setting says. */
  darkOnly?: boolean
}
