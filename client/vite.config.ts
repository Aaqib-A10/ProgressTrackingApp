import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Video call backgrounds use MediaPipe. Its engine files (wasm) are served by PulseTrack
 * itself at /mediapipe/wasm/ (copied from the npm package at build time), so calls never
 * depend on an outside website.
 */
function mediapipeWasm(): Plugin {
  const dir = path.join(path.dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm')
  const type = (f: string) => (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
  return {
    name: 'pt-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const file = path.join(dir, path.basename((req.url ?? '').split('?')[0]))
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
        res.setHeader('Content-Type', type(file))
        fs.createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(wasm|js)$/.test(f)) continue
        this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${f}`, source: fs.readFileSync(path.join(dir, f)) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: forward API calls to the Express server so the client can use
      // relative /api paths without CORS headaches.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
