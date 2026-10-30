import { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { MarketingLayout, Container, SectionHead, PrimaryCta, usePageTitle, useLaunch } from './MarketingLayout'
import { BillingToggle, PlanCards } from '../Landing'
import { COMPARE, PLANS, faqsFor } from './content'

/** Public pricing page (Phase 2): the three plans, what each includes, and billing questions. */
export default function Pricing() {
  const { free } = useLaunch()
  usePageTitle('Pricing · Metriq', `One price for the whole team. Personal $5, Starter $29 for up to 10 people, Business $99 for up to 50. ${free ? 'Free while we launch' : '14-day free trial'}, no card.`)
  const [yearly, setYearly] = useState(false)
  const groups = [...new Set(COMPARE.map((r) => r.group))]
  const billingFaq = faqsFor(free).filter((f) => /free|trial|payment|cancel|own/i.test(f.q))
  return (
    <MarketingLayout>
      <section className="py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <SectionHead center eyebrow="Pricing" title="One price for the whole team" text={free ? 'Metriq is free for every company while we launch. These are the prices once online payment opens: a plan covers everyone up to its limit, not per person.' : 'A plan covers everyone up to its limit, not per person. Every plan starts with a 14-day trial with everything on.'} />
            {!free && <div className="mt-8"><BillingToggle yearly={yearly} onChange={setYearly} /></div>}
          </div>
          <div className="mt-12"><PlanCards yearly={yearly} /></div>
          <div className="mt-8 rounded-[14px] border border-line bg-card px-6 py-5 text-center text-[14.5px] text-ink-muted">
            <b className="text-ink">More than 50 people?</b> Start free and write to us from the Help button inside Metriq; we will set up a plan that fits.
            <span className="mt-1 block text-[13px]">Prices in US dollars. {free ? 'Online payment opens later; until then there is nothing to pay, and we will write to you before it opens.' : ''}</span>
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-card py-16 sm:py-24">
        <Container>
          <SectionHead title="Compare the plans" />
          <div className="mt-10 overflow-x-auto rounded-[14px] border border-line bg-bg">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-4 font-medium text-ink-muted">&nbsp;</th>
                  {PLANS.map((p) => <th key={p.key} className="px-5 py-4 text-[15px] font-semibold text-ink">{p.name}<span className="block text-[13px] font-normal text-ink-muted">${yearly ? p.yearly : p.monthly} / {yearly ? 'year' : 'month'}</span></th>)}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g}>
                  <tr><td colSpan={4} className="bg-slate-50 px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{g}</td></tr>
                  {COMPARE.filter((r) => r.group === g).map((r) => (
                    <tr key={r.label} className="border-t border-line">
                      <td className="px-5 py-3.5 text-ink">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td key={i} className="px-5 py-3.5">
                          {v === true ? <Check size={18} className="text-success" aria-label="Included" /> : v === false ? <Minus size={18} className="text-ink-faint" aria-label="Not included" /> : <span className="text-ink">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHead title="Billing questions" />
          <dl className="space-y-6">
            {[...billingFaq, { q: 'Can we change plans later?', a: 'Yes, up or down at any time. A change in the middle of a month is worked out to the day. A smaller plan has to fit the people you have.' }, { q: 'Do you charge per person?', a: 'No. You pay for the plan; everyone up to its limit is included.' }].map((f) => (
              <div key={f.q}><dt className="text-[15.5px] font-semibold text-ink">{f.q}</dt><dd className="mt-1.5 text-[14.5px] leading-relaxed text-ink-muted">{f.a}</dd></div>
            ))}
          </dl>
        </Container>
        <Container className="mt-14 text-center"><PrimaryCta /></Container>
      </section>
    </MarketingLayout>
  )
}
