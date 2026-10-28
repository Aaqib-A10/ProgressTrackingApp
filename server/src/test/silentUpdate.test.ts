import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'

// Oct 2026: the "PulseTrack has been updated, Reload" banner is gone; an open tab picks up a new
// version by itself at a moment nobody notices. Loaded by path (the server build must not pull in
// client files).

type El = { tagName?: string; value?: string; textContent?: string | null; isContentEditable?: boolean; type?: string; readOnly?: boolean; disabled?: boolean }
type State = { inCall: boolean; path: string; held: boolean; unsavedText: boolean }
type Mod = {
  shouldReload: (d: { outdated: boolean; trigger: 'page-change' | 'hidden' | 'idle'; now: number; since: number; lastReloadAt: number | null; state: State }) => boolean
  hasUnsavedText: (doc: { activeElement: El | null; querySelectorAll: (s: string) => ArrayLike<El> }) => boolean
  holdUpdates: () => () => void
  updatesHeld: () => boolean
  HIDDEN_MS: number
  IDLE_MS: number
  RETRY_GAP_MS: number
}
let m: Mod
beforeAll(async () => {
  m = (await import(path.resolve(__dirname, '../../../client/src/lib/silentUpdate.ts'))) as Mod
})

const NOW = 1_800_000_000_000
const calm: State = { inCall: false, path: '/app/tasks', held: false, unsavedText: false }
const d = (o: Partial<Parameters<Mod['shouldReload']>[0]> = {}) => ({ outdated: true, trigger: 'page-change' as const, now: NOW, since: NOW, lastReloadAt: null, state: calm, ...o })

describe('when a tab picks up a new version by itself', () => {
  it('reloads on the next page change, only when there is a new version', () => {
    expect(m.shouldReload(d())).toBe(true)
    expect(m.shouldReload(d({ outdated: false }))).toBe(false)
  })

  it('never during a call, a meeting, an upload or with text typed', () => {
    expect(m.shouldReload(d({ state: { ...calm, inCall: true } }))).toBe(false)
    expect(m.shouldReload(d({ state: { ...calm, path: '/app/meetings/abc123' } }))).toBe(false)
    expect(m.shouldReload(d({ state: { ...calm, held: true } }))).toBe(false)
    expect(m.shouldReload(d({ state: { ...calm, unsavedText: true } }))).toBe(false)
    // The meetings calendar is not a meeting room.
    expect(m.shouldReload(d({ state: { ...calm, path: '/app/meetings' } }))).toBe(true)
  })

  it('a background tab waits 5 minutes, an open tab 15 idle minutes', () => {
    expect(m.shouldReload(d({ trigger: 'hidden', since: NOW - m.HIDDEN_MS + 1000 }))).toBe(false)
    expect(m.shouldReload(d({ trigger: 'hidden', since: NOW - m.HIDDEN_MS }))).toBe(true)
    expect(m.shouldReload(d({ trigger: 'idle', since: NOW - 5 * 60_000 }))).toBe(false)
    expect(m.shouldReload(d({ trigger: 'idle', since: NOW - m.IDLE_MS }))).toBe(true)
  })

  it('does not reload again right after a silent reload (a cached old page can never loop)', () => {
    expect(m.shouldReload(d({ lastReloadAt: NOW - 60_000 }))).toBe(false)
    expect(m.shouldReload(d({ lastReloadAt: NOW - m.RETRY_GAP_MS }))).toBe(true)
  })

  it('counts words in a text box or editor as unsaved, not empty boxes or a search left alone', () => {
    const doc = (active: El | null, boxes: El[] = []) => ({ activeElement: active, querySelectorAll: () => boxes })
    expect(m.hasUnsavedText(doc(null))).toBe(false)
    expect(m.hasUnsavedText(doc(null, [{ tagName: 'TEXTAREA', value: '   ' }]))).toBe(false)
    expect(m.hasUnsavedText(doc(null, [{ tagName: 'TEXTAREA', value: 'half a report' }]))).toBe(true)
    expect(m.hasUnsavedText(doc(null, [{ tagName: 'DIV', isContentEditable: true, textContent: 'a note' }]))).toBe(true)
    expect(m.hasUnsavedText(doc(null, [{ tagName: 'TEXTAREA', value: 'shown only', readOnly: true }]))).toBe(false)
    expect(m.hasUnsavedText(doc({ tagName: 'INPUT', type: 'text', value: 'Acme' }))).toBe(true)
    expect(m.hasUnsavedText(doc({ tagName: 'INPUT', type: 'checkbox', value: 'on' }))).toBe(false)
  })

  it('an upload holds updates until it ends', () => {
    expect(m.updatesHeld()).toBe(false)
    const a = m.holdUpdates()
    const b = m.holdUpdates()
    a()
    expect(m.updatesHeld()).toBe(true)
    b()
    expect(m.updatesHeld()).toBe(false)
  })
})
