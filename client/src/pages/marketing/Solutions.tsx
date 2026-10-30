import type { CSSProperties } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { MarketingLayout, Container, SectionHead, PrimaryCta, SecondaryCta, Reveal, usePageTitle } from './MarketingLayout'
import { CtaBand, Crumbs, FEATURE_ICON, HueBackdrop, HueCanvas, HueTile } from './Blocks'
import { FEATURES, SOLUTIONS, solutionBySlug } from './pages'
import { IconArrow } from './icons'
import { site } from './content'

/** /solutions: Metriq by kind of team. /solutions/:slug: one kind of team. */

export default function Solutions() {
  const { slug } = useParams()
  if (slug) return <SolutionPage slug={slug} />
  return <Overview />
}

function Overview() {
  usePageTitle('Solutions · Metriq', 'Metriq for sales and call centres, operations and logistics, remote and hybrid teams, and agencies.')
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden">
        <HueBackdrop hue={{ a: '16 185 129', b: '99 102 241' }} />
        <Container className="relative pb-12 pt-16 text-center sm:pt-24">
          <div className="flex justify-center"><Crumbs items={[{ to: '/', label: 'Home' }, { label: 'Solutions' }]} /></div>
          <h1 className="mk-up mx-auto mt-6 max-w-3xl text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.045em] text-ink sm:text-[60px]">Ready for the team you have</h1>
          <p className="mk-up mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-muted sm:text-[19px]" style={{ animationDelay: '120ms' }}>Pick the kind of work each department does and it comes with the right screens. Here is how four kinds of teams use Metriq.</p>
        </Container>
        <Container className="relative pb-20">
          <div className="grid gap-5 md:grid-cols-2">
            {SOLUTIONS.map((s, i) => (
              <Reveal key={s.key} delay={(i % 2) * 100}>
                <Link to={`/solutions/${s.slug}`} className="group relative block aspect-[16/11] overflow-hidden rounded-[22px] border border-line bg-slate-900">
                  <img src={site(s.image)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.05]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/0" />
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
                    <div className="flex flex-wrap gap-1.5">{s.features.slice(0, 3).map((k) => { const F = FEATURES.find((f) => f.key === k)!; const Icon = FEATURE_ICON[k]; return <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 py-0.5 pl-1 pr-2.5 text-[12px] font-medium text-white backdrop-blur"><HueTile hue={F.hue} size={18}><Icon size={11} /></HueTile>{F.name}</span> })}</div>
                    <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-white sm:text-[26px]">{s.name}</h2>
                    <p className="mt-1.5 max-w-md text-[14.5px] leading-relaxed text-white/75">{s.title}.</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-white">See how <IconArrow size={15} className="transition-transform group-hover:translate-x-0.5" /></span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-dashed border-line-strong bg-card p-6">
              <div><p className="text-[17px] font-semibold text-ink">Just you?</p><p className="mt-1 text-[14.5px] text-ink-muted">Your own tasks, to-dos, daily report and hours, on the Personal plan.</p></div>
              <SecondaryCta to="/start">Start on your own <IconArrow size={15} /></SecondaryCta>
            </div>
          </Reveal>
        </Container>
      </section>
      <CtaBand />
    </MarketingLayout>
  )
}

function SolutionPage({ slug }: { slug: string }) {
  const s = solutionBySlug(slug)
  usePageTitle(s ? `${s.name} · Metriq` : 'Metriq', s?.lead)
  if (!s) return <Navigate to="/solutions" replace />
  const main = FEATURES.find((f) => f.key === s.features[0])!
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden">
        <HueBackdrop hue={s.hue} />
        <Container className="relative grid items-center gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1fr_1fr]">
          <div>
            <Crumbs items={[{ to: '/solutions', label: 'Solutions' }, { label: s.name }]} />
            <h1 className="mk-up mt-6 text-balance text-[38px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[52px]">{s.title}</h1>
            <p className="mk-up mt-5 text-pretty text-[17px] leading-relaxed text-ink-muted" style={{ animationDelay: '120ms' }}>{s.lead}</p>
            <div className="mk-up mt-8 flex flex-wrap gap-3" style={{ animationDelay: '220ms' }}><PrimaryCta /><SecondaryCta to="/solutions">Other teams</SecondaryCta></div>
          </div>
          <div className="relative">
            <div className="mk-rise relative aspect-[4/3] overflow-hidden rounded-[24px] border border-line">
              <img src={site(s.image)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, transparent 40%, rgb(${s.hue.b} / 0.35))` }} />
            </div>
            <div className="mk-float absolute -bottom-6 -left-4 hidden w-[62%] sm:block" style={{ '--mk-delay': '0.5s' } as CSSProperties}>
              <div className="overflow-hidden rounded-[14px] border border-line bg-card shadow-overlay">
                <img src={site(main.image)} alt={`${main.name} in Metriq`} className="block w-full dark:hidden" />
                <img src={site(main.darkImage ?? main.image)} alt="" className="hidden w-full dark:block" />
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-card py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead eyebrow="What changes" title="From the old way to one place" /></Reveal>
          <ul className="mt-12 space-y-3">
            {s.fixes.map((x, i) => (
              <Reveal as="li" key={x.before} delay={i * 120} className="grid items-center gap-3 rounded-[18px] border border-line bg-bg p-4 sm:grid-cols-[1fr_auto_1fr] sm:p-5">
                <span className="flex items-center gap-3 text-[15px] text-ink-muted"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></span><span className="line-through decoration-ink-faint/60">{x.before}</span></span>
                <span className="hidden h-px w-16 sm:block" style={{ backgroundImage: `linear-gradient(to right, transparent, rgb(${s.hue.a}))` }} />
                <span className="flex items-center gap-3 text-[15px] font-semibold text-ink"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundImage: `linear-gradient(to bottom, rgb(${s.hue.a}), rgb(${s.hue.b}))` }}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>{x.after}</span>
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Reveal><SectionHead eyebrow="A day for this team" title="How the day runs in Metriq" /></Reveal>
            <ol className="relative mt-8 space-y-1">
              <span aria-hidden className="absolute bottom-4 left-[19px] top-4 w-px" style={{ backgroundImage: `linear-gradient(to bottom, rgb(${s.hue.a}), rgb(${s.hue.b}))`, opacity: 0.5 }} />
              {s.day.map((d, i) => (
                <Reveal as="li" key={d.time} delay={i * 200} className="relative flex gap-4 p-2">
                  <span className="relative z-[1] flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-line bg-card text-[11px] font-bold tabular-nums" style={{ color: `rgb(${s.hue.a})` }}>{i + 1}</span>
                  <span className="pt-1"><span className="text-[12.5px] font-semibold tabular-nums" style={{ color: `rgb(${s.hue.a})` }}>{d.time}</span><span className="mt-0.5 block text-[15px] text-ink">{d.text}</span></span>
                </Reveal>
              ))}
            </ol>
          </div>
          <Reveal delay={150}><HueCanvas hue={s.hue} image={main.image} darkImage={main.darkImage} alt={`${main.name} in Metriq`} /></Reveal>
        </Container>
      </section>

      <section className="border-y border-line bg-card py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead eyebrow="Screens your team gets" title="The parts this team uses most" /></Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {s.features.map((k) => {
              const f = FEATURES.find((x) => x.key === k)!
              const Icon = FEATURE_ICON[k]
              return (
                <Link key={k} to={`/product/${f.slug}`} className="group rounded-[16px] border border-line bg-bg p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-26px_rgb(var(--shadow)/0.5)]">
                  <HueTile hue={f.hue} size={36}><Icon size={18} /></HueTile>
                  <p className="mt-4 text-[15.5px] font-semibold text-ink">{f.name}</p>
                  <p className="mt-1 text-[13.5px] text-ink-muted">{f.menu}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary">See it <IconArrow size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
                </Link>
              )
            })}
          </div>
        </Container>
      </section>
      <CtaBand />
    </MarketingLayout>
  )
}
