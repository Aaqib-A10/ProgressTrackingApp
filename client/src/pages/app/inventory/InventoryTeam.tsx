import { useEffect, useState } from 'react'
import { Boxes, PackageMinus, ClipboardList } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { StatCard } from '../../../components/StatCard'
import { useToast } from '../../../components/ui/Toast'
import { getInventoryTeam, type TeamResponse } from '../../../lib/inventoryApi'

export default function InventoryTeam() {
  const { addToast } = useToast()
  const [data, setData] = useState<TeamResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getInventoryTeam()
      .then(setData)
      .catch(() => addToast({ type: 'error', message: 'Could not load the team view.' }))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !data) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-headline-lg text-ink">Inventory Team</h1>
        <p className="mt-0.5 text-body-md text-ink-muted">Stock overview and per-agent fulfillment.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Items tracked" value={data.totals.itemCount} icon={<Boxes size={18} />} />
        <StatCard label="Out of stock" value={data.totals.outOfStock} icon={<PackageMinus size={18} />} />
        <StatCard label="Open requests" value={data.totals.openRequests} icon={<ClipboardList size={18} />} />
      </div>

      <Card flush>
        {data.agents.length === 0 ? (
          <p className="py-12 text-center text-body-md text-ink-muted">No team members assigned to Inventory yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Agent</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Open</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.agents.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{a.open}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{a.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
