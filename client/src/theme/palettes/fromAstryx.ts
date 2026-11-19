import { contrast, hex, mix, onColor, type RGB } from '../color'
import { HUES, NEUTRAL_STEPS, STATUSES, type Hue, type HueRamp, type ModeColors, type NeutralStep, type ThemeDef } from '../roles'
import { ASTRYX, type AstryxColors } from './astryx.generated'

/**
 * An Astryx theme (palettes/astryx.generated.ts) as a Metriq theme. Astryx names map onto Metriq's roles; colours
 * Astryx gives with transparency are laid over the card (the page's colours are solid); what Astryx has no name for
 * (the sidebar, the grey scale the screens use as slate-*) is worked out from the theme's own colours, so it carries
 * the theme's tint.
 */

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

/** "#rrggbb" or "#rrggbbaa" (laid over `under`). */
function solid(v: string | undefined, under: RGB): RGB | undefined {
  if (!v) return undefined
  const c = hex(v.slice(0, 7))
  if (v.length === 9) return mix(under, c, parseInt(v.slice(7, 9), 16) / 255)
  return c
}

/**
 * How far from the card toward the text each grey step sits. Measured on Metriq's own greys, so a theme's slate-500
 * plays the part Metriq's does (secondary text, icons), whatever the theme's colours.
 */
const GREY_LIGHT: Record<NeutralStep, number> = { 50: 0.035, 100: 0.066, 200: 0.118, 300: 0.197, 400: 0.4, 500: 0.636, 600: 0.76, 700: 0.85, 800: 0.947, 900: 1, 950: 1 }
const GREY_DARK: Record<NeutralStep, number> = { 50: 0.025, 100: 0.05, 200: 0.1, 300: 0.18, 400: 0.33, 500: 0.55, 600: 0.69, 700: 0.84, 800: 0.95, 900: 1, 950: 1 }

function mode(c: AstryxColors, m: 'light' | 'dark'): ModeColors {
  const card = solid(c['background-card'], WHITE)!
  const body = solid(c['background-body'], card)!
  const get = (k: string, under: RGB = card): RGB => {
    const v = solid(c[k], under)
    if (!v) throw new Error(`Astryx colour ${k} is missing`)
    return v
  }
  const text = get('text-primary')
  const dark = m === 'dark'
  const greys = dark ? GREY_DARK : GREY_LIGHT
  const neutral = Object.fromEntries(NEUTRAL_STEPS.map((s) => [s, mix(card, text, greys[s])])) as Record<NeutralStep, RGB>
  // The far end of the scale goes a little past the text colour (Metriq's 950 is darker than its text in light).
  neutral[950] = mix(text, dark ? WHITE : BLACK, 0.35)
  // The sidebar sits a shade apart from the page, as in Metriq: not the same colour, and not a loud one either (Matcha
  // dark's muted background is a bright olive, 1.9:1 against its page). Otherwise a quiet shade of the page.
  const surface = solid(c['background-muted'] ?? c['background-surface'], card)!
  const apart = contrast(surface, body)
  const sidebar = apart < 1.03 || apart > 1.5 ? mix(body, text, dark ? 0.05 : 0.025) : surface
  const accent = get('accent')
  const accentMuted = get('accent-muted')

  // A hue: Astryx's pale background, border, text and icon colours. An icon colour too close to the card falls back
  // to the hue's text colour (Butter's dark blue icon is dark navy on a dark card).
  const hueRoles = (h: Hue) => {
    const ink = get(`text-${h}`)
    let vivid = get(`icon-${h}`)
    if (contrast(vivid, card) < 2) vivid = ink
    const subtle = get(`background-${h}`)
    return { subtle, muted: mix(subtle, vivid, 0.14), ring: get(`border-${h}`), vivid, ink, on: onColor(vivid) }
  }
  const derived: Record<string, RGB> = {}
  const hues = {} as Record<Hue, HueRamp>
  for (const h of HUES) {
    const r = hueRoles(h)
    // Pinned below; the ramp only satisfies the type.
    hues[h] = { 50: r.subtle, 100: r.muted, 200: r.ring, 300: r.ink, 400: r.vivid, 500: r.vivid, 700: r.ink }
    Object.assign(derived, { [`${h}-subtle`]: r.subtle, [`${h}-muted`]: r.muted, [`${h}-ring`]: r.ring, [`${h}-vivid`]: r.vivid, [`text-${h}`]: r.ink, [`on-${h}`]: r.on })
  }
  // Statuses as Astryx has them; the second brand colour ("highlight") is the theme's teal.
  for (const s of STATUSES) {
    if (s === 'highlight') {
      Object.assign(derived, { 'highlight-muted': derived['teal-muted'], 'text-highlight': derived['text-teal'], 'on-highlight': derived['on-teal'] })
      continue
    }
    Object.assign(derived, { [`${s}-muted`]: get(`${s}-muted`), [`text-${s}`]: get(`text-${s}`), [`on-${s}`]: get(`on-${s}`, get(s)) })
  }
  derived['text-accent'] = get('text-accent')
  derived['on-accent'] = get('on-accent', accent)

  return {
    base: {
      'background-body': body,
      'background-card': card,
      'background-sidebar': sidebar,
      'text-primary': text,
      'text-secondary': get('text-secondary'),
      // Hints and placeholders: between secondary text and the card (Astryx's "disabled" is fainter than a hint).
      'text-faint': mix(get('text-secondary'), card, 0.32),
      border: get('border'),
      'border-emphasized': get('border-emphasized'),
      accent,
      'accent-strong': mix(accent, dark ? WHITE : BLACK, 0.14),
      'accent-subtle': mix(card, accentMuted, 0.55),
      'accent-muted': accentMuted,
      highlight: derived['teal-vivid'],
      success: get('success'),
      warning: get('warning'),
      error: get('error'),
      info: get('info'),
      shadow: dark ? BLACK : mix(text, BLACK, 0.5),
    },
    neutral,
    // Chart series: the theme's own hues, in an order that keeps neighbours apart.
    chart: (['blue', 'teal', 'orange', 'pink', 'purple', 'green'] as Hue[]).map((h) => derived[`${h}-vivid`]),
    hues,
    derived,
  }
}

export function fromAstryx(id: string, label: string, description: string): ThemeDef {
  const src = ASTRYX[id]
  if (!src) throw new Error(`No Astryx theme called ${id}`)
  return {
    id,
    label,
    description,
    // A dark-only theme (Gothic) uses its dark colours in light mode too.
    darkOnly: !src.light,
    light: mode(src.light ?? src.dark, src.light ? 'light' : 'dark'),
    dark: mode(src.dark, 'dark'),
  }
}
