import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, Zap, Users, TrendingUp, KanbanSquare, LayoutDashboard, CalendarDays,
  FileBarChart, Target, Clock, Smartphone, Star, ArrowRight, ChevronDown,
} from 'lucide-react'
import { Button } from '../components/ui/Button'

const img = (name: string) => `/assets/images/${name}`

// Brand glyphs — lucide dropped its brand icons (trademark), so these are inline.
type BrandIcon = (p: { className?: string }) => ReactNode
const SOCIALS: { label: string; href: string; Icon: BrandIcon }[] = [
  {
    label: 'Facebook',
    href: '#',
    Icon: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.43-4.94 8.43-9.94Z" />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: '#',
    Icon: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M12 2c2.72 0 3.06.01 4.12.06 1.07.05 1.8.22 2.43.47.66.25 1.22.6 1.77 1.15.55.55.9 1.11 1.15 1.77.25.63.42 1.36.47 2.43.05 1.07.06 1.4.06 4.12s-.01 3.06-.06 4.12c-.05 1.07-.22 1.8-.47 2.43a4.9 4.9 0 0 1-1.15 1.77c-.55.55-1.11.9-1.77 1.15-.63.25-1.36.42-2.43.47-1.07.05-1.4.06-4.12.06s-3.06-.01-4.12-.06c-1.07-.05-1.8-.22-2.43-.47a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.25-.63-.42-1.36-.47-2.43C2.01 15.06 2 14.72 2 12s.01-3.06.06-4.12c.05-1.07.22-1.8.47-2.43.25-.66.6-1.22 1.15-1.77.55-.55 1.11-.9 1.77-1.15.63-.25 1.36-.42 2.43-.47C8.94 2.01 9.28 2 12 2Zm0 1.8c-2.67 0-2.99.01-4.04.06-.98.04-1.5.2-1.86.34-.47.18-.8.4-1.15.75-.35.35-.57.68-.75 1.15-.14.36-.3.88-.34 1.86-.05 1.05-.06 1.37-.06 4.04s.01 2.99.06 4.04c.04.98.2 1.5.34 1.86.18.47.4.8.75 1.15.35.35.68.57 1.15.75.36.14.88.3 1.86.34 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.98-.04 1.5-.2 1.86-.34.47-.18.8-.4 1.15-.75.35-.35.57-.68.75-1.15.14-.36.3-.88.34-1.86.05-1.05.06-1.37.06-4.04s-.01-2.99-.06-4.04c-.04-.98-.2-1.5-.34-1.86a3.1 3.1 0 0 0-.75-1.15 3.1 3.1 0 0 0-1.15-.75c-.36-.14-.88-.3-1.86-.34-1.05-.05-1.37-.06-4.04-.06Zm0 3.07a5.13 5.13 0 1 1 0 10.26 5.13 5.13 0 0 1 0-10.26Zm0 1.8a3.33 3.33 0 1 0 0 6.66 3.33 3.33 0 0 0 0-6.66Zm5.34-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
      </svg>
    ),
  },
  {
    label: 'LinkedIn',
    href: '#',
    Icon: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
      </svg>
    ),
  },
  {
    label: 'X',
    href: '#',
    Icon: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25H8.1l4.71 6.23 5.43-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.04l12.04 15.64Z" />
      </svg>
    ),
  },
  {
    label: 'YouTube',
    href: '#',
    Icon: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2C0 8.09 0 12 0 12s0 3.91.5 5.8a3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14C24 15.91 24 12 24 12s0-3.91-.5-5.8ZM9.6 15.57V8.43L15.82 12 9.6 15.57Z" />
      </svg>
    ),
  },
]

const VERSATILE: { icon: ReactNode; title: string; img: string }[] = [
  { icon: <KanbanSquare size={18} />, title: 'Kanban boards', img: 'f-kanban.jpg' },
  { icon: <LayoutDashboard size={18} />, title: 'Department dashboards', img: 'f-dashboard.jpg' },
  { icon: <TrendingUp size={18} />, title: '3-month trend analytics', img: 'f-trends.jpg' },
  { icon: <Zap size={18} />, title: 'One-minute daily logging', img: 'f-logging.jpg' },
  { icon: <Users size={18} />, title: 'Live team visibility', img: 'f-team.jpg' },
  { icon: <CalendarDays size={18} />, title: 'Editorial calendar', img: 'f-calendar.jpg' },
  { icon: <FileBarChart size={18} />, title: 'Automated reports & export', img: 'f-reports.jpg' },
  { icon: <Target size={18} />, title: 'Targets & status flags', img: 'f-targets.jpg' },
  { icon: <Clock size={18} />, title: 'Leave-aware metrics', img: 'f-timetracking.jpg' },
  { icon: <Smartphone size={18} />, title: 'Mobile-friendly logging', img: 'f-mobile.jpg' },
]

