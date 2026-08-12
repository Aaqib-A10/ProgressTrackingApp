import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { PillFilter } from '../../../components/ui/PillFilter'
import { useToast } from '../../../components/ui/Toast'
import { getEmailOverview, type EmailOverview } from '../../../lib/marketingApi'

type Tab = 'campaigns' | 'automations' | 'lists'
const TABS: { value: Tab; label: string }[] = [
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'automations', label: 'Automations' },
  { value: 'lists', label: 'Lists' },
]

const sel =
  'h-10 rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function EmailMarketing() {
  const { addToast } = useToast()
  const [data, setData] = useState<EmailOverview | null>(null)
  const [brandId, setBrandId] = useState('')
  const [tab, setTab] = useState<Tab>('campaigns')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getEmailOverview()
      .then((r) => {
        setData(r)
        if (r.brands[0]) setBrandId(r.brands[0].id)
      })
      .catch(() => addToast({ type: 'error', message: 'Could not load email marketing.' }))
      .finally(() => setLoading(false))
  }, [addToast])

  if (loading) return <div className="p-2 text-body-md text-ink-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-ink">Email Marketing</h1>
          <p className="mt-0.5 text-body-md text-ink-muted">Per-company email marketing. Setup in progress — metrics coming soon.</p>
        </div>
        {data && data.brands.length > 0 && (
          <div>
            <label className="mb-1 block text-body-sm font-semibold text-ink">Company</label>
            <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <PillFilter options={TABS} value={tab} onChange={setTab} />

      <Card>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-card bg-primary/10 text-primary">
            <Mail size={22} />
          </span>
          <p className="text-body-lg font-semibold text-ink">{TABS.find((t) => t.value === tab)?.label} — nothing here yet</p>
          <p className="max-w-md text-body-md text-ink-muted">
            Email marketing tracking isn't configured yet. Once the metrics and requirements are defined, this tab will show
            {tab === 'campaigns' ? ' sent campaigns, open & click rates' : tab === 'automations' ? ' automated flows and their performance' : ' subscriber lists and growth'}.
          </p>
        </div>
      </Card>
    </div>
  )
}
