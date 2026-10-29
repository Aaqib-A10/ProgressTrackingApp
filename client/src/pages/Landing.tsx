import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, KanbanSquare, MessagesSquare, ClipboardList, PhoneCall,
  SlidersHorizontal, ShieldCheck, Sparkles, Bot, Globe2, Smartphone, Users, X as XIcon, Lock,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { MarketingLayout, Container, SectionHead, Eyebrow, PrimaryCta, SecondaryCta, AppFrame, usePageTitle } from './marketing/MarketingLayout'
import { BENTO, FAQS, PLANS, REPLACES, SECURITY, STEPS, TEAMS, TOUR, site } from './marketing/content'

/**
 * The public home page (Phase 2). Real screens from Metriq (a fictional demo company), no
 * invented customers or numbers. Copy lives in marketing/content.ts.
 */

const TOUR_ICON = { attendance: Clock3, projects: KanbanSquare, chat: MessagesSquare, reports: ClipboardList, sales: PhoneCall } as const
const BENTO_ICON = { sections: SlidersHorizontal, roles: Users, ai: Sparkles, claude: Bot, timezones: Globe2, mobile: Smartphone } as const

export default function Landing() {
  usePageTitle('Metriq: attendance, projects, chat and daily reports in one app', 'Run your whole team from one app: attendance and hours, projects and tasks, chat and calls, and a daily report your team fills in under a minute. 14-day free trial.')
  return (
    <MarketingLayout>
      <Hero />
      <Replaces />
      <Tour />
      <Bento />
      <Teams />
      <Steps />
      <SecurityPreview />
      <PricingPreview />
      <Origin />
      <Faq />
      <FinalCta />
    </MarketingLayout>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--primary)/0.12),transparent)]" />
      <Container className="relative pb-10 pt-14 text-center sm:pt-20">
        <Eyebrow><span className="h-1.5 w-1.5 rounded-full bg-success" />Attendance · Projects · Chat · Daily reports</Eyebrow>
        <h1 className="mx-auto mt-6 max-w-4xl text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[60px]">
          Run your whole team<br className="hidden sm:block" /> from <span className="text-primary">one app</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-muted sm:text-[19px]">
          Metriq puts attendance, projects, team chat and calls, and a daily report in one place, so you stop chasing people across WhatsApp groups, spreadsheets and forms.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryCta />
          <SecondaryCta to="/#tour">See how it works</SecondaryCta>
        </div>
        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13.5px] text-ink-muted">
          {['14 days free', 'No card needed', 'Ready in minutes'].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><Check size={14} className="text-success" />{t}</span>)}
        </p>
      </Container>

      <Container className="relative pb-16 sm:pb-24">
        <div className="relative overflow-hidden rounded-[20px] border border-line">
          <img src={site('office.webp')} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/0" />
          <div className="relative px-3 pb-0 pt-10 sm:px-12 sm:pt-16">
            <AppFrame src={site('app-board.webp')} darkSrc={site('app-board-dark.webp')} alt="A project board in Metriq: tasks in Backlog, To do, In progress, In review and Done, each with an owner and a due date" eager className="mx-auto max-w-5xl rounded-b-none border-b-0" />
          </div>
          {/* Small live-looking cards, drawn from the screens above. */}
          <div className="absolute left-4 top-4 hidden items-center gap-2.5 rounded-card border border-line bg-card/95 px-3.5 py-2.5 shadow-overlay backdrop-blur sm:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success"><Clock3 size={16} /></span>
            <div className="text-left"><p className="text-[12px] text-ink-muted">Working now</p><p className="text-[15px] font-semibold text-ink">9 of 10 in</p></div>
          </div>
          <div className="absolute right-4 top-4 hidden items-center gap-2.5 rounded-card border border-line bg-card/95 px-3.5 py-2.5 shadow-overlay backdrop-blur md:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary"><CheckCircle2 size={16} /></span>
            <div className="text-left"><p className="text-[12px] text-ink-muted">Daily reports</p><p className="text-[15px] font-semibold text-ink">3 of 4 sent</p></div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ replaces */

