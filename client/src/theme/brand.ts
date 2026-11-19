import { channels, contrast, hex, mix, onColor, readable, rgb, type RGB } from './color'
import { resolveMode } from './build'
import type { ThemeDef } from './roles'

/**
 * A company's own brand colour, in place of the theme's accent (buttons, links, focus, selection). The rest of the
 * accent family is worked out from it for the theme it sits in, light and dark, with the same rules as every theme:
 * text on the buttons reads (4.5:1), and the colour as text reads on cards.
 *
 * The result is CSS for <html data-brand>, kept on this device so the next page load paints in it straight away.
 */

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

function accentFamily(brand: RGB, card: RGB, mode: 'light' | 'dark'): Record<string, RGB> {
  // White text on the brand colour if it can be made to read with a small shift; otherwise the dark text.
  let accent = brand
  let on = onColor(brand)
  if (on[0] === 255 && contrast(accent, on) < 4.5) accent = readable(accent, on, 4.5)
  if (contrast(accent, on) < 4.5) { on = onColor(accent) }
  const subtle = mix(card, accent, mode === 'light' ? 0.06 : 0.12)
  const muted = mix(card, accent, mode === 'light' ? 0.12 : 0.2)
  let text = accent
  for (const bg of [card, subtle, card]) if (contrast(text, bg) < 4.5) text = readable(text, bg, 4.5)
  // The hover and pressed colour: a step deeper (lighter on dark pages), still under readable button text.
  let strong = mix(accent, mode === 'light' ? BLACK : WHITE, 0.14)
  if (contrast(strong, on) < 4.5) strong = readable(strong, on, 4.5)
  return {
    accent,
    'accent-strong': strong,
    'accent-subtle': subtle,
    'accent-muted': muted,
    'text-accent': text,
    'on-accent': on,
  }
}

/** The names each role is written under (theme.css writes the same three). */
const OLD: Record<string, string> = { accent: 'primary', 'accent-strong': 'primary-700', 'accent-subtle': 'primary-50', 'accent-muted': 'primary-100' }

function declarations(fam: Record<string, RGB>): string {
  const lines: string[] = []
  for (const [role, c] of Object.entries(fam)) {
    lines.push(`--c-${role}: ${channels(c)};`, `--color-${role}: ${rgb(c)};`)
    if (OLD[role]) lines.push(`--${OLD[role]}: ${channels(c)};`)
  }
  return lines.join(' ')
}

/** The accent roles a brand colour gives in a theme, per mode (null: not a colour). theme-check proves they read. */
export function brandRoles(color: string | null | undefined, theme: ThemeDef): { light: Record<string, RGB>; dark: Record<string, RGB> | null; card: { light: RGB; dark: RGB | null } } | null {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return null
  const brand = hex(color)
  const lightCard = new Map(resolveMode(theme.light, 'light').map((t) => [t.name, t.value])).get('background-card')!
  const darkCard = theme.dark ? new Map(resolveMode(theme.dark, 'dark').map((t) => [t.name, t.value])).get('background-card')! : null
  return {
    light: accentFamily(brand, lightCard, theme.darkOnly ? 'dark' : 'light'),
    dark: darkCard ? accentFamily(brand, darkCard, 'dark') : null,
    card: { light: lightCard, dark: darkCard },
  }
}

/** CSS for a brand colour in a theme, or '' when there is none (or it is not a colour). */
export function brandCss(color: string | null | undefined, theme: ThemeDef): string {
  const r = brandRoles(color, theme)
  if (!r) return ''
  const css = [`html[data-brand]:not(.dark) { ${declarations(r.light)} }`]
  if (r.dark) css.push(`html[data-brand].dark { ${declarations(r.dark)} }`)
  return css.join('\n')
}
