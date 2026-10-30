import { MarketingLayout, Container, PrimaryCta, Reveal, usePageTitle } from './MarketingLayout'
import { SECURITY } from './content'
import { IconBackup, IconExport, IconKey, IconLock, IconSupport, IconWalls } from './icons'
import { ShieldArt } from './Pictures'

const ICONS = [IconWalls, IconLock, IconBackup, IconKey, IconSupport, IconExport]

/** Public security page (Phase 2): only what Metriq does today. */
export default function Security() {
  usePageTitle('Security · Metriq', 'How Metriq keeps your company’s data separate, encrypted, backed up and yours.')
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-[#0b0c10] py-16 text-white sm:py-24">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_60%_at_75%_30%,rgb(var(--primary)/0.28),transparent)]" />
        <Container className="relative grid items-center gap-12 lg:grid-cols-[1fr_0.9fr]">
          <Reveal>
            <p className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-cyan-300"><span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-cyan-300" />Security</p>
            <h1 className="mt-4 text-balance text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">Your company's data stays your company's</h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-white/65 sm:text-[18px]">What Metriq does today to keep your records separate, safe and yours. No promises we do not keep.</p>
          </Reveal>
          <Reveal delay={150}><ShieldArt /></Reveal>
        </Container>
      </section>
      <section className="py-16 sm:py-24">
        <Container>
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map((s, i) => {
              const Icon = ICONS[i] ?? IconWalls
              return (
                <Reveal as="li" key={s.title} delay={(i % 3) * 80} className="rounded-[18px] border border-line bg-card p-6 transition-shadow hover:shadow-[0_20px_50px_-24px_rgb(var(--primary)/0.45)]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-gradient-to-b from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20"><Icon size={22} /></span>
                  <h2 className="mt-5 text-[17px] font-semibold text-ink">{s.title}</h2>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{s.text}</p>
                </Reveal>
              )
            })}
          </ul>
        </Container>
      </section>
      <section className="border-t border-line bg-card py-16 sm:py-20">
        <Container className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Inside your company</h2>
            <ul className="mt-5 space-y-3 text-[15px] text-ink-muted">
              <li>• Members see their own work; team leads see their team; the Super Admin sees the company.</li>
              <li>• Finance and company settings are powers you give to named people only.</li>
              <li>• Check-in can be limited to your office network.</li>
              <li>• An activity log shows who changed what.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Questions about security?</h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">Start free and write to us from the Help button inside Metriq. We answer security and data questions before you bring your team over.</p>
            <div className="mt-6"><PrimaryCta /></div>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  )
}
