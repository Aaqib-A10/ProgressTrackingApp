import type { Asker } from '../access'
import type { Entry, Row, Table } from './types'
import { get, pct, period, reader } from './load'

/**
 * The daily numbers: a person's own (My Reports), and for team leads the ITAD and Lead Gen teams with each agent,
 * today's submissions, and the monthly report. Shapes are those of controllers/itadController.ts,
 * leadgenController.ts, reportsController.ts and dashboardController.ts.
 */

const sa = (a: Asker) => a.role === 'SUPER_ADMIN'
const leadOf = (k: string) => (a: Asker) => sa(a) || (a.role === 'TEAM_LEAD' && a.kinds.includes(k as never))

const LOGGED: Record<string, string> = { SUBMITTED: 'Submitted', PENDING: 'Not submitted', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', OFF: 'Day off' }
const FLAG: Record<string, string> = { EXCEEDING: 'Exceeding the target', OPTIMAL: 'On target', ATTENTION: 'Needs attention', BELOW: 'Below the target' }
interface Agent<T, K> { id: string; name: string; status: string; onLeaveToday: boolean; leaveDays: number; flag: string; totals: T; kpis: K }
interface Range { startDate: string; endDate: string; key: string }
type Itad = { callsDialed: number; connected: number; voicemail: number; emailsSent: number; interested: number; workingOn: number; closed: number; rfqs: number }
type ItadK = { connectRate: number; voicemailRate: number; interestRate: number; rfqConversion: number; closeRate: number }
type Lg = { leadsGenerated: number; accountsResearched: number; contactsFound: number; qualifiedMql: number; handedToSql: number }
type LgK = { leadToQualified: number; mqlToSql: number; contactDiscovery: number }

const flagsOf: Table['flags'] = {
  missing: { label: 'has not submitted', says: ['not submitted', 'pending', 'missing', 'nothing logged'], test: (r) => r.status === 'PENDING' },
  below: { label: 'below the target', says: ['below', 'under target', 'behind', 'low', 'weak'], test: (r) => r.flag === 'BELOW' || r.flag === 'ATTENTION' },
  good: { label: 'on or above the target', says: ['on target', 'above', 'exceeding', 'top', 'best'], test: (r) => r.flag === 'EXCEEDING' || r.flag === 'OPTIMAL' },
}

export const NUMBERS: Entry[] = [
  {
    key: 'reports.mine', label: 'My numbers', area: 'My Reports', app: '/app/reports',
    about: "The asker's own daily numbers for a period (this month unless a period is given): the total of each number their team logs (dials, connected, leads, listings...) and each day they logged.",
    says: ['my numbers', 'my dials', 'how many dials did i', 'how many calls did i', 'my calls', 'my leads this', 'how many leads did i generate', 'my report', 'my reports', 'my performance', 'my stats', 'my totals', 'what did i log', 'my daily log', 'mere dials', 'mere numbers', 'maine kitne'],
    who: () => true, pin: (a) => a.kinds.some((k) => ['ITAD', 'LEAD_GEN', 'CSR', 'TALKLOOP'].includes(k as string)), takes: ['range'],
    blocks: ['my-reports', 'my-analytics', 'itad-log', 'leadgen-log'], apis: ['/api/reports/me'], models: ['ItadDailyEntry', 'LeadGenDailyEntry', 'LeadGenVerticalCount', 'TalkloopDailyEntry', 'TalkloopCountryCount'],
    async load(ctx, a) {
      const p = period(a, ctx)
      const r = await get<{ department: string | null; range: Range; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; totals: Record<string, number> }>(ctx, '/api/reports/me', p.query)
      if (r.error !== undefined) return { error: r.error }
      const b = r.body
      const rows: Row[] = b.rows.map((x) => ({ date: typeof x.date === 'string' ? x.date : '', status: typeof x.status === 'string' ? x.status : '', ...Object.fromEntries(b.columns.map((c) => [c.key, typeof x[c.key] === 'number' ? (x[c.key] as number) : x[c.key] == null ? null : String(x[c.key])])) }))
      return {
        rows, dated: true, notes: p.notes,
        head: [
          `${ctx.me.name}'s own numbers, ${b.range.startDate} to ${b.range.endDate}${b.department ? ` (${b.department})` : ''}.`,
          b.columns.length ? `Totals for the period: ${b.columns.map((c) => `${c.label} ${b.totals[c.key] ?? 0}`).join(', ')}.` : 'This person\'s team has no daily numbers on My Reports.',
        ],
        table: { unit: ['day logged', 'days logged'], columns: [{ key: 'date', label: 'date', kind: 'date' }, { key: 'status', label: 'day' }, ...b.columns.map((c) => ({ key: c.key, label: c.label, kind: 'number' as const }))], status: 'status', words: { status: LOGGED }, sums: b.columns.map((c) => c.key) },
      }
    },
    table: { unit: ['day logged', 'days logged'], columns: [{ key: 'date', label: 'date', kind: 'date' }], sums: [] },
    tip: 'These are the asker\'s OWN numbers. The totals line is the answer to "how many ... did I ... this month"; a day with nothing logged has no row.',
  },
  {
    key: 'itad.team', label: 'ITAD team numbers', area: 'Sales calling', app: '/app/itad/team',
    about: 'For team leads: each ITAD agent over a period (this week unless given): dials, connected, voicemails, emails, interested, working on, closed, RFQs, their connect and close rates, whether they submitted, and whether they are below the target; with the team totals.',
    says: ['team dials', 'team calls', 'itad team', 'who made the most calls', 'who dialed the most', 'top agent', 'agent numbers', 'connect rate', 'close rate', 'team numbers', 'how many dials did the team', 'dials this week', 'calls this week', 'below target', 'team ke dials', 'dials today', 'calls today', 'how many dials'],
    who: leadOf('ITAD'), pin: leadOf('ITAD'), takes: ['range'],
    blocks: ['itad-team', 'itad-analytics'], apis: ['/api/itad/team'], models: ['ItadDailyEntry'],
    load: reader<{ range: Range; target: { dailyDials: number }; team: { totals: Itad; kpis: ItadK }; agents: Agent<Itad, ItadK>[] }>('/api/itad/team', {
      query: (a, c) => period(a, c, 'week'),
      rows: (b) => b.agents.map((x) => ({ id: x.id, name: x.name, status: x.status, flag: x.flag, ...x.totals, connectRate: pct(x.kpis.connectRate), closeRate: pct(x.kpis.closeRate), leaveDays: x.leaveDays })),
      head: (b) => [`Period read: ${b.range.startDate} to ${b.range.endDate}. Daily dial target: ${b.target.dailyDials}.`, `Team rates: connect ${pct(b.team.kpis.connectRate)}, voicemail ${pct(b.team.kpis.voicemailRate)}, interest ${pct(b.team.kpis.interestRate)}, RFQ ${pct(b.team.kpis.rfqConversion)}, close ${pct(b.team.kpis.closeRate)}.`],
      dated: true,
    }),
    table: {
      unit: ['agent', 'agents'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'agent' }, { key: 'status', label: 'log' }, { key: 'flag', label: 'against target' }, { key: 'callsDialed', label: 'dials', kind: 'number' }, { key: 'connected', label: 'connected', kind: 'number' }, { key: 'voicemail', label: 'voicemails', kind: 'number' }, { key: 'emailsSent', label: 'emails', kind: 'number' }, { key: 'interested', label: 'interested', kind: 'number' }, { key: 'workingOn', label: 'working on', kind: 'number' }, { key: 'closed', label: 'closed', kind: 'number' }, { key: 'rfqs', label: 'RFQs', kind: 'number' }, { key: 'connectRate', label: 'connect rate' }, { key: 'closeRate', label: 'close rate' }, { key: 'leaveDays', label: 'leave days', kind: 'number' }],
      people: ['name'], mine: 'id', status: 'status', words: { status: LOGGED, flag: FLAG }, sums: ['callsDialed', 'connected', 'voicemail', 'emailsSent', 'interested', 'workingOn', 'closed', 'rfqs'], flags: flagsOf,
    },
    tip: 'The "total" numbers are the team totals for the period. A member\'s own numbers are what="reports.mine".',
  },
  {
    key: 'leadgen.team', label: 'Lead Gen team numbers', area: 'Lead Generation', app: '/app/leadgen/team',
    about: 'For team leads: each Lead Gen agent over a period (this month unless given): leads generated, accounts researched, contacts found, MQL, SQL, their lead-to-qualified and MQL-to-SQL rates, whether they submitted, and whether they are below the target; with the team totals.',
    says: ['lead gen team', 'leads generated', 'team leads generated', 'mql', 'sql', 'qualified leads', 'accounts researched', 'contacts found', 'who generated the most leads', 'lead gen numbers', 'funnel', 'weekly lead target', 'team ki leads'],
    who: leadOf('LEAD_GEN'), pin: leadOf('LEAD_GEN'), takes: ['range'],
    blocks: ['leadgen-team', 'leadgen-analytics'], apis: ['/api/leadgen/team'], models: ['LeadGenDailyEntry', 'LeadGenVerticalCount'],
    load: reader<{ range: Range; target: { weeklyLeads: number }; team: { totals: Lg; kpis: LgK }; funnel: { stage: string; value: number }[]; agents: Agent<Lg, LgK>[] }>('/api/leadgen/team', {
      query: (a, c) => period(a, c),
      rows: (b) => b.agents.map((x) => ({ id: x.id, name: x.name, status: x.status, flag: x.flag, ...x.totals, leadToQualified: pct(x.kpis.leadToQualified), mqlToSql: pct(x.kpis.mqlToSql), leaveDays: x.leaveDays })),
      head: (b) => [`Period read: ${b.range.startDate} to ${b.range.endDate}. Weekly lead target per person: ${b.target.weeklyLeads}.`, `Team rates: lead to qualified ${pct(b.team.kpis.leadToQualified)}, MQL to SQL ${pct(b.team.kpis.mqlToSql)}, contact discovery ${pct(b.team.kpis.contactDiscovery)}.`, `Funnel: ${b.funnel.map((f) => `${f.stage} ${f.value}`).join(' > ')}.`],
      dated: true,
    }),
    table: {
      unit: ['agent', 'agents'],
      columns: [{ key: 'id', label: 'id', hidden: true }, { key: 'name', label: 'agent' }, { key: 'status', label: 'log' }, { key: 'flag', label: 'against target' }, { key: 'leadsGenerated', label: 'leads', kind: 'number' }, { key: 'accountsResearched', label: 'accounts researched', kind: 'number' }, { key: 'contactsFound', label: 'contacts found', kind: 'number' }, { key: 'qualifiedMql', label: 'MQL', kind: 'number' }, { key: 'handedToSql', label: 'SQL', kind: 'number' }, { key: 'leadToQualified', label: 'lead to qualified' }, { key: 'mqlToSql', label: 'MQL to SQL' }, { key: 'leaveDays', label: 'leave days', kind: 'number' }],
      people: ['name'], mine: 'id', status: 'status', words: { status: LOGGED, flag: FLAG }, sums: ['leadsGenerated', 'accountsResearched', 'contactsFound', 'qualifiedMql', 'handedToSql'], flags: flagsOf,
    },
    tip: 'The "total" numbers are the team totals for the period. A member\'s own numbers are what="reports.mine".',
  },
  {
    key: 'leadgen.breakdown', label: 'Lead Gen monthly breakdown', area: 'Lead Generation', app: '/app/leadgen/breakdown',
    about: 'For team leads: the leads of a month by industry and by campaign, with the top industry.',
    says: ['breakdown', 'by industry', 'by campaign', 'leads by industry', 'leads by source', 'top industry', 'which industry', 'which campaign', 'verticals'],
    who: leadOf('LEAD_GEN'), takes: ['range'],
    blocks: ['leadgen-breakdown'], apis: ['/api/leadgen/breakdown'], models: ['LeadGenBreakdown'],
    load: reader<{ month: string; leadsGenerated: number; topIndustry: string | null; industries: unknown[]; campaigns: unknown[] }>('/api/leadgen/breakdown', {
      query: (a, c) => period(a, c),
      rows: (b) => {
        const row = (kind: string) => (x: unknown): Row => { const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>; return { kind, name: String(o.name ?? o.industry ?? o.campaign ?? o.label ?? ''), leads: Number(o.leads ?? o.count ?? o.value ?? 0) } }
        return [...b.industries.map(row('Industry')), ...b.campaigns.map(row('Campaign'))]
      },
      head: (b) => [`Month ${b.month}: ${b.leadsGenerated} leads generated${b.topIndustry ? `; top industry ${b.topIndustry}` : ''}.`],
      dated: true,
    }),
    table: { unit: ['line', 'lines'], columns: [{ key: 'kind', label: 'by' }, { key: 'name', label: 'name' }, { key: 'leads', label: 'leads', kind: 'number' }], status: 'kind' },
  },
  {
    key: 'reports.today', personal: 'reports.mine', label: "Today's daily reports", area: 'Dashboard', app: '/app/dashboard',
    about: "For team leads: who on the team has submitted today's daily report and their main number for today, with the team's headline numbers for the period.",
    says: ['team dashboard', 'who submitted', 'submitted today', 'todays reports', 'team today', 'dashboard', 'how is the team doing', 'team performance', 'kpis'],
    // The page is a department's: a Super Admin who belongs to no department has none to show.
    who: (a) => a.role === 'TEAM_LEAD' || (sa(a) && !!a.departmentId), takes: ['range'],
    blocks: ['dashboard', 'my-team'], apis: ['/api/dashboard/team'], models: [],
    load: reader<{ department: string; range: Range; kpis: { label: string; value: number; format: string; delta: number }[]; improvement?: string; todaySubmissions: { name: string; status: string; metricLabel: string; metricValue: number }[]; counts: { submitted: number; total: number } }>('/api/dashboard/team', {
      query: (a, c) => period(a, c, 'week'),
      rows: (b) => b.todaySubmissions.map((x) => ({ name: x.name, status: x.status, number: x.metricValue, what: x.metricLabel })),
      head: (b) => [`${b.department} team, ${b.range.startDate} to ${b.range.endDate}: ${b.kpis.map((k) => `${k.label} ${k.format === 'percent' ? pct(k.value) : k.value}${k.delta ? ` (${k.delta > 0 ? '+' : ''}${pct(k.delta)} vs the period before)` : ''}`).join('; ')}.`, `Today ${b.counts.submitted} of ${b.counts.total} have submitted.`, b.improvement ? `Note on the page: ${b.improvement}` : ''],
      dated: true,
    }),
    table: {
      unit: ['person', 'people'],
      columns: [{ key: 'name', label: 'person' }, { key: 'status', label: 'today' }, { key: 'number', label: 'number today', kind: 'number' }, { key: 'what', label: 'of' }],
      people: ['name'], status: 'status', words: { status: LOGGED }, sums: ['number'],
      flags: { missing: { label: 'has not submitted today', says: ['not submitted', 'pending', 'missing'], test: (r) => r.status === 'PENDING' } },
    },
  },
  {
    key: 'reports.monthly', label: 'Monthly report', area: 'Monthly Reports', app: '/app/reports/monthly',
    about: 'For Super Admins and the ITAD and Lead Gen team leads (their own team): last month for the ITAD or Lead Gen team: the team totals, how they changed from the month before, the QA average, the top agent and each agent.',
    says: ['monthly report', 'last month report', 'month report', 'last month numbers', 'compared to last month', 'month over month', 'top agent last month'],
    who: (a) => sa(a) || leadOf('ITAD')(a) || leadOf('LEAD_GEN')(a),
    blocks: ['monthly-reports'], apis: ['/api/reports/monthly'], models: [],
    async load(ctx, a) {
      // A team lead reads their own team's report (the app refuses the other one); a Super Admin either.
      const own = ctx.asker.role === 'SUPER_ADMIN' ? null : ctx.asker.kinds.includes('LEAD_GEN' as never) && !ctx.asker.kinds.includes('ITAD' as never) ? 'LEAD_GEN' : 'ITAD'
      const dept = own ?? (/lead/i.test(`${a.item ?? ''} ${a.search ?? ''}`) ? 'LEAD_GEN' : 'ITAD')
      const r = await get<{ report: { department: string; monthLabel: string; team?: Record<string, unknown>; prev?: Record<string, unknown>; topAgent?: Record<string, unknown> | null; agents?: Record<string, unknown>[] } }>(ctx, '/api/reports/monthly', { department: dept })
      if (r.error !== undefined) return { error: r.error }
      const p = r.body.report
      // The two teams' reports hold different numbers: every plain number of the team is printed under its own name.
      const show = (k: string, v: unknown) => (typeof v !== 'number' ? '' : /rate|ToSql|ToQualified/i.test(k) ? (Math.abs(v) <= 1 ? pct(v) : `${Math.round(v * 10) / 10}%`) : String(Math.round(v * 10) / 10)) // a rate comes as a share (0.15) from one report and as a percentage (37.5) from the other
      const line = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} ${show(k, v)}`).join(', ')
      const agents = p.agents ?? []
      const keys = [...new Set(agents.flatMap((x) => Object.keys(x).filter((k) => k !== 'id' && k !== 'email' && (typeof x[k] === 'number' || typeof x[k] === 'string'))))]
      return {
        rows: agents.map((x) => Object.fromEntries(keys.map((k) => [k, typeof x[k] === 'number' ? Math.round((x[k] as number) * 100) / 100 : (x[k] as string)]))),
        head: [`${p.department} monthly report for ${p.monthLabel}.`, line(p.team) ? `Team: ${line(p.team)}.` : '', line(p.prev) ? `The month before: ${line(p.prev)}.` : '', p.topAgent ? `Top agent: ${String(p.topAgent.name ?? '')}${line(p.topAgent) ? ` (${line(p.topAgent)})` : ''}.` : ''].filter(Boolean),
        notes: own ? [] : [`This is the ${dept === 'ITAD' ? 'ITAD' : 'Lead Gen'} report; pass item "lead gen" or "itad" for the other team.`],
        table: { unit: ['agent', 'agents'], columns: keys.map((k) => ({ key: k, label: k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() })), people: keys.includes('name') ? ['name'] : [] },
      }
    },
    table: { unit: ['agent', 'agents'], columns: [{ key: 'name', label: 'agent' }] },
  },
]
