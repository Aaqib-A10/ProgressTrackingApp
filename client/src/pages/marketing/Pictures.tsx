import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  IconAttendance, IconBoard, IconChat, IconCheck, IconDialer, IconFingerprint, IconForm, IconReport, IconSheet, IconSticky, IconVideo, IconWhatsapp,
  IconBackup, IconKey, IconLock, IconSpark, IconWalls, MetriqMark,
} from './icons'
import { useInView } from './MarketingLayout'

/** The small moving pictures on the home page. Decoration only: hidden from screen readers. */

const d = (ms: number, extra?: CSSProperties) => ({ '--mk-delay': `${ms}ms`, ...extra }) as CSSProperties

/* ------------------------------------------------------------------ one app instead of six */

const OLD = [
  { label: 'WhatsApp groups', Icon: IconWhatsapp },
  { label: 'Attendance machine', Icon: IconFingerprint },
  { label: 'Spreadsheets of hours', Icon: IconSheet },
  { label: 'Google Forms reports', Icon: IconForm },
  { label: 'Separate video calls', Icon: IconVideo },
  { label: 'Sticky-note task lists', Icon: IconSticky },
]
const NEW = [
  { label: 'Attendance and hours', Icon: IconAttendance },
  { label: 'Projects and to-dos', Icon: IconBoard },
  { label: 'Chat, calls and meetings', Icon: IconChat },
  { label: 'Daily reports', Icon: IconReport },
]
// The drawing's own coordinates (1000 × 440); rows sit on these lines.
const OLD_Y = OLD.map((_, i) => 40 + i * 72)
const NEW_Y = NEW.map((_, i) => 220 + (i - 1.5) * 92)

