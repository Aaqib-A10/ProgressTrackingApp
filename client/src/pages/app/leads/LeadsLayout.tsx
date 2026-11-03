import { Outlet } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { EmptyState } from '../../../components/ui/EmptyState'
import { LeadsMetaProvider, useLeadsMeta } from './shared'

/** Wraps every Lead Management screen: loads the businesses I work in once. */
export default function LeadsLayout() {
  return <LeadsMetaProvider><Gate /></LeadsMetaProvider>
}

function Gate() {
  const { meta, error } = useLeadsMeta()
  if (error) return <div className="mx-auto max-w-xl py-16"><EmptyState icon={<Inbox />} title="Leads are not available" hint={error} /></div>
  if (!meta) return <div className="h-40 animate-pulse rounded-card border border-line bg-card" />
  return <Outlet />
}
