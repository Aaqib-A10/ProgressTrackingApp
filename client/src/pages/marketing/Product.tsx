import { Link, Navigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { MarketingLayout, Container, SectionHead, PrimaryCta, SecondaryCta, Reveal, usePageTitle, useLaunch } from './MarketingLayout'
import { AccentTitle, CtaBand, Crumbs, FEATURE_ICON, HueBackdrop, HueCanvas, HueTile } from './Blocks'
import { ConsolidateArt, TeamsArt, RolesArt, AskArt, PhoneArt } from './Pictures'
import { EXTRAS, FEATURES, featureBySlug } from './pages'
import { IconArrow, IconCheck, IconConnect, IconDepartments, IconPhone, IconRoles } from './icons'
import { site } from './content'

/** /product: the whole of Metriq, part by part. /product/:slug: one part in detail. */

export default function Product() {
  const { slug } = useParams()
  if (slug) return <FeaturePage slug={slug} />
  return <Overview />
}

const EXTRA_ICON = { studio: IconDepartments, roles: IconRoles, ai: IconConnect, mobile: IconPhone } as const
const EXTRA_ART = { studio: TeamsArt, roles: RolesArt, ai: AskArt, mobile: PhoneArt } as const

function Overview() {
  const { free } = useLaunch()
  usePageTitle('Product · Metriq', 'Attendance, projects, chat and calls, daily reports and a Lead Dialer for calling teams: the parts of Metriq and how they work together.')
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden">
        <HueBackdrop hue={{ a: '99 102 241', b: '6 182 212' }} />
        <Container className="relative pb-10 pt-16 text-center sm:pt-24">
          <div className="flex justify-center"><Crumbs items={[{ to: '/', label: 'Home' }, { label: 'Product' }]} /></div>
          <h1 className="mk-up mx-auto mt-6 max-w-3xl text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.045em] text-ink sm:text-[60px]">One app for the whole working day</h1>
          <p className="mk-up mx-auto mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-ink-muted sm:text-[19px]" style={{ animationDelay: '120ms' }}>Five parts that share the same people, the same clock and the same day. Turn on the ones each team needs.</p>
          <div className="mk-up mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '220ms' }}><PrimaryCta /><SecondaryCta to="/pricing">See pricing</SecondaryCta></div>
          <p className="mt-4 text-[13.5px] text-ink-muted">{free ? 'Free while we launch' : '14 days free'} · No card needed</p>
        </Container>
        <Container className="relative pb-16">
          <div className="grid gap-4 md:grid-cols-6">
            {FEATURES.map((f, i) => {
              const Icon = FEATURE_ICON[f.key]
              return (
                <Reveal key={f.key} delay={(i % 3) * 90} className={cn(i < 2 ? 'md:col-span-3' : 'md:col-span-2')}>
                  <Link to={`/product/${f.slug}`} className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-line bg-card transition-shadow duration-300 hover:shadow-[0_24px_60px_-30px_rgb(var(--shadow)/0.5)]">
                    <div className="p-6">
                      <div className="flex items-center gap-3"><HueTile hue={f.hue}><Icon size={20} /></HueTile><span className="text-[17px] font-semibold text-ink">{f.name}</span></div>
                      <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{f.menu}.</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-primary">See how it works <IconArrow size={15} className="transition-transform group-hover:translate-x-0.5" /></span>
                    </div>
                    <div className="relative mt-auto overflow-hidden p-4 pt-0 sm:p-5 sm:pt-0">
                      <div className="relative overflow-hidden rounded-[14px] p-3 sm:p-4" style={{ background: `linear-gradient(135deg, rgb(${f.hue.a} / 0.2), rgb(${f.hue.b} / 0.2))` }}>
                        <img src={site(f.image)} alt="" loading="lazy" className={cn('block w-full rounded-[10px] border border-line shadow-overlay transition-transform duration-700 group-hover:-translate-y-1', f.darkImage && 'dark:hidden')} />
                        {f.darkImage && <img src={site(f.darkImage)} alt="" loading="lazy" className="hidden w-full rounded-[10px] border border-line shadow-overlay transition-transform duration-700 group-hover:-translate-y-1 dark:block" />}
                      </div>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
            <Reveal delay={180} className="md:col-span-6">
              <div className="flex h-full flex-wrap items-center justify-between gap-4 rounded-[20px] border border-dashed border-line-strong bg-bg p-6">
                <div className="max-w-2xl">
                  <p className="text-[17px] font-semibold text-ink">Which parts do you need?</p>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">Pick the kind of work each department does and it comes with the right screens. Nothing is deleted when you turn one off.</p>
                </div>
                <SecondaryCta to="/solutions">See it by team <IconArrow size={15} /></SecondaryCta>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-card py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead center eyebrow="Fewer tools" title="How the parts fit together" text="The same people and the same day run through every part: a check-in, a task, a call and a report all land in one place." /></Reveal>
          <div className="mt-14"><ConsolidateArt /></div>
        </Container>
      </section>

      <section className="py-20 sm:py-28">
        <Container>
          <Reveal><SectionHead eyebrow="And more" title="Made to fit your company" /></Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {EXTRAS.map((x, i) => {
              const Icon = EXTRA_ICON[x.key]
              const Art = EXTRA_ART[x.key]
              return (
                <Reveal key={x.key} delay={(i % 2) * 90} className="flex flex-col rounded-[18px] border border-line bg-card p-6">
                  <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-gradient-to-b from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20"><Icon size={21} /></span><h3 className="text-[17px] font-semibold text-ink">{x.title}</h3></div>
                  <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{x.text}</p>
                  <div className="mt-auto"><Art /></div>
                </Reveal>
              )
            })}
          </div>
        </Container>
      </section>
      <CtaBand />
    </MarketingLayout>
  )
}

function FeaturePage({ slug }: { slug: string }) {
  const f = featureBySlug(slug)
  usePageTitle(f ? `${f.name} · Metriq` : 'Metriq', f?.lead)
  const { free } = useLaunch()
  if (!f) return <Navigate to="/product" replace />
  const others = FEATURES.filter((x) => x.key !== f.key)
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden">
        <HueBackdrop hue={f.hue} />
        <div className="relative mx-auto grid max-w-[1280px] items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
          <div>
            <Crumbs items={[{ to: '/product', label: 'Product' }, { label: f.name }]} />
            <h1 className="mk-up mt-6 text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[56px] lg:text-[58px]" style={{ animationDelay: '60ms' }}><AccentTitle text={f.title} accent={f.accent} hue={f.hue} /></h1>
            <p className="mk-up mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-ink-muted sm:text-[18px]" style={{ animationDelay: '160ms' }}>{f.lead}</p>
            <div className="mk-up mt-8 flex flex-wrap gap-3" style={{ animationDelay: '240ms' }}><PrimaryCta /><SecondaryCta to="/product">All of Metriq</SecondaryCta></div>
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-ink-muted">{[free ? 'Free while we launch' : '14 days free', 'No card needed'].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><IconCheck size={14} className="text-success" />{t}</span>)}</p>
          </div>
          <HueCanvas hue={f.hue} image={f.image} darkImage={f.darkImage} alt={`${f.name} in Metriq`} eager />
        </div>
      </section>

      <section className="border-y border-line bg-card py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead eyebrow="What you get" title={`${f.name}, part by part`} /></Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {f.highlights.map((h, i) => (
              <Reveal key={h.title} delay={(i % 3) * 80} className="group relative overflow-hidden rounded-[18px] border border-line bg-bg p-6 transition-shadow duration-300 hover:shadow-[0_20px_50px_-28px_rgb(var(--shadow)/0.5)]">
                <div aria-hidden className="absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" style={{ background: `rgb(${f.hue.a} / 0.25)` }} />
                <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: `rgb(${f.hue.a})` }}>{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 text-[16.5px] font-semibold text-ink">{h.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{h.text}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead center eyebrow="How it works" title="Three steps, and it runs itself" /></Reveal>
          <ol className="relative mt-14 grid gap-8 md:grid-cols-3">
            <span aria-hidden className="absolute left-[16.6%] right-[16.6%] top-5 hidden h-[2px] md:block" style={{ backgroundImage: `linear-gradient(to right, rgb(${f.hue.a}), rgb(${f.hue.b}))`, opacity: 0.5 }} />
            {f.steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 150} className="relative flex flex-col items-center text-center">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold text-white shadow-[0_0_0_6px_rgb(var(--bg))]" style={{ backgroundImage: `linear-gradient(to bottom, rgb(${f.hue.a}), rgb(${f.hue.b}))` }}>{i + 1}</span>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 max-w-xs text-[14.5px] leading-relaxed text-ink-muted">{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-y border-line bg-card py-20 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal><SectionHead eyebrow="Questions" title={`About ${f.name.toLowerCase()}`} /></Reveal>
          <dl className="space-y-4">
            {f.faqs.map((q) => <div key={q.q} className="rounded-[16px] border border-line bg-bg p-5"><dt className="text-[15.5px] font-semibold text-ink">{q.q}</dt><dd className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{q.a}</dd></div>)}
          </dl>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container>
          <Reveal><SectionHead eyebrow="Works with" title="The rest of Metriq" /></Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((o) => {
              const OIcon = FEATURE_ICON[o.key]
              return (
                <Link key={o.key} to={`/product/${o.slug}`} className="group rounded-[16px] border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-26px_rgb(var(--shadow)/0.5)]">
                  <HueTile hue={o.hue} size={36}><OIcon size={18} /></HueTile>
                  <p className="mt-4 text-[15.5px] font-semibold text-ink">{o.name}</p>
                  <p className="mt-1 text-[13.5px] text-ink-muted">{o.menu}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary">Open <IconArrow size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
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
