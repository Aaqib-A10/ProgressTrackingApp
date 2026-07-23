// Renders a monthly team report as an email-client-friendly HTML + plain-text pair.
import type { MonthlyReport, ItadReport, LeadGenReport } from './reports'

const INK = '#0F172A'
const MUTED = '#64748B'
const BORDER = '#E2E8F0'
const BG = '#F8FAFC'
const PRIMARY = '#4F46E5'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const ratePct = (v: number) => `${Math.round(v * 1000) / 10}%` // 0..1 fraction → "13.5%"
const num = (n: number) => n.toLocaleString('en-US')

const GOOD = '#16A34A'
const BAD = '#DC2626'
/** Inline ▲/▼ month-over-month badge from a signed fraction (higher = better for all our KPIs). */
function momBadge(delta: number, show: boolean): string {
  if (!show) return ''
  const p = Math.round(delta * 1000) / 10
  if (p === 0) return `<div style="font-size:11px;color:${MUTED};margin-top:3px">— vs last mo</div>`
  const up = p > 0
  return `<div style="font-size:11px;color:${up ? GOOD : BAD};margin-top:3px">${up ? '▲' : '▼'} ${Math.abs(p)}% vs last mo</div>`
}

function qaColor(v: number | null): string {
  if (v === null) return MUTED
  if (v >= 82) return '#16A34A'
  if (v >= 64) return PRIMARY
  if (v >= 50) return '#D97706'
  return '#DC2626'
}

