import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'
import { MarketingLayout, Container, SectionHead, Eyebrow, PrimaryCta, SecondaryCta, AppFrame, Reveal, usePageTitle, useInView, useLaunch } from './marketing/MarketingLayout'
import { BENTO, DAY, PLANS, SECURITY, STEPS, TEAMS, TOUR, faqsFor, site } from './marketing/content'
import { HeroBackdrop, HeroStage, trackPointer } from './marketing/HeroStage'
import { SOLUTIONS } from './marketing/pages'
import { AskArt, ClocksArt, ConsolidateArt, NotesArt, OrbitArt, PhoneArt, RolesArt, StepArt, TeamsArt, WallsArt } from './marketing/Pictures'
import {
  IconArrow, IconAttendance, IconBackup, IconBoard, IconChat, IconCheck, IconConnect, IconDepartments, IconDialer, IconExport, IconGlobeClock,
  IconKey, IconLock, IconNotes, IconPhone, IconReport, IconRoles, IconSupport, IconWalls,
} from './marketing/icons'

/**
 * The public home page. Real screens from Metriq (a fictional demo company), no invented
 * customers or numbers. Copy lives in marketing/content.ts; the moving pictures in
 * marketing/HeroStage.tsx and marketing/Pictures.tsx.
 */

const TOUR_ICON = { attendance: IconAttendance, projects: IconBoard, chat: IconChat, reports: IconReport, sales: IconDialer } as const
const BENTO_ICON = { sections: IconDepartments, roles: IconRoles, ai: IconNotes, claude: IconConnect, timezones: IconGlobeClock, mobile: IconPhone } as const
const BENTO_ART = { sections: TeamsArt, roles: RolesArt, ai: NotesArt, claude: AskArt, timezones: ClocksArt, mobile: PhoneArt } as const
export const SECURITY_ICONS = [IconWalls, IconLock, IconBackup, IconKey, IconSupport, IconExport]
const DAY_ICON = { attendance: IconAttendance, sales: IconDialer, projects: IconBoard, reports: IconReport } as const

export default function Landing() {
  const { free } = useLaunch()
  usePageTitle('Metriq: attendance, projects, chat and daily reports in one app', `Run your whole team from one app: attendance and hours, projects and tasks, chat and calls, and a daily report your team fills in under a minute. ${free ? 'Free while we launch.' : '14-day free trial.'}`)
  return (
    <MarketingLayout>
      <Hero free={free} />
      <Replaces />
      <Tour />
      <Bento />
      <Teams />
      <Steps />
      <SecurityPreview />
      <PricingPreview free={free} />
      <Origin />
      <Faq free={free} />
      <FinalCta free={free} />
    </MarketingLayout>
  )
}

/* ------------------------------------------------------------------ hero */

function Words({ text, start = 0, className }: { text: string; start?: number; className?: string }) {
  return <>{text.split(' ').map((w, i) => <span key={i} className={cn('mk-word', className)} style={{ '--mk-delay': `${start + i * 70}ms` } as CSSProperties}>{w}{' '}</span>)}</>
}