export function ConsolidateArt() {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <div ref={ref}>
      {/* Wide screens: six tools flow into Metriq, and out come four parts of one app. */}
      <div aria-hidden className="relative hidden h-[440px] lg:block">
        <svg viewBox="0 0 1000 440" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="mk-in" x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--ink-faint))" stopOpacity="0.35" /><stop offset="1" stopColor="rgb(var(--primary))" /></linearGradient>
            <linearGradient id="mk-out" x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--primary))" /><stop offset="1" stopColor="rgb(6 182 212)" /></linearGradient>
          </defs>
          {OLD_Y.map((y) => <path key={`a${y}`} d={`M300 ${y} C 400 ${y}, 400 220, 462 220`} stroke="url(#mk-in)" strokeWidth={1.5} fill="none" vectorEffect="non-scaling-stroke" className={cn(seen && 'mk-flow')} />)}
          {NEW_Y.map((y) => <path key={`b${y}`} d={`M538 220 C 600 220, 600 ${y}, 690 ${y}`} stroke="url(#mk-out)" strokeWidth={1.75} fill="none" vectorEffect="non-scaling-stroke" className={cn(seen && 'mk-flow')} />)}
        </svg>
        {OLD.map(({ label, Icon }, i) => (
          <div key={label} className={cn('mk-reveal absolute right-[70%] flex -translate-y-1/2 items-center gap-3 rounded-full border border-line bg-card py-1.5 pl-1.5 pr-4 text-[14px] text-ink-muted shadow-xs', seen && 'mk-in')} style={{ top: `${(OLD_Y[i] / 440) * 100}%`, ...d(i * 70) }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-ink-faint"><Icon size={16} /></span>
            <span className="relative">{label}<span className="absolute inset-x-0 top-1/2 h-px origin-left bg-ink-faint/70 transition-transform duration-700" style={{ transform: seen ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: `${700 + i * 120}ms` }} /></span>
          </div>
        ))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="mk-pulse-ring absolute inset-0 rounded-[28px] border-2 border-primary/50" />
          <span className="mk-pulse-ring absolute inset-0 rounded-[28px] border-2 border-primary/40" style={{ animationDelay: '1.3s' }} />
          <div className="relative flex h-[76px] w-[76px] items-center justify-center rounded-[24px] bg-card shadow-[0_12px_40px_-8px_rgb(var(--primary)/0.55)] ring-1 ring-primary/30">
            <MetriqMark size={50} />
          </div>
        </div>
        {NEW.map(({ label, Icon }, i) => (
          <div key={label} className={cn('mk-reveal absolute left-[69%] flex -translate-y-1/2 items-center gap-3 rounded-[12px] border border-primary/25 bg-card py-2 pl-2 pr-4 text-[14.5px] font-semibold text-ink shadow-[0_6px_20px_-10px_rgb(var(--primary)/0.6)]', seen && 'mk-in')} style={{ top: `${(NEW_Y[i] / 440) * 100}%`, ...d(500 + i * 90) }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><Icon size={18} /></span>
            {label}
          </div>
        ))}
      </div>

      {/* Phones and tablets: the same story, top to bottom. */}
      <div aria-hidden className="lg:hidden">
        <div className="flex flex-wrap justify-center gap-2">
          {OLD.map(({ label, Icon }) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-[13px] text-ink-muted">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-ink-faint"><Icon size={14} /></span><span className="line-through decoration-ink-faint/70">{label}</span>
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
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary"><Icon size={16} /></span>{label}
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

export function WallsArt() {
  const tiles = Array.from({ length: 9 }, (_, i) => i)
  return (
    <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[360px]">
      <svg viewBox="0 0 360 360" className="absolute inset-0 h-full w-full">
        <circle cx="180" cy="180" r="170" fill="none" stroke="rgb(255 255 255 / 0.08)" />
        <circle cx="180" cy="180" r="130" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeDasharray="3 7" className="mk-orbit" style={{ transformOrigin: '180px 180px', '--mk-dur': '60s' } as CSSProperties} />
      </svg>
      <div className="absolute inset-[18%] grid grid-cols-3 gap-3">
        {tiles.map((i) => (
          <div key={i} className={cn('relative flex items-center justify-center rounded-[14px] border', i === 4 ? 'border-primary/70 bg-primary/20 shadow-[0_0_40px_-6px_rgb(var(--primary)/0.8)]' : 'border-white/10 bg-white/[0.04]')}>
            {i === 4
              ? <span className="text-white"><IconWalls size={30} /></span>
              : <span className="h-2 w-8 rounded-full bg-white/10" />}
            {i === 4 && <span className="mk-scan absolute inset-x-2 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />}
          </div>
        ))}
      </div>
      {[IconLock, IconBackup, IconKey].map((Icon, i) => (
        <div key={i} className="absolute inset-0 mk-orbit" style={{ '--mk-dur': '36s', animationDelay: `${-i * 12}s` } as CSSProperties}>
          <span className="mk-upright absolute left-1/2 top-0 -ml-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#14161c] text-cyan-200 shadow-lg" style={{ '--mk-dur': '36s', animationDelay: `${-i * 12}s` } as CSSProperties}><Icon size={18} /></span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ closing call */

export function OrbitArt() {
  const ring = [IconAttendance, IconBoard, IconChat, IconReport, IconDialer]
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 opacity-90">
      <div className="absolute inset-0 rounded-full border border-white/10" />
      <div className="absolute inset-[90px] rounded-full border border-white/[0.07]" />
      <div className="mk-orbit absolute inset-0" style={{ '--mk-dur': '50s' } as CSSProperties}>
        {ring.map((Icon, i) => {
          const a = (i / ring.length) * Math.PI * 2
          return (
            <span key={i} className="absolute" style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%` }}>
              <span className="mk-upright -ml-6 -mt-6 flex h-12 w-12 items-center justify-center rounded-[14px] border border-white/15 bg-white/10 text-white backdrop-blur" style={{ '--mk-dur': '50s' } as CSSProperties}><Icon size={22} /></span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