const FAQS = [
  { q: 'What is PulseTrack?', a: 'An internal progress-tracking app that replaces manual daily, weekly and monthly reports with structured updates, live team dashboards and trend analytics — one source of truth for every department.' },
  { q: 'Is it really free to start?', a: 'Yes. Create an account, add your team and start logging — no credit card required and no per-seat limit to get going.' },
  { q: 'How long does setup take?', a: 'Minutes. Pick your department, set a couple of targets, invite your team, and your dashboards start populating from the first submission.' },
  { q: 'Can each department track different metrics?', a: 'Absolutely. ITAD tracks calling KPIs, Lead Gen tracks the MQL→SQL funnel by vertical, and Marketing runs SEO/Social/Content with a Kanban board and editorial calendar.' },
  { q: 'Does it work on mobile?', a: 'Yes — the daily entry form is responsive and thumb-friendly, so agents can log progress on the go.' },
  { q: 'Can I export reports?', a: 'Team reports export to CSV (opens in Excel) on demand, and weekly/monthly roll-ups are generated automatically.' },
]

/** Section heading with a small avatar pill (e.g. "It's free  👤"). */
function SectionLabel({ text, avatar }: { text: string; avatar: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[1.9rem] font-bold tracking-tight text-primary sm:text-[2.1rem]">{text}</h2>
      <span className="h-9 w-16 shrink-0 overflow-hidden rounded-full bg-primary/15 ring-1 ring-primary/20">
        <img src={img(avatar)} alt="" className="h-full w-full object-cover" />
      </span>
    </div>
  )
}

/** Outlined pill CTA used across the labeled sections. */
function OutlineCta({ label = 'Get for free' }: { label?: string }) {
  return (
    <Link to="/signup" className="mt-6 inline-flex items-center rounded-full border-2 border-primary px-6 py-2.5 text-body-md font-semibold text-primary transition-colors hover:bg-primary hover:text-white">
      {label}
    </Link>
  )
}

