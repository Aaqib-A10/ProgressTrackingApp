import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  IconAttendance, IconBoard, IconChat, IconCheck, IconDialer, IconFingerprint, IconForm, IconReport, IconSheet, IconSticky, IconVideo, IconWhatsapp,
  IconBackup, IconKey, IconLock, IconNotes, IconSpark, IconSupport, IconWalls, MetriqMark,
} from './icons'
import { useInView } from './MarketingLayout'

/** The small moving pictures on the home page. Decoration only: hidden from screen readers. */

const d = (ms: number, extra?: CSSProperties) => ({ '--mk-delay': `${ms}ms`, ...extra }) as CSSProperties

/* ------------------------------------------------------------------ one app instead of six */

/**
 * The tools a team stops juggling. Each is an app-style tile in that kind of tool's colour with a
 * plain picture. To show a product's own logo instead, put its official file (from the maker's
 * press or brand page) in client/public/assets/site/logos/ under the name below; the tile uses
 * it when it is there.
 */
const OLD = [
  { label: 'WhatsApp groups', pain: 'Updates lost in the chat', Icon: IconWhatsapp, color: 'from-[#2fd36b] to-[#14a650]', logo: 'whatsapp.svg' },
  { label: 'Attendance machine', pain: 'A queue at the door', Icon: IconFingerprint, color: 'from-[#64748b] to-[#334155]', logo: 'attendance.svg' },
  { label: 'Spreadsheets of hours', pain: 'Totals typed by hand', Icon: IconSheet, color: 'from-[#22a35a] to-[#127a3c]', logo: 'sheets.svg' },
  { label: 'Google Forms reports', pain: 'Nobody reads them', Icon: IconForm, color: 'from-[#8b5cf6] to-[#6d28d9]', logo: 'forms.svg' },
  { label: 'Separate video calls', pain: 'Another link, another app', Icon: IconVideo, color: 'from-[#3b9bff] to-[#1d6fe0]', logo: 'video.svg' },
  { label: 'Sticky-note task lists', pain: 'Gone by Friday', Icon: IconSticky, color: 'from-[#fbd24e] to-[#f2a91c]', logo: 'notes.svg' },
]
const NEW = [
  { label: 'Attendance and hours', sub: 'Check-in, breaks, overtime', Icon: IconAttendance },
  { label: 'Projects and to-dos', sub: 'Boards, owners, due dates', Icon: IconBoard },
  { label: 'Chat, calls and meetings', sub: 'With AI meeting notes', Icon: IconChat },
  { label: 'Daily reports', sub: 'Filled in under a minute', Icon: IconReport },
]
// The drawing's own coordinates (1000 × 470); rows sit on these lines.
const H = 470
const OLD_Y = OLD.map((_, i) => 45 + i * 76)
const NEW_Y = NEW.map((_, i) => H / 2 + (i - 1.5) * 100)

function AppTile({ tool, size = 40 }: { tool: (typeof OLD)[number]; size?: number }) {
  const [own, setOwn] = useState<'try' | 'yes' | 'no'>('try')
  return (
    <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-[30%] bg-gradient-to-b text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_10px_-4px_rgb(0_0_0/0.35)]', tool.color)} style={{ width: size, height: size }}>
      {own !== 'no' && <img src={`/assets/site/logos/${tool.logo}`} alt="" onLoad={() => setOwn('yes')} onError={() => setOwn('no')} className={cn('absolute inset-0 z-[1] h-full w-full bg-white object-contain p-[18%]', own === 'yes' ? 'opacity-100' : 'opacity-0')} />}
      <tool.Icon size={Math.round(size * 0.52)} />
    </span>
  )
}

