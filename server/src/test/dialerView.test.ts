import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The connectors use a copy of the Lead Dialer screen logic. If the screens change, copy again:
// the AI must see the same follow-ups and calling hours as the people do.
describe('server copy of the Lead Dialer logic', () => {
  it('matches client/src/lib/dialer.ts', () => {
    const root = path.resolve(__dirname, '../../..')
    const client = fs.readFileSync(path.join(root, 'client/src/lib/dialer.ts'), 'utf8')
    const server = fs.readFileSync(path.join(root, 'server/src/lib/dialer/view.ts'), 'utf8')
    const body = client.slice(client.indexOf('\n') + 1)
    expect(server.endsWith(body)).toBe(true)
  })
})
