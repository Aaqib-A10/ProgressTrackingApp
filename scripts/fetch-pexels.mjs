// Downloads royalty-free Pexels media for the landing page into
// client/public/assets. Reads PEXELS_API_KEY from server/.env (never hardcoded).
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const env = await readFile(new URL('server/.env', root), 'utf8')
const key = env.match(/PEXELS_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1]
if (!key || key === 'your-pexels-api-key') {
  console.error('PEXELS_API_KEY not set in server/.env')
  process.exit(1)
}

const imgDir = new URL('client/public/assets/images/', root)
const vidDir = new URL('client/public/assets/videos/', root)
await mkdir(imgDir, { recursive: true })
await mkdir(vidDir, { recursive: true })

async function download(url, dest) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${r.status}`)
  await writeFile(dest, Buffer.from(await r.arrayBuffer()))
}

async function image(query, name) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&size=medium`, {
    headers: { Authorization: key },
  })
  const j = await r.json()
  const src = j.photos?.[0]?.src?.large
  if (!src) return console.warn(`no image for "${query}"`)
  await download(src, new URL(name, imgDir))
  console.log(`image  ${name} <- "${query}"`)
}

async function video(query, name) {
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, {
    headers: { Authorization: key },
  })
  const j = await r.json()
  for (const v of j.videos ?? []) {
    const f = (v.video_files || [])
      .filter((x) => x.file_type === 'video/mp4' && x.width >= 640 && x.width <= 1280)
      .sort((a, b) => a.width - b.width)[0]
    if (f) {
      await download(f.link, new URL(name, vidDir))
      console.log(`video  ${name} <- "${query}"`)
      return
    }
  }
  console.warn(`no suitable video for "${query}"`)
}

const images = [
  // hero + section visuals
  ['bright white minimal office desk laptop workspace', 'hero-product.jpg'],
  ['happy person working on laptop', 's-free.jpg'],
  ['woman using laptop in office', 's-easy.jpg'],
  ['team working on computers office', 's-versatile.jpg'],
  // feature rows
  ['kanban board planning sticky notes', 'f-kanban.jpg'],
  ['analytics dashboard charts screen', 'f-dashboard.jpg'],
  ['business data growth graph', 'f-trends.jpg'],
  ['person typing on laptop closeup', 'f-logging.jpg'],
  ['team meeting collaboration office', 'f-team.jpg'],
  ['calendar schedule planning desk', 'f-calendar.jpg'],
  ['business documents report paperwork', 'f-reports.jpg'],
  ['target goal business strategy', 'f-targets.jpg'],
  ['person using smartphone app', 'f-mobile.jpg'],
  ['time management clock office desk', 'f-timetracking.jpg'],
  // why section — woman with laptop (lighter background reads as a cut-out on the ellipse)
  ['woman holding laptop smiling white background', 'why-girl.jpg'],
  // trusted-by
  ['diverse business team group office', 'trusted-team.jpg'],
  // legacy (kept for any remaining references)
  ['business team meeting', 'feature-visibility.jpg'],
  ['data visualization charts', 'feature-trends.jpg'],
]

for (const [q, n] of images) {
  try {
    await image(q, n)
  } catch (e) {
    console.warn(`image "${q}" failed: ${e.message}`)
  }
}
try {
  await video('business technology data office', 'hero.mp4')
} catch (e) {
  console.warn(`video failed: ${e.message}`)
}
console.log('done')
