#!/usr/bin/env node
// Run the erp branch on your PC with its OWN database (pulsetrack_erp), so main's local
// database is never touched. From the project folder, on the erp branch:
//   npm run dev:erp            start it (the first time it copies your local database to pulsetrack_erp)
//   npm run dev:erp -- --fresh copy your local database again (throws away erp test data)
//   npm run dev:erp -- --demo  also add the two demo companies and the test owner (testuser / test123)
//   npm run dev:erp -- --testuser  the test accounts: testuser (owner), testcompanyadmin, testcompanyuser, solouser (all test123)
//   npm run dev:erp -- owner create   set up the owner account in pulsetrack_erp (also: password, new-code, unlock)
// Then open http://localhost:5173 (the app) and http://localhost:5173/owner (the owner console).
import { execSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = path.join(root, 'server')
const argv = process.argv.slice(2)
const args = new Set(argv)
const say = (s) => console.log(`[dev:erp] ${s}`)

const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim()
if (branch !== 'erp') { say(`You are on "${branch}". Run: git checkout erp   (then this again)`); process.exit(1) }

const env = readFileSync(path.join(server, '.env'), 'utf8')
const mainUrl = (env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m) || [])[1]
if (!mainUrl) { say('DATABASE_URL is missing in server/.env'); process.exit(1) }
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(mainUrl)) { say('server/.env does not point at a database on this computer. Stopping.'); process.exit(1) }
const mainDb = mainUrl.match(/\/([^/?]+)(\?|$)/)[1]
const withDb = (db) => mainUrl.replace(/\/([^/?]+)(\?|$)/, `/${db}$2`)
const erpUrl = withDb('pulsetrack_erp')
const adminUrl = withDb('postgres').replace(/\?.*$/, '')

const sql = (q) => execSync('npx prisma db execute --stdin --url "' + adminUrl + '"', { cwd: server, input: q, stdio: ['pipe', 'pipe', 'pipe'] })
try { sql('SELECT 1;') } catch (e) {
  say('Cannot reach PostgreSQL on this computer. Start PostgreSQL (Windows: Services > postgresql) and run this again.')
  const msg = String(e.stderr ?? '').split('\n').filter((l) => /error|P1\d{3}|denied|refused/i.test(l)).slice(0, 3).join('\n')
  if (msg) console.log(msg)
  process.exit(1)
}
let exists = true
try { execSync('npx prisma db execute --stdin --url "' + erpUrl + '"', { cwd: server, input: 'SELECT 1;', stdio: ['pipe', 'pipe', 'pipe'] }) } catch { exists = false }
if (!exists || args.has('--fresh')) {
  say(`Copying your local database "${mainDb}" to "pulsetrack_erp" (close any other app using "${mainDb}" first)...`)
  sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${mainDb}', 'pulsetrack_erp') AND pid <> pg_backend_pid();`)
  sql('DROP DATABASE IF EXISTS pulsetrack_erp;')
  sql(`CREATE DATABASE pulsetrack_erp TEMPLATE "${mainDb}";`)
}

const run = (cmd) => execSync(cmd, { cwd: server, stdio: 'inherit', env: { ...process.env, DATABASE_URL: erpUrl } })
say('Updating pulsetrack_erp to the erp version...')
run('npx prisma migrate deploy')
run('npx prisma generate')
if (args.has('--demo')) run('npx tsx src/scripts/demoCompanies.ts')
if (args.has('--demo') || args.has('--testuser')) run('npx tsx src/scripts/devOwner.ts')
if (argv[0] === 'owner') {
  run(`npx tsx src/scripts/owner.ts ${argv[1] ?? ''}`)
  process.exit(0)
}

say('Starting. App: http://localhost:5173   Owner console: http://localhost:5173/owner   (Ctrl+C to stop)')
const child = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL: erpUrl } })
child.on('exit', (code) => process.exit(code ?? 0))
