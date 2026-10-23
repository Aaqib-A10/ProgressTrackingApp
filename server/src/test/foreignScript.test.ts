import { describe, expect, it } from 'vitest'
import { frameLocations, isForeignScriptError } from '../lib/health/foreignScript'

const page = 'https://pulsetrack.online/app/dashboard'

describe('isForeignScriptError', () => {
  it('flags the injected _0x5229ea script (only <anonymous> frames)', () => {
    expect(isForeignScriptError('ReferenceError: _0x5229ea is not defined\n    at <anonymous>:1:30\n    at <anonymous>:1:303', page)).toBe(true)
  })
  it('flags extension and other-site frames, Chrome and Firefox style', () => {
    expect(isForeignScriptError('E\n    at chrome-extension://abc/x.js:1:2', page)).toBe(true)
    expect(isForeignScriptError('E\n    at f (https://cdn.other.com/a.js:1:2)', page)).toBe(true)
    expect(isForeignScriptError('f@moz-extension://1/x.js:1:2', page)).toBe(true)
  })
  it('keeps our own errors', () => {
    expect(isForeignScriptError('E\n    at Card (https://pulsetrack.online/assets/index-A1.js:10:20)\n    at new Promise (<anonymous>)', page)).toBe(false)
    expect(isForeignScriptError('E\n    at async load (https://pulsetrack.online/assets/x.js:1:2)', page)).toBe(false)
    expect(isForeignScriptError('Card@https://pulsetrack.online/assets/index-A1.js:10:20', page)).toBe(false)
    expect(isForeignScriptError('E\n    at Card (http://localhost:5173/src/Card.tsx:10:20)', 'http://localhost:5173/app')).toBe(false)
  })
  it('keeps errors it cannot judge', () => {
    expect(isForeignScriptError(null, page)).toBe(false)
    expect(isForeignScriptError('just a message', page)).toBe(false)
    // A page address that is not a full URL: any http(s) file counts as ours.
    expect(isForeignScriptError('E\n    at Card (https://pulsetrack.online/assets/a.js:1:1)', '/app/projects/OPS')).toBe(false)
  })
  it('reads frame locations', () => {
    expect(frameLocations('E\n    at f (https://a/b.js:1:2)\n    at <anonymous>:1:30\ng@https://a/c.js:3:4')).toEqual(['https://a/b.js:1:2', '<anonymous>:1:30', 'https://a/c.js:3:4'])
  })
})
