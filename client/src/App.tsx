import { useEffect, useState } from 'react'
import { api } from './lib/api'

type Health = { status: string; db: string; time: string }

type Wire = 'checking' | 'connected' | 'unreachable'

export default function App() {
  const [wire, setWire] = useState<Wire>('checking')
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api
      .get<Health>('/health')
      .then((h) => {
        setHealth(h)
        setWire('connected')
      })
      .catch(() => setWire('unreachable'))
  }, [])

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-card bg-card p-8 shadow-card ring-1 ring-line">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
          <h1 className="text-xl font-semibold tracking-tight">PulseTrack</h1>
        </div>
        <p className="mb-6 text-sm text-ink-muted">Scaffold is up. Verifying client → API wiring.</p>

        <div className="space-y-2 text-sm">
          <Row label="Client" value="running" ok />
          <Row
            label="API (/api/health)"
            value={wire === 'checking' ? 'checking…' : wire}
            ok={wire === 'connected'}
          />
          <Row
            label="Database"
            value={health?.db ?? '—'}
            ok={health?.db === 'up'}
          />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
      <span className="text-ink-muted">{label}</span>
      <span
        className={
          'rounded-full px-2 py-0.5 text-xs font-medium ' +
          (ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')
        }
      >
        {value}
      </span>
    </div>
  )
}
