import { channels, contrast, mix, onColor, readable, rgb, type RGB } from './color'
import { BASE_ROLES, CHART_STEPS, HUES, NEUTRAL_STEPS, STATUSES, type BaseRole, type ModeColors, type ThemeDef } from './roles'

/**
 * A theme definition -> CSS. Pure (no file system, no DOM): `npm run theme:build` writes the result to theme.css,
 * the checks read it, and a company's own brand colour can use it in the browser later.
 */

export interface Token {
  /** The role name: --c-<name> and --color-<name>. */
  name: string
  value: RGB
  /** The name the app used before themes (--<old>), if any. */
  old?: string
}

/** Every role of one mode, the derived ones worked out: what a theme means in that mode. */
export function resolveMode(m: ModeColors, mode: 'light' | 'dark'): Token[] {
  const b = m.base
  const set = (name: string, auto: RGB): RGB => m.derived?.[name] ?? auto
  const out: Token[] = []
  for (const role of Object.keys(BASE_ROLES) as BaseRole[]) out.push({ name: role, value: b[role], old: BASE_ROLES[role].old ?? undefined })
  for (const s of NEUTRAL_STEPS) out.push({ name: `neutral-${s}`, value: m.neutral[s], old: `slate-${s}` })
  CHART_STEPS.forEach((n, i) => out.push({ name: `chart-${n}`, value: m.chart[i % m.chart.length] }))
  // Status colours: a pale surface, text that reads on it (and on cards), and text on the solid colour.
  const card = b['background-card']
  for (const s of STATUSES) {
    const fill = b[s]
    const muted = set(`${s}-muted`, mix(card, fill, mode === 'light' ? 0.12 : 0.18))
    out.push({ name: `${s}-muted`, value: muted })
    out.push({ name: `text-${s}`, value: set(`text-${s}`, readable(fill, muted)) })
    out.push({ name: `on-${s}`, value: set(`on-${s}`, onColor(fill)) })
  }
  // Named hues. Light: the ramp's own steps. Dark: soft tints of the bright step over the card, and the light step as text.
  for (const h of HUES) {
    const r = m.hues[h]
    const dark = mode === 'dark'
    const subtle = set(`${h}-subtle`, dark ? mix(card, r[400], 0.1) : r[50])
    const muted = set(`${h}-muted`, dark ? mix(card, r[400], 0.16) : r[100])
    out.push({ name: `${h}-subtle`, value: subtle })
    out.push({ name: `${h}-muted`, value: muted })
    out.push({ name: `${h}-ring`, value: set(`${h}-ring`, dark ? mix(card, r[400], 0.32) : r[200]) })
    out.push({ name: `${h}-vivid`, value: set(`${h}-vivid`, r[500]) })
    out.push({ name: `text-${h}`, value: set(`text-${h}`, readable(dark ? r[300] : r[700], muted)) })
    out.push({ name: `on-${h}`, value: set(`on-${h}`, onColor(r[500])) })
  }
  out.push({ name: 'text-accent', value: set('text-accent', readable(b.accent, b['accent-subtle'])) })
  out.push({ name: 'on-accent', value: set('on-accent', onColor(b.accent)) })
  readablePass(out, mode)
  // Two roles must never write the same variable (the later one would silently replace the first).
  const seen = new Set<string>()
  for (const t of out) { if (seen.has(t.name)) throw new Error(`Two colour roles are both called "${t.name}"`); seen.add(t.name) }
  const olds = out.filter((t) => t.old).map((t) => t.old!)
  if (new Set(olds).size !== olds.length) throw new Error('Two colour roles map to the same old variable name')
  return out
}

/**
 * The last word on every theme: text that must be read is made readable (WCAG AA), whatever the theme's own values.
 *  - A pale surface (a status's -muted, a hue's -subtle/-muted/-ring) that is not pale next to the card is made again
 *    as a soft tint of the card (some themes' "pale" colours are meant for a different page colour).
 *  - Text colours move toward black (light pages) or white (dark pages) until they reach 4.5:1 on every surface they
 *    sit on (hints: 3:1).
 *  - A solid colour (the accent, a status, a hue's -vivid) moves away from its text colour until that text reads, so
 *    a button keeps the text colour the theme chose.
 * A colour that already reads is left exactly as it is.
 */
