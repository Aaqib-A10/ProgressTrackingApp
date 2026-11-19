import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { themeCss, resolveMode, type Token } from '../src/theme/build'
import { contrast, type RGB } from '../src/theme/color'
import { HUES, STATUSES } from '../src/theme/roles'
import { DEFAULT_THEME, THEMES } from '../src/theme/themes'
import { brandRoles } from '../src/theme/brand'

/**
 *   npm run theme:check -w client                       theme.css is up to date, and every pair of colours that must
 *                                                       read does (WCAG AA): a gap fails the check
 *   npm run theme:check -w client -- --against <rev>    and every colour variable of <rev>'s index.css still has the
 *                                                       same value in the same place (proves "nothing changed")
 *   npm run theme:check -w client -- --report           list contrast gaps without failing (while working on a theme)
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const problems: string[] = []
const warnings: string[] = []

// ------------------------------------------------------------------ 1. theme.css is what the themes make
const file = path.resolve(here, '../src/theme/theme.css')
const made = themeCss(THEMES, DEFAULT_THEME)
const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : ''
if (onDisk !== made) problems.push('src/theme/theme.css is out of date: run `npm run theme:build -w client`.')
else console.log(`theme.css is up to date (${THEMES.length} theme${THEMES.length === 1 ? '' : 's'}).`)

// ------------------------------------------------------------------ 2. against an older index.css
type Scope = Map<string, string>
const blocks = (css: string): Map<string, Scope> => {
  const out = new Map<string, Scope>()
  for (const m of css.matchAll(/^([^\s{}][^{}]*?)\s*\{([^{}]*)\}/gm)) {
    // A comment above a block is caught with it: the selector is its last line.
    const sel = m[1].split('\n').pop()!.trim()
    if (/^(:root|\.dark|\.force-light|\.keep-palette)$/.test(sel)) {
      const vars = out.get(sel) ?? new Map<string, string>()
      for (const v of m[2].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars.set(v[1], v[2].trim().replace(/\s+/g, ' '))
      out.set(sel, vars)
    }
  }
  return out
}
const rev = opt('--against')
if (rev) {
  const before = blocks(execSync(`git show ${rev}:client/src/index.css`, { cwd: path.resolve(here, '../..') }).toString())
  const after = blocks(made)
  const root = before.get(':root') ?? new Map()
  let compared = 0
  for (const [sel, vars] of before) {
    // .dark used to inherit what it did not set from :root: those count too.
    const expected = new Map<string, string>(sel === '.dark' ? [...root, ...vars] : vars)
    for (const [name, value] of expected) {
      if (/^(fs|lh)-/.test(name)) continue // the type scale stays in index.css
      compared++
      const now = after.get(sel)?.get(name)
      if (now === undefined) problems.push(`${sel} --${name}: was "${value}", now not set`)
      else if (now !== value) problems.push(`${sel} --${name}: was "${value}", now "${now}"`)
    }
  }
  console.log(`Compared ${compared} colour variables of ${rev}'s index.css (${[...before.keys()].join(', ')}) with theme.css.`)
}

// ------------------------------------------------------------------ 3. contrast, every theme and mode
const report: string[] = []
for (const t of THEMES) {
  for (const mode of ['light', 'dark'] as const) {
    const m = mode === 'light' ? t.light : t.dark
    if (!m) continue
    const tok = new Map(resolveMode(m, mode).map((x: Token) => [x.name, x.value]))
    const c = (n: string): RGB => tok.get(n)!
    const pairs: [string, string, number][] = [
      ['text-primary', 'background-body', 4.5], ['text-primary', 'background-card', 4.5],
      ['text-secondary', 'background-body', 4.5], ['text-secondary', 'background-card', 4.5],
      ['text-faint', 'background-card', 3],
      ['text-accent', 'background-card', 4.5], ['on-accent', 'accent', 4.5], ['on-accent', 'accent-strong', 4.5],
      ...STATUSES.flatMap((s) => [[`text-${s}`, `${s}-muted`, 4.5], [`text-${s}`, 'background-card', 4.5], [`on-${s}`, s, 4.5]] as [string, string, number][]),
      ...HUES.flatMap((h) => [[`text-${h}`, `${h}-muted`, 4.5], [`text-${h}`, `${h}-subtle`, 4.5], [`text-${h}`, 'background-card', 4.5], [`on-${h}`, `${h}-vivid`, 4.5]] as [string, string, number][]),
    ]
    let ok = 0
    for (const [fg, bg, min] of pairs) {
      const r = contrast(c(fg), c(bg))
      if (r >= min) { ok++; continue }
      warnings.push(`${t.id} ${mode}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (needs ${min}:1)`)
    }
    report.push(`  ${t.id.padEnd(10)} ${mode.padEnd(5)} ${ok} of ${pairs.length} pairs read well`)
  }
}
// A company's brand colour in place of the accent: buttons (and their hover) and links read in every theme, for
// colours that are hard to get right (pale, dark, loud, grey).
const BRAND_SAMPLES = ['#4f46e5', '#ffeb3b', '#00e5ff', '#ffffff', '#000000', '#808080', '#e11d48', '#16a34a', '#7c2d12', '#f97316']
let brandPairs = 0
for (const t of THEMES) {
  for (const color of BRAND_SAMPLES) {
    const r = brandRoles(color, t)!
    for (const [mode, fam, card] of [['light', r.light, r.card.light], ['dark', r.dark, r.card.dark]] as const) {
      if (!fam || !card) continue
      const pairs: [string, RGB, RGB][] = [['on-accent on accent', fam['on-accent'], fam.accent], ['on-accent on accent-strong', fam['on-accent'], fam['accent-strong']], ['text-accent on card', fam['text-accent'], card], ['text-accent on accent-subtle', fam['text-accent'], fam['accent-subtle']]]
      for (const [what, fg, bg] of pairs) {
        brandPairs++
        const x = contrast(fg, bg)
        if (x < 4.5) warnings.push(`brand ${color} in ${t.id} ${mode}: ${what} is ${x.toFixed(2)}:1 (needs 4.5:1)`)
      }
    }
  }
}
report.push(`  brand colours: ${BRAND_SAMPLES.length} samples x ${THEMES.length} themes, ${brandPairs} pairs checked`)
console.log(`Contrast (WCAG AA):\n${report.join('\n')}`)
if (warnings.length) console.log(`${flag('--report') ? 'To fix (--report: not failing)' : 'Fails'}:\n${warnings.map((w) => `  - ${w}`).join('\n')}`)
if (!flag('--report')) problems.push(...warnings)

if (problems.length) { console.log(`\nNOT OK (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`); process.exit(1) }
console.log('\nOK')
