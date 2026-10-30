import { useRef, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { AppFrame, Container, useLaunch } from './MarketingLayout'
import { IconArrow, IconAttendance, IconBoard, IconChat, IconDialer, IconReport } from './icons'
import { OrbitArt } from './Pictures'
import { site } from './content'
import type { FeatureKey, Hue } from './pages'

/** Pieces shared by the Product and Solutions pages. */

export const FEATURE_ICON: Record<FeatureKey, typeof IconAttendance> = { attendance: IconAttendance, projects: IconBoard, chat: IconChat, reports: IconReport, sales: IconDialer }

/** A tile in a part's own colours. */
export function HueTile({ hue, children, size = 40, className }: { hue: Hue; children: ReactNode; size?: number; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-[30%] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_20px_-10px_rgb(0_0_0/0.4)]', className)} style={{ width: size, height: size, backgroundImage: `linear-gradient(to bottom, rgb(${hue.a}), rgb(${hue.b}))` }}>
      {children}
    </span>
  )
}

/** A screen of Metriq on a canvas in the part's colours, tilting a little with the pointer. */
export function HueCanvas({ hue, image, darkImage, alt, eager, className }: { hue: Hue; image: string; darkImage?: string; alt: string; eager?: boolean; className?: string }) {
  const stage = useRef<HTMLDivElement>(null)
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !stage.current) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    stage.current.style.transform = `perspective(1600px) rotateY(${x * 5}deg) rotateX(${-y * 4}deg)`
  }
  return (
    <div className={cn('relative overflow-hidden rounded-[24px] border border-line', className)} onPointerMove={tilt} onPointerLeave={() => { if (stage.current) stage.current.style.transform = '' }}>
      <div aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 0% 0%, rgb(${hue.a} / 0.24), transparent 55%), radial-gradient(100% 80% at 100% 100%, rgb(${hue.b} / 0.24), transparent 60%), rgb(var(--card))` }} />
      <div aria-hidden className="mk-grid absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,#000,transparent)]" style={{ backgroundSize: '32px 32px' }} />
      {/* The whole screen, with room around it (never cut off at the edge). */}
      <div className="relative p-4 sm:p-7 lg:p-9">
        <div ref={stage} className="transition-transform duration-300 ease-out" style={{ transformOrigin: '50% 50%' }}>
          <div className="mk-rise">
            <AppFrame src={site(image)} darkSrc={darkImage ? site(darkImage) : undefined} alt={alt} eager={eager} className="shadow-[0_30px_60px_-20px_rgb(var(--shadow)/0.45)]" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** A page title with its last words in the feature's colours. */
export function AccentTitle({ text, accent, hue }: { text: string; accent?: string; hue: Hue }) {
  const at = accent ? text.lastIndexOf(accent) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="mk-accent bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(100deg, rgb(${hue.a}), rgb(${hue.b}), rgb(${hue.a}))` }}>{accent}</span>
      {text.slice(at + accent!.length)}
    </>
  )
}

/** The soft coloured light behind a page's first screen. */
export function HueBackdrop({ hue }: { hue: Hue }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[760px] overflow-hidden">
      <div className="mk-aurora left-[2%] top-[-180px] h-[520px] w-[620px]" style={{ background: `radial-gradient(circle, rgb(${hue.a} / 0.5), transparent 65%)`, animation: 'mk-drift-a 18s ease-in-out infinite alternate' }} />
      <div className="mk-aurora right-[0%] top-[-60px] h-[460px] w-[560px]" style={{ background: `radial-gradient(circle, rgb(${hue.b} / 0.38), transparent 65%)`, animation: 'mk-drift-b 22s ease-in-out infinite alternate' }} />
      <div className="mk-grid absolute inset-0" style={{ backgroundPosition: 'center top' }} />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
    </div>
  )
}

/** The closing call at the end of a page. */
export function CtaBand({ title = 'Give your team one place to work' }: { title?: string }) {
  const { free } = useLaunch()
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#0b0c10] px-6 py-24 text-center sm:px-12 sm:py-28">
          <div aria-hidden className="mk-aurora mk-aurora-a left-[10%] top-[-30%] h-[420px] w-[520px] !opacity-80" />
          <div aria-hidden className="mk-aurora mk-aurora-b bottom-[-40%] right-[5%] h-[420px] w-[520px] !opacity-60" />
          <OrbitArt />
          <div aria-hidden className="absolute inset-0 z-[1] bg-[radial-gradient(38%_42%_at_50%_50%,rgb(11_12_16/0.85),transparent)]" />
          <h2 className="relative z-[3] mx-auto max-w-2xl text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[44px]">{title}</h2>
          <p className="relative z-[3] mx-auto mt-4 max-w-xl text-[16px] text-white/70 sm:text-[17px]">{free ? 'Free while we launch, with everything on. No card, nothing to install.' : 'Start a 14-day trial with everything on. No card, nothing to install.'}</p>
          <div className="relative z-[3] mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/start" className="group inline-flex h-12 items-center gap-2 rounded-btn bg-white px-6 text-[15px] font-semibold text-[#0b0c10] shadow-[0_10px_40px_-10px_rgb(255_255_255/0.5)] transition-transform hover:-translate-y-0.5">Start free<IconArrow size={16} className="transition-transform group-hover:translate-x-0.5" /></Link>
            <Link to="/pricing" className="inline-flex h-12 items-center rounded-btn border border-white/20 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">See pricing</Link>
          </div>
        </div>
      </Container>
    </section>
  )
}

/** "Product / Attendance" above a page title. */
export function Crumbs({ items }: { items: { to?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ink-muted">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-faint">/</span>}
          {it.to ? <Link to={it.to} className="hover:text-ink">{it.label}</Link> : <span className="text-ink">{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}
