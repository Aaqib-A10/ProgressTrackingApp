import type { CSSProperties } from 'react'
import type { Hue } from './roles'

/**
 * Theme colours for inline styles (style={{...}}), charts and SVG: the same CSS variables the classes use, so they
 * follow the theme and dark mode too. Never write a hex colour in a screen for something the theme decides.
 */

/** A role of the theme as a CSS colour: role('accent'), role('green-vivid', 0.12). */
export const role = (r: string, alpha?: number): string => (alpha == null ? `rgb(var(--c-${r}))` : `rgb(var(--c-${r}) / ${alpha})`)

export type Tone = Hue | 'accent' | 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'highlight'

/** A tone's colours: the solid colour, a soft tint of it, text in it that reads on cards and tints, and text on the solid. */
export function tone(t: Tone): { solid: string; tint: string; ink: string; on: string } {
  if (t === 'neutral') return { solid: role('neutral-500'), tint: role('neutral-400', 0.15), ink: role('text-secondary'), on: role('background-body') }
  if (t === 'accent') return { solid: role('accent'), tint: role('accent', 0.1), ink: role('text-accent'), on: role('on-accent') }
  const solid = ['success', 'warning', 'error', 'info', 'highlight'].includes(t) ? t : `${t}-vivid`
  return { solid: role(solid), tint: role(solid, 0.12), ink: role(`text-${t}`), on: role(`on-${t}`) }
}

/**
 * A colour that comes from the data (a custom block, a pipeline stage, a project, a sidebar section), shown as a soft
 * tint with text in that colour. The text is blended toward the theme's own text colour, so a dark colour still reads
 * on a dark page and a pale one on a white page, whatever colour someone picked.
 */
export function dataTint(color: string, alpha = 0.12): CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`,
    color: `color-mix(in srgb, ${color} 62%, rgb(var(--c-text-primary)))`,
  }
}
