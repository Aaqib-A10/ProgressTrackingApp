import { describe, it, expect, vi, beforeAll } from 'vitest'
import path from 'node:path'

// The code under test lives in the web app; it is loaded by path so the server build (tsc, rootDir
// src) does not pull in client files.
type Mod = {
  onPreloadError: (e: { preventDefault: () => void }, env: { storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null; reload: () => void; now: number }) => boolean
  pageModule: <T>(load: () => Promise<T>) => () => Promise<T>
  RELOAD_KEY: string
}
let onPreloadError: Mod['onPreloadError']
let pageModule: Mod['pageModule']
let RELOAD_KEY = ''
beforeAll(async () => {
  const file = path.resolve(__dirname, '../../../client/src/lib/staleChunks.ts')
  const m = (await import(file)) as Mod
  onPreloadError = m.onPreloadError; pageModule = m.pageModule; RELOAD_KEY = m.RELOAD_KEY
})

// System Health, 27 Oct 2026 (Waleed Butt, /app/tasks): "Screen crashed: Cannot read properties of
// undefined (reading 'default')". After a deploy an old tab failed to load a page file; the
// handler cancelled Vite's preload error even when it did not reload (it had just reloaded),
// so the page's import() resolved to undefined and React.lazy crashed.

const store = (v?: string) => { const m = new Map<string, string>(v ? [[RELOAD_KEY, v]] : []); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => { m.set(k, x) } } }
const pending = async (p: Promise<unknown>) => (await Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 30))]))

describe('a page file that fails to load after a deploy', () => {
  it('reloads once: the error is cancelled only when the page really reloads', () => {
    const e = { preventDefault: vi.fn() }
    const reload = vi.fn()
    expect(onPreloadError(e, { storage: store(), reload, now: 1_000_000 })).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('just reloaded and still failing: the error is NOT cancelled, so it reaches the error screen instead of crashing', () => {
    const e = { preventDefault: vi.fn() }
    const reload = vi.fn()
    expect(onPreloadError(e, { storage: store(String(1_000_000 - 5_000)), reload, now: 1_000_000 })).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('no session storage (private mode): no reload loop, the error is not cancelled', () => {
    const e = { preventDefault: vi.fn() }
    expect(onPreloadError(e, { storage: null, reload: vi.fn(), now: 1 })).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('a lazy page whose import came back empty waits for the reload instead of crashing on .default', async () => {
    const empty = pageModule(() => Promise.resolve(undefined as unknown as { default: () => null }))
    expect(await pending(empty())).toBe('pending')
    const real = pageModule(() => Promise.resolve({ default: () => null }))
    expect(typeof (await real()).default).toBe('function')
    const failed = pageModule(() => Promise.reject(new Error('net')))
    await expect(failed()).rejects.toThrow('net')
  })
})
