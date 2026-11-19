import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { themeCss } from '../src/theme/build'
import { DEFAULT_THEME, THEMES } from '../src/theme/themes'

/**
 *   npm run theme:build -w client
 *
 * Writes src/theme/theme.css from the themes in src/theme/themes. Run it after changing a theme; `theme:check`
 * fails when the file is out of date.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../src/theme/theme.css')
fs.writeFileSync(out, themeCss(THEMES, DEFAULT_THEME))
console.log(`Wrote ${path.relative(process.cwd(), out)}: ${THEMES.length} theme${THEMES.length === 1 ? '' : 's'} (${THEMES.map((t) => t.id).join(', ')}).`)