function Replaces() {
  return (
    <section className="border-y border-line bg-card">
      <Container className="flex flex-col items-center gap-6 py-10 lg:flex-row lg:justify-between">
        <p className="shrink-0 text-[15px] font-semibold text-ink">One app instead of</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {REPLACES.map((r) => (
            <li key={r} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1.5 text-[13.5px] text-ink-muted">
              <XIcon size={13} className="text-danger/80" /><span className="line-through decoration-ink-faint/60">{r}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ tour */

function Tour() {
  const [tab, setTab] = useState<(typeof TOUR)[number]['key']>('attendance')
  const t = TOUR.find((x) => x.key === tab)!
  return (
    <section id="tour" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <SectionHead center eyebrow="The product" title="Everything your team does in a day" text="Five parts that work together. Turn on the ones you need; every screen below is Metriq as it is today." />
        <div role="tablist" aria-label="Parts of Metriq" className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
          {TOUR.map((x) => {
            const Icon = TOUR_ICON[x.key]
            return (
              <button key={x.key} role="tab" type="button" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
                className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-medium transition-colors', tab === x.key ? 'border-primary bg-primary text-white shadow-raised' : 'border-line bg-card text-ink-muted hover:text-ink')}>
                <Icon size={16} />{x.tab}
              </button>
            )
          })}
        </div>
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div role="tabpanel" aria-label={t.tab}>
            <h3 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{t.title}</h3>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-muted">{t.text}</p>
            <ul className="mt-6 space-y-3">
              {t.points.map((p) => <li key={p} className="flex gap-3 text-[15px] text-ink"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" />{p}</li>)}
            </ul>
            <div className="mt-8"><PrimaryCta>Try it free</PrimaryCta></div>
          </div>
          <AppFrame key={t.key} src={site(t.image)} alt={`${t.tab} in Metriq`} className="animate-[fadeIn_.25s_ease-out]" />
        </div>
      </Container>
      <style>{'@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'}</style>
    </section>
  )
}

/* ------------------------------------------------------------------ bento */

function Bento() {
  return (
    <section className="border-y border-line bg-card py-20 sm:py-28">
      <Container>
        <SectionHead eyebrow="Made to fit" title={<>Built for how teams<br className="hidden sm:block" /> really work</>} text="Every company works differently. Metriq bends to yours instead of the other way round." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {BENTO.map((b, i) => {
            const Icon = BENTO_ICON[b.key]
            return (
              <div key={b.key} className={cn('rounded-[14px] border border-line bg-bg p-6', [0, 3, 5].includes(i) && 'md:col-span-2')}>
                <span className="flex h-10 w-10 items-center justify-center rounded-card border border-line bg-card text-primary"><Icon size={18} /></span>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">{b.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{b.text}</p>
                {i === 0 && (
                  <div className="mt-5 flex flex-wrap gap-2" aria-hidden>
                    {['General', 'Sales calling', 'Lead Generation', 'Marketing', 'E-commerce', 'Inventory', 'Customer service'].map((k, j) => (
                      <span key={k} className={cn('rounded-full border px-3 py-1 text-[12.5px]', j === 1 ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line bg-card text-ink-muted')}>{k}</span>
                    ))}
                  </div>
                )}
              </div>
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
        <SectionHead eyebrow="Solutions" title="Ready for the team you have" text="Pick the kind of work each department does and it comes with the right screens." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEAMS.map((t) => (
            <div key={t.key} className="group overflow-hidden rounded-[14px] border border-line bg-card">
              <div className="aspect-[4/3] overflow-hidden"><img src={site(t.image)} alt="" aria-hidden loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" /></div>
              <div className="p-5">
                <h3 className="text-[16px] font-semibold text-ink">{t.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{t.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ steps */

function Steps() {
  return (
    <section className="border-y border-line bg-card py-20 sm:py-24">
      <Container>
        <SectionHead center eyebrow="Getting started" title="Up and running before lunch" />
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-[14px] border border-line bg-bg p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white">{i + 1}</span>
              <h3 className="mt-5 text-[17px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center"><PrimaryCta /></div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ security */

function SecurityPreview() {
  return (
    <section className="py-20 sm:py-28">
      <Container className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHead eyebrow="Security" title="Your company's data stays your company's" text="Each company only ever sees its own records, and our team can only look in when you allow it." />
          <div className="mt-8"><SecondaryCta to="/security">How we keep it safe <ArrowRight size={16} /></SecondaryCta></div>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {SECURITY.slice(0, 4).map((s, i) => (
            <li key={s.title} className="rounded-[14px] border border-line bg-card p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-card bg-primary/10 text-primary">{i % 2 ? <Lock size={17} /> : <ShieldCheck size={17} />}</span>
              <h3 className="mt-4 text-[15.5px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{s.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ pricing */

export function PlanCards({ yearly }: { yearly: boolean }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PLANS.map((p) => {
        const price = yearly ? Math.round((p.yearly / 12) * 100) / 100 : p.monthly
        const hl = 'highlight' in p && p.highlight
        return (
          <div key={p.key} className={cn('relative flex flex-col rounded-[16px] border bg-card p-7', hl ? 'border-primary shadow-overlay ring-1 ring-primary/30' : 'border-line')}>
            {hl && <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-white">Everything in Metriq</span>}
            <h3 className="text-[18px] font-semibold text-ink">{p.name}</h3>
            <p className="mt-1.5 min-h-[40px] text-[14px] leading-snug text-ink-muted">{p.blurb}</p>
            <p className="mt-5 flex items-end gap-1.5">
              <span className="text-[42px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">${Number.isInteger(price) ? price : price.toFixed(2)}</span>
              <span className="pb-1 text-[14px] text-ink-muted">/ month{p.people > 1 ? ', whole team' : ''}</span>
            </p>
            <p className="mt-1.5 text-[13px] text-ink-muted">{yearly ? `$${p.yearly} billed once a year` : `or $${p.yearly} a year (2 months free)`} · {p.people === 1 ? 'just you' : `up to ${p.people} people`}</p>
            <Link to="/start" className={cn('mt-6 inline-flex h-11 items-center justify-center rounded-btn text-[15px] font-semibold transition-colors', hl ? 'bg-primary text-white hover:bg-primary-700' : 'border border-line bg-bg text-ink hover:bg-slate-50')}>Start 14-day trial</Link>
            <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
              {p.includes.map((f) => <li key={f} className="flex gap-2.5 text-[14px] text-ink"><Check size={16} className="mt-0.5 shrink-0 text-success" />{f}</li>)}
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
          className={cn('rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors', yearly === v ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}>{l}</button>
      ))}
    </div>
  )
}

function PricingPreview() {
  const [yearly, setYearly] = useState(false)
  return (
    <section className="border-y border-line bg-card py-20 sm:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Pricing" title="One price for the whole team" text="Not per person: a plan covers everyone up to its limit. Start free for 14 days." />
          <BillingToggle yearly={yearly} onChange={setYearly} />
        </div>
        <div className="mt-10"><PlanCards yearly={yearly} /></div>
        <p className="mt-6 text-center text-[13.5px] text-ink-muted">Prices in US dollars. Online payment opens soon; start your trial today, there is nothing to pay yet. <Link to="/pricing" className="font-semibold text-primary hover:underline">Compare plans</Link></p>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ origin */

function Origin() {
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <div className="grid items-center gap-10 rounded-[20px] border border-line bg-card p-8 sm:p-12 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <Eyebrow>Why we built it</Eyebrow>
            <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">Made inside a working company, not a lab</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-muted">Metriq started as the app our own sales, operations and marketing teams run on every day: checking in, calling leads, closing tasks and sending their daily report. Every screen was shaped by people using it at work, and it keeps changing the same way.</p>
          </div>
          <AppFrame src={site('app-dialer.webp')} darkSrc={site('app-dialer-dark.webp')} alt="The Lead Dialer in Metriq: who to call right now by US time zone, the funnel and follow-ups" />
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ faq */

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="scroll-mt-20 border-t border-line bg-card py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="Questions" title="Things people ask before they start" />
        <ul className="divide-y divide-line rounded-[14px] border border-line bg-bg">
          {FAQS.map((f, i) => (
            <li key={f.q}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15.5px] font-medium text-ink">
                {f.q}<ChevronDown size={18} className={cn('shrink-0 text-ink-muted transition-transform', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="-mt-1 px-5 pb-5 text-[14.5px] leading-relaxed text-ink-muted">{f.a}</p>}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ final */

function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="relative overflow-hidden rounded-[24px] bg-primary px-6 py-14 text-center sm:px-12">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(255,255,255,0.22),transparent)]" />
          <h2 className="relative mx-auto max-w-2xl text-[30px] font-semibold leading-tight tracking-[-0.025em] text-white sm:text-[40px]">Give your team one place to work</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-[16px] text-white/85">Start a 14-day trial with everything on. No card, nothing to install.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/start" className="inline-flex h-11 items-center gap-2 rounded-btn bg-white px-5 text-[15px] font-semibold text-primary shadow-raised hover:bg-white/90">Start free trial<ArrowRight size={16} /></Link>
            <Link to="/pricing" className="inline-flex h-11 items-center rounded-btn border border-white/40 px-5 text-[15px] font-semibold text-white hover:bg-white/10">See pricing</Link>
          </div>
        </div>
      </Container>
    </section>
  )
}
