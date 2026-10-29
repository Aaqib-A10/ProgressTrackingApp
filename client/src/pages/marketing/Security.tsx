import { ShieldCheck, Lock, DatabaseBackup, UserCog, LifeBuoy, FileDown } from 'lucide-react'
import { MarketingLayout, Container, SectionHead, PrimaryCta, usePageTitle } from './MarketingLayout'
import { SECURITY } from './content'

const ICONS = [ShieldCheck, Lock, DatabaseBackup, UserCog, LifeBuoy, FileDown]

/** Public security page (Phase 2): only what Metriq does today. */
export default function Security() {
  usePageTitle('Security · Metriq', 'How Metriq keeps your company’s data separate, encrypted, backed up and yours.')
  return (
    <MarketingLayout>
      <section className="py-16 sm:py-24">
        <Container>
          <SectionHead center eyebrow="Security" title="Your company's data stays your company's" text="What Metriq does today to keep your records separate, safe and yours. No promises we do not keep." />
          <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map((s, i) => {
              const Icon = ICONS[i] ?? ShieldCheck
              return (
                <li key={s.title} className="rounded-[14px] border border-line bg-card p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-card bg-primary/10 text-primary"><Icon size={18} /></span>
                  <h2 className="mt-5 text-[17px] font-semibold text-ink">{s.title}</h2>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{s.text}</p>
                </li>
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
            <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">Start a trial and write to us from the Help button inside Metriq. We answer security and data questions before you bring your team over.</p>
            <div className="mt-6"><PrimaryCta /></div>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  )
}