function Hero({ free }: { free: boolean }) {
  return (
    <section className="mk-hero relative overflow-hidden" onPointerMove={trackPointer}>
      <HeroBackdrop />
      <Container className="relative pb-12 pt-16 text-center sm:pt-24">
        <h1 className="mx-auto max-w-4xl text-[42px] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[68px]">
          <Words text="Run your whole team" /><br className="hidden sm:block" />
          <Words text="from" start={280} /><span className="mk-word" style={{ '--mk-delay': '360ms' } as CSSProperties}><span className="mk-shine">one app</span></span><span className="mk-word" style={{ '--mk-delay': '420ms' } as CSSProperties}>.</span>
        </h1>
        <p className="mk-up mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-ink-muted sm:text-[19px]" style={{ '--mk-delay': '550ms' } as CSSProperties}>
          Metriq puts attendance, projects, team chat and calls, and a daily report in one place, so you stop chasing people across WhatsApp groups, spreadsheets and forms.
        </p>
        <div className="mk-up mt-9 flex flex-wrap justify-center gap-3" style={{ '--mk-delay': '680ms' } as CSSProperties}>
          <PrimaryCta />
          <SecondaryCta to="/product">See how it works</SecondaryCta>
        </div>
        <p className="mk-up mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13.5px] text-ink-muted" style={{ '--mk-delay': '780ms' } as CSSProperties}>
          {[free ? 'Free while we launch' : '14 days free', 'No card needed', 'Ready in minutes'].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><IconCheck size={14} className="text-success" />{t}</span>)}
        </p>
      </Container>
      <Container className="relative pb-16 sm:pb-28">
        <HeroStage />
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ one app instead of six */

function Replaces() {
  return (
    <section className="relative border-y border-line bg-card py-20 sm:py-24">
      <Container>
        <Reveal><SectionHead center eyebrow="Fewer tools" title="Six tools out. One app in." text="The group chats, the fingerprint machine, the hours spreadsheet and the report form all become parts of the same app, sharing the same people and the same day." /></Reveal>
        <div className="mt-14"><ConsolidateArt /></div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ tour */

const TOUR_MS = 8000
/** Each part's own light behind its screen. */
const TOUR_HUE: Record<string, { a: string; b: string }> = {
  attendance: { a: '16 185 129', b: '6 182 212' },
  projects: { a: '99 102 241', b: '168 85 247' },
  chat: { a: '14 165 233', b: '99 102 241' },
  reports: { a: '245 158 11', b: '239 68 68' },
  sales: { a: '139 92 246', b: '236 72 153' },
}

function Tour() {
  const [i, setI] = useState(0)
  const [auto, setAuto] = useState(true)
  const [hover, setHover] = useState(false)
  const [ref, seen] = useInView<HTMLDivElement>()
  const t = TOUR[i]
  const hue = TOUR_HUE[t.key]
  // Moves on by itself while in view, until someone picks a part.
  useEffect(() => {
    if (!auto || hover || !seen) return
    const timer = setTimeout(() => setI((x) => (x + 1) % TOUR.length), TOUR_MS)
    return () => clearTimeout(timer)
  }, [i, auto, hover, seen])
  const pick = (n: number) => { setI(n); setAuto(false) }
  const dark = t.key === 'projects' ? site('app-board-dark.webp') : t.key === 'sales' ? site('app-dialer-dark.webp') : undefined
  // A gentle tilt that follows the pointer over the screen.
  const stage = useRef<HTMLDivElement>(null)
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !stage.current) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    stage.current.style.transform = `perspective(1600px) rotateY(${x * 5}deg) rotateX(${-y * 4}deg)`
  }
  const untilt = () => { if (stage.current) stage.current.style.transform = '' }

  return (
    <section id="tour" className="scroll-mt-20 overflow-x-clip py-20 sm:py-28">
      <Container>
        <Reveal><SectionHead center eyebrow="The product" title="Everything your team does in a day" text="Five parts that work together. Turn on the ones you need; every screen here is Metriq as it is today." /></Reveal>
        <div ref={ref} className="mt-14 grid items-stretch gap-6 lg:grid-cols-[0.78fr_1.22fr] lg:gap-8" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <div role="tablist" aria-label="Parts of Metriq" aria-orientation="vertical" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {TOUR.map((x, n) => {
              const Icon = TOUR_ICON[x.key]
              const on = n === i
              const h = TOUR_HUE[x.key]
              return (
                <button key={x.key} role="tab" type="button" aria-selected={on} onClick={() => pick(n)}
                  className={cn('group relative shrink-0 overflow-hidden rounded-[16px] border text-left transition-all duration-300 lg:w-full',
                    on ? 'border-line bg-card shadow-[0_18px_40px_-24px_rgb(var(--shadow)/0.5)]' : 'border-transparent hover:bg-card/70')}>
                  <span className="flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-3.5">
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] transition-all duration-300', on ? 'text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]' : 'bg-slate-100 text-ink-muted group-hover:text-ink')}
                      style={on ? { backgroundImage: `linear-gradient(to bottom, rgb(${h.a}), rgb(${h.b}))` } : undefined}><Icon size={19} /></span>
                    <span className={cn('whitespace-nowrap text-[15px] font-semibold', on ? 'text-ink' : 'text-ink-muted')}>{x.tab}</span>
                  </span>
                  {/* The open part's words and points, on wide screens. */}
                  <span className="mk-acc hidden px-5 lg:grid" data-open={on}>
                    <span className="block overflow-hidden">
                      <span className="block pb-5 pl-12">
                        <span className="block text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink">{x.title}</span>
                        <span className="mt-2 block text-[14px] leading-relaxed text-ink-muted">{x.text}</span>
                        <span className="mt-3 block space-y-1.5">
                          {x.points.map((p) => <span key={p} className="flex gap-2 text-[13.5px] text-ink"><IconCheck size={15} className="mt-0.5 shrink-0" style={{ color: `rgb(${h.a})` }} />{p}</span>)}
                        </span>
                      </span>
                    </span>
                  </span>
                  {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-line"><span key={`${i}-${auto}`} className={cn('block h-full', auto && !hover ? 'mk-progress' : 'scale-x-100')} style={{ backgroundImage: `linear-gradient(to right, rgb(${h.a}), rgb(${h.b}))`, '--mk-dur': `${TOUR_MS}ms`, animationPlayState: seen ? 'running' : 'paused' } as CSSProperties} /></span>}
                </button>
              )
            })}
          </div>

          <div role="tabpanel" aria-label={t.tab} className="relative min-h-[300px] overflow-hidden rounded-[24px] border border-line sm:min-h-[420px] lg:min-h-[520px]" onPointerMove={tilt} onPointerLeave={untilt}>
            {/* The part's own light, a fine grid, and the screen coming in from the corner. */}
            <div aria-hidden className="absolute inset-0 transition-[background] duration-700" style={{ background: `radial-gradient(120% 90% at 0% 0%, rgb(${hue.a} / 0.22), transparent 55%), radial-gradient(100% 80% at 100% 100%, rgb(${hue.b} / 0.22), transparent 60%), rgb(var(--card))` }} />
            <div aria-hidden className="mk-grid absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,#000,transparent)]" style={{ backgroundSize: '32px 32px' }} />
            <div className="relative pl-6 pt-6 sm:pl-12 sm:pt-12 lg:absolute lg:inset-0">
              <div ref={stage} className="transition-transform duration-300 ease-out will-change-transform lg:w-[142%]" style={{ transformOrigin: '0 0' }}>
                <div key={t.key} className="mk-swap -mr-[18%] sm:-mr-[12%] lg:mr-0">
                  <AppFrame src={site(t.image)} darkSrc={dark} alt={`${t.tab} in Metriq`} className="rounded-br-none rounded-tr-none shadow-[0_30px_60px_-20px_rgb(var(--shadow)/0.45)]" />
                </div>
              </div>
            </div>
            <div key={`p${t.key}`} className="mk-swap relative border-t border-line bg-card/90 p-5 backdrop-blur lg:hidden">
              <h3 className="text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">{t.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{t.text}</p>
              <ul className="mt-3 space-y-1.5">{t.points.map((p) => <li key={p} className="flex gap-2 text-[13.5px] text-ink"><IconCheck size={15} className="mt-0.5 shrink-0 text-primary" />{p}</li>)}</ul>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ bento */

function Bento() {
  return (
    <section className="relative overflow-hidden border-y border-line bg-card py-20 sm:py-28">
      <div aria-hidden className="mk-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000,transparent)]" />
      <Container className="relative">
        <Reveal><SectionHead eyebrow="Made to fit" title={<>Built for how teams<br className="hidden sm:block" /> really work</>} text="Every company works differently. Metriq bends to yours instead of the other way round." /></Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {BENTO.map((b, i) => {
            const Icon = BENTO_ICON[b.key]
            const Art = BENTO_ART[b.key]
            const wide = [0, 3, 5].includes(i)
            return (
              <Reveal key={b.key} delay={(i % 3) * 90} className={cn('group relative flex flex-col overflow-hidden rounded-[18px] border border-line bg-bg p-6 transition-shadow duration-300 hover:shadow-[0_20px_50px_-24px_rgb(var(--primary)/0.45)]', wide && 'md:col-span-2')}>
                <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-gradient-to-b from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20"><Icon size={21} /></span>
                  <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{b.title}</h3>
                </div>
                <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink-muted">{b.text}</p>
                <div className="mt-auto">{<Art />}</div>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ teams */

function Teams() {
  return (
    <section id="teams" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal><SectionHead eyebrow="Solutions" title="Ready for the team you have" text="Pick the kind of work each department does and it comes with the right screens." /></Reveal>
          <Reveal delay={120}><SecondaryCta to="/solutions">All solutions <IconArrow size={16} /></SecondaryCta></Reveal>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEAMS.map((t, i) => (
            <Reveal key={t.key} delay={i * 90} className="group relative aspect-[3/4] overflow-hidden rounded-[18px] border border-line bg-slate-900">
              <Link to={`/solutions/${SOLUTIONS.find((x) => x.key === t.key)?.slug ?? ''}`} className="absolute inset-0 z-[2]" aria-label={t.title} />
              <img src={site(t.image)} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/0 transition-colors duration-500 group-hover:via-black/55" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-white">{t.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/75">{t.text}</p>
                <div className="grid transition-[grid-template-rows] duration-500 ease-out [grid-template-rows:1fr] lg:[grid-template-rows:0fr] lg:group-hover:[grid-template-rows:1fr]">
                  <ul className="flex flex-wrap gap-1.5 overflow-hidden pt-3">
                    {t.includes.map((x) => <li key={x} className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur">{x}</li>)}
                  </ul>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ steps */

function Steps() {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <section className="relative overflow-hidden border-y border-line bg-card py-20 sm:py-28">
      <Container>
        <Reveal><SectionHead center eyebrow="Getting started" title="Up and running before lunch" text="Three steps, a few minutes each. Nothing to install, on any computer or phone." /></Reveal>
        <div ref={ref} className={cn('relative mt-16', seen && 'mk-in')}>
          {/* The line that joins the steps fills in as they come into view. */}
          <div aria-hidden className="absolute left-[16.6%] right-[16.6%] top-5 hidden h-[2px] bg-line md:block"><div className="mk-line-fill h-full bg-gradient-to-r from-primary to-cyan-500" /></div>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className={cn('mk-reveal relative flex flex-col items-center text-center', seen && 'mk-in')} style={{ '--mk-delay': `${200 + i * 350}ms` } as CSSProperties}>
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white shadow-[0_0_0_6px_rgb(var(--card)),0_8px_20px_-6px_rgb(var(--primary)/0.7)]">{i + 1}</span>
                <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em] text-ink">{s.title}</h3>
                <p className="mt-2 max-w-xs text-[14.5px] leading-relaxed text-ink-muted">{s.text}</p>
                <div className="mt-6 w-full max-w-[280px] text-left"><StepArt step={i} /></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-14 text-center"><PrimaryCta /></div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ security */

function SecurityPreview() {
  return (
    <section className="relative overflow-hidden bg-[#0b0c10] py-20 text-white sm:py-28">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_30%,rgb(var(--primary)/0.28),transparent),radial-gradient(40%_40%_at_10%_90%,rgb(6_182_212/0.12),transparent)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_60%_60%_at_70%_40%,#000,transparent)]" />
      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.9fr]">
          <Reveal>
            <p className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-cyan-300"><span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-cyan-300" />Security</p>
            <h2 className="mt-4 text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">Your company's data stays your company's</h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-white/65 sm:text-[18px]">Each company only ever sees its own records, and our team can only look in when you allow it.</p>
            <Link to="/security" className="mt-8 inline-flex h-11 items-center gap-2 rounded-btn border border-white/15 bg-white/5 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">How we keep it safe <IconArrow size={16} /></Link>
          </Reveal>
          <Reveal delay={150}><WallsArt /></Reveal>
        </div>
        <ul className="mt-16 grid gap-px overflow-hidden rounded-[18px] border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.slice(0, 4).map((s, i) => {
            const Icon = SECURITY_ICONS[i]
            return (
              <Reveal as="li" key={s.title} delay={i * 80} className="bg-[#0f1116] p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/[0.06] text-cyan-200 ring-1 ring-white/10"><Icon size={20} /></span>
                <h3 className="mt-5 text-[15.5px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-white/60">{s.text}</p>
              </Reveal>
            )
          })}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ pricing */

export function PlanCards({ yearly }: { yearly: boolean }) {
  const { free } = useLaunch()
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PLANS.map((p) => {
        const price = yearly ? Math.round((p.yearly / 12) * 100) / 100 : p.monthly
        const hl = 'highlight' in p && p.highlight
        return (
          <div key={p.key} className={cn('relative flex flex-col rounded-[18px] border bg-card p-7 transition-transform duration-300 hover:-translate-y-1', hl ? 'border-primary/50 shadow-[0_24px_60px_-28px_rgb(var(--primary)/0.7)]' : 'border-line')}>
            {hl && <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-primary to-cyan-500 px-3 py-1 text-[12px] font-semibold text-white">Everything in Metriq</span>}
            <h3 className="text-[18px] font-semibold text-ink">{p.name}</h3>
            <p className="mt-1.5 min-h-[40px] text-[14px] leading-snug text-ink-muted">{p.blurb}</p>
            <p className="mt-5 flex items-end gap-1.5">
              <span className={cn('text-[42px] font-semibold leading-none tracking-[-0.03em] tabular-nums', free ? 'text-ink-faint line-through decoration-2' : 'text-ink')}>${Number.isInteger(price) ? price : price.toFixed(2)}</span>
              {free ? <span className="pb-1 text-[15px] font-semibold text-success">Free while we launch</span> : <span className="pb-1 text-[14px] text-ink-muted">/ month{p.people > 1 ? ', whole team' : ''}</span>}
            </p>
            <p className="mt-1.5 text-[13px] text-ink-muted">{free ? `Then $${p.monthly} a month or $${p.yearly} a year` : yearly ? `$${p.yearly} billed once a year` : `or $${p.yearly} a year (2 months free)`} · {p.people === 1 ? 'just you' : `up to ${p.people} people`}</p>
            <Link to="/start" className={cn('mt-6 inline-flex h-11 items-center justify-center rounded-btn text-[15px] font-semibold transition-colors', hl ? 'bg-primary text-white hover:bg-primary-700' : 'border border-line bg-bg text-ink hover:bg-slate-50')}>{free ? 'Start free' : 'Start 14-day trial'}</Link>
            <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
              {p.includes.map((f) => <li key={f} className="flex gap-2.5 text-[14px] text-ink"><IconCheck size={16} className="mt-0.5 shrink-0 text-success" />{f}</li>)}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

export function BillingToggle({ yearly, onChange }: { yearly: boolean; onChange: (y: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-card p-1">
      {([[false, 'Monthly'], [true, 'Yearly · 2 months free']] as const).map(([v, l]) => (
        <button key={l} type="button" role="radio" aria-checked={yearly === v} onClick={() => onChange(v)}
          className={cn('rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors duration-300', yearly === v ? 'bg-primary text-white shadow-raised' : 'text-ink-muted hover:text-ink')}>{l}</button>
      ))}
    </div>
  )
}

function PricingPreview({ free }: { free: boolean }) {
  const [yearly, setYearly] = useState(false)
  return (
    <section className="border-b border-line bg-card py-20 sm:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal><SectionHead eyebrow="Pricing" title="One price for the whole team" text={free ? 'Free for every company while we launch. After that, one price covers everyone up to the plan’s limit, not per person.' : 'Not per person: a plan covers everyone up to its limit. Start free for 14 days.'} /></Reveal>
          {!free && <BillingToggle yearly={yearly} onChange={setYearly} />}
        </div>
        <div className="mt-10"><PlanCards yearly={yearly} /></div>
        <p className="mt-6 text-center text-[13.5px] text-ink-muted">{free ? 'Prices in US dollars, for when online payment opens. We will write to you before then.' : 'Prices in US dollars.'} <Link to="/pricing" className="font-semibold text-primary hover:underline">Compare plans</Link></p>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ origin */

function Origin() {
  const [ref, seen] = useInView<HTMLOListElement>()
  return (
    <section className="overflow-x-clip py-20 sm:py-28">
      <Container className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <Reveal>
            <Eyebrow>Why we built it</Eyebrow>
            <h2 className="mt-4 text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px]">Made inside a working company, not a lab</h2>
            <p className="mt-5 text-[16px] leading-relaxed text-ink-muted sm:text-[17px]">Metriq started as the app our own sales, operations and marketing teams run on every day. Every screen was shaped by people using it at work, and it keeps changing the same way. Here is a normal day in it:</p>
          </Reveal>
          <ol ref={ref} className="relative mt-8 space-y-1">
            <span aria-hidden className="absolute bottom-4 left-[19px] top-4 w-px bg-line"><span className="block h-full origin-top bg-gradient-to-b from-primary to-cyan-500 transition-transform duration-[1600ms] ease-out" style={{ transform: seen ? 'scaleY(1)' : 'scaleY(0)' }} /></span>
            {DAY.map((x, i) => {
              const Icon = DAY_ICON[x.icon]
              return (
                <li key={x.time} className={cn('mk-reveal relative flex gap-4 rounded-[12px] p-2', seen && 'mk-in')} style={{ '--mk-delay': `${i * 300}ms` } as CSSProperties}>
                  <span className="relative z-[1] flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-line bg-card text-primary shadow-xs"><Icon size={18} /></span>
                  <span className="pt-1">
                    <span className="flex items-baseline gap-2"><span className="text-[12.5px] font-semibold tabular-nums text-primary">{x.time}</span><span className="text-[15px] font-semibold text-ink">{x.title}</span></span>
                    <span className="mt-0.5 block text-[14px] text-ink-muted">{x.text}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
        <Reveal delay={150} className="relative">
          <div aria-hidden className="absolute -inset-8 -z-10 rounded-[40px] bg-[radial-gradient(50%_50%_at_50%_50%,rgb(6_182_212/0.16),transparent)] blur-2xl" />
          <div className="transition-transform duration-500 [transform:perspective(1400px)_rotateY(-6deg)_rotateX(2deg)] hover:[transform:perspective(1400px)_rotateY(0)_rotateX(0)]">
            <AppFrame src={site('app-dialer.webp')} darkSrc={site('app-dialer-dark.webp')} alt="The Lead Dialer in Metriq: who to call right now by US time zone, the funnel and follow-ups" />
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ faq */

function Faq({ free }: { free: boolean }) {
  const faqs = faqsFor(free)
  const cats = ['All', ...new Set(faqs.map((f) => f.cat))]
  const [cat, setCat] = useState('All')
  const [open, setOpen] = useState<string | null>(faqs[0]?.q ?? null)
  const shown = faqs.filter((f) => cat === 'All' || f.cat === cat)
  return (
    <section id="faq" className="relative scroll-mt-20 overflow-hidden border-t border-line bg-card py-20 sm:py-28">
      <div aria-hidden className="mk-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_50%_60%_at_15%_20%,#000,transparent)]" />
      <Container className="relative grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Reveal>
            <SectionHead eyebrow="Questions" title="Things people ask before they start" />
            <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Topics">
              {cats.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
                  className={cn('rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition-colors', cat === c ? 'border-ink bg-ink text-card' : 'border-line bg-bg text-ink-muted hover:text-ink')}>
                  {c}<span className="ml-1.5 tabular-nums opacity-60">{c === 'All' ? faqs.length : faqs.filter((f) => f.cat === c).length}</span>
                </button>
              ))}
            </div>
            <div className="relative mt-8 overflow-hidden rounded-[18px] border border-line bg-bg p-5">
              <div aria-hidden className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
              <div className="relative flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-b from-primary to-[#4338ca] text-white"><IconChat size={20} /></span>
                <div>
                  <p className="text-[15px] font-semibold text-ink">Something else on your mind?</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">Start free and write to us from the Help button inside Metriq. A person answers, usually the same day.</p>
                  <Link to="/start" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:underline">Start free <IconArrow size={15} /></Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
        <ul className="space-y-3">
          {shown.map((f, i) => {
            const on = open === f.q
            return (
              <li key={f.q} className={cn('group relative overflow-hidden rounded-[16px] border bg-bg transition-all duration-300', on ? 'border-primary/30 shadow-[0_18px_40px_-26px_rgb(var(--primary)/0.6)]' : 'border-line hover:border-line-strong')}>
                <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary to-cyan-500 transition-opacity duration-300', on ? 'opacity-100' : 'opacity-0')} />
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : f.q)} className="flex w-full items-center gap-4 px-5 py-4 text-left">
                  <span className={cn('w-6 shrink-0 text-[12.5px] font-semibold tabular-nums transition-colors', on ? 'text-primary' : 'text-ink-faint')}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-[15.5px] font-medium text-ink">{f.q}</span>
                  <span aria-hidden className={cn('relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-300', on ? 'rotate-180 border-primary bg-primary text-white' : 'border-line text-ink-muted group-hover:border-line-strong')}>
                    <span className="absolute h-[1.5px] w-3 rounded bg-current" />
                    <span className={cn('absolute h-3 w-[1.5px] rounded bg-current transition-transform duration-300', on && 'scale-y-0')} />
                  </span>
                </button>
                <div className="mk-acc grid" data-open={on}>
                  <div><p className="px-5 pb-5 pl-[60px] pr-14 text-[14.5px] leading-relaxed text-ink-muted">{f.a}</p></div>
                </div>
              </li>
            )
          })}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ final */

function FinalCta({ free }: { free: boolean }) {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#0b0c10] px-6 py-24 text-center sm:px-12 sm:py-32">
          <div aria-hidden className="mk-aurora mk-aurora-a left-[10%] top-[-30%] h-[420px] w-[520px] !opacity-80" />
          <div aria-hidden className="mk-aurora mk-aurora-b bottom-[-40%] right-[5%] h-[420px] w-[520px] !opacity-60" />
          <OrbitArt />
          <div aria-hidden className="absolute inset-0 z-[1] bg-[radial-gradient(38%_42%_at_50%_50%,rgb(11_12_16/0.85),transparent)]" />
          <h2 className="relative z-[3] mx-auto max-w-2xl text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[48px]">Give your team one place to work</h2>
          <p className="relative z-[3] mx-auto mt-5 max-w-xl text-[16px] text-white/70 sm:text-[18px]">{free ? 'Free while we launch, with everything on. No card, nothing to install.' : 'Start a 14-day trial with everything on. No card, nothing to install.'}</p>
          <div className="relative z-[3] mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/start" className="group inline-flex h-12 items-center gap-2 rounded-btn bg-white px-6 text-[15px] font-semibold text-[#0b0c10] shadow-[0_10px_40px_-10px_rgb(255_255_255/0.5)] transition-transform hover:-translate-y-0.5">Start free<IconArrow size={16} className="transition-transform group-hover:translate-x-0.5" /></Link>
            <Link to="/pricing" className="inline-flex h-12 items-center rounded-btn border border-white/20 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">See pricing</Link>
          </div>
        </div>
      </Container>
    </section>
  )
}
