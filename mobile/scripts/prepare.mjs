// Writes www/start.js: the address the no-connection page goes back to. Runs before every sync,
// so a build made with METRIQ_APP_URL=... points its "Try again" button at that address too.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const site = (process.env.METRIQ_APP_URL || 'https://pulsetrack.online').replace(/\/+$/, '')
writeFileSync(fileURLToPath(new URL('../www/start.js', import.meta.url)), `window.METRIQ_START_URL = ${JSON.stringify(`${site}/app`)}\n`)
console.log(`Metriq app will open ${site}/app`)
