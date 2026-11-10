// Runs the Android build tool (gradlew) the same way on Windows, Mac and Linux.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const android = fileURLToPath(new URL('../android/', import.meta.url))
const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const r = spawnSync(cmd, process.argv.slice(2), { cwd: android, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
