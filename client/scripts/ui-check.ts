import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 *   npm run ui:check -w client
 *
 * Every colour a screen shows comes from the theme (src/theme). This fails on anything that would look the same in
 * every theme, or break in dark mode:
 *   - Tailwind's numbered colours (bg-orange-50, text-sky-700): use a role (bg-orange-subtle, text-blue-ink,
 *     bg-warning-muted, text-success-ink). The grey slate-* scale is fine: it is the theme's neutral scale.
 *   - a hex or rgb() colour in a screen (#4F46E5, rgba(34,197,94,.16)): use role()/tone()/dataTint() from
 *     src/theme/css.ts, or CHART from components/charts/chartTheme.ts for charts.
 *   - white text on the accent or a status colour (bg-primary text-white): use text-primary-on, text-success-on...,
 *     so a theme with a light accent still has readable buttons.
 * The exceptions are listed below, each with its reason.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../src')

/** Files left out entirely, and why. */
const SKIP: Record<string, string> = {
  'theme/': 'the theme itself',
  'pages/marketing/': 'the public website: its own light-only design',
  'pages/Landing.tsx': 'the public website: its own light-only design',
  'pages/owner/': "the platform owner's console, not a company's app",
  'components/calls/CallWindow.tsx': 'the call window is dark by design (video), in every theme',
  'components/ui/MediaViewer.tsx': 'the photo viewer is dark by design, in every theme',
  'pages/GuestJoin.tsx': 'the page a guest sees before joining a call: dark by design',
  'components/metra/MetraMark.tsx': "Metra's logo",
  'components/metra/MetraLauncher.tsx': "Metra's logo",
  'components/auth/OAuthButtons.tsx': "Google's and Microsoft's own logo colours",
  'lib/connectors.ts': 'the logo colours of connected apps',
  'lib/avatars.ts': 'drawing a picture (canvas), not a screen colour',
}

/**
 * Hex colours allowed in a file, and why: colours people pick and save (swatches) and the defaults stored with new
 * records. They are data, not the theme, and are always shown through dataTint() so they read in light and dark.
 */
const DATA_COLOURS: Record<string, { why: string; hex: string[] }> = {
  'components/projects/pmUi.tsx': { why: 'colour swatches for projects and avatars (people pick these)', hex: ['*'] },
  'pages/app/leads/LeadSettings.tsx': { why: 'colour swatches for businesses and pipeline stages (people pick these)', hex: ['*'] },
  'pages/app/leads/SetupGuide.tsx': { why: 'colour swatches for a new business', hex: ['*'] },
  'lib/customApi.ts': { why: 'colour swatches for custom blocks', hex: ['*'] },
  'lib/leadsApi.ts': { why: 'the stage colours stored with a new pipeline', hex: ['*'] },
  'pages/app/leads/Tags.tsx': { why: 'colour swatches for lead tags (people pick these), and grey for a tag not on the list', hex: ['*'] },
  'pages/app/projects/ProjectSettings.tsx': { why: 'the starting value of a colour picker', hex: ['#94A3B8'] },
  'components/ui/Pictures.tsx': { why: 'the stand-in colour of a project with no colour of its own (white initials on it)', hex: ['#64748B'] },
  'pages/app/marketing/SocialPlanner.tsx': { why: "each social network's own brand colour", hex: ['*'] },
  'lib/theme.ts': { why: "the browser's address-bar colour, and a stand-in when there is no page to read a colour from", hex: ['*'] },
}

const FAMILIES = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|zinc|neutral|stone'
const NUMBERED = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration|placeholder|caret|shadow|accent)-(?:${FAMILIES})-\\d{2,3}(?:/\\d+)?(?![\\w-])`, 'g')
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g
const RGB = /\brgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}/g
const LITERAL = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g
const SOLID = /(?<![\w/:-])bg-(?:primary(?:-700)?|success|danger|warning|accent|error|info|highlight)(?![\w/-])/
const WHITE = /(?<![\w/:-])text-white(?![\w/-])/
// A status or accent colour as TEXT: the solid colour does not read on cards in every theme (amber on white is 2:1);
// the -ink colour does (src/theme/build.ts readablePass).
const RAW_TEXT = /(?<![\w-])(?:[\w[\]&:.-]*:)?text-(?:success|warning|danger|error|info|primary|accent|highlight)(?=(?:\/[\w.[\]]+)?(?![\w-]))/g

const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p) } }
walk(SRC)

const problems: string[] = []
let scanned = 0
for (const p of files) {
  const rel = path.relative(SRC, p).replace(/\\/g, '/')
  if (Object.keys(SKIP).some((s) => rel.startsWith(s))) continue
  scanned++
  const allow = DATA_COLOURS[rel]
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    const at = `${rel}:${i + 1}`
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // comments
    for (const m of line.match(NUMBERED) ?? []) problems.push(`${at}  ${m}  (a numbered colour: use a theme role)`)
    for (const m of line.match(HEX) ?? []) {
      if (allow && (allow.hex.includes('*') || allow.hex.map((h) => h.toLowerCase()).includes(m.toLowerCase()))) continue
      problems.push(`${at}  ${m}  (a fixed colour: use role()/tone()/dataTint() or CHART)`)
    }
    for (const m of line.match(RGB) ?? []) if (!allow?.hex.includes('*')) problems.push(`${at}  ${m}...)  (a fixed colour: use role()/tone())`)
    for (const m of line.match(RAW_TEXT) ?? []) problems.push(`${at}  ${m}  (a solid colour as text: use the -ink colour, e.g. text-warning-ink)`)
    for (const lit of line.match(LITERAL) ?? []) if (SOLID.test(lit) && WHITE.test(lit)) problems.push(`${at}  text-white on ${lit.match(SOLID)![0]}  (use the -on colour, e.g. text-primary-on)`)
  })
}

console.log(`Scanned ${scanned} files (${Object.keys(SKIP).length} left out on purpose, ${Object.keys(DATA_COLOURS).length} with stored colours allowed).`)
if (problems.length) { console.log(`\nNOT OK (${problems.length}):\n${problems.map((x) => `  ${x}`).join('\n')}`); process.exit(1) }
console.log('OK: every colour in the screens comes from the theme.')
