/**
 * Colour maths for the theme system: no browser, no DOM, so the build script, the checks and (later) a company's
 * own brand colour all use the same code. Colours are [r, g, b] channels 0..255, as the CSS variables hold them.
 */

export type RGB = readonly [number, number, number]

export function hex(h: string): RGB {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const channels = (c: RGB): string => `${c[0]} ${c[1]} ${c[2]}`
export const rgb = (c: RGB): string => `rgb(${channels(c)})`

/** Relative luminance (WCAG 2). */
export function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colours, 1 to 21 (WCAG 2). 4.5 is the minimum for body text, 3 for large text and icons. */
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** `t` of the way from a to b (0 = a, 1 = b), rounded to whole channels. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as RGB
}

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

/** White or near-black text on a filled colour, whichever reads better. */
export function onColor(fill: RGB, dark: RGB = [17, 17, 19]): RGB {
  return contrast(fill, WHITE) >= contrast(fill, dark) ? WHITE : dark
}

/**
 * The colour itself, darkened (on a light page) or lightened (on a dark page) in small steps until it reads as text
 * on `bg` with at least `min` contrast. A colour that already reads is returned as it is.
 */
export function readable(c: RGB, bg: RGB, min = 4.5): RGB {
  const toward = luminance(bg) > 0.4 ? BLACK : WHITE
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const x = mix(c, toward, t)
    if (contrast(x, bg) >= min) return x
  }
  return toward
}
