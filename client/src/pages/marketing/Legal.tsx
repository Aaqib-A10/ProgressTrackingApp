import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { MarketingLayout, Container, usePageTitle } from './MarketingLayout'
import { LEGAL, LEGAL_DOCS, type LegalDoc } from './legal'
import { IconCheck } from './icons'

/** /terms, /privacy, /cookies and /dpa: one layout, a list of sections at the side. */
export default function Legal() {
  const { pathname } = useLocation()
  const doc = LEGAL_DOCS.find((d) => `/${d.slug}` === pathname) ?? LEGAL_DOCS[0]
  usePageTitle(`${doc.title} · Metriq`, `Metriq ${doc.title}: ${doc.summary[0]}`)
  const active = useActiveSection(doc)
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden border-b border-line bg-card">
        <div aria-hidden className="mk-grid absolute inset-0 opacity-70" />
        <Container className="relative py-14 sm:py-20">
          <nav aria-label="Legal pages" className="flex flex-wrap gap-2">
            {LEGAL_DOCS.map((d) => (
              <Link key={d.slug} to={`/${d.slug}`} className={cn('rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition-colors', d.slug === doc.slug ? 'border-primary bg-primary text-white' : 'border-line bg-card text-ink-muted hover:text-ink')}>{d.title}</Link>
            ))}
          </nav>
          <h1 className="mt-8 text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[52px]">{doc.title}</h1>
          <p className="mt-3 text-[14.5px] text-ink-muted">Last updated {LEGAL.updated} · {LEGAL.operator}</p>
          <div className="mt-8 max-w-3xl rounded-[16px] border border-primary/20 bg-primary/5 p-5 sm:p-6">
            <p className="text-[13px] font-semibold text-primary">In short</p>
            <ul className="mt-3 space-y-2">
              {doc.summary.map((s) => <li key={s} className="flex gap-2.5 text-[15px] leading-relaxed text-ink"><IconCheck size={16} className="mt-1 shrink-0 text-primary" />{s}</li>)}
            </ul>
            <p className="mt-4 text-[13px] text-ink-muted">This summary helps you read the page; the full text below is what applies.</p>
          </div>
        </Container>
      </section>
      <Container className="grid gap-12 py-14 lg:grid-cols-[230px_1fr] lg:py-20">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 space-y-0.5 border-l border-line">
            {doc.sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                className={cn('-ml-px block border-l-2 py-1.5 pl-4 text-[13.5px] transition-colors', active === s.id ? 'border-primary font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>{s.title.replace(/^\d+\.\s*/, '')}</a>
            ))}
          </nav>
        </aside>
        <article className="max-w-3xl">
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-b border-line py-8 first:pt-0 last:border-0">
              <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-ink">{s.title}</h2>
              <div className="mt-4 space-y-4 text-[15.5px] leading-[1.75] text-ink-muted">
                {s.body.map((b, i) => Array.isArray(b)
                  ? <ul key={i} className="space-y-2 pl-1">{b.map((x) => <li key={x} className="flex gap-3"><span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />{x}</li>)}</ul>
                  : <p key={i}>{b}</p>)}
              </div>
            </section>
          ))}
          <p className="mt-6 rounded-[12px] border border-line bg-card p-4 text-[13.5px] text-ink-muted">Related: {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d, i) => <span key={d.slug}>{i > 0 && ' · '}<Link to={`/${d.slug}`} className="font-medium text-primary hover:underline">{d.title}</Link></span>)}</p>
        </article>
      </Container>
    </MarketingLayout>
  )
}

/** The section being read, for the side list. */
function useActiveSection(doc: LegalDoc) {
  const [active, setActive] = useState(doc.sections[0]?.id)
  useEffect(() => {
    setActive(doc.sections[0]?.id)
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      const on = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (on) setActive(on.target.id)
    }, { rootMargin: '-90px 0px -65% 0px' })
    doc.sections.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [doc])
  return active
}