function readablePass(out: Token[], mode: 'light' | 'dark'): void {
  const t = new Map(out.map((x) => [x.name, x]))
  const v = (n: string): RGB => t.get(n)!.value
  const put = (n: string, c: RGB) => { t.get(n)!.value = c }
  const card = v('background-card')
  const body = v('background-body')
  /** Readable on every one of these surfaces (a second round settles a change made for the first). */
  const onAll = (c: RGB, bgs: RGB[], min: number): RGB => {
    let x = c
    for (let round = 0; round < 3; round++) for (const bg of bgs) if (contrast(x, bg) < min) x = readable(x, bg, min)
    return x
  }
  const pale = (n: string, solid: RGB, share: number) => { if (contrast(v(n), card) > 1.6) put(n, mix(card, solid, share)) }
  const solidFor = (solidName: string, onName: string) => { if (contrast(v(solidName), v(onName)) < 4.5) put(solidName, readable(v(solidName), v(onName), 4.5)) }

  put('text-secondary', onAll(v('text-secondary'), [card, body], 4.5))
  put('text-faint', onAll(v('text-faint'), [card], 3))
  solidFor('accent', 'on-accent')
  solidFor('accent-strong', 'on-accent') // the button's hover and pressed colour
  put('text-accent', onAll(v('text-accent'), [card, v('accent-subtle')], 4.5))
  for (const s of STATUSES) {
    pale(`${s}-muted`, v(s), mode === 'light' ? 0.12 : 0.18)
    solidFor(s, `on-${s}`)
    put(`text-${s}`, onAll(v(`text-${s}`), [v(`${s}-muted`), card], 4.5))
  }
  for (const h of HUES) {
    const vivid = v(`${h}-vivid`)
    pale(`${h}-subtle`, vivid, mode === 'light' ? 0.08 : 0.1)
    pale(`${h}-muted`, vivid, mode === 'light' ? 0.16 : 0.16)
    pale(`${h}-ring`, vivid, mode === 'light' ? 0.32 : 0.32)
    // An icon must at least be seen on the card.
    if (contrast(vivid, card) < 2) put(`${h}-vivid`, readable(vivid, card, 2))
    solidFor(`${h}-vivid`, `on-${h}`)
    put(`text-${h}`, onAll(v(`text-${h}`), [v(`${h}-muted`), v(`${h}-subtle`), card], 4.5))
  }
}

function block(selector: string, tokens: Token[], scheme?: 'light' | 'dark'): string {
  const lines = [`${selector} {`]
  if (scheme) lines.push(`  color-scheme: ${scheme};`)
  for (const t of tokens) lines.push(`  --c-${t.name}: ${channels(t.value)};`)
  const old = tokens.filter((t) => t.old)
  if (old.length) {
    lines.push('  /* The names used before themes: kept, so every screen reads the same colours. */')
    for (const t of old) lines.push(`  --${t.old}: ${channels(t.value)};`)
  }
  lines.push('  /* Astryx role names (full colours), for plain CSS and Astryx components. */')
  for (const t of tokens) lines.push(`  --color-${t.name}: ${rgb(t.value)};`)
  lines.push('}')
  return lines.join('\n')
}

const neutralsOnly = (tokens: Token[]) => tokens.filter((t) => t.name.startsWith('neutral-'))

/**
 * The whole stylesheet. The default theme sits on :root and .dark (no attribute needed); any other theme on
 * [data-theme="id"]. Inside every theme: .force-light (the public pages, light only) and .keep-palette (the call
 * window and photo viewer, dark by design, keep the light greys).
 */
export function themeCss(themes: ThemeDef[], defaultId: string): string {
  const parts = ['/* Made by `npm run theme:build` from src/theme (roles.ts, themes/). Do not edit by hand: edit the theme and build. */']
  const ordered = [...themes].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0))
  for (const t of ordered) {
    const isDefault = t.id === defaultId
    // The page carries data-theme (on <html>); a preview of a theme anywhere on a page carries it too (Settings).
    const at = `[data-theme="${t.id}"]`
    const light = resolveMode(t.light, 'light')
    const dark = t.dark ? resolveMode(t.dark, 'dark') : null
    parts.push(`\n/* ---- ${t.label}${isDefault ? ' (default)' : ''} ---- */`)
    parts.push(block(isDefault ? `:root, ${at}` : at, light, t.darkOnly ? 'dark' : 'light'))
    if (dark) parts.push(block(isDefault ? `.dark, ${at}.dark, .dark ${at}` : `${at}.dark, .dark ${at}`, dark, 'dark'))
    if (isDefault) parts.push(block(`.force-light, ${at} .force-light`, light, 'light'))
    parts.push(block(isDefault ? `.keep-palette, ${at} .keep-palette` : `${at} .keep-palette`, neutralsOnly(light)))
  }
  return `${parts.join('\n')}\n`
}