/** Interactive "It's versatile" — hovering a capability swaps the preview image. */
function Versatile() {
  const [active, setActive] = useState(0)
  return (
    <section id="features" className="py-16">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        {/* preview image — swaps to the hovered capability */}
        <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
          <img key={active} src={img(VERSATILE[active].img)} alt={VERSATILE[active].title} className="aspect-[4/3] w-full animate-fade-in object-cover" />
        </div>
        <div>
          <SectionLabel text="It's versatile" avatar="s-versatile.jpg" />
          <p className="mt-4 max-w-md text-body-lg text-ink">
            PulseTrack is far more than a checklist — it's a complete toolkit for productive teams, including:
          </p>
          <ul className="mt-4 space-y-0.5">
            {VERSATILE.map((f, i) => (
              <li key={f.title}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className={'flex w-full items-center gap-2.5 rounded px-1 py-1.5 text-left text-body-lg transition-colors ' + (i === active ? 'font-semibold text-primary' : 'text-slate-400 hover:text-ink')}
                >
                  <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (i === active ? 'bg-primary' : 'bg-slate-300')} />
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
          <OutlineCta />
        </div>
      </div>
    </section>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-card text-ink">
      {/* Hero wrapper — the thin blue blob starts at the very top of the screen */}
      <div className="relative overflow-hidden bg-gradient-to-b from-[#eef3fb] to-[#f4f7fc] pb-16">
        {/* logo header — always in front */}
        <header className="relative z-50 mx-auto max-w-7xl px-6 pt-7 sm:px-12 lg:px-16">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-700 text-white shadow-md">
              <Activity size={22} strokeWidth={2.4} />
            </span>
            <span className="text-2xl font-bold tracking-tight text-ink">Pulse<span className="text-primary">Track</span></span>
          </Link>
        </header>

        {/* content — padding from above pushes the text down */}
        <div className="relative z-10 mx-auto grid max-w-7xl items-start gap-4 px-6 pb-20 pt-16 sm:px-12 lg:grid-cols-2 lg:px-16">
          <div className="lg:justify-self-end lg:max-w-xl lg:pr-2 lg:pt-10">
            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-[3.5rem]">
              Track every team's progress — <span className="text-primary">automatically.</span>
            </h1>
            <p className="mt-5 max-w-md text-body-lg text-ink-muted">
              Organize and manage your team's work with PulseTrack — a free progress manager that replaces manual daily, weekly and monthly reports.
            </p>
            <Link to="/signup" className="mt-7 inline-block">
              <Button size="lg" className="px-8" trailingIcon={<ArrowRight size={18} />}>Get Started</Button>
            </Link>
          </div>

          {/* device mockup floating on a thin blue blob — rounded bottom, pulled left toward the text */}
          <div className="flex justify-center lg:justify-start">
            <div className="relative w-[94%] max-w-xl">
              <div className="absolute left-1/2 top-[-11rem] h-[38rem] w-[112%] -translate-x-1/2 rounded-b-[50%] bg-gradient-to-b from-[#a9c9ff] via-[#c9dcff] to-[#eef3ff]" />
              <img
                src={img('hero-mockup.png')}
                alt="PulseTrack product preview"
                className="relative z-10 w-full drop-shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Why — white panel with large rounded top corners curving up over the hero */}
      <div className="relative z-20 -mt-12 rounded-[2.5rem] bg-card shadow-[0_0_40px_rgba(15,23,42,0.06)] sm:rounded-[3rem]">
      <section id="why" className="mx-auto max-w-7xl px-6 pb-20 pt-16 sm:px-10 lg:px-16">
        <h2 className="text-center text-3xl font-bold tracking-tight text-primary sm:text-4xl">Why PulseTrack?</h2>
        <div className="mt-12 grid items-center gap-12 lg:grid-cols-2">
          {/* girl with laptop on a blue ellipse */}
          <div className="relative mx-auto flex h-80 w-full max-w-md items-center justify-center">
            <div className="absolute h-64 w-[22rem] rounded-[50%] bg-gradient-to-b from-primary/40 via-primary/20 to-primary/5" />
            <img src={img('why-girl.jpg')} alt="Team member using PulseTrack" className="relative h-72 w-72 rounded-full object-cover shadow-card" />
          </div>
          {/* three-point list */}
          <div>
            <p className="text-body-lg text-ink">Choosing a progress tracker really comes down to three things:</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-body-lg text-ink marker:text-ink-muted">
              <li><a href="#free" className="font-semibold text-primary hover:underline">Free to start</a> <span className="text-ink-muted">(yes, actually free)</span></li>
              <li><a href="#easy" className="font-semibold text-primary hover:underline">Easy to use</a></li>
              <li><a href="#features" className="font-semibold text-primary hover:underline">Versatile</a></li>
            </ul>
            <p className="mt-6 max-w-lg text-body-lg text-ink-muted">
              PulseTrack delivers all three — a free progress tracker your team can run in minutes, with department-specific dashboards, trends and one-click reports built in.
            </p>
            <Link to="/signup" className="mt-8 inline-block"><Button size="lg" className="px-8">Get Started</Button></Link>
          </div>
        </div>
      </section>
      </div>

      {/* Labeled sections joined by a dashed blue zig-zag connector (decorative, lg only) */}
      <div className="relative mx-auto max-w-6xl px-6 sm:px-10 lg:px-16">
        {/* connector: a single straight vertical dashed line down the centre column-gap */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 100">
          <line
            x1="50"
            y1="8"
            x2="50"
            y2="62"
            stroke="#6366F1"
            strokeOpacity="0.4"
            strokeWidth="2"
            strokeDasharray="7 7"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

      {/* It's free — registration image + benefits */}
      <section id="free" className="py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="overflow-hidden rounded-card border border-line shadow-card">
            <img src={img('registration.png')} alt="Create your PulseTrack account" className="w-full object-cover" />
          </div>
          <div>
            <SectionLabel text="It's free" avatar="s-free.jpg" />
            <p className="mt-4 text-body-lg text-ink">
              Getting started with PulseTrack takes one step — sign up with your work email and you're in. The core plan is free, with everything your team needs to start tracking from day one.
            </p>
            <ul className="mt-5 list-disc space-y-2 pl-5 text-body-lg text-ink-muted marker:text-primary">
              <li>No credit card required</li>
              <li>Unlimited team members</li>
              <li>Free, forever, on the core plan</li>
            </ul>
            <OutlineCta />
          </div>
        </div>
      </section>

      {/* It's easy — invitation image + steps */}
      <section id="easy" className="py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="lg:order-1">
            <SectionLabel text="It's easy to use" avatar="s-easy.jpg" />
            <p className="mt-4 text-body-lg text-ink">
              PulseTrack is as easy as it gets — invite your team, pick a department, set a couple of targets, and start logging.
            </p>
            <ul className="mt-5 list-disc space-y-2 pl-5 text-body-lg text-ink-muted marker:text-primary">
              <li>Set up your team in under five minutes</li>
              <li>Guided onboarding and a clear daily form</li>
              <li>Invite your whole team in one click</li>
            </ul>
            <OutlineCta />
          </div>
          <div className="overflow-hidden rounded-card border border-line shadow-card lg:order-2">
            <img src={img('invitation.png')} alt="Invite your team to PulseTrack" className="w-full object-cover" />
          </div>
        </div>
      </section>

      {/* It's versatile (interactive hover) */}
      <Versatile />
      </div>

      {/* Trusted by */}
      <section className="bg-ink py-20 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-headline-lg">Built for high-performance B2B teams</h2>
            <p className="mt-3 text-body-lg text-white/70">From outbound calling floors to lead-gen research desks and marketing studios — PulseTrack keeps every department comparable, accountable and improving.</p>
          </div>
          <div className="overflow-hidden rounded-card shadow-overlay ring-1 ring-white/10">
            <img src={img('trusted-team.jpg')} alt="" className="aspect-[16/10] w-full object-cover" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-4xl font-light tracking-wide text-primary md:text-5xl">PulseTrack FAQs</h2>
        </div>
        <div className="mt-10 space-y-4">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-card border border-line bg-card px-7 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-colors hover:border-line/80">
              <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-medium text-ink">
                {f.q}
                <ChevronDown size={22} className="ml-4 shrink-0 text-ink-muted/70 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-body-md text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="rounded-card bg-gradient-to-br from-primary to-accent px-8 py-14 text-center text-white shadow-overlay">
          <div className="mb-2 flex justify-center gap-0.5 text-white">{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={16} className="fill-current" />)}</div>
          <h2 className="text-headline-lg">Ready to scale your team's output?</h2>
          <p className="mx-auto mt-2 max-w-md text-body-lg text-white/80">Join teams replacing scattered spreadsheets with one source of truth.</p>
          <Link to="/signup" className="mt-7 inline-block"><Button size="lg" className="!bg-white !text-primary shadow-md hover:!bg-white/90">Get started free</Button></Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-8 py-12 sm:px-12 lg:flex-row lg:items-start lg:gap-x-20 lg:px-20">
          <div className="max-w-xs">
            <div className="inline-flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-700 text-white shadow-md">
                <Activity size={22} strokeWidth={2.4} />
              </span>
              <span className="text-2xl font-bold tracking-tight text-ink">Pulse<span className="text-primary">Track</span></span>
            </div>
            <p className="mt-3 text-body-sm text-ink-muted">The single source of truth for every team's progress.</p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-8 sm:gap-x-16">
            {[
              { h: 'Product', items: ['Features', 'Why PulseTrack', 'FAQ'] },
              { h: 'Company', items: ['About', 'Careers', 'Contact'] },
              { h: 'Resources', items: ['Docs', 'Support', 'Privacy'] },
            ].map((col) => (
              <div key={col.h}>
                <p className="text-label-md uppercase text-ink-muted">{col.h}</p>
                <ul className="mt-3 space-y-2 text-body-md text-ink-muted">
                  {col.items.map((i) => <li key={i}><a href="#" className="hover:text-ink">{i}</a></li>)}
                </ul>
              </div>
            ))}
            <div>
              <p className="text-label-md uppercase text-ink-muted">Follow Us</p>
              <ul className="mt-3 space-y-2 text-body-md text-ink-muted">
                {SOCIALS.map(({ label, href, Icon }) => (
                  <li key={label}>
                    <a href={href} className="inline-flex items-center gap-2.5 hover:text-primary">
                      <Icon className="h-[18px] w-[18px]" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