export function ConsolidateArt() {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <div ref={ref}>
      {/* Wide screens: six tools flow into Metriq, and out come four parts of one app. */}
      <div aria-hidden className="relative hidden lg:block" style={{ height: H }}>
        <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="mk-in" x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--ink-faint))" stopOpacity="0.25" /><stop offset="1" stopColor="rgb(var(--primary))" stopOpacity="0.9" /></linearGradient>
            <linearGradient id="mk-out" x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--primary))" /><stop offset="1" stopColor="rgb(6 182 212)" /></linearGradient>
          </defs>
          {OLD_Y.map((y, i) => {
            const d = `M318 ${y} C 410 ${y}, 400 ${H / 2}, 458 ${H / 2}`
            return (
              <g key={`a${y}`}>
                <path d={d} stroke="url(#mk-in)" strokeWidth={1.25} fill="none" vectorEffect="non-scaling-stroke" />
                {seen && <circle r="3.2" fill="rgb(var(--primary))"><animateMotion dur="2.8s" begin={`${i * 0.45}s`} repeatCount="indefinite" path={d} /><animate attributeName="opacity" values="0;1;1;0" dur="2.8s" begin={`${i * 0.45}s`} repeatCount="indefinite" /></circle>}
              </g>
            )
          })}
          {NEW_Y.map((y, i) => {
            const d = `M542 ${H / 2} C 600 ${H / 2}, 600 ${y}, 676 ${y}`
            return (
              <g key={`b${y}`}>
                <path d={d} stroke="url(#mk-out)" strokeWidth={1.75} fill="none" vectorEffect="non-scaling-stroke" />
                {seen && <circle r="3.6" fill="rgb(34 211 238)"><animateMotion dur="2.2s" begin={`${1.4 + i * 0.35}s`} repeatCount="indefinite" path={d} /><animate attributeName="opacity" values="0;1;1;0" dur="2.2s" begin={`${1.4 + i * 0.35}s`} repeatCount="indefinite" /></circle>}
              </g>
            )
          })}
        </svg>
        {OLD.map((tool, i) => (
          <div key={tool.label} className={cn('mk-reveal absolute right-[68.2%] flex w-[290px] -translate-y-1/2 items-center gap-3 rounded-[16px] border border-line bg-card/90 p-2 pr-4 shadow-[0_6px_20px_-12px_rgb(var(--shadow)/0.35)] backdrop-blur', seen && 'mk-in')} style={{ top: `${(OLD_Y[i] / H) * 100}%`, ...d(i * 80) }}>
            <span className="relative">
              <AppTile tool={tool} />
              <span className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-card text-danger shadow ring-1 ring-line transition-transform duration-500" style={{ transform: seen ? 'scale(1)' : 'scale(0)', transitionDelay: `${900 + i * 140}ms` }}><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></span>
            </span>
            <span className="min-w-0">
              <span className="relative block truncate text-[14px] font-semibold text-ink-muted">{tool.label}<span className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left bg-ink-faint/80 transition-transform duration-700" style={{ transform: seen ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: `${900 + i * 140}ms` }} /></span>
              <span className="block truncate text-[12.5px] text-ink-faint">{tool.pain}</span>
            </span>
          </div>
        ))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="mk-pulse-ring absolute inset-0 rounded-[30px] border-2 border-primary/50" />
          <span className="mk-pulse-ring absolute inset-0 rounded-[30px] border-2 border-cyan-400/40" style={{ animationDelay: '1.3s' }} />
          <span className="mk-orbit absolute -inset-6 rounded-full border border-dashed border-primary/25" style={{ '--mk-dur': '30s' } as CSSProperties} />
          <div className="relative flex h-[84px] w-[84px] items-center justify-center rounded-[26px] bg-card shadow-[0_16px_50px_-10px_rgb(var(--primary)/0.65)] ring-1 ring-primary/30">
            <MetriqMark size={54} />
          </div>
        </div>
        {NEW.map(({ label, sub, Icon }, i) => (
          <div key={label} className={cn('mk-reveal absolute left-[67.6%] flex w-[300px] -translate-y-1/2 items-center gap-3 rounded-[16px] border border-primary/20 bg-card p-2.5 pr-4 shadow-[0_10px_30px_-16px_rgb(var(--primary)/0.7)]', seen && 'mk-in')} style={{ top: `${(NEW_Y[i] / H) * 100}%`, ...d(600 + i * 110) }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-b from-primary to-[#4338ca] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]"><Icon size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold text-ink">{label}</span>
              <span className="block truncate text-[12.5px] text-ink-muted">{sub}</span>
            </span>
            <span className="relative flex h-2 w-2"><span className="mk-ping absolute inset-0 rounded-full bg-success/60" style={{ animationDelay: `${i * 0.4}s` }} /><span className="relative h-2 w-2 rounded-full bg-success" /></span>
          </div>
        ))}
      </div>

      {/* Phones and tablets: the same story, top to bottom. */}
      <div aria-hidden className="lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
          {OLD.map((tool) => (
            <span key={tool.label} className="flex items-center gap-2 rounded-[14px] border border-line bg-card p-1.5 pr-2.5">
              <AppTile tool={tool} size={30} />
              <span className="min-w-0 truncate text-[12.5px] text-ink-muted line-through decoration-ink-faint/70">{tool.label}</span>
            </span>
          ))}
        </div>
        <div className="mx-auto my-5 flex w-fit flex-col items-center">
          <span className="h-8 w-px bg-gradient-to-b from-transparent to-primary" />
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-card shadow-[0_12px_40px_-8px_rgb(var(--primary)/0.55)] ring-1 ring-primary/30"><MetriqMark size={42} /></div>
          <span className="h-8 w-px bg-gradient-to-b from-primary to-transparent" />
        </div>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
          {NEW.map(({ label, Icon }) => (
            <span key={label} className="flex items-center gap-2 rounded-[12px] border border-primary/25 bg-card p-2 text-[13.5px] font-semibold text-ink">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary text-white"><Icon size={16} /></span>{label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ bento pictures */

const KINDS = ['General', 'Sales calling', 'Lead Generation', 'Marketing', 'E-commerce', 'Inventory', 'Customer service']

export function TeamsArt() {
  const rows = [
    { name: 'Lead Dialer', on: true, d: 0 },
    { name: 'Daily calls log', on: true, d: 900 },
    { name: 'Quality Assurance', on: false, d: 1800 },
    { name: 'Inventory', on: false, d: 2700 },
  ]
  return (
    <div aria-hidden className="relative mt-6 grid gap-4 sm:grid-cols-[1fr_1.05fr]">
      <div className="space-y-2.5 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_15%,#000_85%,transparent)]">
        {[0, 1].map((r) => (
          <div key={r} className={cn('mk-marquee gap-2', r === 1 && 'mk-marquee-rev')}>
            {[...KINDS, ...KINDS].map((k, i) => (
              <span key={i} className={cn('whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px]', (i % 7) === (r ? 3 : 1) ? 'border-primary/40 bg-primary/10 font-semibold text-primary' : 'border-line bg-card text-ink-muted')}>{k}</span>
            ))}
          </div>
        ))}
        <p className="pt-1 text-center text-[12px] text-ink-faint">Seven kinds of work, each with its own screens</p>
      </div>
      <div className="rounded-[12px] border border-line bg-card p-3 shadow-raised">
        <p className="px-1 text-[12px] font-semibold text-ink">Sales 2 · Member menu</p>
        <ul className="mt-2 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between px-1 py-2 text-[13px] text-ink-muted">
              {r.name}
              <span className="mk-toggle relative h-[16px] w-[28px] rounded-full bg-line-strong" style={d(r.d)}><i className="absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-white shadow" /></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function RolesArt() {
  const rows: [string, boolean[]][] = [
    ['Sends a daily report', [true, true, true]],
    ['Sees the team’s reports', [false, true, true]],
    ['Changes settings', [false, false, true]],
  ]
  return (
    <div aria-hidden className="mt-6 rounded-[12px] border border-line bg-card p-3 shadow-raised">
      <div className="grid grid-cols-[1fr_repeat(3,50px)] items-center gap-y-2.5 text-[11.5px]">
        <span />
        {['Member', 'Lead', 'Admin'].map((r) => <span key={r} className="text-center font-semibold text-ink-muted">{r}</span>)}
        {rows.map(([label, cols], i) => (
          <Row key={label} label={label}>
            {cols.map((on, c) => (
              <span key={c} className="flex justify-center">
                <span className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border text-transparent', on ? 'mk-tick-on' : 'border-line-strong bg-slate-50')} style={d(c * 350 + i * 220)}>
                  <IconCheck size={12} />
                </span>
              </span>
            ))}
          </Row>
        ))}
      </div>
    </div>
  )
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => <><span className="truncate pr-2 text-[12.5px] text-ink">{label}</span>{children}</>

export function NotesArt() {
  const bars = [0.4, 0.8, 0.55, 1, 0.65, 0.9, 0.35, 0.75, 0.5, 0.95, 0.6, 0.8, 0.45, 0.7, 0.3, 0.85, 0.55, 0.9, 0.4, 0.65]
  return (
    <div aria-hidden className="mt-6 rounded-[12px] border border-line bg-card p-3 shadow-raised">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
        <span className="relative flex h-2.5 w-2.5"><span className="mk-ping absolute inset-0 rounded-full bg-danger/60" /><span className="relative h-2.5 w-2.5 rounded-full bg-danger" /></span>
        Recording · Weekly sales call
      </div>
      <div className="mt-3 flex h-8 items-center gap-[3px]">
        {bars.map((b, i) => <span key={i} className="mk-wave-bar w-[3px] flex-1 rounded-full bg-primary/70" style={d(i * 60, { height: `${b * 100}%` })} />)}
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px]">
        <p className="mk-appear flex items-start gap-1.5 text-ink" style={d(0, { '--mk-dur': '7s' } as CSSProperties)}><IconSpark size={13} className="mt-0.5 shrink-0 text-primary" />Omar sends the forklift quote by Friday</p>
        <p className="mk-appear flex items-start gap-1.5 text-ink" style={d(500, { '--mk-dur': '7s' } as CSSProperties)}><IconSpark size={13} className="mt-0.5 shrink-0 text-primary" />Hina books the warehouse visit</p>
      </div>
    </div>
  )
}

export function AskArt() {
  const q = 'Who has not sent today’s daily report?'
  return (
    <div aria-hidden className="mt-6 space-y-3 rounded-[12px] border border-line bg-card p-4 shadow-raised">
      <div className="flex justify-end">
        <p className="rounded-[12px] rounded-br-[4px] bg-primary px-3 py-2 text-[13px] text-white"><span className="mk-type" style={{ '--mk-steps': q.length, '--mk-dur': '9s' } as CSSProperties}>{q}</span></p>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan-500 text-white"><IconSpark size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="mk-appear text-[13px] text-ink" style={{ '--mk-dur': '9s', '--mk-delay': '0.4s' } as CSSProperties}>Two people, both in Sales:</p>
          <div className="mk-appear mt-2 flex flex-wrap gap-2" style={{ '--mk-dur': '9s', '--mk-delay': '0.9s' } as CSSProperties}>
            {[['OF', 'Omar F.', 'bg-violet-500'], ['HR', 'Hina R.', 'bg-teal-500']].map(([i, n, c]) => (
              <span key={n} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg py-0.5 pl-0.5 pr-2.5 text-[12.5px] text-ink">
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white', c)}>{i}</span>{n}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-faint">Ask Claude, connected to your Metriq <span className="mk-dots text-ink-faint"><span /><span /><span /></span></p>
    </div>
  )
}

const ZONES = [{ city: 'Karachi', tz: 'Asia/Karachi' }, { city: 'London', tz: 'Europe/London' }, { city: 'New York', tz: 'America/New_York' }]

function useNow(on: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function ClocksArt() {
  const [ref, seen] = useInView<HTMLDivElement>()
  const now = useNow(seen)
  return (
    <div ref={ref} aria-hidden className="mt-6 grid grid-cols-3 gap-2">
      {ZONES.map((z) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: z.tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, Number(p.value)]))
        const h = parts.hour ?? 0, m = parts.minute ?? 0, s = parts.second ?? 0
        const hand = (deg: number, len: number, w: number, cls: string) => <line x1="20" y1="20" x2="20" y2={20 - len} strokeWidth={w} strokeLinecap="round" className={cls} style={{ transform: `rotate(${deg}deg)`, transformOrigin: '20px 20px' }} />
        return (
          <div key={z.city} className="flex flex-col items-center rounded-[12px] border border-line bg-card px-2 py-3 shadow-xs">
            <svg width="56" height="56" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="18" className="fill-bg stroke-line-strong" strokeWidth="1" />
              {Array.from({ length: 12 }, (_, i) => <line key={i} x1="20" y1="3.5" x2="20" y2={i % 3 ? 5 : 6.5} strokeWidth={i % 3 ? 0.8 : 1.3} className="stroke-ink-faint" style={{ transform: `rotate(${i * 30}deg)`, transformOrigin: '20px 20px' }} />)}
              {hand((h % 12) * 30 + m / 2, 9, 2, 'stroke-ink')}
              {hand(m * 6 + s / 10, 13, 1.4, 'stroke-ink')}
              {hand(s * 6, 14, 0.8, 'stroke-primary')}
              <circle cx="20" cy="20" r="1.4" className="fill-primary" />
            </svg>
            <p className="mt-1.5 text-[12.5px] font-semibold text-ink">{z.city}</p>
            <p className="text-[11.5px] tabular-nums text-ink-muted">{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}</p>
          </div>
        )
      })}
    </div>
  )
}

export function PhoneArt() {
  const [ref, seen] = useInView<HTMLDivElement>()
  const now = useNow(seen)
  const [start] = useState(() => Date.now() - (3 * 3600 + 7 * 60) * 1000)
  const secs = Math.max(0, Math.floor((now.getTime() - start) / 1000))
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60
  return (
    <div ref={ref} aria-hidden className="relative mt-6 flex h-[200px] justify-center overflow-hidden sm:h-[180px]">
      <div className="mk-float w-[190px] rounded-t-[30px] border-[6px] border-b-0 border-ink/85 bg-card px-4 pt-5 shadow-overlay dark:border-white/20">
        <div className="mx-auto -mt-2 mb-3 h-1.5 w-12 rounded-full bg-ink/15" />
        <p className="text-[11px] font-semibold text-ink-muted">Wednesday · Office Wi-Fi</p>
        <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight text-ink">{hh}:{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</p>
        <p className="flex items-center gap-1.5 text-[11.5px] text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />Working</p>
        <div className="relative mt-4">
          <span className="mk-ping absolute inset-0 rounded-[10px] bg-primary/40" />
          <span className="relative flex h-9 items-center justify-center rounded-[10px] bg-primary text-[13px] font-semibold text-white">Take a break</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ getting started */

export function StepArt({ step }: { step: number }) {
  if (step === 0) {
    const name = 'Northgate Foods'
    return (
      <div aria-hidden className="space-y-2 rounded-[12px] border border-line bg-card p-3 text-[12.5px] shadow-xs">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">Company name</p>
          <div className="mt-1 flex h-8 items-center rounded-[8px] border border-primary/50 px-2.5 ring-2 ring-primary/15">
            <span className="mk-type text-ink" style={{ '--mk-steps': name.length, '--mk-dur': '6s' } as CSSProperties}>{name}</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-ink-muted">Time zone</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-ink">Asia/Karachi</span>
        </div>
      </div>
    )
  }
  if (step === 1) {
    const teams = [['Sales', 'Sales calling'], ['Operations', 'Inventory'], ['Marketing', 'Marketing']]
    return (
      <div aria-hidden className="space-y-1.5 rounded-[12px] border border-line bg-card p-3 text-[12.5px] shadow-xs">
        {teams.map(([n, k], i) => (
          <div key={n} className="mk-appear flex items-center justify-between rounded-[8px] border border-line bg-bg px-2.5 py-1.5" style={{ '--mk-delay': `${i * 0.35}s`, '--mk-dur': '6s' } as CSSProperties}>
            <span className="font-medium text-ink">{n}</span><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{k}</span>
          </div>
        ))}
      </div>
    )
  }
  const people = [['SA', 'bg-indigo-500'], ['OF', 'bg-violet-500'], ['HR', 'bg-teal-500'], ['AK', 'bg-emerald-500'], ['MZ', 'bg-amber-500']]
  return (
    <div aria-hidden className="rounded-[12px] border border-line bg-card p-3 text-[12.5px] shadow-xs">
      <div className="flex -space-x-2">
        {people.map(([i, c], j) => (
          <span key={i} className={cn('mk-appear flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-card', c)} style={{ '--mk-delay': `${j * 0.25}s`, '--mk-dur': '6s' } as CSSProperties}>{i}</span>
        ))}
      </div>
      <p className="mk-appear mt-2.5 flex items-center gap-1.5 font-medium text-success" style={{ '--mk-delay': '1.4s', '--mk-dur': '6s' } as CSSProperties}><IconCheck size={14} />5 invites sent</p>
    </div>
  )
}

/* ------------------------------------------------------------------ security */

/** What the security screen checks, in order. All of it is what Metriq does today. */
const CHECKS = [
  { icon: IconWalls, label: 'Company walls', note: 'App and database' },
  { icon: IconLock, label: 'HTTPS on every request', note: 'TLS' },
  { icon: IconKey, label: 'Passwords hashed', note: 'One-way, never text' },
  { icon: IconBackup, label: 'Nightly backup', note: 'Last: 2:00 AM' },
] as const

/** The activity log's lines (made-up people), arriving one at a time. */
const LOG = [
  { who: 'SK', name: 'Sara Khan', what: 'signed in with Google', tone: 'text-emerald-300' },
  { who: 'BK', name: 'Backup', what: 'finished · database and files', tone: 'text-cyan-300' },
  { who: 'AR', name: 'Ali Raza', what: 'made Hina a team lead', tone: 'text-violet-300' },
  { who: 'HN', name: 'Hina Noor', what: 'checked in · office network', tone: 'text-emerald-300' },
  { who: 'SA', name: 'Super Admin', what: 'turned support access off', tone: 'text-amber-300' },
  { who: 'UA', name: 'Usman Ali', what: 'exported March attendance', tone: 'text-cyan-300' },
] as const

const TIMES = ['09:41', '09:38', '09:32', '09:30', '09:26', '09:21', '09:17']

/**
 * Security, as a real screen: the company's security checks run one by one and tick, the support
 * switch sits off (our team gets in only when the Super Admin allows it), and the activity log
 * keeps filling in. Everything shown is something Metriq does today; the names are made up.
 */
export function SecurityArt() {
  const [ref, seen] = useInView<HTMLDivElement>()
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [done, setDone] = useState(reduced ? CHECKS.length : 0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!seen || reduced) return
    let n = 0
    const a = window.setInterval(() => { n++; setDone(n); if (n >= CHECKS.length) window.clearInterval(a) }, 650)
    const b = window.setInterval(() => setTick((t) => t + 1), 2600)
    return () => { window.clearInterval(a); window.clearInterval(b) }
  }, [seen, reduced])
  const all = done >= CHECKS.length
  // The newest four lines, newest on top; each new one slides in.
  const rows = [0, 1, 2, 3].map((k) => ({ ...LOG[(tick - k + LOG.length * 100) % LOG.length], key: tick - k, time: TIMES[k] }))

  return (
    <div ref={ref} aria-hidden className="relative mx-auto w-full max-w-[480px] select-none text-white">
      {/* Soft light behind the window */}
      <div className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(60%_50%_at_50%_30%,rgb(var(--primary)/0.35),transparent_70%)] blur-2xl" />
      <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-[#11131b]/95 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] backdrop-blur">
        <div className="flex h-9 items-center gap-1.5 border-b border-white/[0.07] px-3.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 text-[11px] font-medium text-white/45">Settings · Security</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300"><IconLock size={10} />HTTPS</span>
        </div>

        {/* Status */}
        <div className="flex items-center gap-4 px-5 pb-4 pt-5">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <span className={cn('mk-sec-ring absolute inset-0 rounded-full', all && 'mk-sec-ring-on')} />
            <span className="absolute inset-[3px] rounded-full bg-[#11131b]" />
            <svg viewBox="0 0 24 24" width="26" height="26" className="relative" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6l-7-3Z" stroke="rgb(165 180 252)" strokeWidth={1.6} fill="rgb(99 102 241 / 0.18)" />
              <path d="m8.8 12.2 2.2 2.2 4.3-4.6" stroke="rgb(110 231 183)" strokeWidth={2} className={cn('mk-sec-tick', all && 'mk-sec-tick-on')} />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-[-0.01em]">{all ? 'All checks passing' : 'Checking your company…'}</p>
            <p className="mt-0.5 text-[12px] text-white/50">Northgate Foods · 48 people</p>
          </div>
          <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors duration-500', all ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[0.06] text-white/50')}>{all ? 'Protected' : `${done}/${CHECKS.length}`}</span>
        </div>

        <ul className="mx-3 space-y-1 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-1.5">
          {CHECKS.map((c, i) => {
            const Icon = c.icon
            const ok = i < done, now = i === done
            return (
              <li key={c.label} className={cn('relative flex items-center gap-3 overflow-hidden rounded-[10px] px-2.5 py-2 transition-colors duration-500', now && 'bg-white/[0.04]')}>
                {now && <span className="mk-sec-sweep absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-indigo-400/15 to-transparent" />}
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-500', ok ? 'bg-indigo-400/15 text-indigo-200' : 'bg-white/[0.05] text-white/35')}><Icon size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[12.5px] font-medium transition-colors duration-500', ok ? 'text-white' : 'text-white/55')}>{c.label}</span>
                  <span className="block truncate text-[10.5px] text-white/40">{c.note}</span>
                </span>
                <span className="relative flex h-5 w-5 items-center justify-center">
                  {ok ? (
                    <span className="mk-sec-pop flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[#0b0c10]"><IconCheck size={12} /></span>
                  ) : now ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-indigo-300" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                  )}
                </span>
              </li>
            )
          })}
          {/* Support access: off until the Super Admin allows it */}
          <li className="flex items-center gap-3 rounded-[10px] px-2.5 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.05] text-amber-200"><IconSupport size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-white">Support access</span>
              <span className="block truncate text-[10.5px] text-white/40">Only when you allow it, up to a week</span>
            </span>
            <span className="relative h-5 w-9 rounded-full bg-white/[0.12]"><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white/70 shadow" /></span>
          </li>
        </ul>

        {/* Activity log */}
        <div className="px-5 pb-5 pt-4">
          <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">Activity log<span className="flex items-center gap-1.5 normal-case tracking-normal text-emerald-300/80"><span className="mk-sec-live h-1.5 w-1.5 rounded-full bg-emerald-400" />Live</span></p>
          <ul className="relative mt-2.5 h-[136px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_62%,transparent)]">
            {rows.map((r, k) => (
              <li key={r.key} className={cn('absolute inset-x-0 flex items-center gap-2.5 transition-all duration-700 ease-out', k === 0 && tick > 0 && 'mk-sec-in')} style={{ top: k * 37 }}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[10px] font-bold text-white/80">{r.who}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-white/60"><span className="font-semibold text-white">{r.name}</span> {r.what}</span>
                <span className={cn('font-mono text-[10.5px] tabular-nums', k === 0 ? r.tone : 'text-white/35')}>{r.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ closing call */

/**
 * The closing call: the app's parts circle the words on an oval that always fits inside the box
 * (it is measured), passing behind and in front like a slow carousel. Still with reduced motion.
 */
export function OrbitArt() {
  const ring = [IconAttendance, IconBoard, IconChat, IconReport, IconDialer, IconNotes]
  const box = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const start = performance.now()
    const place = (now: number) => {
      const w = el.clientWidth, h = el.clientHeight
      const icon = w < 640 ? 40 : 52
      // The oval stays a full icon inside every edge.
      const rx = w / 2 - icon * 0.9, ry = h / 2 - icon * 0.8
      const turn = still ? 0 : ((now - start) / 60000) * Math.PI * 2
      items.current.forEach((n, i) => {
        if (!n) return
        const a = turn + (i / ring.length) * Math.PI * 2
        const depth = (Math.sin(a) + 1) / 2 // 0 at the top (far), 1 at the bottom (near)
        const x = w / 2 + rx * Math.cos(a) - icon / 2, y = h / 2 + ry * Math.sin(a) - icon / 2
        n.style.width = n.style.height = `${icon}px`
        n.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${0.72 + depth * 0.38})`
        n.style.opacity = String(0.35 + depth * 0.65)
        n.style.zIndex = depth > 0.55 ? '2' : '0'
      })
      if (!still) raf = requestAnimationFrame(place)
    }
    raf = requestAnimationFrame(place)
    const ro = new ResizeObserver(() => { if (still) place(performance.now()) })
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [ring.length])
  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-[9%] rounded-[50%] border border-white/[0.07]" />
      <div className="absolute inset-[18%] rounded-[50%] border border-dashed border-white/[0.06]" />
      {ring.map((Icon, i) => (
        <span key={i} ref={(n) => { items.current[i] = n }} className="absolute left-0 top-0 flex items-center justify-center rounded-[30%] border border-white/15 bg-white/10 text-white shadow-[0_10px_30px_-10px_rgb(0_0_0/0.6)] backdrop-blur will-change-transform">
          <Icon size={22} />
        </span>
      ))}
    </div>
  )
}
