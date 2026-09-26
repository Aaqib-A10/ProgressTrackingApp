import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Crown, ListChecks } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { useToast } from '../../../components/ui/Toast'
import { initials } from '../../../components/MentionBox'
import { getMarketingTeam, DISCIPLINE_META, type TeamGroup, type TeamMember } from '../../../lib/marketingApi'

const ROLE_LABEL: Record<string, string> = {
  MEMBER: 'Member', SUB_DEPT_LEAD: 'Sub-Dept Lead', TEAM_LEAD: 'Team Lead', SUPER_ADMIN: 'Admin',
}
const ROLE_TONE: Record<string, BadgeTone> = {
  MEMBER: 'neutral', SUB_DEPT_LEAD: 'accent', TEAM_LEAD: 'primary', SUPER_ADMIN: 'danger',
}

// A group's accent colour: match the board discipline colours where they line up.
const GROUP_COLOR: Record<string, string> = {
  social: DISCIPLINE_META.SOCIAL.color,
  content: DISCIPLINE_META.CONTENT.color,
  seo: DISCIPLINE_META.SEO.color,
  ads: '#EC4899',
  email: '#8B5CF6',
  leadership: '#0F172A',
}

export default function MarketingTeam() {
  const { addToast } = useToast()
  const [groups, setGroups] = useState<TeamGroup[] | null>(null)

  useEffect(() => {
    getMarketingTeam()
      .then((r) => setGroups(r.groups))
      .catch(() => { setGroups([]); addToast({ type: 'error', message: 'Could not load the team.' }) })
  }, [addToast])

  const totalMembers = (groups ?? []).reduce((n, g) => n + g.members.length, 0)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-card bg-primary/10 text-primary"><Users size={22} /></span>
          <div>
            <h1 className="text-headline-lg text-ink">Marketing Team</h1>
            <p className="mt-0.5 text-body-md text-ink-muted">People by sub-department, with their live workload. {totalMembers} {totalMembers === 1 ? 'person' : 'people'}.</p>
          </div>
        </div>
        <Link to="/app/marketing/board" className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-card px-3 text-body-sm font-semibold text-ink-muted hover:border-primary/40 hover:text-ink">
          <ListChecks size={15} /> Board
        </Link>
      </div>

      {!groups ? (
        <p className="px-4 py-10 text-center text-body-md text-ink-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <Card className="py-14 text-center text-body-md text-ink-muted">No marketing team members yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((g) => <GroupCard key={g.slug} group={g} />)}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group }: { group: TeamGroup }) {
  const color = GROUP_COLOR[group.slug] ?? '#64748B'
  const open = group.members.reduce((n, m) => n + m.openTasks, 0)
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3" style={{ backgroundColor: `${color}0d` }}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="text-headline-md text-ink">{group.name}</h2>
          <span className="rounded-full bg-slate-200 px-2 text-body-sm font-semibold text-ink-muted">{group.members.length}</span>
        </div>
        <span className="text-body-sm text-ink-muted">{open} open</span>
      </div>
      {group.members.length === 0 ? (
        <p className="px-5 py-6 text-center text-body-sm text-ink-muted">No members.</p>
      ) : (
        <ul className="divide-y divide-line">
          {group.members.map((m) => <MemberRow key={m.id} m={m} leadId={group.lead?.id} color={color} />)}
        </ul>
      )}
    </div>
  )
}

function MemberRow({ m, leadId, color }: { m: TeamMember; leadId?: string; color: string }) {
  const isLead = m.id === leadId
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold" style={{ backgroundColor: `${color}1a`, color }}>
        {initials(m.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-ink">{m.name}</span>
          {isLead && <Crown size={13} className="shrink-0 text-warning" aria-label="Sub-department lead" />}
        </div>
        <Badge tone={ROLE_TONE[m.role] ?? 'neutral'} className="mt-0.5">{ROLE_LABEL[m.role] ?? m.role}</Badge>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-metric-lg leading-none tabular-nums text-ink" style={{ fontSize: 22 }}>{m.openTasks}</div>
        <div className="text-body-sm text-ink-muted">open{m.totalTasks > m.openTasks ? ` · ${m.totalTasks} total` : ''}</div>
      </div>
    </li>
  )
}