function shell(title: string, period: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden">
        <tr><td style="background:linear-gradient(90deg,#4F46E5,#14B8A6);background-color:${PRIMARY};padding:20px 24px">
          <div style="font-size:13px;color:#E0E7FF;letter-spacing:.04em;text-transform:uppercase">Monthly Team Report</div>
          <div style="font-size:22px;font-weight:bold;color:#fff;margin-top:2px">${esc(title)}</div>
          <div style="font-size:14px;color:#E0E7FF;margin-top:2px">${esc(period)}</div>
        </td></tr>
        <tr><td style="padding:24px">${inner}</td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px">
          Generated automatically by PulseTrack. Figures cover the period above and exclude leave/off days.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function kpiRow(cells: { label: string; value: string }[]): string {
  const tds = cells
    .map(
      (c) => `<td style="padding:12px 8px;text-align:center;border:1px solid ${BORDER};border-radius:8px">
        <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.03em">${esc(c.label)}</div>
        <div style="font-size:20px;font-weight:bold;color:${INK};margin-top:4px">${esc(c.value)}</div></td>`,
    )
    .join('<td style="width:8px"></td>')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>${tds}</tr></table>`
}

/** Exec scorecard: KPI value + a month-over-month ▲/▼ badge under it. */
function scorecard(cells: { label: string; value: string; delta: number }[], showDelta: boolean): string {
  const tds = cells
    .map(
      (c) => `<td style="padding:12px 8px;text-align:center;border:1px solid ${BORDER};border-radius:8px">
        <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.03em">${esc(c.label)}</div>
        <div style="font-size:20px;font-weight:bold;color:${INK};margin-top:4px">${esc(c.value)}</div>
        ${momBadge(c.delta, showDelta)}</td>`,
    )
    .join('<td style="width:8px"></td>')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>${tds}</tr></table>`
}

function topPerformer(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
    <tr><td style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px">
      <span style="font-size:18px">🏆</span>
      <span style="font-size:14px;color:${MUTED};text-transform:uppercase;letter-spacing:.03em">&nbsp;Top performer&nbsp;·&nbsp;</span>
      <span style="font-size:16px;font-weight:bold;color:${INK}">${esc(text)}</span>
    </td></tr></table>`
}

const th = (t: string, align = 'right') =>
  `<th style="text-align:${align};padding:8px 6px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.03em;border-bottom:2px solid ${BORDER}">${esc(t)}</th>`
const td = (t: string, align = 'right', color = INK, bold = false) =>
  `<td style="text-align:${align};padding:8px 6px;font-size:13px;color:${color};border-bottom:1px solid ${BORDER};${bold ? 'font-weight:bold' : ''}">${t}</td>`

function renderItad(r: ItadReport): { subject: string; html: string; text: string } {
  const weekHeads = Array.from({ length: r.weeks }, (_, i) => th(`Wk ${i + 1}`)).join('')
  const rows = r.agents
    .map((a) => {
      const weekCells = a.weeklyQa.map((w) => td(w.avg === null ? '·' : `${w.avg}%`, 'right', MUTED)).join('')
      return `<tr>${td(esc(a.name), 'left', INK, true)}${weekCells}${td(`<span style="color:${qaColor(a.monthQaAvg)};font-weight:bold">${pct(a.monthQaAvg)}</span>`)}${td(num(a.callsDialed))}${td(num(a.connected))}${td(num(a.closed))}${td(num(a.rfqs))}</tr>`
    })
    .join('')
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${th('Agent', 'left')}${weekHeads}${th('Month QA')}${th('Dials')}${th('Conn.')}${th('Closed')}${th('RFQs')}</tr>
    ${rows}</table>`
  const showDelta = r.prev !== null
  const inner =
    scorecard(
      [
        { label: 'Team avg QA', value: pct(r.team.qaAvg), delta: r.deltas.qaAvg },
        { label: 'Connect rate', value: ratePct(r.team.connectRate), delta: r.deltas.connectRate },
        { label: 'Calls dialed', value: num(r.team.callsDialed), delta: r.deltas.callsDialed },
        { label: 'Closed deals', value: num(r.team.closed), delta: r.deltas.closed },
      ],
      showDelta,
    ) +
    (r.topAgent ? topPerformer(`${r.topAgent.name} · ${r.topAgent.avg}% avg QA`) : '') +
    `<div style="font-size:13px;font-weight:bold;color:${INK};margin-bottom:8px">Per-agent — weekly QA scores & call activity</div>` +
    table
  const mom = (label: string, d: number) => `${label} ${d >= 0 ? '+' : ''}${Math.round(d * 1000) / 10}%`
  const text = [
    `ITAD — Monthly Team Report (${r.monthLabel})`,
    `Team avg QA: ${pct(r.team.qaAvg)} | Connect rate: ${ratePct(r.team.connectRate)} | Calls dialed: ${num(r.team.callsDialed)} | Closed: ${r.team.closed} | RFQs: ${r.team.rfqs} | Evaluations: ${r.team.qaCount}`,
    showDelta ? `MoM: ${[mom('QA', r.deltas.qaAvg), mom('connect', r.deltas.connectRate), mom('dials', r.deltas.callsDialed), mom('closed', r.deltas.closed)].join(' · ')}` : 'MoM: no prior month',
    r.topAgent ? `Top performer: ${r.topAgent.name} (${r.topAgent.avg}%)` : '',
    '',
    ...r.agents.map((a) => `${a.name}: month QA ${pct(a.monthQaAvg)} | weekly ${a.weeklyQa.map((w) => (w.avg === null ? '-' : w.avg + '%')).join('/')} | dials ${num(a.callsDialed)} | closed ${a.closed} | RFQs ${a.rfqs}`),
  ].filter(Boolean).join('\n')
  return { subject: `ITAD — Monthly Team Report · ${r.monthLabel}`, html: shell('ITAD', r.monthLabel, inner), text }
}

function renderLeadGen(r: LeadGenReport): { subject: string; html: string; text: string } {
  const rows = r.agents
    .map(
      (a) =>
        `<tr>${td(esc(a.name), 'left', INK, true)}${td(num(a.leads))}${td(num(a.accountsResearched), 'right', MUTED)}${td(num(a.contactsFound), 'right', MUTED)}${td(num(a.mql))}${td(num(a.sql))}${td(esc(a.verticals.slice(0, 3).map((v) => v.name).join(', ') || '—'), 'left', MUTED)}</tr>`,
    )
    .join('')
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${th('Member', 'left')}${th('Leads')}${th('Resrch')}${th('Contacts')}${th('MQL')}${th('SQL')}${th('Top industries', 'left')}</tr>
    ${rows}</table>`
  const industries = r.topVerticals.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid ${BORDER};border-radius:8px">
        <tr><td style="padding:12px 16px"><div style="font-size:13px;font-weight:bold;margin-bottom:8px">Leads by industry</div>${r.topVerticals
          .map((v) => `<div style="font-size:13px;padding:3px 0;border-bottom:1px solid ${BG}"><span style="color:${INK}">${esc(v.name)}</span><span style="float:right;font-weight:bold">${num(v.count)}</span></div>`)
          .join('')}</td></tr></table>`
    : ''
  const inner =
    kpiRow([
      { label: 'Total leads', value: num(r.team.leads) },
      { label: 'Qualified (MQL)', value: num(r.team.mql) },
      { label: 'Handed (SQL)', value: num(r.team.sql) },
      { label: 'MQL → SQL', value: pct(r.team.mqlToSqlRate) },
    ]) +
    (r.topAgent ? topPerformer(`${r.topAgent.name} · ${num(r.topAgent.leads)} leads`) : '') +
    industries +
    `<div style="font-size:13px;font-weight:bold;color:${INK};margin-bottom:8px">Per-agent — leads & funnel</div>` +
    table
  const text = [
    `Lead Generation — Monthly Team Report (${r.monthLabel})`,
    `Total leads: ${num(r.team.leads)} | MQL: ${r.team.mql} | SQL: ${r.team.sql} | MQL→SQL: ${pct(r.team.mqlToSqlRate)}`,
    r.topAgent ? `Top by leads: ${r.topAgent.name} (${num(r.topAgent.leads)})` : '',
    `Industries: ${r.topVerticals.map((v) => `${v.name} ${v.count}`).join(', ')}`,
    '',
    ...r.agents.map((a) => `${a.name}: leads ${num(a.leads)} | MQL ${a.mql} | SQL ${a.sql} | ${a.verticals.slice(0, 3).map((v) => v.name).join(', ')}`),
  ].filter(Boolean).join('\n')
  return { subject: `Lead Generation — Monthly Team Report · ${r.monthLabel}`, html: shell('Lead Generation', r.monthLabel, inner), text }
}

export function renderMonthlyReportEmail(report: MonthlyReport): { subject: string; html: string; text: string } {
  return report.department === 'ITAD' ? renderItad(report) : renderLeadGen(report)
}
